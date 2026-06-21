package com.datalake.spark.service.processor;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.apache.spark.sql.Column;
import org.apache.spark.sql.Dataset;
import org.apache.spark.sql.Row;
import org.apache.spark.sql.SparkSession;
import org.apache.spark.sql.functions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.datalake.spark.model.JobMessage;
import com.datalake.spark.model.query.FilterCondition;
import com.datalake.spark.model.query.OrderBy;
import com.datalake.spark.model.query.QueryRequest;
import com.datalake.spark.model.query.SelectColumn;
import com.datalake.spark.service.MinioService;
import com.datalake.spark.service.RedisService;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Processes query jobs against Iceberg tables.
 * Leverages Iceberg metadata for optimizations:
 * - Partition pruning via predicate pushdown
 * - Column projection (read only needed columns)
 * - File skipping using min/max statistics
 */
public class QueryJobProcessor {
    private static final Logger log = LoggerFactory.getLogger(QueryJobProcessor.class);
    
    private final SparkSession spark;
    private final MinioService minioService;
    private final RedisService redisService;
    private final ObjectMapper objectMapper;

    public QueryJobProcessor(SparkSession spark, MinioService minioService, RedisService redisService) {
        this.spark = spark;
        this.minioService = minioService;
        this.redisService = redisService;
        this.objectMapper = new ObjectMapper();
    }

    /**
     * Processes a query job end-to-end.
     * 
     * Key optimizations:
     * 1. Column projection - Spark + Iceberg read only selected columns
     * 2. Predicate pushdown - Filters are pushed to Iceberg scan (partition + file pruning)
     * 3. Results stored as Parquet (compressed, columnar)
     * 4. Metadata returned separately (schema, row count, file size)
     */
    public void process(JobMessage job) throws Exception {
        log.info("Processing query job: {}", job.getJobId());
        
        redisService.markProcessing(job.getJobId(), "Started processing query");
        
        Path resultParquetPath = null;
        try {
            // 1. Parse query request
            QueryRequest queryRequest = objectMapper.readValue(
                job.getQueryJson(), 
                QueryRequest.class
            );
            
            log.info("Query request: {}", queryRequest);
            
            // 2. Build and execute query with Iceberg optimizations
            Dataset<Row> resultDf = executeOptimizedQuery(queryRequest);
            
            // 3. Collect result metadata
            long rowCount = resultDf.count();
            String resultSchema = resultDf.schema().json();
            
            log.info("Query returned {} rows", rowCount);
            
            // 4. Store results as Parquet in MinIO (efficient binary format)
            resultParquetPath = storeResultAsParquet(job.getJobId(), resultDf);
            
            // 5. Upload result file to MinIO warehouse
            String minioResultPath = uploadResultToMinio(job.getJobId(), resultParquetPath, queryRequest.getSource());
            
            long fileSizeBytes = Files.size(resultParquetPath);
            
            // 6. Convert result to JSON for immediate API response
            // This is the KEY FEATURE that allows this project to return JSON results
            // directly to clients, making it easy to integrate with other projects
            String resultJson = convertResultToJson(resultDf, rowCount);
            
            // 7. Build result metadata and log it
            String metadata = buildResultMetadata(
                rowCount, 
                fileSizeBytes, 
                minioResultPath, 
                resultSchema
            );
            
            log.info("Query result metadata: {}", metadata);
            
            // 8. Update Redis status with result metadata AND JSON data
            // This stores both:
            // - Metadata (path, row count, file size) for reference
            // - JSON data (up to 10K rows) for immediate consumption
            // The API service will return this JSON data in the response
            String message = String.format("Query completed: %d rows, result stored at %s", rowCount, minioResultPath);
            redisService.markCompletedWithData(job.getJobId(), message, minioResultPath, rowCount, fileSizeBytes, resultJson);
            
            log.info("Query job {} completed successfully", job.getJobId());
            
        } finally {
            // Cleanup temporary files
            if (resultParquetPath != null) {
                cleanupTempDirectory(resultParquetPath.getParent());
            }
        }
    }

