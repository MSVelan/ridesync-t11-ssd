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

Volumes generated: 5,000 VehicleMetadata, 120,000 TripReviews,
500,000 TelemetryPings.

### Indexes

| Collection | Index | Why |
|---|---|---|
| VehicleMetadata | `vehicle_id` unique | one metadata document per vehicle |
| TelemetryPings | `location` 2dsphere | `$geoNear` for Workflow 3; 2dsphere rather than the legacy flat 2d, so distances come back in metres |
| TelemetryPings | `created_at` TTL 7200s | pings expire after two hours |
| TripReviews | `{city: 1, created_at: -1}` | backs the `$match` ahead of `$facet` in Workflow 4 |

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
plan: IXSCAN  docsExamined=23887  nReturned=23887  collectionTotal=120000
```

23,887 documents examined out of 120,000, and every one of them returned, so
nothing was read and thrown away. Full `explain("executionStats")` output is
in `performance/mongo_execution_stats.json`, regenerated with:

```bash
W4_EXPLAIN_ONLY=1 mongosh --quiet ridesync --file mongo/03_workflow4_facet.js \
    > performance/mongo_execution_stats.json
```

### Assumptions

- `vehicle_id`, `rider_id` and `trip_id` are the PostgreSQL integer primary
  keys. Mongo does not enforce them as foreign keys, so keeping the two
  engines consistent is the application's job.
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
