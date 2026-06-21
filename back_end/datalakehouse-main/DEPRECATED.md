# Data lakehouse stack — retired

**Status:** deprecated as of April 2026, replaced by the DuckDB engine
embedded in [back_end/Chart-API-main/engine](../Chart-API-main/engine).

## Why we retired it

This stack (Spring Boot `api-service` + Spark worker + RabbitMQ + Redis + MinIO
+ Iceberg on Postgres) was originally built to support distributed file
processing at large scale. In practice the app never used those capabilities:

- Only five endpoints were ever called (`/upload`, `/query`, `/query/:jobId`,
  `/schema/*`, `/jobs/:id`).
- Iceberg's ACID guarantees, partitioning, and time-travel were **not** used
  in the live code — uploads were write-once, reads were append-only
  `SELECT *`.
- The Spark worker image is ~6.5 GB; cold-starts took several minutes; every
  Java change hit Docker Hub's Cloudflare R2 CDN timeout we fought repeatedly.
- Datasets fit comfortably in DuckDB (sub-second queries on the ~10k-row
  result sizes we actually work with).

## What replaced it

- **Engine:** `back_end/Chart-API-main/engine/` — DuckDB over local-disk
  Parquet. One process. One SQLite catalog. Zero new containers.
- **Storage:** `./data/warehouse/{user_id}/{project_id}/{table}.parquet`
  (local disk; `DUCKDB_WAREHOUSE_PATH` to override).
- **Connectors:** `back_end/Chart-API-main/engine/connectors.py` — native
  drivers for Postgres, MySQL, SQLite, Redshift, MSSQL, Oracle, MongoDB,
  BigQuery, Snowflake. Credentials stored AES-256-GCM sealed in
  `user-auth-main/connector_credentials`.

## Rollback

If you need the old stack back for any reason (large-dataset scale-out,
Iceberg time-travel, distributed Spark):

```bash
git checkout lakehouse-era       # pre-refactor tag
cd back_end/datalakehouse-main
docker-compose up -d --build
```

Then flip `NEXT_PUBLIC_LAKEHOUSE_URL` in `Front_end/vanta-auth-ui/.env`
back to `http://localhost:8888/api/v1` and restart the frontend.

## Do not delete

The source under this directory is kept verbatim to preserve the rollback
path and as a reference for anyone who wants to reintroduce Spark/Iceberg
for a specific workload. Don't run its compose by default; the root
`npm run dev` no longer orchestrates it.