    /**
     * Processes a schema request to get table column information.
     * 
     * This reads the Iceberg table metadata to extract:
     * - Column names
     * - Column data types
     * - Nullable information
     * 
     * The schema is returned as JSON to help users build queries.
     */
    public void processSchema(JobMessage job) {
        log.info("Processing schema request for job: {}", job.getJobId());
        
        try {
            // Update status to processing
            redisService.updateQueryJobStatus(job.getJobId(), "processing", "Reading table schema from Iceberg metadata", null, null, null);
            
            // Parse the source (projectId.tableName)
            String source = job.getSource();
            String fullTableName = "local." + source;
            
            log.info("Reading schema for Iceberg table: {}", fullTableName);
            
            // Read table to get schema (Iceberg will use metadata, not data files)
            Dataset<Row> df = spark.read()
                    .format("iceberg")
                    .load(fullTableName);
            
            // Extract schema information
            List<java.util.Map<String, Object>> schemaInfo = new ArrayList<>();
            
            org.apache.spark.sql.types.StructType schema = df.schema();
            for (org.apache.spark.sql.types.StructField field : schema.fields()) {
                java.util.Map<String, Object> columnInfo = new java.util.HashMap<>();
                columnInfo.put("name", field.name());
                columnInfo.put("type", field.dataType().simpleString());
                columnInfo.put("nullable", field.nullable());
                schemaInfo.add(columnInfo);
            }
            
            // Convert schema to JSON
            String schemaJson = objectMapper.writeValueAsString(schemaInfo);
            
            log.info("Extracted schema with {} columns", schemaInfo.size());
            
            // Store schema result in Redis
            String[] parts = source.split("\\.");
            String projectId = parts.length > 1 ? parts[0] : "unknown";
            String tableName = parts.length > 1 ? parts[1] : source;
            
            String message = String.format("Schema retrieved: %d columns from table %s.%s", 
                                          schemaInfo.size(), projectId, tableName);
            
            // Update Redis with schema data (stored as resultData)
            redisService.markCompletedWithData(
                job.getJobId(), 
                message, 
                null,  // No file path for schema requests
                schemaInfo.size(),  // Row count = number of columns
                0,  // No file size
                schemaJson
            );
            
            log.info("Schema request {} completed successfully", job.getJobId());
            
        } catch (Exception e) {
            log.error("Schema request {} failed", job.getJobId(), e);
            redisService.updateQueryJobStatus(
                job.getJobId(), 
                "failed", 
                "Failed to retrieve schema: " + e.getMessage(),
                null,
                null,
                null
            );
            throw new RuntimeException("Schema request failed", e);
        }
    }

    /**
     * Executes query with Iceberg optimizations.
     * 
     * Iceberg automatically provides:
     * - Partition pruning (if table is partitioned)
     * - File skipping using min/max statistics
     * - Schema evolution support
     */
    private Dataset<Row> executeOptimizedQuery(QueryRequest request) {
        // Parse table identifier - format: local.{projectId}.{tableName}
        // Maps to warehouse path: warehouse/wh/{projectId}/{tableName}/
        String fullTableName = String.format("local.%s", request.getSource());
        
        log.info("Reading Iceberg table: {}", fullTableName);
        
        // Read from Iceberg - this leverages metadata for optimization
        Dataset<Row> df = spark.read()
                .format("iceberg")
                .load(fullTableName);
        
        log.info("Table schema: {}", df.schema().treeString());
        log.info("Table initial row count: {}", df.count());
        
        // Apply filters (predicate pushdown to Iceberg)
        if (request.getFilters() != null && !request.getFilters().isEmpty()) {
            df = applyFilters(df, request.getFilters());
            log.info("After filters row count: {}", df.count());
        }
        
        // Apply select with aggregations
        if (request.getSelect() != null && !request.getSelect().isEmpty()) {
            df = applySelect(df, request.getSelect());
        }
        
        // Apply group by
        if (request.getGroupBy() != null && !request.getGroupBy().isEmpty()) {
            // Grouping already handled in applySelect if aggregations present
            log.debug("Group by columns: {}", request.getGroupBy());
        }
        
        // Apply order by
        if (request.getOrderBy() != null && !request.getOrderBy().isEmpty()) {
            df = applyOrderBy(df, request.getOrderBy());
        }
        
        // Apply pagination
        if (request.getOffset() != null && request.getOffset() > 0) {
            df = df.offset(request.getOffset());
        }
        
        if (request.getLimit() != null && request.getLimit() > 0) {
            df = df.limit(request.getLimit());
        }
        
        return df;
    }

