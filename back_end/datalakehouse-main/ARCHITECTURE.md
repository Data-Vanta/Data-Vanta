# System Architecture

> Comprehensive guide to the data lakehouse architecture, components, and data flows.

## 📚 Navigation

- [← Back to README](README.md)
- [API Reference →](API_REFERENCE.md)
- [Testing Guide →](TESTING.md)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Details](#component-details)
3. [Data Flow Diagrams](#data-flow-diagrams)
4. [Storage Structure](#storage-structure)
5. [Redis Implementation](#redis-implementation)

---

## Architecture Overview

```
┌─────────────┐     REST API        ┌──────────────┐
│   Client    │ ──────────────────→ │ API Service  │
│  (curl/app) │                     │ (Spring Boot)│
└─────────────┘                     └──────┬───────┘
                                           │
                                           │ Publish Job
                                           ↓
                                    ┌──────────────┐
                                    │  RabbitMQ    │
                                    │   (Queue)    │
                                    └──────┬───────┘
                                           │
                                           │ Consume Job
                                           ↓
                                    ┌──────────────┐
                                    │ Spark Worker │
                                    │ (Processing) │
                                    └──────┬───────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ↓                      ↓                      ↓
             ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
             │    MinIO     │      │  PostgreSQL  │      │    Redis     │
             │   (Storage)  │      │  (Metadata)  │      │   (Cache)    │
             └──────────────┘      └──────────────┘      └──────────────┘
```

### Design Principles

- **Decoupled Architecture**: API service and processing are separate, communicating via message queue
- **Asynchronous Processing**: Jobs processed in background, users don't wait
- **Scalability**: Horizontal scaling of both API and worker services
- **Resilience**: Message queue ensures no job loss, Redis provides fast status lookup
- **Cloud-Native**: Containerized services, S3-compatible storage

---

## Component Details

### 1. API Service (Spring Boot)

**Purpose**: Front door for all client interactions

**Technology Stack**:

- Spring Boot 3.x
- Spring Data Redis (Lettuce)
- Spring AMQP (RabbitMQ)
- MinIO SDK

**Key Responsibilities**:

- Accept file uploads
- Validate and store files in MinIO
- Create job records in Redis
- Publish jobs to RabbitMQ
- Accept query requests
- Return job status from Redis

**Code Location**: `api-service/service/src/main/java/com/datalake/api/`

**Key Classes**:
| Class | Purpose |
|-------|---------|
| `FileUploadController` | Handles `/api/v1/upload` endpoint |
| `QueryController` | Handles `/api/v1/query` endpoints |
| `JobController` | Handles `/api/v1/jobs` status endpoints |
| `FileStorageService` | MinIO file operations |
| `JobStatusService` | Redis job status management |
| `RabbitMQService` | Publishes jobs to queue |

**Redis Configuration**:

```yaml
# application.yml
spring:
  data:
    redis:
      host: redis
      port: 6379
```

Spring Boot auto-configures:

1. `LettuceConnectionFactory` (connection pool)
2. `StringRedisTemplate` (Redis operations)
3. Automatic connection pooling with Lettuce

---

### 2. Spark Worker (Standalone Java)

**Purpose**: Process upload and query jobs asynchronously

**Technology Stack**:

- Apache Spark 3.4
- Apache Iceberg 1.3
- Jedis (Redis client)
- RabbitMQ Java client

**Key Responsibilities**:

- Consume jobs from RabbitMQ
- Download files from MinIO
- Read CSVs into Spark DataFrames
- Write to Iceberg tables with ACID
- Execute queries with optimizations
- Save results as Parquet
- Update job status in Redis

**Code Location**: `spark/worker-app/src/main/java/com/datalake/spark/`

**Key Classes**:
| Class | Purpose |
|-------|---------|
| `WorkerApp` | Application entry point |
| `MessageConsumerService` | Consumes from RabbitMQ |
| `JobProcessor` | Routes jobs to processors |
| `UploadJobProcessor` | Handles CSV → Iceberg |
| `QueryJobProcessor` | Handles queries → Parquet |
| `SparkService` | Spark session & operations |
| `RedisService` | Direct Redis updates (Jedis) |
| `MinioService` | File downloads/uploads |

**Why Jedis Instead of Spring?**

The Spark worker is **not a Spring Boot application**, so it must manually manage Redis connections:

```java
// Manual connection pool initialization
private final JedisPool jedisPool;

public RedisService(AppConfig config) {
    this.jedisPool = new JedisPool(config.getRedisHost(), config.getRedisPort());
}

// Usage with try-with-resources (auto-returns connection to pool)
try (Jedis jedis = jedisPool.getResource()) {
    jedis.setex(key, ttl, value);
}
```

**Performance Benefits of Jedis Pool**:
| Metric | Without Pool | With Pool | Improvement |
|--------|--------------|-----------|-------------|
| Connection creation | ~5ms | ~0.1ms | 50x faster |
| Concurrent requests | 1 at a time | 8 parallel | 8x throughput |
| Memory usage | New conn each time | Reuse 8 conns | 90% less |

---

### 3. MinIO (Object Storage)

**Purpose**: S3-compatible object storage for files and data

**Buckets**:

1. **`uploads`** - Raw uploaded CSV files

   ```
   uploads/
   └── {jobId}/
       └── {filename}.csv
   ```

2. **`warehouse`** - Iceberg tables and query results
   ```
   warehouse/
   └── wh/                                    ← Iceberg warehouse root
       └── {projectId}/                       ← Project namespace
           ├── {tableName}/                   ← Iceberg table
           │   ├── metadata/
           │   │   ├── v1.metadata.json
           │   │   └── snap-*.avro
           │   └── data/
           │       └── *.parquet
           │
           └── queries/                       ← Query results
               └── query_{timestamp}/
                   └── result.parquet
   ```

**Why Two Buckets?**

- **Separation of concerns**: Raw vs. processed data
- **Different lifecycles**: Uploads can be deleted after processing
- **Clear organization**: Easy to identify data stages

**Access**:

- Console: http://localhost:9001 (admin/password123)
- S3 API: http://localhost:9000

---

### 4. RabbitMQ (Message Queue)

**Purpose**: Decouple API from processing, enable async jobs

**Queue Configuration**:

- Queue name: `file.processing.queue`
- Durable: Yes (survives broker restart)
- Auto-delete: No
- Message format: JSON

**Message Types**:

1. **Upload Job**:

```json
{
  "jobId": "abc-123",
  "userId": "user1",
  "projectId": "proj1",
  "fileName": "data.csv",
  "filePath": "uploads/abc-123/data.csv",
  "tableName": "customers",
  "jobType": "upload"
}
```

2. **Query Job**:

```json
{
  "jobId": "query-xyz",
  "source": "proj1.customers",
  "queryJson": "{...query spec...}",
  "jobType": "query"
}
```

**Benefits**:

- **Reliability**: Messages persist until processed
- **Load balancing**: Multiple workers consume from same queue
- **Retry logic**: Failed jobs can be re-queued
- **Monitoring**: Web UI shows queue depth

**Access**:

- Management UI: http://localhost:15672 (admin/password123)

---

### 5. Redis (Cache)

**Purpose**: Fast job status storage and retrieval

**Data Structure**:

```
Key: job:{jobId}               (Upload jobs)
Key: query:{jobId}            (Query jobs)
TTL: 3600 seconds (1 hour)
```

**Upload Job Value**:

```json
{
  "jobId": "abc-123",
  "userId": "user1",
  "projectId": "proj1",
  "fileName": "data.csv",
  "filePath": "uploads/abc-123/data.csv",
  "tableName": "customers",
  "fileSize": 6732,
  "timestamp": "2025-11-20T15:00:00",
  "status": "completed",
  "message": "Successfully processed 100 rows"
}
```

**Query Job Value**:

```json
{
  "jobId": "query-xyz",
  "jobType": "query",
  "source": "proj1.customers",
  "queryJson": "{...}",
  "status": "completed",
  "message": "Query completed: 12 rows",
  "resultPath": "warehouse/wh/proj1/queries/query_20251120_150608/result.parquet",
  "rowCount": 12,
  "fileSizeBytes": 2193,
  "resultData": [
    { "Region": "North", "total_revenue": 50000 },
    { "Region": "South", "total_revenue": 45000 }
  ],
  "timestamp": "2025-11-20T15:00:08"
}
```

**Note:** The `resultData` field contains query results as JSON array (up to 10,000 rows). For larger datasets, the full Parquet file is available at `resultPath`.

**Why Redis?**

- **Speed**: In-memory, sub-millisecond reads
- **Automatic expiry**: TTL prevents stale data
- **Atomic operations**: No race conditions
- **Simple**: Key-value model, perfect for status
- **JSON storage**: Stores query results directly for immediate access

**Update Mechanism**:

- **API Service**: Writes initial "queued" status
- **Spark Worker**: Updates to "processing" → "completed"/"failed"
- **Client**: Polls for status changes

---

### 6. PostgreSQL (Metadata Catalog)

**Purpose**: Store Apache Iceberg table metadata

**What It Stores**:

- Table locations
- Schema versions
- Partition specifications
- Snapshot history
- Manifest file locations
- Column statistics

**Why PostgreSQL?**

- Iceberg requires a catalog to track table metadata
- JDBC catalog is simplest for single-cluster setups
- Provides ACID guarantees for metadata updates
- Enables concurrent writers (multiple Spark jobs)

**Connection**:

```properties
spark.sql.catalog.local.type=jdbc
spark.sql.catalog.local.uri=jdbc:postgresql://postgres:5432/iceberg_catalog
spark.sql.catalog.local.jdbc.user=iceberg_user
```

**Tables Created by Iceberg**:

- `iceberg_tables` - Table registry
- `iceberg_namespace_properties` - Namespace configs

---

## Data Flow Diagrams

### Upload Flow

```
1. Client uploads CSV
    ↓
2. API validates file
    ↓
3. API saves to MinIO: uploads/{jobId}/file.csv
    ↓
4. API creates job in Redis (status: "queued")
    ↓
5. API publishes to RabbitMQ
    ↓
6. API returns jobId to client
    ↓
7. Worker consumes message
    ↓
8. Worker updates Redis (status: "processing")
    ↓
9. Worker downloads CSV from MinIO
    ↓
10. Worker reads CSV into Spark DataFrame
    ↓
11. Worker creates namespace in PostgreSQL
    ↓
12. Worker creates Iceberg table
    ↓
13. Worker writes Parquet files to MinIO warehouse
    ↓
14. Worker writes metadata to MinIO warehouse
    ↓
15. Worker updates PostgreSQL catalog
    ↓
16. Worker updates Redis (status: "completed")
    ↓
17. Client polls Redis for status
```

### Query Flow

```
1. Client submits query JSON
    ↓
2. API validates query structure
    ↓
3. API creates query job in Redis (status: "queued")
    ↓
4. API publishes to RabbitMQ
    ↓
5. API returns queryJobId to client
    ↓
6. Worker consumes message
    ↓
7. Worker updates Redis (status: "processing")
    ↓
8. Worker reads Iceberg table metadata from PostgreSQL
    ↓
9. Worker applies partition pruning (skip irrelevant partitions)
    ↓
10. Worker applies file skipping (min/max stats)
    ↓
11. Worker reads only required columns (projection)
    ↓
12. Worker executes aggregations and sorting
    ↓
13. Worker converts DataFrame to JSON (up to 10,000 rows)
    ↓
14. Worker writes result to /tmp/result.parquet
    ↓
15. Worker uploads to MinIO: warehouse/wh/{project}/queries/{timestamp}/
    ↓
16. Worker updates Redis with resultPath, rowCount, and resultData (JSON)
    ↓
17. Client polls Redis for status
    ↓
18. Client receives JSON results immediately from Redis
    ↓
19. (Optional) Client downloads full result.parquet from MinIO for larger datasets
```

---

## Storage Structure

### MinIO Bucket Layout

```
MinIO
├── uploads/                                    [Bucket 1: Raw files]
│   └── {jobId}/
│       └── {filename}.csv
│
└── warehouse/                                  [Bucket 2: Processed data]
    └── wh/                                     [Iceberg warehouse root]
        └── {projectId}/
            ├── {tableName}/                    [Iceberg table]
            │   ├── metadata/
            │   │   ├── v1.metadata.json        [Schema, partitions]
            │   │   ├── v2.metadata.json        [Schema evolution]
            │   │   ├── snap-123.avro           [Snapshot manifest]
            │   │   └── manifest-*.avro         [File-level metadata]
            │   └── data/
            │       ├── 00000-0-data.parquet    [Actual data]
            │       └── 00001-0-data.parquet
            │
            └── queries/                        [Query results]
                └── query_20251120_150608/
                    └── result.parquet
```

### Iceberg Table Structure

**Metadata Hierarchy**:

```
table_metadata.json
├── Schema (column definitions)
├── Partition Spec (partitioning strategy)
├── Sort Order (physical layout)
└── Snapshots (version history)
    └── Manifest List (snapshot metadata)
        └── Manifests (partition-level metadata)
            ├── Data File Paths
            ├── Partition Values
            ├── Record Counts
            └── Column Statistics (min/max, null counts)
```

**Why This Matters**:

- Iceberg reads metadata to skip files without opening them
- Enables partition pruning, file skipping, and column projection
- Provides time travel (query historical snapshots)

---

## Redis Implementation

### API Service (Spring Boot + Lettuce)

**Auto-Configuration**:

```java
// No explicit config needed!
// Spring Boot detects dependency and creates beans automatically

@Service
@RequiredArgsConstructor
public class JobStatusService {
    private final StringRedisTemplate redisTemplate; // Auto-injected

    public void saveJobStatus(UploadJob job) {
        String key = "job:" + job.getJobId();
        String value = objectMapper.writeValueAsString(job);
        redisTemplate.opsForValue().set(key, value, 1, TimeUnit.HOURS);
    }
}
```

**Connection Pooling**: Handled automatically by Lettuce (Spring's default Redis client)

---

### Spark Worker (Standalone + Jedis)

**Manual Configuration**:

```java
// Must manually create connection pool
public class RedisService {
    private final JedisPool jedisPool;

    public RedisService(AppConfig config) {
        // Create pool with 8 connections
        this.jedisPool = new JedisPool(config.getRedisHost(), config.getRedisPort());
    }

    public void updateStatus(String jobId, String status) {
        // Borrow connection from pool
        try (Jedis jedis = jedisPool.getResource()) {
            String key = "query:" + jobId;
            Map<String, Object> data = getExistingJob(jedis, key);
            data.put("status", status);
            jedis.setex(key, 3600, objectMapper.writeValueAsString(data));
        } // Auto-returns connection to pool
    }
}
```

**Why Different Approaches?**

| Aspect        | API Service     | Spark Worker       |
| ------------- | --------------- | ------------------ |
| Framework     | Spring Boot     | Plain Java         |
| Redis Client  | Lettuce         | Jedis              |
| Pooling       | Auto (Spring)   | Manual (JedisPool) |
| Configuration | application.yml | Java code          |
| Thread Safety | Spring handles  | Pool handles       |

---

## Scalability

### Horizontal Scaling

```bash
# Scale API service (multiple instances behind load balancer)
docker compose up -d --scale api-service=3

# Scale Spark workers (multiple consumers on same queue)
docker compose up -d --scale spark-worker=5
```

**What Happens**:

- Multiple API instances serve requests (stateless)
- Multiple workers consume from same RabbitMQ queue
- RabbitMQ load-balances jobs across workers
- Redis shared state visible to all instances
- PostgreSQL handles concurrent Iceberg writes

**Bottlenecks**:

- RabbitMQ message rate
- PostgreSQL metadata writes
- MinIO storage throughput

---

## High Availability

**Single Points of Failure**:

- RabbitMQ (single instance)
- PostgreSQL (single instance)
- Redis (single instance)

**Production Improvements**:

- RabbitMQ cluster with mirrored queues
- PostgreSQL with replication (primary/replica)
- Redis Sentinel or Cluster mode
- MinIO distributed mode (multi-node)

---

## Next Steps

- [API Reference →](API_REFERENCE.md) - Complete API documentation
- [Testing Guide →](TESTING.md) - Test all endpoints
- [Developer Guide →](DEVELOPER_GUIDE.md) - Iceberg optimizations
