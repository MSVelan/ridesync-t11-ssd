
# RideSync — Team 11

CS6.302 Software Systems Development, Assignment 1.


Repository: https://github.com/MSVelan/ridesync-t11-ssd

## Team

| Name | Roll number |
|---|---|
| Muthiah Sivavelan | 2026204017 |
| Muppidi Reddy | 2026201013 |
| Disha Sharma | 2026201012 |
| Srinjoy Majumdar | 2026201054 |

## Setup:
- Install `uv`
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- For visualization of schema:
  ```bash
  uv run docs/generate_erd.py --dsn "postgresql://user:pass@localhost:5432/ridesync"
  ```
  or
  ```bash
  source .venv/bin/activate
  ./docs/generate_erd.py --dsn "postgresql://user:pass@localhost:5432/ridesync"
  ```

to run the seeder, use the following command:
``` uv run data_generation/postgres_seeder.py --dsn postgres://username:password@localhost:5432/ridesync```

- Create .env file with contents:
  ```
  NEON_DSN=<public_neon_db_conn_string>
  ATLAS_URI=<public_atlas_db_conn_string>
  ```

## MongoDB Layer

Three collections. `docs/mongo_schema_map.json` has the document shapes and a
sample of each; `mongo/01_collections_and_indexes.js` creates them with
validators and builds the indexes.

- **VehicleMetadata** — inspection history and feature flags. Only the outer
  shape is validated. The `features` object is left open on purpose, since
  different vehicles carry different feature sets and that is exactly what a
  relational column handles badly.
- **TripReviews** — ratings, feedback tags, timestamps. Validated strictly,
  because Workflow 4 aggregates over it: `rating` is bounded 1–5 so the
  histogram cannot grow a sixth bucket, and `feedback_tags` must be an array
  for `$unwind` to expand.
- **TelemetryPings** — GeoJSON Points in `[longitude, latitude]` order. Holds
  the 2dsphere index for Workflow 3 and a 7200-second TTL, so raw telemetry
  clears itself after two hours instead of growing without bound.

### Running it

```bash
set -a && source .env && set +a

uv run data_generation/mongo_seeder.py --drop --uri "$ATLAS_URI"
mongosh "$ATLAS_URI" mongo/01_collections_and_indexes.js
```

Locally, drop `--uri` and use `mongosh ridesync`.

Seed first, then build indexes. The TTL index deletes anything older than two
hours, so creating it before the load would delete seed data as it arrived.

Volumes generated: 2,000 VehicleMetadata, 100,000 TripReviews,
500,000 TelemetryPings. These match the PostgreSQL seeder's 2,000 vehicles,
10,000 riders and 100,000 trips, so every ID referenced from Mongo exists in
Postgres.

### Indexes

| Collection | Index | Why |
|---|---|---|
| VehicleMetadata | `vehicle_id` unique | one metadata document per vehicle |
| TelemetryPings | `location` 2dsphere | `$geoNear` for Workflow 3; 2dsphere rather than the legacy flat 2d, so distances come back in metres |
| TelemetryPings | `created_at` TTL 7200s | pings expire after two hours |
| TripReviews | `{city: 1, created_at: -1}` | backs the `$match` ahead of `$facet` in Workflow 4 |


## PostgreSQL Layer

Four tables in `sql/01_schema_ddl.sql`. Fares and balances are `DECIMAL(10,2)`,
never float. Trip status is `REQUESTED`, `IN TRANSIT` (space, not underscore),
or `COMPLETED`.

- **riders** — name and `wallet_balance` (`CHECK >= 0`).
- **vehicles** — unique `license_plate`, `class`, `is_active`.
- **trips** — FKs to rider and vehicle, quoted/charged `fare_amount`, status,
  `created_at`. A trip row is only created once a vehicle is assigned
  (`vehicle_id` is `NOT NULL`).
- **wallet_audit_logs** — CREDIT/DEBIT ledger. Written by a trigger.


### Running it

Apply SQL in order, then seed:

