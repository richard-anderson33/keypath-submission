# Keypath Education - Lead Software Developer Exercise

## Overview & Instructions

**Company:** Keypath Education  
**Role:** Lead Software Developer Exercise  
**Due Date:** Thursday, October 1 (End of Day)  
**Recipient:** Alaina Frederick (Talent Acquisition Specialist) / Erich Buser  

Keypath has long-term interest and investment in Microsoft Azure cloud technologies. Please complete this exercise using only solutions and technologies available in Microsoft Azure. Please also provide thorough technical details, including working code or pseudo code; and be prepared to walk through and explain code and design to other architects and engineers.

This exercise is intended to take only a couple hours of time. It is not meant to be a complex or deployable solution. It is also meant to work with Free or Trial Credit services available in Azure when setting up a new account ([Azure Free Account](https://azure.microsoft.com/en-us/free/)).

AI-assisted engineering practices are also encouraged for this exercise, including use of GitHub Copilot, GitHub CLI, Copilot, or equivalent tools. Ultimately, you're still accountable for the final design and codebase. Please share any agents, instructions, prompts, or markdown files that you used during the exercise.

---

## Part 1: Design Exercise (System Architecture)

### Givens
1. **Third-Party SMS API:**
   - Existing web-based API with 95% uptime.
   - Accepts 2 phone numbers (`From`, `To`) and a string `Message`.
   - Attempts to deliver text message to `To` number from `From` number.
   - Synchronous deliverability status response:
     - `"Successfully Sent"`
     - `"Not Sent – Not a valid phone"`
     - `"Not Sent – Not valid by Time zone"`
   - No bandwidth limitations.
   - Approximately 3-second round trip interval between send and status receive.

2. **Source Data (`Messages`):**
   - Source: Database table or triggered event.
   - Growth rate: ~10,000 records per day.
   - Peak rate: ~3,000 records per hour near Noon.
   - Schema:
     - `ID`: numeric (18,0) identity
     - `To`: numeric (18,0)
     - `From`: numeric (18,0)
     - `Message`: nvarchar(1000) *(actual SMS message text)*
     - `Status`: nvarchar(100)
     - `CreatedDateTime`: DateTime
     - `ModifiedDateTime`: DateTime

### Problem Statement
- Design a process that will process `Message` information from its source and send those messages via the external API, returning/updating the status of the message.
- The process should target delivery of all messages within **10 minutes of creation** when possible.

---

## Part 2: Front End / Back End Exercise (Practical Implementation)

Using available Azure technology resources, build an application consisting of 2 parts:

1. **Web API:**
   - Accepts data and records that data to a data source of your choosing.
   - Capable of accepting data in **multiple formats** (e.g., Query String, form-data, and JSON).
   - At least one field passed in should be of string value.

2. **Responsive Single Page App (SPA):**
   - Capable of taking a `[search/filter]` string and returning a grid of submitted records that match the string based on `"contains"` or `"Equals"` criteria.
   - **Search Constraint:** Don't start search until input has at least **3 characters**.
   - **Sorting:** Grid should be reorderable based on criteria (e.g., String field, Submitted On, Modified On...).
   - **UI/UX:** Clean, intuitive, responsive, easy to understand.
   - **Pagination:** Application must support pagination.
   - **Demo Data:** Create structures and sample records to demo.

*Note: The data/subject matter for Part 2 can be of your choosing; it is not required to build the SMS example from Part 1.*
