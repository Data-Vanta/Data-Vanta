# Data Lakehouse Platform

> A production-ready, cloud-native data lakehouse built with Apache Spark, Apache Iceberg, and Spring Boot. Provides real-time data ingestion, efficient querying, and analytics with ACID transactions and scalable object storage.

[![Docker](https://img.shields.io/badge/Docker-20.10%2B-blue)](https://www.docker.com/)
[![Java](https://img.shields.io/badge/Java-17-orange)](https://openjdk.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.x-green)](https://spring.io/projects/spring-boot)
[![Apache Spark](https://img.shields.io/badge/Apache%20Spark-3.4-red)](https://spark.apache.org/)
[![Apache Iceberg](https://img.shields.io/badge/Apache%20Iceberg-1.3-blue)](https://iceberg.apache.org/)

---

## 📚 Documentation Structure

This project has comprehensive documentation organized into focused guides:

| Document                                     | Purpose                         | Audience            |
| -------------------------------------------- | ------------------------------- | ------------------- |
| **[README.md](README.md)**                   | Quick start & overview          | Everyone            |
| **[ARCHITECTURE.md](ARCHITECTURE.md)**       | System design & components      | Developers, DevOps  |
| **[API_REFERENCE.md](API_REFERENCE.md)**     | Complete API docs               | Frontend, API users |
| **[TESTING.md](TESTING.md)**                 | Testing guide & scripts         | QA, Developers      |
| **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** | Advanced topics & optimizations | Backend developers  |

---

## 📋 Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
- [How It Works](#how-it-works)
- [API Endpoints](#api-endpoints)
- [Testing](#testing)
- [Configuration](#configuration)
- [Next Steps](#next-steps)

---

## 🎯 Overview

This data lakehouse platform combines the best of **data lakes** (scalable storage) and **data warehouses** (ACID transactions, schema enforcement) into a unified architecture. It enables:

- **Batch data ingestion** from CSV files into Apache Iceberg tables
- **Real-time query execution** with JSON-based query API
- **Efficient data storage** using Parquet columnar format
- **ACID transactions** with schema evolution support
- **Asynchronous job processing** with status tracking
- **Cloud-native architecture** with Docker containers

### Key Technologies

| Component             | Technology            | Purpose                             |
| --------------------- | --------------------- | ----------------------------------- |
| **API Layer**         | Spring Boot 3.x       | RESTful API for uploads and queries |
| **Processing Engine** | Apache Spark 3.4      | Distributed data processing         |
| **Table Format**      | Apache Iceberg 1.3    | ACID transactions, time travel      |
| **Object Storage**    | MinIO (S3-compatible) | Scalable file and data storage      |
| **Message Queue**     | RabbitMQ              | Asynchronous job processing         |
| **Cache**             | Redis                 | Job status and metadata caching     |
| **Metadata Catalog**  | PostgreSQL 16         | Iceberg table metadata              |

---

## 🏗️ Architecture

### System Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP Requests
       ▼
┌────────────────────────────────────────────────────────┐
│                     API Service                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Upload     │  │    Query     │  │   Status     │  │
│  │ Controller   │  │  Controller  │  │  Controller  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└───────┬──────────────────┬──────────────────┬──────────┘
        │                  │                  │
        │ Store File       │ Queue Job        │ Update Status
        ▼                  ▼                  ▼
┌──────────────┐    ┌──────────────┐   ┌──────────────┐
│    MinIO     │    │   RabbitMQ   │   │    Redis     │
│ (uploads/)   │    │   (Queue)    │   │  (Cache)     │
└──────────────┘    └───────┬──────┘   └──────────────┘
                            │
                            │ Consume Jobs
                            ▼
                    ┌──────────────────┐
                    │  Spark Worker    │
                    │ ┌──────────────┐ │
                    │ │ Job Processor│ │
                    │ └──────┬───────┘ │
                    │        │         │
                    │  ┌─────▼──────┐  │
                    │  │  Upload    │  │
                    │  │ Processor  │  │
                    │  └─────┬──────┘  │
                    │        │         │
                    │  ┌─────▼──────┐  │
                    │  │   Query    │  │
                    │  │ Processor  │  │
                    │  └─────┬──────┘  │
                    └────────┼─────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐   ┌──────────────┐
│    MinIO     │    │  PostgreSQL  │   │    Redis     │
│ (warehouse/) │    │  (Iceberg    │   │  (Status     │
│              │    │   Metadata)  │   │   Updates)   │
└──────────────┘    └──────────────┘   └──────────────┘
```

### Data Flow

#### Upload Flow

```
1. Client uploads CSV → API Service
2. API saves to MinIO (uploads bucket)
3. API creates job in Redis (status: queued)
4. API sends message to RabbitMQ
5. Spark Worker consumes message
6. Worker reads CSV from MinIO
7. Worker creates Iceberg table (if needed)
8. Worker writes data to warehouse bucket
9. Worker updates job status in Redis (completed)
```

#### Query Flow

```
1. Client sends query JSON → API Service
2. API creates query job in Redis
3. API sends message to RabbitMQ
4. Spark Worker consumes message
5. Worker executes query on Iceberg table
6. Worker applies filters, aggregations, sorting
7. Worker saves result as Parquet to warehouse
8. Worker updates job with result path in Redis
9. Client downloads result from MinIO
```

---

## ✨ Features

### 🚀 Core Capabilities

- **Batch Data Ingestion**: Upload CSV files via REST API
- **Query API**: JSON-based query language with filters, aggregations, GROUP BY, ORDER BY
- **Efficient Storage**: Parquet columnar format with Snappy compression (10x smaller than JSON)
- **ACID Transactions**: Full transactional support via Apache Iceberg
- **Async Processing**: Non-blocking job execution with RabbitMQ
- **Real-time Status**: Track job progress via Redis cache

### 🎨 Query Features

- **Column Selection**: `SELECT` specific columns or all (`*`)
- **Aggregations**: `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`
- **Filtering**: Support for `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`
- **Grouping**: `GROUP BY` multiple columns
- **Sorting**: `ORDER BY` with ASC/DESC
- **Pagination**: `LIMIT` and `OFFSET` support

### 🔧 Operational Features

- **Docker Containerized**: Easy deployment and scaling
- **Health Monitoring**: Spring Boot Actuator endpoints
- **Scalable Workers**: Horizontal scaling support
- **MinIO Console**: Web UI for data browsing
- **RabbitMQ Management**: Queue monitoring UI

---

## 🔄 How It Works

### Component Interaction

#### 1. API Service (Spring Boot)

**Location**: `api-service/service/`

**Responsibilities**:

- Expose REST endpoints for upload, query, status
- Validate uploaded files
- Store files in MinIO (`uploads` bucket)
- Queue jobs to RabbitMQ
- Cache job status in Redis
- Return results to clients

**Key Classes**:

- `FileUploadController`: Handles file uploads
- `QueryController`: Handles query job submission
- `JobController`: Handles job status lookups and queue statistics
- `FileStorageService`: MinIO client wrapper for file operations
- `RabbitMQService`: Message queue producer for upload and query jobs
- `JobStatusService`: Redis operations for job tracking (upload and query jobs)

**Configuration**: `application.yml` reads all settings from environment variables populated by `.env`

#### 2. Spark Worker

**Location**: `spark/worker-app/`

**Responsibilities**:

- Consume jobs from RabbitMQ
- Download files from MinIO
- Process data with Apache Spark
- Write to Iceberg tables (JDBC catalog with PostgreSQL)
- Execute queries with optimizations
- Update job status in Redis

**Key Classes**:

- `WorkerApp`: Main entry point, initializes Spark and services
- `MessageConsumerService`: RabbitMQ consumer
- `JobProcessor`: Routes jobs to appropriate processor
- `UploadJobProcessor`: Handles data ingestion
- `QueryJobProcessor`: Executes queries with Iceberg optimizations
- `SparkService`: Spark DataFrame operations
- `MinioService`: File upload/download
- `RedisService`: Direct Redis updates for job status

**Spark Configuration**:

- `Dockerfile`: Entrypoint script with dynamic Spark config
- `spark-defaults.conf`: Static Spark settings
- Environment variables set Iceberg catalog, MinIO credentials, PostgreSQL connection

#### 3. MinIO (Object Storage)

**Purpose**: S3-compatible object storage for files and data

**Buckets**:

- `uploads`: Raw CSV files from user uploads
- `warehouse`: Iceberg table data and query results

**Structure**:

```
uploads/
└── {jobId}/
    └── {filename}.csv

warehouse/
└── wh/                              ← Iceberg warehouse root
    └── {projectId}/                 ← Project namespace
        ├── {tableName}/             ← Iceberg table
        │   ├── metadata/
        │   │   └── *.metadata.json
        │   └── data/
        │       └── *.parquet
        └── queries/                 ← Query results
            └── query_{timestamp}/
                └── result.parquet
```

**Access**: MinIO client configured with `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` from `.env`

#### 4. RabbitMQ (Message Queue)

**Purpose**: Asynchronous job processing

**Queue**: `file.processing.queue` (configurable via `RABBITMQ_QUEUE_NAME`)

**Message Types**:

- **Upload Jobs**: `{jobId, userId, projectId, fileName, filePath, tableName}`
- **Query Jobs**: `{jobId, source, select, filters, groupBy, orderBy, limit, offset}`

**Flow**:

1. API publishes message
2. Worker consumes message
3. Worker processes job
4. Worker updates status in Redis

#### 5. Redis (Cache)

**Purpose**: Fast job status lookup and updates

**Data Structure**:

- Upload jobs: `job:{jobId}` → JSON with status, message, filePath, etc.
- Query jobs: `query:{jobId}` → JSON with status, resultPath, rowCount, fileSizeBytes

**TTL**: Jobs expire after 1 hour

**Updates**:

- API creates job records when jobs are submitted
- Worker updates status directly via Jedis client (`processing` → `completed`/`failed`)
- No HTTP calls for status updates (direct Redis access for performance)

#### 6. PostgreSQL (Iceberg Catalog)

**Purpose**: Store Iceberg table metadata

**Database**: `iceberg_catalog`

**Tables**:

- `iceberg_tables`: Table locations and metadata pointers
- `iceberg_namespace_properties`: Namespace (project) metadata

**Catalog Type**: JDBC catalog (Iceberg standard)

**Table Naming**:

- Catalog: `local`
- Namespace: `local.{projectId}`
- Table: `local.{projectId}.{tableName}`
- Example: `local.elm4r7a.sales`

### Code Interaction Flow

**Upload Job Processing:**

```
1. FileUploadController.uploadFile()
   ├─ Validates file
   ├─ Stores in MinIO (uploads/{jobId}/)
   ├─ Creates UploadJob in Redis
   ├─ Sends to RabbitMQ
   └─ Returns jobId to client

2. MessageConsumerService.handleDelivery()
   ├─ Receives message from RabbitMQ
   └─ Routes to JobProcessor

3. JobProcessor.processJob()
   ├─ Determines job type
   └─ Routes to UploadJobProcessor

4. UploadJobProcessor.process()
   ├─ Updates status to "processing" in Redis
   ├─ Downloads file from MinIO
   ├─ Reads CSV into Spark DataFrame
   ├─ Calls SparkService.writeToIceberg()
   │   ├─ Creates namespace: local.{projectId}
   │   ├─ Writes to Iceberg table
   │   └─ Returns row count
   ├─ Updates status to "completed" in Redis
   └─ Cleanup temp files
```

**Query Job Processing:**

```
1. QueryController.submitQuery()
   ├─ Validates query request
   ├─ Converts QueryRequest to JSON string
   ├─ Creates QueryJob in Redis (status: queued)
   ├─ Sends to RabbitMQ
   └─ Returns jobId to client

2. MessageConsumerService.handleDelivery()
   ├─ Receives message from RabbitMQ
   └─ Routes to JobProcessor

3. JobProcessor.processJob()
   ├─ Determines job type (query vs upload)
   └─ Routes to QueryJobProcessor

4. QueryJobProcessor.process()
   ├─ Updates status to "processing" in Redis
   ├─ Parses QueryRequest from JSON
   ├─ Loads Iceberg table (local.{projectId}.{tableName})
   ├─ Applies filters (predicate pushdown to Iceberg)
   ├─ Applies SELECT + aggregations + GROUP BY
   ├─ Applies ORDER BY and LIMIT/OFFSET
   ├─ Writes result to Parquet file
   ├─ Uploads to warehouse/wh/{projectId}/queries/
   ├─ Updates Redis: status=completed, resultPath, rowCount, fileSize
   └─ Cleanup temp files
```

---

## 🚀 Quick Start

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 8GB+ RAM recommended
- 10GB+ disk space

### 1. Clone Repository

```bash
git clone https://github.com/mohamed20o03/data-lakehouse.git
cd data-lakehouse
```

### 2. Configuration

The `.env` file is already configured with development defaults. For production, update passwords:

```bash
cp .env .env.backup  # Backup if needed
nano .env            # Update passwords for production
```

**Key variables to change for production:**

- `MINIO_ROOT_PASSWORD`
- `MINIO_SECRET_KEY`
- `RABBITMQ_DEFAULT_PASS`
- `POSTGRES_PASSWORD`

### 3. Start Services

```bash
docker compose up -d --build
```

### 4. Verify Services

```bash
docker compose ps
```

All services should show "Up" status:

- `api-service` (Port 8080)
- `minio` (Ports 9000, 9001)
- `postgres` (Port 5432)
- `rabbitmq` (Ports 5672, 15672)
- `redis` (Port 6379)
- `spark-worker`

### 5. Run Tests

```bash
cd api-service/service
./mvnw test
```

Expected output:

```
[INFO] Tests run: 10, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

All tests validate:

- ✅ Docker services health
- ✅ File upload to Iceberg tables
- ✅ Multiple batch merging
- ✅ Query execution with JSON results
- ✅ Result storage in MinIO

---

## 📚 API Documentation

See [QUERY_API.md](./QUERY_API.md) for complete API reference.

### Quick Examples

#### Upload File

```bash
curl -X POST http://localhost:8080/api/v1/upload \
  -F "file=@data.csv" \
  -F "userId=user1" \
  -F "projectId=proj1" \
  -F "tableName=sales"
```

Response:

```json
{
  "jobId": "uuid",
  "status": "queued"
}
```

#### Check Status

```bash
curl http://localhost:8080/api/v1/jobs/{jobId}
```

#### Execute Query

```bash
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "source": "proj1.sales",
    "select": [
      {"column": "Region", "as": "region"},
      {"column": "Revenue", "aggregation": "sum", "as": "total_revenue"}
    ],
    "filters": [
      {"column": "Date", "operator": ">=", "value": "2023-01-01"}
    ],
    "groupBy": ["Region"],
    "orderBy": [{"column": "total_revenue", "direction": "desc"}],
    "limit": 10
  }'
```

Response:

```json
{
  "jobId": "uuid",
  "status": "queued",
  "message": "Query job queued for processing",
  "checkStatusAt": "/api/v1/query/uuid"
}
```

#### Check Query Status

```bash
curl http://localhost:8080/api/v1/query/{jobId}
```

Response (completed):

```json
{
  "jobId": "uuid",
  "status": "completed",
  "resultPath": "warehouse/wh/proj1/queries/query_20251120_143022/result.parquet",
  "rowCount": 5000,
  "fileSizeBytes": 124567,
  "resultData": [
    { "Region": "North", "total_revenue": 50000 },
    { "Region": "South", "total_revenue": 45000 },
    { "Region": "East", "total_revenue": 38000 },
    { "Region": "West", "total_revenue": 42000 }
  ]
}
```

**Note:** `resultData` field contains query results as JSON array (up to 10,000 rows). For larger result sets, download the full Parquet file from `resultPath`.

---

## 💾 Data Storage Structure

See [MINIO_STRUCTURE.md](./MINIO_STRUCTURE.md) for detailed bucket structure.

### Two-Bucket Design

**Bucket 1: `uploads`** - Temporary raw files

```
uploads/{jobId}/{filename}.csv
```

**Bucket 2: `warehouse`** - Processed data and query results

```
warehouse/wh/{projectId}/{tableName}/      ← Iceberg tables
warehouse/wh/{projectId}/queries/          ← Query results
```

### Iceberg Table Structure

```
warehouse/wh/elm4r7a/sales/
├── metadata/
│   ├── v1.metadata.json          ← Schema, partition spec
│   ├── v2.metadata.json          ← Updated metadata
│   └── snap-*.avro               ← Snapshot metadata
└── data/
    └── 00000-0-*.parquet         ← Actual data files
```

### Query Results

```
warehouse/wh/elm4r7a/queries/
└── query_20251118_165511/
    └── result.parquet            ← Compressed result (2.2KB for 12 rows)
```

---

## ⚙️ Configuration

All configuration is centralized in `.env`. No hardcoded defaults exist.

### Environment Variables

| Variable                 | Default               | Description                |
| ------------------------ | --------------------- | -------------------------- |
| `MINIO_ROOT_USER`        | admin                 | MinIO admin username       |
| `MINIO_ROOT_PASSWORD`    | password123           | MinIO admin password       |
| `MINIO_ENDPOINT`         | http://minio:9000     | MinIO API endpoint         |
| `MINIO_ACCESS_KEY`       | admin                 | MinIO S3 access key        |
| `MINIO_SECRET_KEY`       | password123           | MinIO S3 secret key        |
| `RABBITMQ_DEFAULT_USER`  | admin                 | RabbitMQ username          |
| `RABBITMQ_DEFAULT_PASS`  | password123           | RabbitMQ password          |
| `RABBITMQ_QUEUE_NAME`    | file.processing.queue | Job queue name             |
| `POSTGRES_USER`          | iceberg_user          | PostgreSQL username        |
| `POSTGRES_PASSWORD`      | iceberg_pass          | PostgreSQL password        |
| `POSTGRES_DB`            | iceberg_catalog       | Iceberg metadata database  |
| `REDIS_HOST`             | redis                 | Redis hostname             |
| `REDIS_PORT`             | 6379                  | Redis port                 |
| `ICEBERG_WAREHOUSE_PATH` | s3a://warehouse/wh/   | Iceberg warehouse location |
| `API_SERVICE_PORT`       | 8080                  | API external port          |
| `FILE_MAX_SIZE`          | 104857600             | Max file size (100MB)      |

**After changing `.env`:**

```bash
docker compose down
docker compose up -d --build
```

---

## 🧪 Testing

### Automated Java Integration Tests

**Run all tests:**

```bash
cd api-service/service
./mvnw test
```

**Run specific test:**

```bash
./mvnw test -Dtest=DockerComposeHealthTest
./mvnw test -Dtest=SimpleUploadTest
./mvnw test -Dtest=IcebergQueryIntegrationTest
```

#### Test Suites Overview

We have **3 comprehensive test classes** with **10 total tests** that validate the entire platform:

##### 1. **DockerComposeHealthTest** (5 tests)

Quick smoke tests to verify all services are running correctly.

**Tests:**

- ✅ **API Service Health** - Verifies API is responsive (`/actuator/health`)
- ✅ **MinIO Accessibility** - Checks MinIO storage is available
- ✅ **RabbitMQ Management** - Validates message queue is operational
- ✅ **Queue Stats Endpoint** - Tests queue statistics API with live data
- ✅ **Services Summary** - Displays status of all Docker Compose services

**Runtime:** ~1 second  
**Purpose:** Fast validation that infrastructure is ready

**Example output:**

```
===========================================
Docker Compose Services Status
===========================================
✓ API Service: http://localhost:8080
✓ MinIO: http://localhost:9000
✓ RabbitMQ: http://localhost:15672
✓ Redis: localhost:6380
✓ PostgreSQL: localhost:5432
===========================================

Queue Statistics:
{"queueName":"file.processing.queue","messageCount":0,"consumerCount":1,"status":"available"}
```

---

##### 2. **SimpleUploadTest** (3 tests)

Basic upload functionality and job status tracking.

**Tests:**

- ✅ **Upload CSV File** - Uploads 10-row test file, validates job creation
- ✅ **Job Status Tracking** - Waits for completion, verifies status transitions (queued → processing → completed)
- ✅ **Queue Statistics** - Confirms message was processed through RabbitMQ

**Runtime:** ~2 seconds  
**Data:** 10 rows (ProductID, ProductName, Category, Price, Stock)  
**Purpose:** Validate basic upload pipeline

**What it tests:**

1. File upload via multipart form data
2. Job ID generation and queuing
3. Spark worker processing CSV → Iceberg table
4. Status updates in Redis (queued → completed)
5. Row count verification (10 rows processed)

---

##### 3. **IcebergQueryIntegrationTest** (2 tests)

End-to-end testing: upload multiple batches + query merged data + verify results stored in MinIO.

**Test 1: Upload and Query Merged Data** (1 test)

- ✅ **Uploads 3 batches to same table** (15+20+25=60 rows)
  - Batch 1: 15 rows (Product A, Region North)
  - Batch 2: 20 rows (Product B, Region South)
  - Batch 3: 25 rows (Product C, Region East)
- ✅ **Queries merged table** - Submits SELECT query for all columns
- ✅ **Verifies query results as JSON** - Confirms 60 rows returned in response
- ✅ **Validates MinIO storage** - Checks query results stored as Parquet file

**Runtime:** ~8 seconds  
**Total Data:** 60 rows (merged from 3 batches)  
**Query Output:**

- **JSON**: Returned in API response (`resultData` field, up to 10,000 rows)
- **Parquet**: Stored in MinIO at `warehouse/wh/{project}/queries/query_{timestamp}/result.parquet`**Test 2: Query with Filters** (1 test)

- ✅ **Uploads 2 batches** - 5 rows North + 5 rows South (10 total)
- ✅ **Queries with filter** - `WHERE Region = 'North'`
- ✅ **Verifies filtered results as JSON** - Confirms only 5 rows returned (North only)
- ✅ **Validates predicate pushdown** - Iceberg efficiently filters at read time

**Runtime:** ~4 seconds  
**Purpose:** Validate query engine, filters, JSON response, and result storage

**What it tests:**

1. **Upload Pipeline**: CSV → Iceberg table with merging
2. **Query Submission**: POST `/api/v1/query` with JSON query
3. **Query Processing**:
   - Iceberg table scanning
   - Filter application (WHERE clause)
   - Column selection (SELECT)
   - Result conversion to JSON
   - Result writing to Parquet
4. **Result Storage**:
   - JSON stored in Redis (up to 10,000 rows)
   - Parquet stored in MinIO warehouse
5. **Result Retrieval**: JSON data returned in GET `/api/v1/query/{jobId}` response
6. **Metadata Tracking**: Row count, file size, result path
7. **Async Job Handling**: Query job queuing and status updates**Example output:**

```
===========================================
Iceberg Upload and Query Test
Project: query_test_abc12345
Table: combined_sales
===========================================

✓ Batch 1: 15 rows uploaded (Product A, North)
✓ Batch 2: 20 rows uploaded (Product B, South)
✓ Batch 3: 25 rows uploaded (Product C, East)

Query Job ID: xyz-789-uuid
Query status: completed

===========================================
QUERY RESULTS
===========================================
Status: completed
Message: Query completed: 60 rows, result stored at warehouse/wh/query_test_abc12345/queries/query_20251211_164858/result.parquet
Result Path: warehouse/wh/query_test_abc12345/queries/query_20251211_164858/result.parquet
Row Count: 60
File Size: 2117 bytes
===========================================

✓ Uploaded 3 batches to same table
✓ Iceberg merged all data
✓ Query returned all 60 rows
✓ Query results stored in MinIO
```

**MinIO Storage Structure:**

```
warehouse/wh/query_test_abc12345/
  ├── combined_sales/              # Source Iceberg table
  │   ├── data/                    # 3 Parquet files (15+20+25 rows)
  │   └── metadata/                # 3 snapshots
  └── queries/                     # Query results
      └── query_20251211_164858/
          └── result.parquet       # 60 rows, 2117 bytes
```

---

#### Test Summary

| Test Class                    | Tests  | Runtime  | Purpose                                       |
| ----------------------------- | ------ | -------- | --------------------------------------------- |
| `DockerComposeHealthTest`     | 5      | ~1s      | Infrastructure validation                     |
| `SimpleUploadTest`            | 3      | ~2s      | Basic upload pipeline                         |
| `IcebergQueryIntegrationTest` | 2      | ~12s     | End-to-end: merge + query + result validation |
| **Total**                     | **10** | **~15s** | **Complete platform validation**              |

**All tests:**

- ✅ Use actual Docker services (no mocks)
- ✅ Generate unique project IDs (no conflicts)
- ✅ Create temporary CSV files (auto cleanup)
- ✅ Wait for async job completion (Awaitility)
- ✅ Verify data in MinIO and PostgreSQL
- ✅ Test real API endpoints (REST Assured)

---

### Running All Tests

```bash
cd api-service/service
./mvnw test
```

**Expected Results:**

- 10 tests pass in ~15 seconds
- All Docker services validated
- Upload, merge, and query functionality verified
- JSON results returned and validated

### Test Data

Sample CSV with 100 rows, 10 columns (Region, Product, Category, Date, Revenue, Profit, Quantity, etc.)

### Manual Testing

**Upload:**

```bash
curl -X POST http://localhost:8080/api/v1/upload \
  -F "file=@test_data.csv" \
  -F "userId=testuser" \
  -F "projectId=elm4r7a" \
  -F "tableName=sales"
```

**Query:**

```bash
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d @query.json  # See API_REFERENCE.md for examples
```

**Check Query Status and Get Results:**

```bash
curl http://localhost:8080/api/v1/query/{jobId}
```

**Response includes JSON data:**

```json
{
  "jobId": "abc-123",
  "status": "completed",
  "resultPath": "warehouse/wh/proj1/queries/query_20251211_192935/result.parquet",
  "rowCount": 60,
  "fileSizeBytes": 2117,
  "resultData": [
    {
      "ProductID": "P001",
      "ProductName": "Product A",
      "Region": "North",
      "Quantity": 10,
      "Price": 100.0
    },
    {
      "ProductID": "P002",
      "ProductName": "Product A",
      "Region": "North",
      "Quantity": 15,
      "Price": 100.0
    }
  ]
}
```

**Note:** `resultData` contains up to 10,000 rows as JSON. Full data available in Parquet file at `resultPath`.

📖 **See [TESTING.md](TESTING.md) for comprehensive testing documentation and troubleshooting.**

---

## 📊 Monitoring

### Service UIs

| Service                 | URL                                   | Credentials         |
| ----------------------- | ------------------------------------- | ------------------- |
| **MinIO Console**       | http://localhost:9001                 | admin / password123 |
| **RabbitMQ Management** | http://localhost:15672                | admin / password123 |
| **API Health**          | http://localhost:8080/actuator/health | -                   |

### Logs

**All services:**

```bash
docker compose logs -f
```

**Specific service:**

```bash
docker compose logs -f spark-worker
docker compose logs -f api-service
```

**Follow Spark job:**

```bash
docker logs spark-worker 2>&1 | grep -E "INFO|ERROR"
```

### Health Checks

**API:**

```bash
curl http://localhost:8080/actuator/health
```

**MinIO:**

```bash
curl http://localhost:9000/minio/health/live
```

**RabbitMQ:**

```bash
docker exec rabbitmq rabbitmq-diagnostics ping
```

### Metrics

**Job count:**

```bash
docker exec redis redis-cli DBSIZE
```

**Queue depth:**

```bash
curl -u admin:password123 http://localhost:15672/api/queues/%2F/file.processing.queue
```

---

## 🔧 Troubleshooting

### Common Issues

#### Services Won't Start

```bash
# Check status
docker compose ps

# View logs
docker compose logs [service]

# Restart specific service
docker compose restart [service]
```

#### Upload Fails

- Check file size < 100MB (`FILE_MAX_SIZE`)
- Verify MinIO is healthy
- Check API logs for errors

#### Worker Not Processing

```bash
# Check worker logs
docker compose logs spark-worker

# Verify RabbitMQ connection
docker compose logs spark-worker | grep RabbitMQ

# Check queue depth
curl -u admin:password123 http://localhost:15672/api/queues
```

#### Query Returns No Results

- Verify table exists in PostgreSQL catalog
- Check namespace: `local.{projectId}.{tableName}`
- Inspect Iceberg metadata:

```bash
docker exec postgres psql -U iceberg_user -d iceberg_catalog -c "SELECT * FROM iceberg_tables;"
```

#### Results Not in Warehouse Bucket

Check worker logs for bucket name:

```bash
docker logs spark-worker 2>&1 | grep "Uploading file to MinIO bucket"
```

Should show: `bucket 'warehouse': wh/{projectId}/queries/...`

### Clean Metadata

If data and metadata are out of sync:

```bash
# Clear PostgreSQL Iceberg metadata
docker exec postgres psql -U iceberg_user -d iceberg_catalog -c "TRUNCATE TABLE iceberg_tables CASCADE; TRUNCATE TABLE iceberg_namespace_properties CASCADE;"

# Clear Redis job cache
docker exec redis redis-cli FLUSHALL

# Rebuild and restart
docker compose down
docker compose up -d --build
```

### Performance Tuning

**Spark Memory:**
Edit `docker-compose.yml`:

```yaml
spark-worker:
  deploy:
    resources:
      limits:
        memory: 4G
```

**Connection Pool:**
Edit `api-service/service/src/main/resources/application.yml` for database connection pool sizing.

---

## 📖 Documentation

### Complete Guides

| Document                                     | Purpose                                 | Best For                        |
| -------------------------------------------- | --------------------------------------- | ------------------------------- |
| **[ARCHITECTURE.md](ARCHITECTURE.md)**       | System design, components, data flows   | Understanding how it all works  |
| **[API_REFERENCE.md](API_REFERENCE.md)**     | Complete API documentation & examples   | Frontend integration, API usage |
| **[TESTING.md](TESTING.md)**                 | Testing guide & automated scripts       | QA, troubleshooting, validation |
| **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** | Iceberg optimizations & advanced topics | Performance tuning, deep dives  |

### Quick Reference

**Run Tests**:

```bash
cd api-service/service
./mvnw test
```

**Scale Workers**:

```bash
docker compose up -d --scale spark-worker=3
```

**View Logs**:

```bash
docker compose logs -f api-service spark-worker
```

**Access Web UIs**:

- MinIO Console: http://localhost:9001 (admin/password123)
- RabbitMQ Management: http://localhost:15672 (admin/password123)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes and test
4. Submit a pull request

## 🎉 Acknowledgments

Built with:

- Apache Spark & Iceberg communities
- Spring Boot ecosystem
- MinIO team
- RabbitMQ project

---

**Questions or Issues?**

- Check [TESTING_GUIDE.md](./TESTING_GUIDE.md)
- Review service logs
- Open a GitHub issue

**Built with ❤️ for modern data engineering**
