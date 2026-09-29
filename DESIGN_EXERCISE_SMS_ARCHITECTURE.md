# Keypath Education - SMS Queue Processing System Architecture
## Part 1: System Design Specification

---

## 1. Executive Summary & Problem Overview

Keypath Education requires a resilient, scalable, and cost-effective Azure-native architecture to process text messages from a data source and deliver them via a third-party SMS API within a strict **10-minute SLA window**.

### Key System Metrics & Constraints
* **Daily Volume:** 10,000 messages / day.
* **Peak Volume:** 3,000 messages / hour (centered around 12:00 PM Noon).
* **Third-Party API Performance:** 
  * 3-second round-trip latency per request.
  * 95% uptime SLA (5% failure rate requiring retries / circuit breaking).
  * Unlimited API bandwidth.
  * Synchronous deliverability status return (`Successfully Sent`, `Not Sent – Not a valid phone`, `Not Sent – Not valid by Time zone`).
* **SLA Requirement:** Target delivery of all messages within **10 minutes** of creation ($T_{max} = 600\text{ seconds}$).

---

## 2. SLA & Throughput Mathematical Analysis

To guarantee the **10-minute delivery SLA** during peak ingestion bursts, we derive the concurrency requirements:

$$\text{Peak Arrival Rate} = \frac{3,000 \text{ messages}}{3,600 \text{ seconds}} = 0.833 \text{ msgs/sec}$$

If 3,000 messages are enqueued simultaneously at 12:00 PM:
$$\text{Required Minimum Processing Rate} = \frac{3,000 \text{ messages}}{600 \text{ seconds (10 mins)}} = 5 \text{ msgs/sec}$$

Given each API call takes 3 seconds ($T_{latency} = 3\text{s}$):
$$\text{Minimum Active Concurrency} = \text{Required Rate} \times T_{latency} = 5 \text{ msgs/sec} \times 3 \text{ sec/msg} = 15 \text{ worker threads}$$

### Resilience Overhead Factor
Accounting for the third-party API's 95% SLA (retries on 5% transient failures and HTTP timeouts):
$$\text{Target Concurrency} = 15 \text{ workers} \times 1.5 \text{ safety buffer} = \mathbf{25\text{ to }30\text{ concurrent workers}}$$

---

## 3. High-Level Azure Architecture Diagram

```mermaid
flowchart TD
    subgraph Data Layer
        A[Azure SQL Database / Application DB] -->|Transactional Outbox / CDC / Trigger| B[Outbox Processor / Change Feed]
    end

    subgraph Messaging & Ingestion
        B -->|Publish Event| C[Azure Service Bus Queue: sms-messages-queue]
        C -->|Dead Letter after 5 Retries| DLQ[Service Bus DLQ: sms-messages-dlq]
    end

    subgraph Compute & Resilience Layer
        C -->|Service Bus Trigger | D[Azure Functions Worker Pool]
        D -->|HttpClient + Polly Circuit Breaker| E[3rd Party SMS API]
    end

    subgraph Status Feedback & Observability
        E -->|Synchronous Response| D
        D -->|Async Batch Update| A
        D -->|Logs & Metrics| F[Azure Application Insights / Log Analytics]
        DLQ -->|Alert & Reconciliation| G[DLQ Monitor Azure Function / Logic App]
```

---

## 4. End-to-End Component Breakdown

### A. Data Source & Transactional Outbox Pattern
* **Database:** Azure SQL Database (Serverless or Server-based).
* **Pattern:** **Transactional Outbox Pattern** or **SQL Change Data Capture (CDC)**.
  * When a message record is inserted into `Messages` with `Status = 'Pending'`, a database trigger or light outbox background service pushes the `Message` payload to **Azure Service Bus**.
  * Avoids polling lock-contention on SQL DB and guarantees decoupled scaling.

### B. Message Buffer (Azure Service Bus)
* **Resource:** Azure Service Bus Queue (`sms-messages-queue`).
* **Configuration:**
  * `MaxDeliveryCount`: 5
  * `LockDuration`: 30 seconds
  * `EnableDeadLetteringOnMessageExpiration`: True
* **Benefits:** Provides competing consumers, message lock management, auto-scaling metric for compute, and built-in dead-letter handling.

