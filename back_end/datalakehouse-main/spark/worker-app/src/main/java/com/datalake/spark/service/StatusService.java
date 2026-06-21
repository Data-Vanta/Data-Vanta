package com.datalake.spark.service;

import com.datalake.spark.config.AppConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/**
 * Service for sending job status updates to the API.
 */
public class StatusService {
    private static final Logger log = LoggerFactory.getLogger(StatusService.class);
    private static final int TIMEOUT_SECONDS = 5;
    
    private final String apiBaseUrl;
    private final ObjectMapper mapper;
    private final HttpClient httpClient;

    public StatusService(AppConfig config, ObjectMapper mapper) {
        this.apiBaseUrl = config.getApiBaseUrl();
        this.mapper = mapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(TIMEOUT_SECONDS))
                .build();
    }

    /**
     * Sends a status update for a job.
     *
     * @param jobId Job identifier
     * @param status Status value (e.g., "processing", "completed", "failed")
     * @param message Optional message providing details
     */
    public void sendStatus(String jobId, String status, String message) {
        if (jobId == null || jobId.isBlank()) {
            log.warn("Cannot send status update: jobId is null or blank");
            return;
        }

        try {
            Map<String, Object> body = new HashMap<>();
            body.put("status", status);
            if (message != null && !message.isBlank()) {
                body.put("message", truncateMessage(message));
            }

            String jsonBody = mapper.writeValueAsString(body);
            String url = String.format("%s/api/v1/jobs/%s/status", apiBaseUrl, jobId);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() >= 300) {
                log.error("Status update failed for job {} with HTTP {}: {}", 
                    jobId, response.statusCode(), response.body());
            } else {
                log.debug("Status update sent successfully for job {}: {}", jobId, status);
            }
        } catch (Exception e) {
            log.error("Failed to send status update for job {}: {}", jobId, e.getMessage(), e);
        }
    }

    /**
     * Sends a "processing" status update.
     */
    public void sendProcessing(String jobId, String message) {
        sendStatus(jobId, "processing", message);
    }

    /**
     * Sends a "completed" status update.
     */
    public void sendCompleted(String jobId, String message) {
        sendStatus(jobId, "completed", message);
    }

    /**
     * Sends a "failed" status update.
     */
    public void sendFailed(String jobId, String message) {
        sendStatus(jobId, "failed", message);
    }

    /**
     * Truncates overly long messages to avoid huge payloads.
     */
    private String truncateMessage(String message) {
        final int MAX_LENGTH = 500;
        if (message.length() > MAX_LENGTH) {
            return message.substring(0, MAX_LENGTH) + "...";
        }
        return message;
    }
}