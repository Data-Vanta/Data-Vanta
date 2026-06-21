# Testing Guide

> Comprehensive testing guide with automated scripts and manual test cases.

## 📚 Navigation

- [← Back to README](README.md)
- [API Reference →](API_REFERENCE.md)
- [Architecture →](ARCHITECTURE.md)

---

## Table of Contents

1. [Quick Start Testing](#quick-start-testing)
2. [Automated Test Suite](#automated-test-suite)
3. [Manual Testing](#manual-testing)
4. [Test Results](#test-results)
5. [Troubleshooting](#troubleshooting)

---

## Quick Start Testing

### Prerequisites

```bash
# Start all services
docker compose up -d

# Wait for services to initialize
sleep 10

# Verify services are running
docker compose ps
```

Expected output:

```
NAME                              STATUS
api-service                       Up (healthy)
spark-worker                      Up
minio                             Up (healthy)
rabbitmq                          Up (healthy)
postgres                          Up
redis                             Up
```

---

### Run Tests

**Quick Start**:

```bash
cd api-service/service
./mvnw test
```

**Expected Output**:

```
[INFO] Tests run: 10, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

---

## Automated Test Suite

### Java Integration Tests

**Test Classes**:

| Test Class                    | Tests | Purpose                                     |
| ----------------------------- | ----- | ------------------------------------------- |
| `DockerComposeHealthTest`     | 5     | Validates all infrastructure services       |
| `SimpleUploadTest`            | 3     | Tests basic upload pipeline                 |
| `IcebergQueryIntegrationTest` | 2     | Tests merge functionality & query with JSON |

**Total**: 10 tests, ~15 seconds runtime

**What It Tests**:

1. **Infrastructure Health** (5 tests)

   - ✅ API service availability
   - ✅ MinIO storage connectivity
   - ✅ RabbitMQ queue statistics
   - ✅ Redis status checks
   - ✅ PostgreSQL metadata database

2. **Upload Pipeline** (3 tests)

   - ✅ CSV file upload acceptance
   - ✅ Job status tracking (queued → processing → completed)
   - ✅ Background processing via RabbitMQ

3. **Query & Merge** (2 tests)
   - ✅ Upload multiple batches to same table (merge)
   - ✅ Retrieve table schema from Iceberg metadata
   - ✅ Query merged data and verify JSON results
   - ✅ Query with filters and verify only matching rows returned

**When to Use**:

- After making code changes
- Before committing
- CI/CD pipeline validation
- Before releases

---

### Expected Output

```
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.datalake.api.integration.DockerComposeHealthTest
  "status": "queued"
}
✓ Test 1 PASSED

Waiting for upload to complete...
  Attempt 1: Status = processing
  Attempt 2: Status = completed

Test 2: Get Upload Job Status
--------------------------------------
{
  "jobId": "abc-123-xyz",
  "status": "completed",
  "message": "Successfully processed 100 rows"
}
✓ Test 2 PASSED

Test 3: Get Table Schema
--------------------------------------
{
  "jobId": "schema-xyz-123",
  "status": "completed",
  "message": "Schema retrieved: 5 columns",
  "resultData": [
    {"name": "ProductID", "type": "string", "nullable": true},
    {"name": "ProductName", "type": "string", "nullable": true},
    {"name": "Region", "type": "string", "nullable": true},
    {"name": "Quantity", "type": "int", "nullable": true},
    {"name": "Price", "type": "double", "nullable": true}
  ]
}
✓ Test 3 PASSED (Schema discovery working)

Test 4: Submit Query Job
--------------------------------------
{
  "jobId": "query-xyz-123",
  "status": "queued"
}
✓ Test 4 PASSED

Test 5: Get Query Job Status
--------------------------------------
{
  "jobId": "query-xyz-123",
  "status": "completed",
  "rowCount": 60,
  "fileSizeBytes": 2121,
  "resultData": [
    {"ProductID": "P001", "ProductName": "Product A", ...},
    ...
  ]
}
✓ Test 5 PASSED (60 rows from merged batches)

Test 6: Get Queue Statistics
--------------------------------------
{
  "queueName": "file.processing.queue",
  "messageCount": 0,
  "consumerCount": 1
}
✓ Test 6 PASSED

Test 7: Query with Filters
--------------------------------------
{
  "jobId": "filter-query-xyz",
  "status": "completed",
  "rowCount": 5,
  "resultData": [
    {"ProductID": "P001", "Region": "North", ...},
    ...
  ]
}
✓ Test 7 PASSED (5 rows filtered from 10 total)

======================================
  Test Suite Complete!
======================================

Summary:
  Upload Job ID:  abc-123-xyz
  Query Job ID:   query-xyz-123
  Result Rows:    3
```

---

## Manual Testing

### Test 1: Upload CSV File

```bash
curl -X POST http://localhost:8080/api/v1/upload \
  -F "file=@test_data.csv" \
  -F "userId=testuser" \
  -F "projectId=myproject" \
  -F "tableName=sales"
```

**Success Criteria**:

- Returns HTTP 200
- Response contains `jobId` (UUID format)
- Status is "queued"

---

### Test 2: Check Upload Status

```bash
# Save jobId from Test 1
JOB_ID="abc-123-xyz"

# Poll for status
curl http://localhost:8080/api/v1/jobs/$JOB_ID | jq
```

**Success Criteria**:

- Status progresses: queued → processing → completed
- Completed message shows row count
- Table name is correct

---

### Test 3: Get Table Schema

```bash
# Discover table structure before querying
curl http://localhost:8080/api/v1/schema/myproject/sales | jq

# Save schema jobId
SCHEMA_JOB_ID="schema-xyz-123"

# Check schema result
curl http://localhost:8080/api/v1/query/$SCHEMA_JOB_ID | jq
```

**Expected Response**:

```json
{
  "jobId": "schema-xyz-123",
  "status": "completed",
  "message": "Schema retrieved: 7 columns from table myproject.sales",
  "rowCount": 7,
  "resultData": [
    { "name": "id", "type": "int", "nullable": false },
    { "name": "name", "type": "string", "nullable": true },
    { "name": "email", "type": "string", "nullable": true },
    { "name": "region", "type": "string", "nullable": true },
    { "name": "status", "type": "string", "nullable": true },
    { "name": "amount", "type": "double", "nullable": true },
    { "name": "created_date", "type": "date", "nullable": true }
  ]
}
```

**Success Criteria**:

- Returns list of columns with names, types, and nullable info
- Column count matches table structure
- JSON format ready for integration

---

### Test 4: Submit Query

```bash
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "source": "myproject.sales",
    "select": [
      {"column": "region", "as": "region"},
      {"column": "amount", "aggregation": "sum", "as": "total_revenue"}
    ],
    "filters": [
      {"column": "created_date", "operator": ">=", "value": "2023-01-01"}
    ],
    "groupBy": ["region"],
    "orderBy": [{"column": "total_revenue", "direction": "desc"}],
    "limit": 10
  }' | jq
```

**Success Criteria**:

- Returns HTTP 200
- Response contains query `jobId`
- Includes `checkStatusAt` URL

---

### Test 5: Check Query Status & Get Results

```bash
# Save query jobId from Test 3
QUERY_JOB_ID="query-xyz-123"

# Poll for results
curl http://localhost:8080/api/v1/query/$QUERY_JOB_ID | jq
```

**Success Criteria**:

- Status becomes "completed"
- Response includes `resultPath`
- `rowCount` and `fileSizeBytes` are present
- **`resultData` field contains query results as JSON array** (up to 10,000 rows)

**Example Response**:

```json
{
  "jobId": "query-xyz-123",
  "status": "completed",
  "resultPath": "warehouse/wh/myproject/queries/query_20251120_150608/result.parquet",
  "rowCount": 12,
  "fileSizeBytes": 2193,
  "resultData": [
    { "Region": "North", "total_revenue": 50000 },
    { "Region": "South", "total_revenue": 45000 }
  ]
}
```

**Note:** For larger result sets (>10,000 rows), download the full Parquet file from MinIO using `resultPath`

---

### Test 6: View Queue Statistics

```bash
curl http://localhost:8080/api/v1/queue/stats | jq
```

**Success Criteria**:

- Returns queue name
- Shows consumer count (≥1)
- Status is "available"

---

### Test 7: List Tables (Placeholder)

```bash
curl http://localhost:8080/api/v1/query/tables | jq
```

**Expected**:

- Returns placeholder message
- Suggests using `{projectId}.{tableName}` format

---

### Test 8: Update Job Status (Internal)

```bash
curl -X POST http://localhost:8080/api/v1/jobs/$JOB_ID/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "processing",
    "message": "Test update"
  }' | jq
```

**Success Criteria**:

- Returns job object with updated status
- Can retrieve updated status via GET

---

## Advanced Test Scenarios

### Test Multi-Column GROUP BY

```bash
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "source": "myproject.sales",
    "select": [
      {"column": "Region", "as": "region"},
      {"column": "Product", "as": "product"},
      {"column": "Category", "as": "category"},
      {"column": "Revenue", "aggregation": "sum", "as": "total_revenue"}
    ],
    "groupBy": ["Region", "Product", "Category"],
    "orderBy": [{"column": "total_revenue", "direction": "desc"}],
    "limit": 20
  }' | jq
```

---

### Test Date Range Filtering

```bash
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "source": "myproject.sales",
    "select": [
      {"column": "Date"},
      {"column": "Sales", "aggregation": "count"}
    ],
    "filters": [
      {"column": "Date", "operator": ">=", "value": "2023-06-01"},
      {"column": "Date", "operator": "<=", "value": "2023-06-30"}
    ],
    "groupBy": ["Date"],
    "orderBy": [{"column": "Date", "direction": "asc"}]
  }' | jq
