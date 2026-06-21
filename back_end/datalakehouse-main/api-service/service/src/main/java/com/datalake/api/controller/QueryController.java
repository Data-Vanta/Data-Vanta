package com.datalake.api.controller;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.datalake.api.model.QueryJob;
import com.datalake.api.model.query.QueryRequest;
import com.datalake.api.service.JobStatusService;
import com.datalake.api.service.RabbitMQService;
import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Controller for executing queries against Iceberg tables.
 * 
 * Query jobs are queued to RabbitMQ and processed asynchronously by Spark worker.
 * Results are stored as Parquet files in MinIO for efficient download.
 */
@RestController
@RequestMapping("/api/v1")
@Slf4j
@RequiredArgsConstructor
public class QueryController {

    private final RabbitMQService rabbitMQService;
    private final JobStatusService jobStatusService;
    private final ObjectMapper objectMapper;

    /**
     * POST /api/v1/query
     * 
     * Submit a query job for async execution.
     * Returns a jobId that can be used to check status and download results.
     * 
     * Request body example:
     * {
     *   "source": "testproj.sales_data",
     *   "select": [
     *     {"column": "Date", "as": "x"},
     *     {"column": "Sales", "aggregation": "sum", "as": "y"}
     *   ],
     *   "filters": [
     *     {"column": "Date", "operator": ">=", "value": "2023-01-01"}
     *   ],
     *   "groupBy": ["Date"],
     *   "orderBy": [{"column": "Date", "direction": "asc"}],
     *   "limit": 1000
     * }
     * 
     * Response:
     * {
     *   "jobId": "abc-123",
     *   "status": "queued",
     *   "message": "Query job queued for processing"
     * }
     */
    @PostMapping("/query")
    public ResponseEntity<?> submitQuery(@Valid @RequestBody QueryRequest request) {
        try {
            log.info("Received query request for source: {}", request.getSource());
            
            // Validate source format
            if (request.getSource() == null || request.getSource().isBlank()) {
                return ResponseEntity.badRequest().body(
                    Map.of("error", "source is required (format: projectId.tableName)")
                );
            }
            
            // Generate job ID
            String jobId = UUID.randomUUID().toString();
            
            // Convert query to JSON string
            String queryJson = objectMapper.writeValueAsString(request);
            
            // Create query job
            QueryJob job = QueryJob.builder()
                    .jobId(jobId)
                    .jobType("query")
                    .source(request.getSource())
                    .queryJson(queryJson)
                    .timestamp(LocalDateTime.now())
                    .status("queued")
                    .message("Query job queued for processing")
                    .build();
            
            // Save to Redis
            jobStatusService.saveQueryJob(job);
            
            // Send to RabbitMQ
            rabbitMQService.sendQueryJob(job);
            
            log.info("Query job {} queued successfully", jobId);
            
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobId", jobId,
                "status", "queued",
                "message", "Query job queued for processing",
                "checkStatusAt", "/api/v1/query/" + jobId
            ));
            
        } catch (Exception e) {
            log.error("Failed to queue query job", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to queue query", "details", e.getMessage()));
        }
    }

    /**
     * GET /api/v1/query/{jobId}
     * 
     * Get the status and result location of a query job.
     * 
     * Response (processing):
     * {
     *   "jobId": "abc-123",
     *   "status": "processing",
     *   "message": "Query executing..."
     * }
     * 
     * Response (completed):
     * {
     *   "jobId": "abc-123",
     *   "status": "completed",
     *   "resultPath": "query-results/abc-123/result.parquet",
     *   "rowCount": 5000,
     *   "fileSizeBytes": 124567,
     *   "downloadUrl": "/api/v1/query/abc-123/download"
     * }
     */
    @GetMapping("/query/{jobId}")
    public ResponseEntity<?> getQueryStatus(@PathVariable String jobId) {
        QueryJob job = jobStatusService.getQueryJob(jobId);
        
        if (job == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "query job not found"));
        }
        
        return ResponseEntity.ok(job);
    }

    /**
     * GET /api/v1/query/tables
     * 
     * List available tables (future enhancement).
     */
    @GetMapping("/query/tables")
    public ResponseEntity<?> listTables() {
        log.info("List tables endpoint called");
        return ResponseEntity.ok(Map.of(
            "message", "Table listing not yet implemented",
            "suggestion", "Use source format: {projectId}.{tableName}"
        ));
    }

    /**
     * GET /api/v1/schema/{projectId}/{tableName}
     * 
     * Get the schema (columns and types) for an Iceberg table.
     * This helps users understand what columns are available before building queries.
     * 
     * Response example:
     * {
     *   "projectId": "myproject",
     *   "tableName": "sales",
     *   "schema": [
     *     {"name": "ProductID", "type": "string", "nullable": true},
     *     {"name": "Region", "type": "string", "nullable": true},
     *     {"name": "Revenue", "type": "double", "nullable": true}
     *   ]
     * }
     */
    @GetMapping("/schema/{projectId}/{tableName}")
    public ResponseEntity<?> getTableSchema(
            @PathVariable String projectId,
            @PathVariable String tableName) {
        
        try {
            log.info("Schema request for table: {}.{}", projectId, tableName);
            
            // Create a schema request job
            String jobId = UUID.randomUUID().toString();
            
            QueryJob schemaJob = QueryJob.builder()
                    .jobId(jobId)
                    .jobType("schema")
                    .source(projectId + "." + tableName)
                    .queryJson("{\"type\":\"schema\",\"projectId\":\"" + projectId + "\",\"tableName\":\"" + tableName + "\"}")
                    .timestamp(LocalDateTime.now())
                    .status("queued")
                    .message("Schema request queued")
                    .build();
            
            // Save to Redis
            jobStatusService.saveQueryJob(schemaJob);
            
            // Send to RabbitMQ for processing by Spark worker
            rabbitMQService.sendQueryJob(schemaJob);
            
            log.info("Schema job {} queued for {}.{}", jobId, projectId, tableName);
            
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobId", jobId,
                "status", "queued",
                "message", "Schema request queued for processing",
                "checkStatusAt", "/api/v1/query/" + jobId
            ));
            
        } catch (Exception e) {
            log.error("Failed to queue schema request", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to get schema", "details", e.getMessage()));
        }
    }
}