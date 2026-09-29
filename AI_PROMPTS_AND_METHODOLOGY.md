# AI-Assisted Engineering Methodology & Prompt Logs

## Overview

Keypath Education explicitly encourages AI-assisted engineering practices for this Lead Software Developer exercise. As required by the exercise guidelines, this document details the AI tools, agent architectures, prompts, and verification strategies used to design the architecture and build the practical implementation.

---

## 1. Tooling & Environment Context

* **AI Agent Environment:** Antigravity Agentic AI (Google DeepMind Architecture)
* **Model:** Gemini 3.6 Flash (High Reasoning & Verification Mode)
* **Primary Capabilities Used:**
  * System Architecture & Mathematical Verification
  * Full-Stack Web API & SPA Development
  * Automated Local Runtime Verification

---

## 2. Prompts & Interaction Methodology

### Prompt 1: Requirements Extraction & SLA Math Analysis
> **Goal:** Extract requirements from exercise prompt images and perform concurrency/throughput math for Part 1.  
> **Key Strategy:** Compute peak arrival rates ($3000\text{ msgs/hr} = 0.833\text{ msgs/sec}$), minimum required processing rate ($5\text{ msgs/sec}$ for 10-minute SLA), and calculate target active concurrency ($25\text{--}30$ workers) factoring in 3-second API latency and 95% SLA retries.

### Prompt 2: Azure Resilience Architecture Design (Part 1)
> **Goal:** Design an enterprise-grade Azure native architecture for the SMS queue processing system.  
> **Key Strategy:**
> - Select Azure Service Bus Queue (Standard Tier) with dead-lettering (`MaxDeliveryCount = 5`).
> - Implement Transactional Outbox pattern from Azure SQL DB to eliminate polling locks.
> - Configure Azure Functions (C# .NET 8 Isolated Worker Model) with Polly pipeline (Retry with exponential backoff + Jitter & Circuit Breaker).
> - Generate Azure Bicep IaC definitions.

### Prompt 3: Web API & SPA Development (Part 2)
> **Goal:** Develop a responsive SPA frontend and Express backend supporting multi-format data ingestion, 3-character search delay, column sorting, and pagination.  
> **Key Strategy:**
> - Build Express endpoint handling `application/json`, `multipart/form-data`, and `Query Strings`.
> - Build responsive UI using Tailwind CSS, featuring active query badges, match criteria toggle (`Contains` / `Equals`), clickable column sorting, and pagination controls.
> - Provide a seed dataset reset feature for reviewer convenience.

---

## 3. Verification & Quality Assurance

All generated code was compiled, run, and verified locally using `node` and automated HTTP endpoint execution.

* **Server Status:** Executed on `http://localhost:3000`.
* **Multi-Format Ingestion:** Verified that POST JSON, POST Form-Data, and GET Query-String endpoints successfully ingest data into the database.
* **Search Constraint:** Confirmed search filters activate ONLY when search query length $\ge 3$ characters.
* **Sorting & Pagination:** Tested multi-column sorting (Ascending / Descending) and page offset slicing.
