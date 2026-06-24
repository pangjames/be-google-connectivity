# Google Hotel Connectivity Engine - System Documentation

This document explains how the Google Hotel Connectivity Engine operates, how external systems (like the Booking Engine / PMS) should interact with it, and how it handles data syncing efficiently at scale.

## 1. System Architecture Overview

The system is designed as an **Incremental, Push-Based Delivery Model**. It sits between your Booking Engine (PMS) and the Google Hotel ARI (Availability, Rates, and Inventory) API. 

Instead of rebuilding complex pricing data every time Google is updated, the engine maintains a pre-computed "Flat Table" (`tb_hotel_calendar_inventory`) which acts as the highly-optimized source of truth for the XML payloads sent to Google.

### High-Level Data Flow:
1. **PMS Event**: The Booking Engine triggers a webhook when a rate or restriction changes.
2. **Master Update**: The webhook safely updates the master database table (`tb_hotel_rate_custom`).
3. **Queueing (BullMQ)**: The webhook queues a sync job in BullMQ to prevent Google rate limits.
4. **Materialization**: BullMQ processes the job, merging the new master data into the Flat Table using a recursive SQL query.
5. **Google Push**: The system builds the XML payloads from the Flat Table and pushes them to Google.

---

## 2. Using the PMS Webhooks (Targeted Updates)

To push live updates from your Booking Engine, you must use the Webhook endpoints. These endpoints are designed for **pinpoint accuracy**—you can update a specific rate plan for a specific date range without touching the rest of the hotel's calendar.

> [!IMPORTANT]
> Both endpoints require authentication. Include the `Authorization: Bearer <ADMIN_API_TOKEN>` header in your requests.

### Rate Change Endpoint
`POST /pms/webhook/rate-change`

Triggers when a specific room's rate is modified by the hotel operator.
```json
{
  "type": "RATE_CHANGE",
  "hotel": "HTL001",
  "room": 10,
  "rate": 25,
  "start": "2026-12-24",
  "end": "2026-12-25",
  "newRate": 250000
}
```

### Restriction Change Endpoint
`POST /pms/webhook/restriction-change`

Triggers when an inventory restriction (Close out, Closed to Arrival, Closed to Departure) is toggled.
```json
{
  "type": "RESTRICTION_CHANGE",
  "hotel": "HTL001",
  "room": 10,
  "rate": 25,
  "start": "2026-12-24",
  "end": "2026-12-31",
  "isOpen": false,
  "restrictionType": "master" 
}
```
*(Note: `restrictionType` can be `"master"`, `"arrival"`, or `"departure"`).*

---

## 3. Data Integrity & The Materialization Engine

The engine is protected against **Race Conditions**. If the webhook were to update the Flat Table directly, background BullMQ processes running concurrently might overwrite those changes with stale data from the master tables.

To solve this and ensure the newest data always reaches Google:
1. The Webhook first runs an `INSERT ... ON DUPLICATE KEY UPDATE` directly against the **Master Table** (`tb_hotel_rate_custom`).
2. The webhook then tells **BullMQ** to process the date range.
3. BullMQ triggers the **Materialization Engine**, which safely pulls the updated master data, calculates the final taxes/rules, and saves it into the Flat Table.

This guarantees that the Flat Table is always a 100% accurate reflection of the latest PMS inputs.

---

## 4. Bootstrapping & Handling Massive Data Safely

When connecting a new hotel, the database is initially empty. The system must generate data for up to 1 year (365 days) across dozens of rate plans. Generating this data naively could cause severe database lockups ("hogging").

The system uses three layers of protection to achieve this safely:

### A. The `WITH RECURSIVE` SQL Engine
Instead of writing a Node.js `for-loop` that executes thousands of individual database inserts, the engine offloads the heavy lifting to the MySQL engine using a `WITH RECURSIVE` CTE (Common Table Expression). MySQL can generate and insert 10,000+ rows into the Flat Table in a single transaction that takes only milliseconds.

### B. BullMQ Concurrency Limits
If the system needs to bootstrap 500 new hotels simultaneously, it does not execute them all at once. The `GooglePushConsumer` in BullMQ is configured with `concurrency: 5`. It will safely bootstrap 5 hotels at a time, completely shielding the database from CPU spikes.

### C. The Rolling Horizon (Incremental Sync)
The engine does not attempt to calculate a full 365 days unless necessary. Through the `ROLLING_HORIZON_MONTHS` configuration (defaulting to 3 months), the nightly Cron job incrementally "rolls" the calendar forward. 
- Instead of rebuilding 3 months of data every night, the engine queries the Flat Table to find the last synced date.
- It then computes and inserts **only the single new day** added to the horizon.
- This reduces nightly database operations by 99%.