```bash
set -a && source .env && set +a

psql "$NEON_DSN" -f sql/01_schema_ddl.sql
psql "$NEON_DSN" -f sql/02_indexes.sql
psql "$NEON_DSN" -f sql/03_triggers_and_audit.sql
psql "$NEON_DSN" -f sql/04_stored_procedures.sql
psql "$NEON_DSN" -f sql/05_materialized_views.sql

uv run data_generation/postgres_seeder.py --dsn "$NEON_DSN"
```

### PostgreSQL Trigger (Audit Logging)

`sql/03_triggers_and_audit.sql` — `trg_rider_wallet_audit` fires
`AFTER UPDATE OF wallet_balance ON riders`. `log_wallet_change()` inserts
one immutable row into `wallet_audit_logs`: the delta, `CREDIT` or `DEBIT`,
and `balance_after`. The seeder never writes the ledger by hand; booking
debits and top-ups both go through this trigger.

```sql
CREATE TRIGGER trg_rider_wallet_audit
AFTER UPDATE OF wallet_balance ON riders
FOR EACH ROW
WHEN (OLD.wallet_balance IS DISTINCT FROM NEW.wallet_balance)
EXECUTE FUNCTION log_wallet_change();
```

### Partial Indexing
`sql/02_indexes.sql`
We created partial indexes because they solves:

1. **One open trip per rider** (`idx_active_rider_trip`). Unique on `rider_id`
   only while status is `REQUESTED` or `IN TRANSIT`. Completed trips are left
   out so a rider can have many finished trips, but never two at once.

2. **Faster 7-day revenue** (`idx_trips_completed_vehicle_date`). Workflow 2
   only reads completed trips. This index keeps `(vehicle_id, created_at)` and
   `fare_amount` for those rows only, so the window query does not scan
   requested / in-transit trips.

3. `idx_trips_rider_id` — index on `trips(rider_id)` so “trips for this rider” does not scan the whole table (Postgres does not auto-index FKs).

4. `idx_trips_vehicle_id` — same idea for `trips(vehicle_id)`: look up or join a vehicle’s trips without a full scan.


### Materialized View

`sql/05_materialized_views.sql` — `mv_vehicle_earnings` joins every vehicle
to its lifetime **completed** trip count and fare sum. Open trips do not
count. A unique index on `vehicle_id` is required so refreshes can run
`REFRESH CONCURRENTLY` without locking readers. Call
`SELECT fn_refresh_vehicle_earnings();` after new bookings.

```sql
SELECT fn_refresh_vehicle_earnings();
```
### MongoDB Geospatial & TTL Indexes

`mongo/01_collections_and_indexes.js` builds both on `TelemetryPings`:

- **2dsphere** on `location` (`idx_pings_location_2dsphere`) — Workflow 3
  `$geoNear` needs GeoJSON Points. 2dsphere (not the old flat `2d` index)
  so distances come back in metres.
- **TTL** on `created_at` (`idx_pings_created_at_ttl`, `expireAfterSeconds:
  7200`) — pings older than two hours are deleted automatically. `created_at`
  must be a BSON Date; a string field would build the index and expire
  nothing.

```javascript
db.TelemetryPings.createIndex({ location: "2dsphere" });
db.TelemetryPings.createIndex({ created_at: 1 }, { expireAfterSeconds: 7200 });
```


### Workflow 1 — Atomic Booking (Stored Procedure)

The assignment’s “atomic checkout / `orders`” flow is this procedure.
Checkout = book a trip. The order row is `trips`, not a separate `orders`
table.

`sql/04_stored_procedures.sql` — `sp_atomic_booking(rider, vehicle, fare)`
is one PL/pgSQL transaction (`CALL` commits on success). It:

1. Locks the rider (`SELECT … FOR UPDATE`) so two bookings cannot debit
   the same wallet at once.
2. Rejects a missing rider or a non-positive fare.
3. Verifies the wallet can cover the fare. `riders.wallet_balance` also
   has `CHECK (>= 0)`, so a debit that would go negative is rejected.
4. Deducts the fare, then inserts a `REQUESTED` trip. The wallet trigger
   writes the immutable `DEBIT` into `wallet_audit_logs` (audit is on the
   balance change, not on the trip insert).
