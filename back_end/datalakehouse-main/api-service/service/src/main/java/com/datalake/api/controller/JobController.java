package com.datalake.api.controller;

import java.util.Map;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.datalake.api.model.UploadJob;
import com.datalake.api.service.JobStatusService;
import com.datalake.api.service.RabbitMQService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * JobController handles endpoints related to job tracking and queue monitoring.
 * 
 * Responsibilities:
 *  - Retrieve the current status of a specific upload job.
 *  - Fetch RabbitMQ queue statistics (message and consumer counts).
 */
@RestController
@RequestMapping("/api/v1")
@Slf4j
@RequiredArgsConstructor
public class JobController {

    // Service that stores and retrieves job status information
    private final JobStatusService jobStatusService;

    // Service that interacts with RabbitMQ to get queue statistics
    private final RabbitMQService rabbitMQService;

    /**
     * GET /api/v1/jobs/{jobId}
     * 
     * Retrieves the current status of a specific job by its ID.
     * 
     * @param jobId the unique identifier of the upload job
     * @return 200 OK with job details if found, or 404 if not found
     */
    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<?> getJobStatus(@PathVariable String jobId) {
        UploadJob job = jobStatusService.getJobStatus(jobId);
        if (job == null) {
            // If job is not found, return 404 response with an error message
            return ResponseEntity.status(404).body(Map.of("error", "job not found"));
        }
        // If found, return job details (status, filename, timestamp, etc.)
        return ResponseEntity.ok(job);
    }

    /**
     * GET /api/v1/queue/stats
     * 
     * Returns basic statistics about the RabbitMQ queue such as:
     * - queue name
     * - number of pending messages
     * - number of connected consumers
     * 
     * @return 200 OK with queue statistics in JSON format
     */
    @GetMapping("/queue/stats")
    public ResponseEntity<?> getQueueStats() {
        Map<String, Object> stats = rabbitMQService.getQueueStats();
        return ResponseEntity.ok(stats);
    }

    /**
     * POST /api/v1/jobs/{jobId}/status
     * 
     * HTTP endpoint for updating job status in Redis.
     * 
     * NOTE: Current workers (Spark) update Redis directly using Jedis for better performance.
     * This endpoint is provided for:
     * - External systems that can't access Redis directly (Python/Node.js workers, monitoring tools)
     * - Manual admin operations (debugging, fixing stuck jobs)
     * - Future integrations with non-Java workers
     * - Testing and development purposes
     * 
     * Request Body: {"status":"processing|completed|failed", "message":"optional"}
     * 
     * @param jobId the unique identifier of the job to update
     * @param body contains status and optional message
     * @return 200 OK with updated status (idempotent - returns 200 even if job doesn't exist)
     */
    @PostMapping("/jobs/{jobId}/status")
    public ResponseEntity<?> updateJobStatus(@PathVariable String jobId, @RequestBody UpdateStatusRequest body) {
        if (body == null || body.status == null || body.status.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "status is required"));
        }

        // Accept limited set of statuses
        Set<String> allowed = Set.of("processing", "completed", "failed");
        String normalized = body.status.toLowerCase();
        if (!allowed.contains(normalized)) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "invalid status", "allowed", allowed));
        }

        // Update in Redis (no-op if job doesn't exist; we keep 200 for idempotency)
        jobStatusService.updateJobStatus(jobId, normalized, body.message != null ? body.message : "");
        return ResponseEntity.ok(Map.of(
                "jobId", jobId,
                "status", normalized
        ));
    }

    // Simple DTO for status update body
    public static class UpdateStatusRequest {
        public String status;
        public String message;
    }
}