    /**
     * Applies filter conditions with predicate pushdown.
     * Iceberg will use these predicates to skip partitions and files.
     */
    private Dataset<Row> applyFilters(Dataset<Row> df, List<FilterCondition> filters) {
        for (FilterCondition filter : filters) {
            String column = filter.getColumn();
            String operator = filter.getOperator();
            Object value = filter.getValue();
            
            log.debug("Applying filter: {} {} {}", column, operator, value);
            
            Column condition = null;
            
            switch (operator.toLowerCase()) {
                case "=":
                case "==":
                    condition = functions.col(column).equalTo(functions.lit(value));
                    break;
                case "!=":
                case "<>":
                    condition = functions.col(column).notEqual(functions.lit(value));
                    break;
                case ">":
                    condition = functions.col(column).gt(functions.lit(value));
                    break;
                case "<":
                    condition = functions.col(column).lt(functions.lit(value));
                    break;
                case ">=":
                    condition = functions.col(column).geq(functions.lit(value));
                    break;
                case "<=":
                    condition = functions.col(column).leq(functions.lit(value));
                    break;
                case "like":
                    condition = functions.col(column).like(value.toString());
                    break;
                case "in":
                    if (value instanceof List) {
                        Object[] values = ((List<?>) value).toArray();
                        condition = functions.col(column).isin(values);
                    }
                    break;
                case "between":
                    if (filter.getValue2() != null) {
                        condition = functions.col(column).between(
                            functions.lit(value), 
                            functions.lit(filter.getValue2())
                        );
                    }
                    break;
                default:
                    log.warn("Unsupported operator: {}", operator);
            }
            
            if (condition != null) {
                df = df.filter(condition);
            }
        }
        
        return df;
    }

    /**
     * Applies column selection with optional aggregations.
     * Column projection is automatically pushed down to Iceberg.
     */
    private Dataset<Row> applySelect(Dataset<Row> df, List<SelectColumn> selectColumns) {
        List<Column> allColumns = new ArrayList<>();
        List<Column> aggregatedColumns = new ArrayList<>();
        boolean hasAggregation = false;
        List<Column> groupByColumns = new ArrayList<>();
        
        for (SelectColumn sel : selectColumns) {
            String columnName = sel.getColumn();
            String aggregation = sel.getAggregation();
            String alias = sel.getAs();
            
            Column col;
            
            if (aggregation != null && !aggregation.isBlank()) {
                hasAggregation = true;
                
                // Apply aggregation function
                switch (aggregation.toLowerCase()) {
                    case "sum":
                        col = functions.sum(columnName);
                        break;
                    case "avg":
                    case "average":
                        col = functions.avg(columnName);
                        break;
                    case "count":
                        col = functions.count(columnName);
                        break;
                    case "min":
                        col = functions.min(columnName);
                        break;
                    case "max":
                        col = functions.max(columnName);
                        break;
                    case "first":
                        col = functions.first(columnName);
                        break;
                    case "last":
                        col = functions.last(columnName);
                        break;
                    default:
                        log.warn("Unsupported aggregation: {}", aggregation);
                        col = functions.col(columnName);
                }
                
                // Apply alias if provided for aggregated columns
                if (alias != null && !alias.isBlank()) {
                    col = col.alias(alias);
                }
                
                aggregatedColumns.add(col);
            } else {
                // Non-aggregated column - will be used for GROUP BY
                col = functions.col(columnName);
                
                // Apply alias if provided for group by columns
                if (alias != null && !alias.isBlank()) {
                    col = col.alias(alias);
                }
                
                groupByColumns.add(col);
            }
            
            allColumns.add(col);
        }
        
        // If we have aggregations, group by non-aggregated columns
        if (hasAggregation && !groupByColumns.isEmpty()) {
            // Group by the non-aggregated columns
            df = df.groupBy(groupByColumns.toArray(Column[]::new))
                   .agg(aggregatedColumns.get(0), 
                        aggregatedColumns.subList(1, aggregatedColumns.size()).toArray(Column[]::new));
        } else {
            df = df.select(allColumns.toArray(Column[]::new));
        }
        
        return df;
    }

    /**
     * Applies ORDER BY clause.
     */
    private Dataset<Row> applyOrderBy(Dataset<Row> df, List<OrderBy> orderByList) {
        Column[] orderColumns = new Column[orderByList.size()];
        
        for (int i = 0; i < orderByList.size(); i++) {
            OrderBy orderBy = orderByList.get(i);
            Column col = functions.col(orderBy.getColumn());
            
            if ("desc".equalsIgnoreCase(orderBy.getDirection())) {
                col = col.desc();
            } else {
                col = col.asc();
            }
            
            orderColumns[i] = col;
        }
        
        return df.orderBy(orderColumns);
    }

