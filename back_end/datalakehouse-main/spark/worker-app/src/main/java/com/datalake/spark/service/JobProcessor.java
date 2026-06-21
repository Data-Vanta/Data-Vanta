package com.datalake.spark.service;

import org.apache.spark.sql.SparkSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.datalake.spark.model.JobMessage;
import com.datalake.spark.service.processor.UploadJobProcessor;
import com.datalake.spark.service.processor.QueryJobProcessor;

/**
 * Routes job messages to the appropriate processor based on job type.
 * Supports two job types:
 * - "upload": File upload and Iceberg table creation
 * - "query": Query execution against Iceberg tables
 */
public class JobProcessor {
    private static final Logger log = LoggerFactory.getLogger(JobProcessor.class);
    
    private final UploadJobProcessor uploadProcessor;
    private final QueryJobProcessor queryProcessor;

    public JobProcessor(SparkSession spark, MinioService minioService, StatusService statusService, RedisService redisService) {
        this.uploadProcessor = new UploadJobProcessor(spark, minioService, statusService);
        this.queryProcessor = new QueryJobProcessor(spark, minioService, redisService);
        
        log.info("JobProcessor initialized with upload and query processors");
    }

    /**
     * Routes a job to the appropriate processor based on jobType.
     *
     * @param job The job message to process
     */
    public void processJob(JobMessage job) throws Exception {
        String jobType = job.getJobType();
        
        if (jobType == null || jobType.isBlank()) {
            // Default to upload for backward compatibility
            jobType = "upload";
            log.warn("Job {} has no jobType specified, defaulting to 'upload'", job.getJobId());
        }
        
        log.info("Routing job {} with type '{}'", job.getJobId(), jobType);
        
        switch (jobType.toLowerCase()) {
            case "upload":
                uploadProcessor.process(job);
                break;
                
            case "query":
                queryProcessor.process(job);
                break;
                
            case "schema":
                // Schema requests are handled by query processor
                // It reads Iceberg table metadata instead of executing a query
                queryProcessor.processSchema(job);
                break;
                
            default:
                throw new IllegalArgumentException("Unknown job type: " + jobType);
        }
    }

    /**
     * Routes failure handling to the appropriate processor.
     *
     * @param job The job that failed
     * @param exception The exception that occurred
     */
    public void handleFailure(JobMessage job, Exception exception) {
        String jobType = job.getJobType();
        
        if (jobType == null || jobType.isBlank()) {
            jobType = "upload";
        }
        
        log.error("Handling failure for job {} of type '{}'", job.getJobId(), jobType);
        
        switch (jobType.toLowerCase()) {
            case "upload":
                uploadProcessor.handleFailure(job, exception);
                break;
                
            case "query":
                queryProcessor.handleFailure(job, exception);
                break;
                
            default:
                log.error("Unknown job type '{}' for failed job {}", jobType, job.getJobId());
        }
    }
}