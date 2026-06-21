package com.datalake.api.service;

import com.datalake.api.model.UploadJob;
import com.datalake.api.model.QueryJob;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/**
 * Service for managing job status in Redis.
 * 
 * Note: StringRedisTemplate is auto-configured by Spring Boot.
 * No explicit RedisConfig needed - Spring Boot automatically:
 * 1. Detects spring-boot-starter-data-redis dependency
 * 2. Reads connection settings from application.yml (spring.data.redis.*)
 * 3. Creates LettuceConnectionFactory and StringRedisTemplate beans
 * 4. Injects StringRedisTemplate here via @RequiredArgsConstructor
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class JobStatusService {

    // Auto-injected by Spring Boot's Redis auto-configuration
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final String JOB_PREFIX = "job:";
    private static final String QUERY_JOB_PREFIX = "query:";
    private static final long JOB_TTL_HOURS = 1;

    /**
     * Save job status to Redis
     * Key format: job:{jobId}
     * TTL: 1 hour
     */
    public void saveJobStatus(UploadJob job) {
        try {
            String key = JOB_PREFIX + job.getJobId();
            String value = objectMapper.writeValueAsString(job);
            
            log.info("Saving job status to Redis - Key: {}, Status: {}", key, job.getStatus());
            
            // Save with TTL (Time To Live)
            redisTemplate.opsForValue().set(key, value, JOB_TTL_HOURS, TimeUnit.HOURS);
            
            log.debug("Job status saved successfully: {}", job.getJobId());
            
        } catch (Exception e) {
            log.error("Failed to save job status to Redis - JobId: {}", job.getJobId(), e);
            // Don't throw exception - job can still proceed even if Redis fails
        }
    }

    /**
     * Get job status from Redis
     */
    public UploadJob getJobStatus(String jobId) {
        try {
            String key = JOB_PREFIX + jobId;
            
            log.debug("Retrieving job status from Redis - Key: {}", key);
            
            String value = redisTemplate.opsForValue().get(key);
            
            if (value == null) {
                log.warn("Job not found in Redis: {}", jobId);
                return null;
            }
            
            UploadJob job = objectMapper.readValue(value, UploadJob.class);
            
            log.info("Job status retrieved - JobId: {}, Status: {}", jobId, job.getStatus());
            
            return job;
            
        } catch (Exception e) {
            log.error("Failed to get job status from Redis - JobId: {}", jobId, e);
            return null;
        }
    }

    /**
     * Update job status (typically called by worker)
     */
    public void updateJobStatus(String jobId, String status, String message) {
        try {
            log.info("Updating job status - JobId: {}, Status: {}, Message: {}", 
                     jobId, status, message);
            
            // Try to get as upload job first
            UploadJob uploadJob = getJobStatus(jobId);
            
            if (uploadJob != null) {
                // Update upload job
                uploadJob.setStatus(status);
                uploadJob.setMessage(message);
                saveJobStatus(uploadJob);
                log.info("Upload job status updated successfully: {}", jobId);
                return;
            }
            
            // Try to get as query job
            QueryJob queryJob = getQueryJob(jobId);
            
            if (queryJob != null) {
                // Update query job
                updateQueryJobStatus(jobId, status, message);
                log.info("Query job status updated successfully: {}", jobId);
                return;
            }
            
            log.warn("Cannot update job status - job not found: {}", jobId);
            
        } catch (Exception e) {
            log.error("Failed to update job status - JobId: {}", jobId, e);
        }
    }

    // ==================== Query Job Methods ====================

    /**
     * Save query job status to Redis
     */
    public void saveQueryJob(QueryJob job) {
        try {
            String key = QUERY_JOB_PREFIX + job.getJobId();
            String value = objectMapper.writeValueAsString(job);
            
            log.info("Saving query job to Redis - Key: {}, Status: {}", key, job.getStatus());
            
            redisTemplate.opsForValue().set(key, value, JOB_TTL_HOURS, TimeUnit.HOURS);
            
            log.debug("Query job saved successfully: {}", job.getJobId());
            
        } catch (Exception e) {
            log.error("Failed to save query job to Redis - JobId: {}", job.getJobId(), e);
        }
    }

    /**
     * Get query job from Redis
     */
    public QueryJob getQueryJob(String jobId) {
        try {
            String key = QUERY_JOB_PREFIX + jobId;
            
            log.debug("Retrieving query job from Redis - Key: {}", key);
            
            String value = redisTemplate.opsForValue().get(key);
            
            if (value == null) {
                log.warn("Query job not found in Redis: {}", jobId);
                return null;
            }
            
            QueryJob job = objectMapper.readValue(value, QueryJob.class);
            
            log.info("Query job retrieved - JobId: {}, Status: {}", jobId, job.getStatus());
            
            return job;
            
        } catch (Exception e) {
            log.error("Failed to get query job from Redis - JobId: {}", jobId, e);
            return null;
        }
    }

    /**
     * Update query job status
     */
    public void updateQueryJobStatus(String jobId, String status, String message) {
        try {
            String key = QUERY_JOB_PREFIX + jobId;
            
            log.info("Updating query job status - JobId: {}, Status: {}, Message: {}", 
                     jobId, status, message);
            
            QueryJob job = getQueryJob(jobId);
            
            if (job != null) {
                job.setStatus(status);
                job.setMessage(message);
                saveQueryJob(job);
                
                log.info("Query job status updated successfully: {}", jobId);
            } else {
                log.warn("Cannot update query job status - job not found: {}", jobId);
            }
            
        } catch (Exception e) {
            log.error("Failed to update query job status - JobId: {}", jobId, e);
        }
    }
}