```

---

### Test Multiple Aggregations

```bash
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "source": "myproject.sales",
    "select": [
      {"column": "Product"},
      {"column": "Revenue", "aggregation": "sum", "as": "total_revenue"},
      {"column": "Quantity", "aggregation": "sum", "as": "total_units"},
      {"column": "Profit", "aggregation": "avg", "as": "avg_profit"},
      {"column": "*", "aggregation": "count", "as": "transaction_count"}
    ],
    "groupBy": ["Product"],
    "orderBy": [{"column": "total_revenue", "direction": "desc"}],
    "limit": 10
  }' | jq
```

---

### Test Query by Job ID

```bash
# Use upload jobId as source instead of table name
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": \"$JOB_ID\",
    \"select\": [{\"column\": \"*\"}],
    \"limit\": 5
  }" | jq
```

---

## Test Results

### Download Query Results

**Option 1: MinIO Console**

1. Open http://localhost:9001
2. Login: admin/password123
3. Navigate to `warehouse` → `wh/{projectId}/queries/{timestamp}/`
4. Download `result.parquet`

**Option 2: Python**

```python
import pandas as pd

# Download from MinIO first, then:
df = pd.read_parquet('result.parquet')
print(df)
```

**Option 3: MinIO CLI**

```bash
# Configure mc
mc alias set myminio http://localhost:9000 admin password123