### C. Compute & Consumer Layer (Azure Functions / Container Apps)
* **Compute Service:** **Azure Functions** (C# .NET 8 Isolated Worker Model) or **Azure Container Apps** with KEDA scaling.
* **Auto-Scaling Strategy:** Scales instance count automatically based on queue depth.
* **Concurrency:** Configured via `host.json`:
  ```json
  {
    "version": "2.0",
    "extensions": {
      "serviceBus": {
        "maxConcurrentCalls": 32,
        "maxAutoLockRenewDuration": "00:05:00"
      }
    }
  }
  ```

### D. Third-Party API Integration & Resilience (Polly Policies)
* **Resilience Mechanisms:**
  1. **Transient Fault Handling:** Exponential backoff retry with jitter (Retry count = 3, initial pause = 2s).
  2. **Circuit Breaker Pattern:** If 5 consecutive failures occur within 30 seconds, open circuit for 60 seconds to allow the third-party API to recover without flooding it.
  3. **Non-Retryable Errors:** Synchronous non-retryable responses (`Not Sent – Not a valid phone`, `Not Sent – Not valid by Time zone`) bypass retries and update status immediately in SQL DB.

---

## 5. Working C# / Azure Function Implementation Code

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Polly;
using Polly.CircuitBreaker;
using Polly.Retry;

namespace Keypath.SmsProcessor
{
    public record SmsMessageRequest(
        long Id,
        long To,
        long From,
        string Message,
        string Status,
        DateTime CreatedDateTime
    );

    public record SmsApiResponse(string Status, string ErrorDetails);

    public class SmsDeliveryFunction
    {
        private readonly HttpClient _httpClient;
        private readonly ISmsRepository _smsRepository;
        private readonly ILogger<SmsDeliveryFunction> _logger;
        private static readonly AsyncResiliencePipeline _resiliencePipeline;

        static SmsDeliveryFunction()
        {
            // Build Polly resilience pipeline (Retry + Circuit Breaker)
            _resiliencePipeline = new ResiliencePipelineBuilder()
                .AddRetry(new RetryStrategyOptions
                {
                    ShouldHandle = new PredicateBuilder().Handle<HttpRequestException>(),
                    MaxRetryAttempts = 3,
                    Delay = TimeSpan.FromSeconds(2),
                    BackoffType = DelayBackoffType.Exponential,
                    UseJitter = true
                })
                .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
                {
                    ShouldHandle = new PredicateBuilder().Handle<HttpRequestException>(),
                    FailureRatio = 0.5,
                    SamplingDuration = TimeSpan.FromSeconds(30),
                    MinimumThroughput = 5,
                    BreakDuration = TimeSpan.FromSeconds(60)
                })
                .Build();
        }

        public SmsDeliveryFunction(HttpClient httpClient, ISmsRepository smsRepository, ILogger<SmsDeliveryFunction> logger)
        {
            _httpClient = httpClient;
            _smsRepository = smsRepository;
            _logger = logger;
        }

        [Function(nameof(ProcessSmsQueue))]
        public async Task ProcessSmsQueue(
            [ServiceBusTrigger("sms-messages-queue", Connection = "ServiceBusConnection")] SmsMessageRequest smsRequest)
        {
            _logger.LogInformation("Processing SMS ID {Id} to {To}", smsRequest.Id, smsRequest.To);

            string finalStatus = "Failed - Unknown";

            try
            {
                // Execute API Call through Polly Resilience Pipeline
                var response = await _resiliencePipeline.ExecuteAsync(async ct =>
                {
                    var payload = new
                    {
                        From = smsRequest.From.ToString(),
                        To = smsRequest.To.ToString(),
                        Message = smsRequest.Message
                    };

                    var res = await _httpClient.PostAsJsonAsync("https://api.3rdparty-sms.com/send", payload, ct);
                    res.EnsureSuccessStatusCode();

                    return await res.Content.ReadFromJsonAsync<SmsApiResponse>(cancellationToken: ct);
                });

                finalStatus = response?.Status switch
                {
                    "Successfully Sent" => "Successfully Sent",
                    "Not Sent – Not a valid phone" => "Not Sent – Not a valid phone",
                    "Not Sent – Not valid by Time zone" => "Not Sent – Not valid by Time zone",
                    _ => response?.Status ?? "Not Sent - Undefined Status"
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "HTTP failure sending SMS ID {Id}", smsRequest.Id);
                finalStatus = "Not Sent - Network/API Failure";
                throw; // Triggers Service Bus retry / dead-lettering if retries exhausted
            }
            catch (BrokenCircuitException ex)
            {
                _logger.LogWarning(ex, "Circuit open. SMS ID {Id} delayed", smsRequest.Id);
                finalStatus = "Not Sent - Circuit Breaker Open";
                throw;
            }
            finally
            {
                // Update database record status
                await _smsRepository.UpdateMessageStatusAsync(smsRequest.Id, finalStatus, DateTime.UtcNow);
            }
        }
    }

    public interface ISmsRepository
    {
        Task UpdateMessageStatusAsync(long id, string status, DateTime modifiedDateTime);
    }
}
```

---

## 6. Infrastructure Provisioning (Azure Bicep / IaC)

```bicep
param location string = resourceGroup().location
param environment string = 'dev'

// Azure Service Bus Namespace & Queue
resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: 'sb-keypath-${environment}'
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
}

resource smsQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'sms-messages-queue'
  properties: {
    maxDeliveryCount: 5
    lockDuration: 'PT30S'
    deadLetteringOnMessageExpiration: true
  }
}

// Azure App Service Plan (Consumption / Elastic Premium for Azure Functions)
resource functionPlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: 'asp-keypath-${environment}'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
}

// Azure Function App
resource functionApp 'Microsoft.Web/sites@2022-09-01' = {
  name: 'func-sms-processor-${environment}'
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: functionPlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'dotnet-isolated'
        }
        {
          name: 'ServiceBusConnection'
          value: listKeys(resourceId('Microsoft.ServiceBus/namespaces/authorizationRules', serviceBusNamespace.name, 'RootManageSharedAccessKey'), '2022-10-01-preview').primaryConnectionString
        }
      ]
    }
  }
}
```

---

## 7. Cost & Azure Free Tier Eligibility

| Azure Component | Pricing Tier | Estimated Monthly Cost | Free Tier Eligible? |
| :--- | :--- | :--- | :--- |
| **Azure Functions** | Consumption (Y1) | $0.00 (First 1,000,000 executions free) | Yes |
| **Azure Service Bus** | Standard | ~$0.05 / 10K operations | Included in $200 Trial Credit |
| **Azure SQL DB** | Serverless / General Purpose | ~$5.00 / month (or free 32GB offer) | Yes |
| **Application Insights** | Basic | $0.00 (First 5 GB data ingestion free) | Yes |
| **Total Estimated Cost** | - | **<$5.00 / month** | **100% covered by Azure Free Account** |
