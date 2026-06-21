# Developer Guide

> Advanced topics: Apache Iceberg optimizations, storage structure, and performance tuning.

## 📚 Navigation

- [← Back to README](README.md)
- [API Reference →](API_REFERENCE.md)
- [Architecture →](ARCHITECTURE.md)
- [Testing →](TESTING.md)

---

# Apache Iceberg Metadata & Query Optimization Guide

## Table of Contents

1. [Iceberg Metadata Architecture](#iceberg-metadata-architecture)
2. [Query Optimizations](#query-optimizations)
3. [How This Project Uses Iceberg](#how-this-project-uses-iceberg)
4. [Performance Comparison](#performance-comparison)

---

## Iceberg Metadata Architecture

Apache Iceberg stores rich metadata that enables powerful query optimizations **without scanning data files**.

### Metadata Hierarchy

```
Table Metadata (metadata.json)
│
├── Schema
│   ├── Column names
│   ├── Column types
│   └── Column IDs (schema evolution support)
│
├── Partition Spec
│   ├── Partition columns
│   └── Partition transform functions (day, hour, bucket, etc.)
│
├── Sort Order
│   └── Physical layout optimization
│
└── Snapshots (version history)
    │
    └── Manifest List (snapshot-level manifest)
        │
        └── Manifests (partition-level metadata)
            │
            ├── Data File Paths
            ├── Partition Values
            ├── Record Counts
            ├── File Sizes
            └── Column Statistics
                ├── Min/Max values per column
                ├── Null counts
                └── NaN counts (for floats)
```

### Example Metadata Structure

```json
{
  "table-metadata": {
    "format-version": 2,
    "table-uuid": "abc-123",
    "location": "s3://warehouse/db/sales",
    "schemas": [
      {
        "schema-id": 0,
        "fields": [
          { "id": 1, "name": "Date", "type": "date" },
          { "id": 2, "name": "Sales", "type": "double" },
          { "id": 3, "name": "Region", "type": "string" }
        ]
      }
    ],
    "partition-spec": [
      {
        "field-id": 1000,
        "source-id": 1,
        "transform": "day",
        "name": "Date_day"
      }
    ],
    "current-snapshot-id": 5,
    "snapshots": [
      {
        "snapshot-id": 5,
        "timestamp-ms": 1700000000000,
        "manifest-list": "s3://warehouse/db/sales/metadata/snap-5-manifest-list.avro"
      }
    ]
  }
}
```

---

## Query Optimizations

### 1. **Partition Pruning** ✂️

**What it does:**  
Skips entire partitions that don't match query filters.

**Example:**

```json
{
  "filters": [
    { "column": "Date", "operator": ">=", "value": "2023-06-01" },
    { "column": "Date", "operator": "<=", "value": "2023-06-30" }
  ]
}
```

**Without Iceberg (traditional Hive tables):**

- Reads all Parquet files
- Applies filter row-by-row
- Scans 365 partition directories (if partitioned by day)

**With Iceberg:**

- Reads manifest files (tiny Avro files with partition metadata)
- Identifies only June partitions (30 days)
- Skips 335 partitions completely ⚡
- **~11x less I/O**

---

### 2. **File Skipping (Min/Max Statistics)** 📊

**What it does:**  
Skips individual data files using column min/max values.

**Example:**

```json
{
  "filters": [{ "column": "Sales", "operator": ">", "value": 10000 }]
}
```

**Manifest entry for a data file:**

```json
{
  "data-file": {
    "file-path": "s3://warehouse/db/sales/data/00001.parquet",
    "record-count": 50000,
    "value-counts": { "Sales": 50000 },
    "lower-bounds": { "Sales": 100 },
    "upper-bounds": { "Sales": 5000 }
  }
}
```

**Iceberg decision:**

- Check upper-bound: 5000 < 10000 ❌
- Skip this file completely (50,000 rows avoided)
- Only read files where `upper-bound >= 10000`

**Result:**  
If 80% of files have sales < 10,000, skip 80% of data files without opening them!

---

### 3. **Column Projection (Columnar Format)** 📁

**What it does:**  
Reads only required columns from Parquet files.

**Example Query:**

```json
{
  "select": [
    { "column": "Date", "as": "x" },
    { "column": "Sales", "aggregation": "sum", "as": "y" }
  ]
}
```

**Traditional row format (CSV):**

- Must read entire row: `Date,Sales,Region,Product,Quantity,Price,Tax`
- Then discard unused columns

**Iceberg + Parquet:**

- Reads only `Date` and `Sales` columns
- Parquet stores columns separately on disk
- **~5x less I/O** (if table has 7 columns)

---

### 4. **Schema Evolution** 🔄

**What it does:**  
Handles schema changes without rewriting data.

**Example Scenario:**

1. Upload `sales_v1.csv` with columns: `Date, Sales, Region`
2. Later upload `sales_v2.csv` with columns: `Date, Sales, Region, Product`
3. Query reads both files seamlessly

**Iceberg handles:**

- Missing columns filled with `NULL`
- Column ID tracking (rename columns safely)
- Type promotion (int → long)

---

### 5. **Time Travel** ⏰

**What it does:**  
Query historical snapshots of data.

**Example:**

```sql
-- Spark SQL syntax
SELECT * FROM local.db.sales VERSION AS OF 123456789000;
SELECT * FROM local.db.sales TIMESTAMP AS OF '2023-06-01 00:00:00';
```

**Use cases:**

- Audit data changes
- Rollback to previous state
- Compare current vs. historical data

---

## How This Project Uses Iceberg

### Architecture Flow

```
Upload Job (CSV → Iceberg)
┌────────────────────────────────────────────────────────────────────────┐
│ 1. API receives CSV upload                                             │
│ 2. Stores file in MinIO: uploads/{jobId}/file.csv                      │
│ 3. Enqueues job to RabbitMQ                                            │
│ 4. Spark worker reads CSV                                              │
│ 5. Writes to Iceberg table: local.db.{projectId}.{table}               │
│    - Parquet files → MinIO: warehouse/db/{projectId}/{table}/data/     │
│    - Metadata → MinIO: warehouse/db/{projectId}/{table}/metadata/      │
└────────────────────────────────────────────────────────────────────────┘

Query Job (Iceberg → Parquet Results)
┌────────────────────────────────────────────────────────────────────────┐
│ 1. API receives query JSON                                             │
│ 2. Enqueues query job to RabbitMQ                                      │
│ 3. Spark worker:                                                       │
│    a. Reads Iceberg table metadata                                     │
│    b. Applies partition pruning (filter pushdown)                      │
│    c. Applies file skipping (min/max stats)                            │
│    d. Reads only required columns (projection)                         │
│    e. Executes aggregations & sorting                                  │
│    f. Writes result as Parquet to MinIO                                │
│    g. Returns result location to API                                   │
│ 4. Client downloads Parquet result (compressed, efficient)             │
└────────────────────────────────────────────────────────────────────────┘
```

### Code Implementation

#### Partition Pruning (Automatic)

```java
// In QueryJobProcessor.java
Dataset<Row> df = spark.read()
    .format("iceberg")
    .load("local.db.sales");

// Filters are automatically pushed down to Iceberg
df = df.filter(functions.col("Date").geq(functions.lit("2023-06-01")))
       .filter(functions.col("Date").leq(functions.lit("2023-06-30")));

// Iceberg reads manifests and skips partitions outside Jun 2023
```

**What Iceberg does internally:**

1. Reads `manifest-list.avro` (snapshot metadata)
2. Filters manifests by partition bounds
3. Only reads manifests for June 2023
4. Skips all other data files

#### Column Projection (Automatic)

```java
// Only select Date and Sales
df = df.select(functions.col("Date"), functions.sum("Sales"));

// Iceberg + Parquet read only these 2 columns from disk
```

#### File Skipping (Automatic)

```java
// Filter on Sales > 10000
df = df.filter(functions.col("Sales").gt(functions.lit(10000)));

// Iceberg checks manifest file statistics:
// - If file's upper_bound(Sales) < 10000 → skip file
// - Only read files that might contain matching rows
```

---

## Performance Comparison

### Scenario: Query 30 days of sales from 1-year dataset

**Dataset:**

- 365 partitions (1 per day)
- 10 data files per partition (Parquet)
- 100 MB per file
- Total: 365 GB

**Query:**

```json
{
  "source": "sales",
  "select": [
    { "column": "Date", "as": "x" },
    { "column": "Sales", "aggregation": "sum", "as": "y" }
  ],
  "filters": [
    { "column": "Date", "operator": ">=", "value": "2023-06-01" },
    { "column": "Date", "operator": "<=", "value": "2023-06-30" }
  ],
  "group_by": ["Date"]
}
```

### Without Iceberg (Traditional Hive/Parquet)

| Step                   | Operations                        | I/O              |
| ---------------------- | --------------------------------- | ---------------- |
| List files             | List 365 directories              | Small            |
| Open files             | Open 3650 Parquet files           | Large            |
| Read footers           | Read Parquet footers (3650 files) | ~3.6 GB          |
| Apply partition filter | Check filename patterns           | None             |
| Read matching files    | Read 300 files (30 days × 10)     | 30 GB            |
| Apply column filter    | Read all 7 columns, discard 5     | 30 GB            |
| **Total I/O**          |                                   | **~64 GB**       |
| **Query Time**         |                                   | **~180 seconds** |

### With Iceberg + This Project

| Step                  | Operations                          | I/O             |
| --------------------- | ----------------------------------- | --------------- |
| Read manifest list    | Read 1 Avro file                    | ~10 KB          |
| Read manifests        | Read 30 Avro manifest files         | ~300 KB         |
| Partition pruning     | Skip 335 partitions in metadata     | None            |
| File skipping         | Skip 0 files (no Sales filter)      | None            |
| Read matching files   | Read 300 files (30 days × 10)       | 30 GB           |
| **Column projection** | Read only 2/7 columns (Date, Sales) | **~8.6 GB**     |
| **Total I/O**         |                                     | **~8.6 GB**     |
| **Query Time**        |                                     | **~25 seconds** |

**Performance gain: 7.4x faster! ⚡**

### With Iceberg + File Skipping (if Sales filter added)

If we add: `{"column": "Sales", "operator": ">", "value": 50000}`

Assume 70% of files have `max(Sales) < 50000`:

| Optimization      | Files Skipped       | I/O Saved               |
| ----------------- | ------------------- | ----------------------- |
| Column projection | 0 files             | 21.4 GB (read 2/7 cols) |
| **File skipping** | **210 files (70%)** | **~6 GB additional**    |
| **Total I/O**     |                     | **~2.6 GB**             |
| **Query Time**    |                     | **~7 seconds**          |

**Performance gain: 25x faster compared to traditional approach! 🚀**

---

## Result Format Efficiency

### JSON vs. Parquet for Results

**Dataset: 1 million rows, 5 columns**

| Format               | Size      | Bandwidth | Parsing Time     |
| -------------------- | --------- | --------- | ---------------- |
| JSON                 | 450 MB    | High      | ~8 seconds       |
| **Parquet (Snappy)** | **45 MB** | **Low**   | **~0.5 seconds** |

**Why Parquet is better:**

1. **Compression:** Columnar format compresses better (~10x)
2. **Binary format:** No need to escape strings
3. **Schema embedded:** Type information included
4. **Streaming:** Can read row groups incrementally
5. **Compatible:** Works with Pandas, PyArrow, Spark, etc.

### Client-Side Usage

**Python example:**

```python
import pyarrow.parquet as pq

# Download Parquet result from MinIO
result = pq.read_table('query-results/job-123/result.parquet')

# Convert to Pandas
df = result.to_pandas()

# Or read in chunks (streaming)
parquet_file = pq.ParquetFile('result.parquet')
for batch in parquet_file.iter_batches(batch_size=1000):
    df_chunk = batch.to_pandas()
    # Process chunk
```

---

## Best Practices

### 1. **Partition your tables wisely**

```java
// Good: partition by date (if queries filter by date)
df.writeTo("local.db.sales")
  .partitionedBy("Date")
  .create();

// Bad: partition by high-cardinality column (too many partitions)
df.writeTo("local.db.sales")
  .partitionedBy("TransactionId")  // ❌ Millions of partitions!
  .create();
```

**Rule of thumb:**

- Partition column should have 10-1000 unique values
- Queries should frequently filter on partition column

### 2. **Use filters that push down to Iceberg**

✅ **Good filters (push down):**

```json
{"column": "Date", "operator": ">=", "value": "2023-01-01"}
{"column": "Region", "operator": "=", "value": "US"}
{"column": "Sales", "operator": ">", "value": 1000}
```

❌ **Bad filters (don't push down well):**

```json
{"column": "lower(Region)", "operator": "=", "value": "us"}  // Function call
{"column": "Date", "operator": "=", "value": "current_date()"}  // Dynamic value
```

### 3. **Select only needed columns**

✅ **Good:**

```json
{
  "select": [{ "column": "Date" }, { "column": "Sales", "aggregation": "sum" }]
}
```

❌ **Bad:**

```json
{
  "select": [
    { "column": "*" } // Reads all columns from disk
  ]
}
```

---

## Summary

| Feature             | Traditional Tables         | **Iceberg**              |
| ------------------- | -------------------------- | ------------------------ |
| Partition pruning   | Manual (filename patterns) | ✅ Automatic (metadata)  |
| File skipping       | ❌ No                      | ✅ Yes (min/max stats)   |
| Column projection   | ✅ Yes (Parquet)           | ✅ Yes (Parquet)         |
| Schema evolution    | ❌ Rewrite data            | ✅ Automatic             |
| Time travel         | ❌ No                      | ✅ Yes (snapshots)       |
| ACID transactions   | ❌ No                      | ✅ Yes                   |
| Concurrent writes   | ❌ Unsafe                  | ✅ Safe                  |
| Query planning time | Slow (list all files)      | ⚡ Fast (read manifests) |

**Bottom line:** Iceberg metadata enables **orders of magnitude** faster queries on large datasets! 🎉

# MinIO Bucket Structure

## Overview

The data lakehouse uses **two separate MinIO buckets** with a clear separation of concerns:

---

## 📦 Bucket 1: `uploads`

**Purpose:** Store raw uploaded CSV files temporarily

**Structure:**

```
uploads/
└── {jobId}/
    └── {filename}.csv
```

**Example:**

```
uploads/
└── 474d1858-2091-4122-ae4c-313e3bb6351e/
    └── test_data.csv
```

**Lifecycle:**

- Files uploaded via API are stored here
- Worker reads CSV from here during processing
- Can be cleaned up after successful Iceberg ingestion

---

## 🏢 Bucket 2: `warehouse`

**Purpose:** Store processed data and query results in Iceberg format

**Structure:**

```
warehouse/
└── wh/                                    ← Iceberg warehouse root
    └── {projectId}/                       ← Project namespace
        ├── {tableName}/                   ← Iceberg table data
        │   ├── metadata/
        │   │   ├── v1.metadata.json
        │   │   ├── v2.metadata.json
        │   │   └── snap-*.avro
        │   └── data/
        │       └── *.parquet
        │
        └── queries/                       ← Query results folder
            ├── query_20251118_161335/     ← Timestamped query result
            │   └── result.parquet
            ├── query_20251118_162045/
            │   └── result.parquet
            └── query_20251118_163512/
                └── result.parquet
```

**Example:**

```
warehouse/
└── wh/
    └── elm4r7a/                          ← Project: elm4r7a
        ├── sales/                        ← Iceberg table: sales
        │   ├── metadata/
        │   │   ├── v1.metadata.json
        │   │   ├── v2.metadata.json
        │   │   └── snap-123456.avro
        │   └── data/
        │       └── 00000-0-data.parquet
        │
        └── queries/                      ← Query results
            └── query_20251118_161335/
                └── result.parquet        ← 12 rows, 2.2 KB
```

---

## 🔑 Key Points

### Iceberg Warehouse Path

**Environment Variable:** `ICEBERG_WAREHOUSE_PATH=s3a://warehouse/wh/`

This tells Iceberg that:

- MinIO bucket: `warehouse`
- Warehouse root: `/wh/` folder inside the bucket
- All Iceberg tables live under `/wh/{projectId}/{tableName}/`

### Query Results Path

**Format:** `warehouse/wh/{projectId}/queries/query_{timestamp}/result.parquet`

**Why this location?**

- ✅ Keeps query results **inside the same project folder** as the source tables
- ✅ Organized by timestamp for easy tracking
- ✅ Separate from raw uploads (different bucket)
- ✅ Part of the warehouse structure (same bucket as processed data)

### Path Components

- `warehouse` - MinIO bucket name
- `wh` - Iceberg warehouse root folder
- `{projectId}` - Project namespace (e.g., "elm4r7a")
- `queries` - Folder for all query results in this project
- `query_{timestamp}` - Unique folder per query (format: `yyyyMMdd_HHmmss`)
- `result.parquet` - Compressed Parquet result file

---

## 📊 Data Flow

### Upload Flow

```
User uploads CSV
    → API stores in: uploads/{jobId}/file.csv
    → Worker reads from uploads bucket
    → Worker processes to Iceberg
    → Iceberg stores in: warehouse/wh/{projectId}/{tableName}/
```

### Query Flow

```
User submits query
    → Worker reads from: warehouse/wh/{projectId}/{tableName}/
    → Worker executes query with filters/aggregations
    → Worker stores result in: warehouse/wh/{projectId}/queries/query_{timestamp}/result.parquet
    → User downloads Parquet file
```

---

## 🎯 Remember

**Two buckets:**

1. **uploads** = Raw temporary files
2. **warehouse** = Processed data + query results

**Warehouse structure:**

- `/wh/` = Iceberg root
- `/wh/{projectId}/` = Project folder
- `/wh/{projectId}/{tableName}/` = Iceberg tables
- `/wh/{projectId}/queries/` = Query results

**Never mix:**

- ❌ Don't put query results in `uploads` bucket
- ❌ Don't put query results at `warehouse/{projectId}/` (missing `wh/`)
- ✅ Always use: `warehouse/wh/{projectId}/queries/query_{timestamp}/result.parquet`