# Download
mc cp myminio/warehouse/wh/myproject/queries/query_20251120_150608/result.parquet .

# Read
python -c "import pandas as pd; print(pd.read_parquet('result.parquet'))"
```

---

## Troubleshooting

### Issue: Upload Stuck at "queued"

**Symptoms**:

- Job status remains "queued" for >1 minute
- No progress to "processing"

**Diagnosis**:

```bash
# Check Spark worker logs
docker compose logs spark-worker

# Check RabbitMQ
curl http://localhost:8080/api/v1/queue/stats | jq
```

**Solutions**:

1. Restart Spark worker: `docker compose restart spark-worker`
2. Check RabbitMQ has consumer: `consumerCount` should be ≥1
3. Check worker logs for errors

---

### Issue: Upload Failed

**Symptoms**:

- Job status is "failed"
- Error message in response

**Diagnosis**:

```bash
# Get job details
curl http://localhost:8080/api/v1/jobs/$JOB_ID | jq '.message'

# Check worker logs
docker compose logs spark-worker | grep -A 5 "ERROR"
```

**Common Causes**:

- Invalid CSV format
- Missing columns
- PostgreSQL connection error
- MinIO connection error

---

### Issue: Query Returns No Results

**Symptoms**:

- Query completes successfully
- `rowCount` is 0

**Diagnosis**:

```bash
# Check if table exists
docker exec spark-worker spark-sql \
  --conf spark.sql.catalog.local=org.apache.iceberg.spark.SparkCatalog \
  --conf spark.sql.catalog.local.type=hadoop \
  --conf spark.sql.catalog.local.warehouse=/warehouse \
  -e "SHOW TABLES IN local.db;"

