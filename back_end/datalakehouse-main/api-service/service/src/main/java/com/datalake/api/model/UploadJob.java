package com.datalake.api.model;

import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonFormat;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a file upload job that will be processed by the Spark worker.
 * 
 * This model tracks the entire lifecycle of a file upload from submission
 * to processing completion, including metadata about the file and its status.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UploadJob {

    /**
     * Unique job identifier (UUID)
     */
    private String jobId;
    
    /**
     * User who submitted the upload
     */
    private String userId;
    
    /**
     * Project identifier where the data will be stored
     */
    private String projectId;
    
    /**
     * Original filename of the uploaded file
     */
    private String fileName;
    
    /**
     * MinIO path where the file is stored (uploads bucket)
     */
    private String filePath;
    
    /**
     * Target Iceberg table name
     */
    private String tableName;
    
    /**
     * File size in bytes
     */
    private Long fileSize;
    
    /**
     * Timestamp when the job was created
     */
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime timestamp;
    
    /**
     * Job status: queued, processing, completed, failed
     */
    private String status;
    
    /**
     * Status message or error details
     */
    private String message;
}