# Azana Google Connectivity - System Architecture & Documentation

## Overview
The **Azana Google Connectivity** engine is a NestJS-based middleware application designed to seamlessly synchronize Azana's hotel data with the **Google Hotel API**. It operates using a push-based model, transforming data from Azana's internal database (PMS) into OpenTravel Alliance (OTA) XML formats and securely delivering them to Google.

The system is highly optimized for scale, utilizing BullMQ for job queueing, Redis-based distributed locking (Redlock), and optimized MySQL recursive CTEs to prevent database lockups.

---

## 1. Core Architectures

The system is split into two primary data pipelines required by Google:

### A. Dynamic Data Pipeline (ARI - Availability, Rates, Inventory)
Google requires frequent, real-time updates for pricing and availability.
- **Flat Table Architecture**: To prevent heavy SQL JOINs on every API push, data from various master tables (`tb_hotel`, `tb_hotel_room_type`, `tb_hotel_rate_plan`, `tb_hotel_rate_custom`) is materialized into a highly optimized flat table (`tb_hotel_calendar_inventory`).
- **Rolling Horizon**: The system does not rebuild 365 days of data constantly. A nightly Cron job (`GoogleHorizonCron`) incrementally adds just the newest day to the horizon (e.g., maintaining a rolling 3-month window).
- **XML Builders**: Uses `RateBuilder`, `AvailabilityBuilder`, and `InventoryBuilder` to convert flat data into `RateAmountNotifRQ`, `AvailNotifRQ`, and `InvCountNotifRQ` XML payloads.

### B. Static Data Pipeline (List Feed & Property Metadata)
Google requires static configuration data defining the hotel's physical properties, rooms, and rate plans.
- **Gateway Table**: Uses `tb_hotel_connectivity_setup` as a pre-joined, static snapshot of all active, valid hotels. 
- **Validation**: Only hotels marked active (`setup_status = 1`) in this table are processed by the cron jobs, acting as a firewall against incomplete data crashing the system.
- **XML Builder**: Uses `GoogleStaticFeedBuilder` to generate `Hotel` and `Transaction` (RoomData / PackageData) metadata.

---

## 2. Event-Driven Workflows (Webhooks)

When the Booking Engine (PMS) changes a price or closes a room, the changes must reach Google immediately.

1. **Webhook Reception**: The PMS sends an `AriChangePayloadDto` to `PmsWebhookController`.
2. **Security**: The request is validated by `AdminAuthGuard` (checking the `ADMIN_API_TOKEN`).
3. **Race Condition Prevention**: The `EventHandlerService` directly updates the *Master Table* (`tb_hotel_rate_custom`) using a recursive `INSERT ... ON DUPLICATE KEY UPDATE` query. It *never* writes directly to the flat table, preventing background jobs from overwriting live updates with stale data.
4. **Queueing**: A sync job is pushed to BullMQ with high priority.
5. **Processing**: The worker materializes the updated master data into the flat table and pushes the delta to Google.

---

## 3. Queueing & Concurrency Control

With hundreds of hotels, sending all data to Google simultaneously would violate rate limits and crash the server. 
- **BullMQ**: All outgoing traffic is routed through queues (`google-push-queue` for ARI, `property-update-queue` for Static Data).
- **Rate Limiting**: Workers use BullMQ's native limiters (e.g., `concurrency: 5`, `limiter: { max: 10, duration: 1000 }`) to respect Google API quotas.
- **Redlock**: Distributed Redis locks (`redlock`) ensure that two identical updates for the same hotel are never processed at the exact same millisecond, preventing database deadlocks.

---

## 4. Key Endpoints

### PMS Webhooks (Requires Auth)
- `POST /pms/webhook/rate-change`
- `POST /pms/webhook/restriction-change`

### Google Connectivity (Static Feeds)
- `POST /google-connectivity/sync-hotel` (Triggers a static metadata update)

### Testing & Mocking
- `POST /mock-google-api/...` (Simulates Google API endpoints, preventing actual live pushes during local development and testing).

---

## 5. Technology Stack
- **Framework**: NestJS (TypeScript)
- **Database**: MySQL (TypeORM)
- **Queue**: BullMQ (Redis)
- **Locking**: Redlock
- **XML Generation**: `xmlbuilder2`
- **API Documentation**: Swagger (`/api-docs`)