# Check table data
docker exec spark-worker spark-sql \
  --conf spark.sql.catalog.local=org.apache.iceberg.spark.SparkCatalog \
  --conf spark.sql.catalog.local.type=hadoop \
  --conf spark.sql.catalog.local.warehouse=/warehouse \
  -e "SELECT COUNT(*) FROM local.db.myproject.sales;"
```

**Solutions**:

1. Verify upload completed successfully
2. Check filters aren't too restrictive
3. Verify table name format: `{projectId}.{tableName}`

---

### Issue: Query Timeout

**Symptoms**:

- Query takes >30 seconds
- Status becomes "failed" with timeout error

**Solutions**:

1. Add more specific filters to reduce data scanned
2. Increase query timeout in Spark worker config
3. Optimize Iceberg table (partition by frequently filtered column)

---

### Issue: Can't Access MinIO Console

**Symptoms**:

- http://localhost:9001 not accessible
- Connection refused

**Diagnosis**:

```bash
# Check MinIO status
docker compose ps minio

# Check logs
docker compose logs minio
```

**Solutions**:

1. Restart MinIO: `docker compose restart minio`
2. Check port 9001 is not in use: `lsof -i :9001`
3. Verify docker-compose.yml has correct port mapping

---

### Issue: RabbitMQ Not Processing

**Symptoms**:

- `messageCount` increases but jobs don't process
- `consumerCount` is 0

**Diagnosis**:

```bash
# Check RabbitMQ Management UI
open http://localhost:15672
# Login: admin/password123

# Check worker connection
docker compose logs spark-worker | grep -i "rabbitmq"
```

**Solutions**:

1. Restart worker: `docker compose restart spark-worker`
2. Check RabbitMQ credentials in worker config
3. Verify queue name matches: `file.processing.queue`

---

## Performance Testing

### Load Test: Multiple Uploads

```bash
# Upload 10 files concurrently
for i in {1..10}; do
  curl -X POST http://localhost:8080/api/v1/upload \
    -F "file=@test_data.csv" \
    -F "userId=user$i" \
    -F "projectId=loadtest" \
    -F "tableName=table$i" &
done
wait

# Check queue depth
curl http://localhost:8080/api/v1/queue/stats | jq
```

---

### Load Test: Multiple Queries

```bash
# Submit 20 queries concurrently
for i in {1..20}; do
  curl -X POST http://localhost:8080/api/v1/query \
    -H "Content-Type: application/json" \
    -d '{
      "source": "myproject.sales",
      "select": [{"column": "*"}],
      "limit": 100
    }' &
done
wait
```

---

## Monitoring

### View Service Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api-service
docker compose logs -f spark-worker

# Filter errors
docker compose logs api-service | grep ERROR
docker compose logs spark-worker | grep ERROR
```

---

### Monitor Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df

# MinIO bucket sizes
mc du myminio/uploads
mc du myminio/warehouse
```

---

## Clean Up Test Data

### Clear All Data

```bash
# Stop services
docker compose down

# Clear PostgreSQL metadata
docker compose up -d postgres
docker exec postgres psql -U iceberg_user -d iceberg_catalog \
  -c "TRUNCATE TABLE iceberg_tables CASCADE; TRUNCATE TABLE iceberg_namespace_properties CASCADE;"

# Clear Redis
docker compose up -d redis
docker exec redis redis-cli FLUSHALL

# Clear MinIO (via console or mc)
mc rm -r --force myminio/uploads/
mc rm -r --force myminio/warehouse/wh/

# Restart all services
docker compose up -d
```

---

### Clear Specific Project

```bash
# Delete Iceberg table
docker exec spark-worker spark-sql \
  --conf spark.sql.catalog.local=org.apache.iceberg.spark.SparkCatalog \
  --conf spark.sql.catalog.local.type=hadoop \
  --conf spark.sql.catalog.local.warehouse=/warehouse \
  -e "DROP TABLE IF EXISTS local.db.myproject.sales;"

# Delete MinIO files
mc rm -r --force myminio/warehouse/wh/myproject/
```

---

## Next Steps

- [API Reference →](API_REFERENCE.md) - Detailed API documentation
- [Developer Guide →](DEVELOPER_GUIDE.md) - Iceberg optimizations & advanced topics
- [Architecture →](ARCHITECTURE.md) - System design details
