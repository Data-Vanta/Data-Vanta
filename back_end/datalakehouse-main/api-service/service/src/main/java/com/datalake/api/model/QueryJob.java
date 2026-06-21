package com.datalake.api.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonFormat;

/**
 * Represents a query job that will be executed by the Spark worker.
 * Similar to UploadJob but for query execution.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QueryJob {
    
    /**
     * Unique job ID
     */
    private String jobId;
    
    /**
     * Job type (should be "query")
     */
    private String jobType;
    
    /**
     * Table identifier (projectId.tableName)
     */
    private String source;
    
    /**
     * The full query specification as JSON string
     */
    private String queryJson;
    
    /**
     * Job status: queued, processing, completed, failed
     */
    private String status;
    
    /**
     * Status message or error details
     */
    private String message;
    
    /**
     * Timestamp when query was submitted
     */
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime timestamp;
    
    /**
     * Result location (MinIO path where Parquet results are stored)
     */
    private String resultPath;
    
    /**
     * Number of rows in result
     */
    private Long rowCount;
    
    /**
     * Size of result file in bytes
     */
    private Long fileSizeBytes;
    
    /**
     * Query result data as JSON array (limited to first 10,000 rows).
     * 
     * This field contains the actual query results in JSON format, allowing
     * immediate access to the data without downloading Parquet files.
     * 
     * Features:
     * - Results are returned directly in the API response
     * - Perfect for small to medium result sets (up to 10,000 rows)
     * - Enables easy integration with frontend/other services that consume JSON
     * 
     * For larger datasets:
     * - This field contains only the first 10,000 rows
     * - Download the full Parquet file from 'resultPath' for complete data
     * 
     * Example value:
     * [{"region": "North", "total_amount": 5000}, {"region": "South", "total_amount": 3000}]
     */
    private Object resultData;
}
