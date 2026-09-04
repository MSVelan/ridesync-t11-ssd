
# RideSync — Team 11

CS6.302 Software Systems Development, Assignment 1.
Polyglot persistence across PostgreSQL and MongoDB.

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
``` python data_generation/postgres_seeder.py --dsn postgres://username:password@localhost:5432/ridesync```

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

python3 data_generation/mongo_seeder.py --drop --uri "$ATLAS_URI"
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
find the closest available vehicles within a 5 km radius, returning distances
in metres. Its `explain("executionStats")` output is appended to the same
`performance/mongo_execution_stats.json`.

```bash
mongosh ridesync mongo/02_workflow3_geonear.js
```


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

