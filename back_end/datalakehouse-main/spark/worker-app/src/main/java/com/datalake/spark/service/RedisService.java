package com.datalake.spark.service;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.datalake.spark.config.AppConfig;
import com.fasterxml.jackson.databind.ObjectMapper;

import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

/**
 * Service for updating job status directly in Redis.
 * This replaces the HTTP-based status updates which were not working.
 */
public class RedisService {
    private static final Logger log = LoggerFactory.getLogger(RedisService.class);
    private static final String QUERY_JOB_PREFIX = "query:";
    private static final int TTL_SECONDS = 3600; // 1 hour
    
    private final JedisPool jedisPool;
    private final ObjectMapper objectMapper;

    public RedisService(AppConfig config, ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        
        // Initialize Redis connection pool with simple config
        this.jedisPool = new JedisPool(config.getRedisHost(), config.getRedisPort());
        
        log.info("RedisService initialized - Host: {}, Port: {}", config.getRedisHost(), config.getRedisPort());
    }

    /**
     * Update query job status in Redis.
     * 
     * @param jobId Job ID
     * @param status New status (processing, completed, failed)
     * @param message Status message
     * @param resultPath Optional result path (for completed queries)
     * @param rowCount Optional row count (for completed queries)
     * @param fileSizeBytes Optional file size (for completed queries)
     */
    public void updateQueryJobStatus(String jobId, String status, String message, 
                                      String resultPath, Long rowCount, Long fileSizeBytes) {
        try (Jedis jedis = jedisPool.getResource()) {
            String key = QUERY_JOB_PREFIX + jobId;
            
            // Get existing job data
            String existingJson = jedis.get(key);
            
            if (existingJson != null) {
                // Parse existing job
                @SuppressWarnings("unchecked")
                Map<String, Object> jobData = objectMapper.readValue(existingJson, Map.class);
                
                // Update fields
                jobData.put("status", status);
                jobData.put("message", message);
                
                if (resultPath != null) {
                    jobData.put("resultPath", resultPath);
                }
                if (rowCount != null) {
                    jobData.put("rowCount", rowCount);
                }
                if (fileSizeBytes != null) {
                    jobData.put("fileSizeBytes", fileSizeBytes);
                }
                
                // Save back to Redis
                String updatedJson = objectMapper.writeValueAsString(jobData);
                jedis.setex(key, TTL_SECONDS, updatedJson);
                
                log.info("Updated query job status in Redis - JobId: {}, Status: {}", jobId, status);
            } else {
                log.warn("Query job not found in Redis: {}", jobId);
            }
            
        } catch (Exception e) {
            log.error("Failed to update query job status in Redis - JobId: {}", jobId, e);
        }
    }

    /**
     * Mark query job as processing.
     */
    public void markProcessing(String jobId, String message) {
        updateQueryJobStatus(jobId, "processing", message, null, null, null);
    }

    /**
     * Mark query job as completed with result metadata.
     */
    public void markCompleted(String jobId, String message, String resultPath, long rowCount, long fileSizeBytes) {
        updateQueryJobStatus(jobId, "completed", message, resultPath, rowCount, fileSizeBytes);
    }

    /**
     * Mark query job as completed with result metadata AND JSON data.
     * 
     * This is a specialized method for query jobs that returns JSON results directly.
     * Unlike the standard markCompleted() method, this one includes the actual query
     * results as JSON, enabling immediate data access without downloading Parquet files.
     * 
     * The resultJson is stored in Redis and will be returned to clients via the API,
     * making this project suitable for integration with other JSON-based services.
     * 
     * @param jobId The query job identifier
     * @param message Completion message with details
     * @param resultPath MinIO path to the full Parquet result file
     * @param rowCount Total number of rows in the result
     * @param fileSizeBytes Size of the Parquet file in bytes
     * @param resultJson JSON array string containing query results (up to 10K rows)
     */
    public void markCompletedWithData(String jobId, String message, String resultPath, long rowCount, long fileSizeBytes, String resultJson) {
        try (Jedis jedis = jedisPool.getResource()) {
            String key = QUERY_JOB_PREFIX + jobId;
            
            // Get existing job data from Redis
            String existingJson = jedis.get(key);
            
            if (existingJson != null) {
                // Parse existing job data (created when query was submitted)
                @SuppressWarnings("unchecked")
                Map<String, Object> jobData = objectMapper.readValue(existingJson, Map.class);
                
                // Update with completion information
                jobData.put("status", "completed");
                jobData.put("message", message);
                jobData.put("resultPath", resultPath);  // Path to full Parquet file
                jobData.put("rowCount", rowCount);
                jobData.put("fileSizeBytes", fileSizeBytes);
                
                // Store the actual query results as JSON
                // Parse the JSON string into an object structure for proper JSON serialization
                // This allows the API to return it as a proper JSON array, not a string
                jobData.put("resultData", objectMapper.readTree(resultJson));
                
                // Save back to Redis
                String updatedJson = objectMapper.writeValueAsString(jobData);
                jedis.setex(key, TTL_SECONDS, updatedJson);
                
                log.info("Updated query job with result data in Redis - JobId: {}, Rows: {}", jobId, rowCount);
            } else {
                log.warn("Query job not found in Redis: {}", jobId);
            }
            
        } catch (Exception e) {
            log.error("Failed to update query job with data in Redis - JobId: {}", jobId, e);
        }
    }

    /**
     * Mark query job as failed.
     */
    public void markFailed(String jobId, String message) {
        updateQueryJobStatus(jobId, "failed", message, null, null, null);
    }

    /**
     * Close Redis connection pool.
     */
    public void close() {
        if (jedisPool != null && !jedisPool.isClosed()) {
            jedisPool.close();
            log.info("Redis connection pool closed");
        }
    }
}
