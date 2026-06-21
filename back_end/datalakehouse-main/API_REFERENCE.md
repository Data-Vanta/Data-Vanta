# API Reference

> Complete API documentation with request/response examples and testing instructions.

## 📚 Navigation

- [← Back to README](README.md)
- [Architecture Guide →](ARCHITECTURE.md)
- [Testing Guide →](TESTING.md)

---

## Table of Contents

1. [API Overview](#api-overview)
2. [Upload Endpoints](#upload-endpoints)
3. [Query Endpoints](#query-endpoints)
4. [Job Status Endpoints](#job-status-endpoints)
5. [Monitoring Endpoints](#monitoring-endpoints)
6. [Query Language](#query-language)

---

## API Overview

**Base URL**: `http://localhost:8080/api/v1`

### Available Endpoints

| Endpoint                          | Method | Purpose                        | Status         |
| --------------------------------- | ------ | ------------------------------ | -------------- |
| `/upload`                         | POST   | Upload CSV file                | ✅ Production  |
| `/jobs/{jobId}`                   | GET    | Get upload job status          | ✅ Production  |
| `/query`                          | POST   | Submit query job               | ✅ Production  |
| `/query/{jobId}`                  | GET    | Get query job status & results | ✅ Production  |
| `/schema/{projectId}/{tableName}` | GET    | Get table schema               | ✅ Production  |
| `/queue/stats`                    | GET    | View RabbitMQ statistics       | ✅ Production  |
| `/query/tables`                   | GET    | List available tables          | ⚠️ Placeholder |
| `/jobs/{jobId}/status`            | POST   | Update job status (internal)   | ✅ Production  |

---

## Upload Endpoints

### POST /upload

Upload a CSV file and create an Iceberg table.

**Request**:

```bash
curl -X POST http://localhost:8080/api/v1/upload \
  -F "file=@test_data.csv" \
  -F "userId=user123" \
  -F "projectId=myproject" \
  -F "tableName=sales"
```

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | File | Yes | CSV file to upload |
| `userId` | String | No | User identifier (defaults to "anonymous" if not provided) |
| `projectId` | String | Yes | Project/namespace identifier |
| `tableName` | String | No | Target Iceberg table name (defaults to filename if not provided) |

**Response** (200 OK):

```json
{
  "jobId": "abc-123-xyz-789",
  "status": "queued"
}
```

**Response Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `jobId` | String | Unique job identifier (UUID) |
| `status` | String | Initial status (always "queued") |

**Error Response** (400 Bad Request):

```json
{
  "error": "Invalid file format",
  "message": "Only CSV files are supported"
}
```

---

### GET /jobs/{jobId}

Get upload job status and details.

**Request**:

```bash
curl http://localhost:8080/api/v1/jobs/abc-123-xyz-789
```

**Response - Queued** (200 OK):

```json
{
  "jobId": "abc-123-xyz-789",
  "userId": "user123",
  "projectId": "myproject",
  "fileName": "test_data.csv",
  "filePath": "uploads/abc-123-xyz-789/test_data.csv",
  "tableName": "sales",
  "fileSize": 6732,
  "timestamp": "2025-11-20T15:00:00",
  "status": "queued",
  "message": "Job queued for processing"
}
```

**Response - Processing** (200 OK):

```json
{
  "jobId": "abc-123-xyz-789",
  "userId": "user123",
  "projectId": "myproject",
  "fileName": "test_data.csv",
  "filePath": "uploads/abc-123-xyz-789/test_data.csv",
  "tableName": "sales",
  "fileSize": 6732,
  "timestamp": "2025-11-20T15:00:00",
  "status": "processing",
  "message": "Processing upload job"
}
```

**Response - Completed** (200 OK):

```json
{
  "jobId": "abc-123-xyz-789",
  "userId": "user123",
  "projectId": "myproject",
  "fileName": "test_data.csv",
  "filePath": "uploads/abc-123-xyz-789/test_data.csv",
  "tableName": "sales",
  "fileSize": 6732,
  "timestamp": "2025-11-20T15:00:00",
  "status": "completed",
  "message": "Successfully processed 100 rows into table myproject.sales"
}
```

**Response - Failed** (200 OK):

```json
{
  "jobId": "abc-123-xyz-789",
  "userId": "user123",
  "projectId": "myproject",
  "fileName": "test_data.csv",
  "filePath": "uploads/abc-123-xyz-789/test_data.csv",
  "tableName": "sales",
  "fileSize": 6732,
  "timestamp": "2025-11-20T15:00:00",
  "status": "failed",
  "message": "Error: Invalid CSV format at line 42"
}
```

**Error Response** (404 Not Found):

```json
{
  "error": "Job not found",
  "jobId": "invalid-job-id"
}
```

---

## Query Endpoints

### POST /query

Submit an async query job.

**Request**:

```bash
curl -X POST http://localhost:8080/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "source": "myproject.sales",
    "select": [
      {"column": "Region", "as": "region"},
      {"column": "Revenue", "aggregation": "sum", "as": "total_revenue"}
    ],
    "filters": [
      {"column": "Date", "operator": ">=", "value": "2023-01-01"},
      {"column": "Date", "operator": "<=", "value": "2023-12-31"}
    ],
    "groupBy": ["Region"],
    "orderBy": [{"column": "total_revenue", "direction": "desc"}],
    "limit": 10
  }'
```

**Request Body**:

```typescript
{
  source: string,              // Table identifier: "{projectId}.{tableName}" or jobId
  select: [                    // Columns to select
    {
      column: string,          // Column name (required)
      aggregation?: string,    // Optional: sum, avg, count, min, max
      as?: string              // Optional: alias for result column
    }
  ],
  filters?: [                  // Optional: WHERE conditions
    {
      column: string,          // Column to filter
      operator: string,        // =, !=, <, <=, >, >=, LIKE, IN, IS NULL, IS NOT NULL
      value: any               // Value to compare
    }
  ],
  groupBy?: string[],          // Optional: GROUP BY columns
  orderBy?: [                  // Optional: ORDER BY clauses
    {
      column: string,
      direction: "asc" | "desc"  // Default: asc
    }
  ],
  limit?: number,              // Optional: max rows to return
  encoding?: {                 // Optional: visualization hints
    x?: string,
    y?: string,
    color?: string
  }
}
```

**Response** (200 OK):

```json
{
  "jobId": "query-xyz-123",
  "status": "queued",
  "message": "Query job queued for processing",
  "checkStatusAt": "/api/v1/query/query-xyz-123"
}
```

**Error Response** (400 Bad Request):

```json
{
  "error": "Invalid query",
  "message": "Table not found: myproject.nonexistent"
}
```

---

### GET /query/{jobId}

Get query job status and results.

**Request**:

```bash
curl http://localhost:8080/api/v1/query/query-xyz-123
```

**Response - Queued** (200 OK):

```json
{
  "jobId": "query-xyz-123",
  "jobType": "query",
  "source": "myproject.sales",
  "queryJson": "{...full query JSON...}",
  "status": "queued",
  "message": "Query job queued",
  "timestamp": "2025-11-20T15:00:00"
}
```

**Response - Completed** (200 OK):

```json
{
  "jobId": "query-xyz-123",
  "jobType": "query",
  "source": "myproject.sales",
  "queryJson": "{...full query JSON...}",
  "status": "completed",
  "message": "Query completed: 12 rows, result stored at warehouse/wh/myproject/queries/query_20251120_150608/result.parquet",
  "timestamp": "2025-11-20T15:00:08",
  "resultPath": "warehouse/wh/myproject/queries/query_20251120_150608/result.parquet",
  "rowCount": 12,
  "fileSizeBytes": 2193,
  "resultData": [
    { "Region": "North", "total_revenue": 50000 },
    { "Region": "South", "total_revenue": 45000 },
    { "Region": "East", "total_revenue": 38000 }
  ]
}
```

**Note:** The `resultData` field contains query results as JSON array (up to 10,000 rows). For larger result sets, download the full Parquet file from `resultPath`.

````

**Response - Failed** (200 OK):

```json
{
  "jobId": "query-xyz-123",
  "jobType": "query",
  "source": "myproject.sales",
  "queryJson": "{...}",
  "status": "failed",
  "message": "Error: Column 'InvalidColumn' not found in table",
  "timestamp": "2025-11-20T15:00:05"
}
````

---

### GET /schema/{projectId}/{tableName}

Get the schema (columns and types) for an Iceberg table from metadata.

**Purpose**: Helps users understand what columns are available before building queries.

**Request**:

```bash
curl http://localhost:8080/api/v1/schema/myproject/sales
```

**Parameters**:
| Parameter | Type | Required | Description |
|-------------|--------|----------|-----------------------------|
| `projectId` | String | Yes | Project/namespace identifier |
| `tableName` | String | Yes | Table name |

**Response** (202 ACCEPTED):

```json
{
  "jobId": "schema-abc-123",
  "status": "queued",
  "message": "Schema request queued for processing",
  "checkStatusAt": "/api/v1/query/schema-abc-123"
}
```

**Check Status**:

```bash
curl http://localhost:8080/api/v1/query/schema-abc-123
```

**Schema Response** (200 OK - Completed):

```json
{
  "jobId": "schema-abc-123",
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
    { "name": "created_date", "type": "string", "nullable": true }
  ]
}
```

**Error Response** (404 Not Found):

```json
{
  "jobId": "schema-abc-123",
  "status": "failed",
  "message": "Failed to retrieve schema: Table not found: myproject.nonexistent"
}
```

**Use Case**: Call this endpoint before submitting queries to know what columns exist.

---

### GET /query/tables

List all available Iceberg tables.

**Request**:

```bash
curl http://localhost:8080/api/v1/query/tables
```

**Response** (200 OK - Future Implementation):

```json
{
  "tables": [
    {
      "namespace": "myproject",
      "tableName": "sales",
      "location": "s3a://warehouse/wh/myproject/sales",
      "rowCount": 1000000,
      "sizeBytes": 52428800
    }
  ],
  "count": 1
}
```

**Current Response** (200 OK):

```json
{
  "message": "Table listing not yet implemented",
  "suggestion": "Use source format: {projectId}.{tableName}"
}
```

---

## Job Status Endpoints

### POST /jobs/{jobId}/status

Update job status (internal API, typically called by worker).

**Request**:

```bash
curl -X POST http://localhost:8080/api/v1/jobs/abc-123-xyz/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "processing",
    "message": "Processing 50% complete"
  }'
```

**Request Body**:

```json
{
  "status": "queued" | "processing" | "completed" | "failed",
  "message": "Status description"
}
```

**Response** (200 OK):

```json
{
  "jobId": "abc-123-xyz",
  "status": "processing"
}
```

---

## Monitoring Endpoints

### GET /queue/stats

View RabbitMQ queue statistics.

**Request**:

```bash
curl http://localhost:8080/api/v1/queue/stats
```

**Response** (200 OK):

```json
{
  "queueName": "file.processing.queue",
  "messageCount": 5,
  "consumerCount": 2,
  "status": "available"
}
```

**Response Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `queueName` | String | RabbitMQ queue name |
| `messageCount` | Integer | Number of pending messages |
| `consumerCount` | Integer | Number of active consumers (workers) |
| `status` | String | Queue health status |

---

## Query Language

### Source Identifiers

The `source` field can be:

1. **Explicit table name**: `"{projectId}.{tableName}"`
   ```json
   { "source": "myproject.sales" }
   ```
2. **Job ID**: `"{jobId}"`
   ```json
   { "source": "abc-123-xyz-789" }
   ```
   API looks up the job in Redis and retrieves the table name.

---

### Aggregation Functions

| Function   | Description        | Example                                          |
| ---------- | ------------------ | ------------------------------------------------ |
| `sum`      | Sum of values      | `{"column": "Revenue", "aggregation": "sum"}`    |
| `avg`      | Average of values  | `{"column": "Price", "aggregation": "avg"}`      |
| `count`    | Count of rows      | `{"column": "*", "aggregation": "count"}`        |
| `min`      | Minimum value      | `{"column": "Date", "aggregation": "min"}`       |
| `max`      | Maximum value      | `{"column": "Date", "aggregation": "max"}`       |
| `stddev`   | Standard deviation | `{"column": "Sales", "aggregation": "stddev"}`   |
| `variance` | Variance           | `{"column": "Sales", "aggregation": "variance"}` |

---

### Filter Operators

| Operator      | Description           | Example                                                         |
| ------------- | --------------------- | --------------------------------------------------------------- |
| `=`           | Equals                | `{"column": "Region", "operator": "=", "value": "US"}`          |
| `!=`          | Not equals            | `{"column": "Status", "operator": "!=", "value": "Cancelled"}`  |
| `<`           | Less than             | `{"column": "Price", "operator": "<", "value": 100}`            |
| `<=`          | Less than or equal    | `{"column": "Quantity", "operator": "<=", "value": 10}`         |
| `>`           | Greater than          | `{"column": "Revenue", "operator": ">", "value": 1000}`         |
| `>=`          | Greater than or equal | `{"column": "Date", "operator": ">=", "value": "2023-01-01"}`   |
| `LIKE`        | Pattern matching      | `{"column": "Name", "operator": "LIKE", "value": "%Smith%"}`    |
| `IN`          | Value in list         | `{"column": "Category", "operator": "IN", "value": ["A", "B"]}` |
| `IS NULL`     | Is null               | `{"column": "DeletedAt", "operator": "IS NULL"}`                |
| `IS NOT NULL` | Is not null           | `{"column": "Email", "operator": "IS NOT NULL"}`                |

---

### Query Examples

#### Example 1: Simple Selection

```json
{
  "source": "myproject.sales",
  "select": [{ "column": "*" }]
}
```

#### Example 2: Aggregation with Grouping

```json
{
  "source": "myproject.sales",
  "select": [
    { "column": "Date", "as": "date" },
    { "column": "Region", "as": "region" },
    { "column": "Revenue", "aggregation": "sum", "as": "total_revenue" }
  ],
  "filters": [
    { "column": "Date", "operator": ">=", "value": "2023-01-01" },
    { "column": "Date", "operator": "<=", "value": "2023-12-31" }
  ],
  "groupBy": ["Date", "Region"],
  "orderBy": [{ "column": "total_revenue", "direction": "desc" }],
  "limit": 100
}
```

#### Example 3: Top N with Multiple Aggregations

```json
{
  "source": "myproject.sales",
  "select": [
    { "column": "Product", "as": "product" },
    { "column": "Revenue", "aggregation": "sum", "as": "revenue" },
    { "column": "Quantity", "aggregation": "sum", "as": "units_sold" },
    { "column": "Profit", "aggregation": "avg", "as": "avg_profit" }
  ],
  "filters": [
    { "column": "Category", "operator": "=", "value": "Electronics" }
  ],
  "groupBy": ["Product"],
  "orderBy": [{ "column": "revenue", "direction": "desc" }],
  "limit": 10
}
```

#### Example 4: Multi-column GROUP BY

```json
{
  "source": "myproject.sales",
  "select": [
    { "column": "Region", "as": "region" },
    { "column": "Product", "as": "product" },
    { "column": "Category", "as": "category" },
    { "column": "Revenue", "aggregation": "sum", "as": "total_revenue" }
  ],
  "groupBy": ["Region", "Product", "Category"],
  "orderBy": [{ "column": "total_revenue", "direction": "desc" }],
  "limit": 50
}
```

---

## Download Query Results

Query results are stored as Parquet files in MinIO.

### Option 1: MinIO Console (Web UI)

1. Open http://localhost:9001
2. Login: `admin` / `password123`
3. Navigate to bucket: `warehouse`
4. Browse to: `wh/{projectId}/queries/{query_timestamp}/`
5. Download: `result.parquet`

### Option 2: Using Python

```python
import pandas as pd
from minio import Minio

# Configure MinIO client
client = Minio(
    "localhost:9000",
    access_key="admin",
    secret_key="password123",
    secure=False
)

# Download result
result_path = "wh/myproject/queries/query_20251120_150608/result.parquet"
client.fget_object("warehouse", result_path, "local_result.parquet")

# Read with pandas
df = pd.read_parquet("local_result.parquet")
print(df)
```

### Option 3: Using MinIO Client (CLI)

```bash
# Configure mc
mc alias set myminio http://localhost:9000 admin password123

# Download result
mc cp myminio/warehouse/wh/myproject/queries/query_20251120_150608/result.parquet .

# Read with Python
python -c "import pandas as pd; print(pd.read_parquet('result.parquet'))"
```

---

## Error Handling

### Common Error Codes

| Status | Error                 | Cause                 | Solution               |
| ------ | --------------------- | --------------------- | ---------------------- |
| 400    | Invalid file format   | Non-CSV file uploaded | Upload CSV files only  |
| 400    | Invalid query         | Malformed query JSON  | Check query structure  |
| 404    | Job not found         | Invalid jobId         | Check jobId is correct |
| 404    | Table not found       | Table doesn't exist   | Upload data first      |
| 500    | Internal server error | System error          | Check logs             |

---

## Rate Limits & Quotas

**Current Limits**:

- Max file size: 100 MB
- Max query result rows: 10,000 (configurable)
- Query timeout: 30 seconds (configurable)
- Job TTL in Redis: 1 hour

**Future Enhancements**:

- User-based rate limiting
- Quota management
- Priority queues

---

## Next Steps

- [Testing Guide →](TESTING.md) - Test all endpoints
- [Architecture →](ARCHITECTURE.md) - Understand the system
- [Developer Guide →](DEVELOPER_GUIDE.md) - Advanced topics