5. If the balance is insufficient, `RAISE EXCEPTION` aborts the `CALL`.
   Postgres rolls back the whole body — no debit, no trip, no audit row.

The fare is charged at **request** time, not at completion. A second open
trip for the same rider fails on `idx_active_rider_trip` and also rolls
back.

```sql
CALL sp_atomic_booking(1, 1, 250.00);
```


### Workflow 2 — 7-day window analytics

`sql/06_window_analytics.sql` is the Postgres workflow. Only `COMPLETED`
trips count as revenue. It:

1. Sums `fare_amount` per vehicle per day.
2. Computes a 7-day moving average with
   `AVG(...) OVER (PARTITION BY vehicle_id ORDER BY revenue_date
   ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)`.
3. Two `DENSE_RANK()`: 1. best vehicle on each day, and 2. each
   vehicle’s best days.

```bash
psql "$NEON_DSN" -f sql/06_window_analytics.sql
```

### Workflow 3 — Nearest Available Vehicle

`mongo/02_workflow3_geonear.js` uses `$geoNear` against the 2dsphere index to
find the closest available vehicles within 5 km of a rider
(`[78.4867, 17.385]`, Hyderabad), returning distances in metres. The
`query: { is_available: true }` filter is applied after the geo search.
Results are grouped by `vehicle_id` and the five nearest are kept.

```bash
mongosh ridesync mongo/02_workflow3_geonear.js
```

`$geoNear` must be first in the pipeline so it can use
`idx_pings_location_2dsphere`. A collection scan would walk all 500,000
pings.

```
plan: GEO_NEAR_2DSPHERE  index=idx_pings_location_2dsphere
docsExamined=15133  nReturned=2339  executionTimeMillis=83
```

15,133 documents examined out of 500,000 seeded pings. The geo stage found
6,590 pings inside 5 km; the `is_available` FETCH cut that to 2,339. Full
`explain("executionStats")` is under `workflow3_geonear` in
`performance/mongo_execution_stats.json`.


### Workflow 4 — Faceted Review Analytics

`mongo/03_workflow4_facet.js` answers three questions in one pass over the
collection: the 1–5 rating histogram, the ten most common feedback tags via
`$unwind`, and the overall average rating.

```bash
mongosh ridesync mongo/03_workflow4_facet.js
```

The `$match` at the front is doing the real work. Sub-pipelines inside
`$facet` cannot use an index — only the stage before it can — so without that
leading match the whole thing degenerates into a collection scan. Matching on
`{city, created_at}` lets it ride `idx_reviews_city_created_at` instead:

```
plan: IXSCAN  docsExamined=20243  nReturned=20243  collectionTotal=100000
```

20,243 documents examined out of 100,000, and every one of them returned, so
nothing was read and thrown away. Full `explain("executionStats")` output is
in `performance/mongo_execution_stats.json`, regenerated with:

```bash
W4_EXPLAIN_ONLY=1 mongosh --quiet ridesync --file mongo/03_workflow4_facet.js \
    > performance/mongo_execution_stats.json
```


### PERFORMANCE PROOF
The performance proof for Workflow 2 is in `performance/postgres_explain_analyzes.txt` and for workflow 3 and 4 is in
`performance/mongo_execution_stats.json`


### Assumptions

- `vehicle_id`, `rider_id` and `trip_id` are the PostgreSQL integer primary
  keys. Mongo does not enforce them as foreign keys, so keeping the two
  engines consistent is the application's job. Both seeders use matching
  entity counts so that stays true.
- `created_at` is a BSON Date everywhere, never an ISO string. A TTL index on
  a string field builds without complaint and then silently expires nothing.
- Pings are seeded inside a 90-minute window so the two-hour TTL does not
  delete them mid-demo.
- Ping coordinates cluster around five Indian cities rather than spreading
  uniformly. Uniform points would leave almost nothing within a 5 km radius
  and the geospatial queries would look broken.
- Validators are applied with `collMod` after seeding, so they govern new
  writes rather than the documents already loaded.
- Tested against MongoDB 8.0.
- Only `Completed Trips` count as Revenue
- The ammount is debited when the trip is requested.




