package com.datalake.spark.service.processor;

import java.nio.file.Path;

import org.apache.spark.sql.Dataset;
import org.apache.spark.sql.Row;
import org.apache.spark.sql.SparkSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.datalake.spark.model.JobMessage;
import com.datalake.spark.service.MinioService;
import com.datalake.spark.service.SparkService;
import com.datalake.spark.service.StatusService;

/**
 * Processes file upload jobs.
 * Handles downloading files from MinIO, reading them, and writing to Iceberg tables.
 */
public class UploadJobProcessor {
    private static final Logger log = LoggerFactory.getLogger(UploadJobProcessor.class);
    
    private final SparkSession spark;
    private final MinioService minioService;
    private final StatusService statusService;

    public UploadJobProcessor(SparkSession spark, MinioService minioService, StatusService statusService) {
        this.spark = spark;
        this.minioService = minioService;
        this.statusService = statusService;
    }

    /**
     * Processes an upload job end-to-end.
     */
    public void process(JobMessage job) throws Exception {
        log.info("Processing upload job: {}", job.getJobId());
        
        // Update status: processing
        statusService.sendProcessing(job.getJobId(), "Started processing upload");
        
        Path downloadedFile = null;
        try {
            // 1. Download file from MinIO
            log.info("Downloading file: {}", job.getFilePath());
            downloadedFile = minioService.downloadObject(job.getFilePath(), job.getFileName());

            // 2. Read file into DataFrame
            log.info("Reading file into Spark DataFrame");
            Dataset<Row> df = SparkService.readFile(spark, downloadedFile);
            
            log.info("DataFrame schema: {}", df.schema().treeString());
            log.info("DataFrame row count: {}", df.count());

            // 3. Write to Iceberg table
            String tableName = job.getTableName() != null ? job.getTableName() : "default_table";
            log.info("Writing data to Iceberg table: {}.{}", job.getProjectId(), tableName);
            
            long rowCount = SparkService.writeToIceberg(
                spark, 
                df, 
                job.getProjectId(), 
                tableName
            );
            
            // 4. Update status: completed
            String successMessage = String.format(
                "Successfully processed %d rows into table %s.%s",
                rowCount,
                job.getProjectId(),
                tableName
            );
            statusService.sendCompleted(job.getJobId(), successMessage);
            
            log.info("Upload job {} completed successfully", job.getJobId());

        } finally {
            // Cleanup temporary files
            if (downloadedFile != null) {
                minioService.cleanupTempFile(downloadedFile);
            }
        }
    }

    /**
     * Handles upload job failures.
     */
    public void handleFailure(JobMessage job, Exception exception) {
        log.error("Upload job {} failed: {}", job.getJobId(), exception.getMessage(), exception);
        
        String errorMessage = extractErrorMessage(exception);
        statusService.sendFailed(job.getJobId(), "Upload failed: " + errorMessage);
    }

    /**
     * Extracts a clean error message from an exception.
     */
    private String extractErrorMessage(Exception exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            message = exception.getClass().getSimpleName();
        }
        
        // Include cause if available and different
        Throwable cause = exception.getCause();
        if (cause != null && cause.getMessage() != null && !cause.getMessage().equals(message)) {
            message = message + " - Cause: " + cause.getMessage();
        }
        
        return message;
    }
}