    /**
     * Stores query result as Parquet file (compressed, columnar format).
     * Much more efficient than JSON for bandwidth and storage.
     */
    private Path storeResultAsParquet(String jobId, Dataset<Row> df) throws Exception {
        Path tempDir = Files.createTempDirectory("query-result-" + jobId);
        String outputPath = tempDir.resolve("result.parquet").toString();
        
        log.info("Writing result to Parquet: {}", outputPath);
        
        // Write as Parquet with Snappy compression (good balance of speed and size)
        df.write()
            .mode("overwrite")
            .option("compression", "snappy")
            .parquet(outputPath);
        
        // Spark writes Parquet as a directory, find the actual file
        File parquetDir = new File(outputPath);
        File[] parquetFiles = parquetDir.listFiles((dir, name) -> name.endsWith(".parquet"));
        
        if (parquetFiles == null || parquetFiles.length == 0) {
            throw new Exception("No Parquet file generated");
        }
        
        return parquetFiles[0].toPath();
    }

    /**
     * Uploads result Parquet file to MinIO warehouse.
     * Path format: warehouse/wh/{projectId}/queries/query_{timestamp}/result.parquet
     */
    private String uploadResultToMinio(String jobId, Path localFile, String source) throws Exception {
        // Extract projectId from source (format: "projectId.tableName")
        String projectId = source.contains(".") ? source.split("\\.")[0] : "default";
        
        // Create timestamp-based query folder name
        String timestamp = java.time.LocalDateTime.now()
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"));
        
        String resultPath = String.format("warehouse/wh/%s/queries/query_%s/result.parquet", 
                                         projectId, timestamp);
        
        log.info("Uploading result to MinIO warehouse: {}", resultPath);
        
        minioService.uploadFile(localFile.toFile(), resultPath);
        
        return resultPath;
    }

    /**
     * Converts query result DataFrame to JSON string for immediate API response.
     * 
     * This method enables the project to return query results as JSON directly,
     * allowing easy integration with other services/projects that consume JSON.
     * 
     * Limitations:
     * - Returns up to 10,000 rows as JSON (to prevent memory/network issues)
     * - For larger datasets, clients should download the full Parquet file from resultPath
     * 
     * @param df The query result DataFrame from Spark
     * @param rowCount Total number of rows in the result
     * @return JSON array string containing the query results
     * @throws Exception if JSON conversion fails
     */
    private String convertResultToJson(Dataset<Row> df, long rowCount) throws Exception {
        // Limit JSON result to reasonable size (max 10000 rows)
        // This prevents:
        // 1. Excessive memory usage in Redis
        // 2. Large network payloads
        // 3. Slow API responses
        int maxJsonRows = 10000;
        if (rowCount > maxJsonRows) {
            log.warn("Result has {} rows, limiting JSON response to {} rows. Full data available in Parquet.", 
                     rowCount, maxJsonRows);
            df = df.limit(maxJsonRows);
        }
        
        // Convert DataFrame rows to JSON strings
        // Each row becomes a JSON object: {"column1": value1, "column2": value2, ...}
        List<String> jsonRows = df.toJSON().collectAsList();
        
        // Combine into a single JSON array string: [{...}, {...}, ...]
        // This format is standard and easy to parse by any JSON library
        return "[" + String.join(",", jsonRows) + "]";
    }

    /**
     * Builds result metadata as JSON string.
     */
    private String buildResultMetadata(long rowCount, long fileSizeBytes, String resultPath, String schema) throws Exception {
        var metadata = new java.util.HashMap<String, Object>();
        metadata.put("rowCount", rowCount);
        metadata.put("fileSizeBytes", fileSizeBytes);
        metadata.put("resultPath", resultPath);
        metadata.put("format", "parquet");
        metadata.put("schema", objectMapper.readTree(schema));
        
        return objectMapper.writeValueAsString(metadata);
    }

    /**
     * Cleans up temporary directory.
     */
    private void cleanupTempDirectory(Path directory) {
        try {
            if (directory != null && Files.exists(directory)) {
                Files.walk(directory)
                    .sorted(java.util.Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (Exception e) {
                            log.warn("Failed to delete temp file: {}", path, e);
                        }
                    });
            }
        } catch (Exception e) {
            log.warn("Failed to cleanup temp directory: {}", directory, e);
        }
    }

    /**
     * Handles query job failures.
     */
    public void handleFailure(JobMessage job, Exception exception) {
        log.error("Query job {} failed: {}", job.getJobId(), exception.getMessage(), exception);
        
        String errorMessage = extractErrorMessage(exception);
        redisService.markFailed(job.getJobId(), "Query failed: " + errorMessage);
    }

    /**
     * Extracts a clean error message from an exception.
     */
    private String extractErrorMessage(Exception exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            message = exception.getClass().getSimpleName();
        }
        
        Throwable cause = exception.getCause();
        if (cause != null && cause.getMessage() != null && !cause.getMessage().equals(message)) {
            message = message + " - Cause: " + cause.getMessage();
        }
        
        return message;
    }
}
