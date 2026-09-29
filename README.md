# Keypath Education - Lead Software Developer Assessment Submission

This repository contains the complete submission package for the **Keypath Lead Software Developer Exercise**.

---

## 📁 Submission Directory Structure

```
Keypath/
├── EXERCISE_REQUIREMENTS.md            # Transcribed prompt, givens, & rules from prompt images
├── DESIGN_EXERCISE_SMS_ARCHITECTURE.md # Part 1: SMS Queue Architecture & Azure System Design
├── EXECUTION_PLAN_AND_SETUP.md         # Setup instructions, prerequisites, & execution roadmap
├── AI_PROMPTS_AND_METHODOLOGY.md       # AI methodology & prompt log (as requested by Keypath)
└── solution/                           # Part 2: Working Web API & Single Page Application (SPA)
    ├── package.json
    ├── server.js                        # Express Web API (Multi-format ingestion, sorting, pagination)
    └── public/
        ├── index.html                  # Responsive Single Page Application UI
        └── app.js                      # Client-side state, 3-char search, sorting, & API runner
```

---

## 🚀 Quick Start Guide (Part 2 Web API & SPA)

### Prerequisites
* **Node.js** (v18 or higher recommended; v20 tested)

### Running Locally
1. Open terminal in the `solution/` directory:
   ```bash
   cd solution
   ```
2. Install dependencies (if not already installed):
   ```bash
   npm install
   ```
3. Start the application server:
   ```bash
   npm start
   ```
4. Open your browser and navigate to:
   [http://localhost:3000](http://localhost:3000)
5. Run the automated test suite:
   ```bash
   npm test
   ```

---

## ✨ Features Implemented (Part 2 Requirements)

1. **Multi-Format Data Ingestion Endpoint (`/api/records/ingest`):**
   - Ingests data passed as **JSON Body**, **Form-Data**, or **Query String**.
   - Requires at least one string field (`stringValue`).
2. **Search & Match Logic:**
   - Enforces the **3-character minimum** input rule before activating backend filter.
   - Supports **Contains** and **Equals** match criteria dropdown.
3. **Reorderable Column Sorting:**
   - Interactive table header clicks toggle ascending/descending sort order for String Value, Category, Submitted By, Submitted On, Modified On, and Status.
4. **Pagination:**
   - Configurable page size (5, 10, 20 items) with Next/Prev page navigation.
5. **Interactive Ingestion Testing Sandbox:**
   - Embedded form in SPA allows live testing of JSON, Form-Data, and Query-String formats directly from the browser UI.

---

## 📐 System Design Overview (Part 1 Requirements)

Please review [`DESIGN_EXERCISE_SMS_ARCHITECTURE.md`](file:///c:/Users/titan/Downloads/Interviews/Keypath/DESIGN_EXERCISE_SMS_ARCHITECTURE.md) for the full technical specification.

* **Buffer:** Azure Service Bus Queue (`sms-messages-queue`).
* **Compute:** Azure Functions (C# .NET 8 Isolated Worker Model) with auto-scaling based on queue depth.
* **Resilience:** Polly Pipeline with Exponential Backoff + Jitter Retry and Circuit Breaker for handling 95% 3rd-party API SLA.
* **Database Pattern:** Transactional Outbox / CDC on Azure SQL Database.
* **SLA Verification:** Mathematical proof achieving 3,000 peak messages within 10 minutes at 3-second API latency.
