package com.datalake.api.integration;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.awaitility.Awaitility.await;
import org.junit.jupiter.api.AfterAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;

import io.restassured.RestAssured;
import io.restassured.response.Response;

/**
 * Simple integration test that validates the basic upload pipeline.
 * 
 * PURPOSE:
 * Tests the complete workflow of uploading a CSV file and tracking its processing
 * through the asynchronous job system.
 * 
 * WORKFLOW TESTED:
 * 1. Client uploads CSV file → API Service
 * 2. API stores file in MinIO and creates job in Redis
 * 3. API publishes job message to RabbitMQ
 * 4. Spark worker consumes message and processes file
 * 5. Worker creates Iceberg table and writes Parquet data
 * 6. Worker updates job status in Redis to "completed"
 * 7. Client polls job status until complete
 * 
 * TEST EXECUTION:
 * Tests run in order (@Order annotation) because later tests depend on
 * data created by earlier tests (e.g., jobId from upload test).
 * 
 * WHAT IT VALIDATES:
 * - File upload acceptance
 * - Asynchronous job queuing
 * - Background processing by Spark worker
 * - Job status tracking via Redis
 * - Queue statistics monitoring
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisplayName("Simple Upload Integration Test")
public class SimpleUploadTest {

    private static final String API_BASE_URL = "http://localhost:8080/api/v1";
    private File testFile;
    private String jobId;
    private String projectId;

    /**
     * Test setup: Create test data before running tests
     * 
     * Creates:
     * - Unique project ID to avoid conflicts with other test runs
     * - Temporary CSV file with 10 rows of sample data
     * 
     * The CSV contains typical business data:
     * - User information (id, name, email)
     * - Regional data (region field)
     * - Status and amount (for filtering/aggregation tests)
     * - Date field (for time-based queries)
     */
    @BeforeAll
    void setup() throws IOException {
        RestAssured.baseURI = API_BASE_URL;
        projectId = "test_" + UUID.randomUUID().toString().substring(0, 8).replace("-", "");
        
        // Create test CSV file with 10 rows
        // This represents a typical data upload scenario
        testFile = File.createTempFile("test_", ".csv");
        try (FileWriter writer = new FileWriter(testFile)) {
            writer.write("id,name,email,region,status,amount,created_date\n");
            for (int i = 1; i <= 10; i++) {
                writer.write(String.format("%d,User%d,user%d@test.com,Region%d,active,%.2f,2024-01-%02d\n",
                        i, i, i, (i % 3) + 1, i * 100.0, i));
            }
        }
        
        System.out.println("Test setup complete. Project ID: " + projectId);
    }

    @AfterAll
    void cleanup() {
        if (testFile != null && testFile.exists()) {
            testFile.delete();
        }
    }

    /**
     * TEST 1: Upload CSV file to API
     * 
     * What it does:
     * - Sends multipart form request with CSV file
     * - Provides userId, projectId, and tableName metadata
     * - Captures jobId for status tracking in next test
     * 
     * What it validates:
     * - API accepts the upload (HTTP 202 ACCEPTED)
     * - JobId is generated (UUID format)
     * - Initial status is "queued"
     * 
     * Why 202 ACCEPTED?
     * The API uses asynchronous processing:
     * - 202 means "request accepted, will be processed later"
     * - The actual processing happens in the background by Spark worker
     * - Client polls job status to check completion
     * 
     * What happens next:
     * 1. API saves file to MinIO
     * 2. API creates job record in Redis
     * 3. API publishes message to RabbitMQ
     * 4. Returns immediately (doesn't wait for processing)
     */
    @Test
    @Order(1)
    @DisplayName("Upload CSV file")
    void testUpload() {
        Response response = RestAssured.given()
                .multiPart("file", testFile)
                .formParam("userId", "testuser")
                .formParam("projectId", projectId)
                .formParam("tableName", "test_table")
                .when()
                .post("/upload")
                .then()
                .statusCode(202)  // API returns 202 ACCEPTED (async processing)
                .extract().response();

        jobId = response.jsonPath().getString("jobId");
        String status = response.jsonPath().getString("status");

        assertNotNull(jobId, "Job ID should not be null");
        assertEquals("queued", status, "Initial status should be queued");
        
        System.out.println("Upload successful. Job ID: " + jobId);
    }

    /**
     * TEST 2: Wait for background processing to complete
     * 
     * What it does:
     * - Polls job status every 2 seconds
     * - Waits up to 120 seconds for completion
     * - Validates final status and result message
     * 
     * Status progression:
     * queued → processing → completed (or failed)
     * 
     * What happens during processing:
     * 1. Spark worker downloads CSV from MinIO
     * 2. Reads CSV into Spark DataFrame
     * 3. Creates Iceberg table in PostgreSQL catalog
     * 4. Writes data as Parquet files to MinIO
     * 5. Updates job status in Redis
     * 
     * What it validates:
     * - Job eventually completes (not stuck)
     * - Final status is "completed" (not "failed")
     * - Success message includes row count (10 rows)
     * 
     * Why 120 seconds timeout?
     * Processing includes:
     * - File I/O (download, read, write)
     * - Spark operations (DataFrame transformations)
     * - Iceberg table creation (metadata writes)
     * For 10 rows, typically completes in ~5-10 seconds,
     * but allow extra time for slow systems.
     */
    @Test
    @Order(2)
    @DisplayName("Wait for upload to complete")
    void testWaitForCompletion() {
        assertNotNull(jobId, "Job ID must be set from previous test");

        // Poll job status until completed or failed
        await().atMost(120, TimeUnit.SECONDS)
                .pollInterval(2, TimeUnit.SECONDS)
                .until(() -> {
                    Response response = RestAssured.given()
                            .get("/jobs/" + jobId)
                            .then()
                            .extract().response();
                    
                    String status = response.jsonPath().getString("status");
                    System.out.println("Job status: " + status);
                    
                    return "completed".equals(status) || "failed".equals(status);
                });

        // Verify final status is "completed"
        Response finalResponse = RestAssured.given()
                .get("/jobs/" + jobId)
                .then()
                .statusCode(200)
                .extract().response();

        String finalStatus = finalResponse.jsonPath().getString("status");
        String message = finalResponse.jsonPath().getString("message");
        
        assertEquals("completed", finalStatus, "Job should complete successfully");
        assertTrue(message.contains("10 rows"), "Message should indicate 10 rows processed");
        
        System.out.println("Job completed: " + message);
    }

    /**
     * TEST 3: Verify queue statistics are accessible
     * 
     * What it does:
     * - Calls the queue monitoring endpoint
     * - Validates queue information is returned
     * 
     * What it validates:
     * - Queue stats endpoint works
     * - Queue name is configured
     * - Response contains valid data
     * 
     * Why it matters:
     * Queue statistics help monitor system health:
     * - messageCount: Pending jobs (should be 0 after processing)
     * - consumerCount: Active workers (should be ≥1)
     * - status: Queue availability
     * 
     * In production:
     * - High messageCount = backlog of jobs
     * - Zero consumerCount = workers down, jobs not processing
     */
    @Test
    @Order(3)
    @DisplayName("Check queue statistics")
    void testQueueStats() {
        Response response = RestAssured.given()
                .get("/queue/stats")
                .then()
                .statusCode(200)
                .extract().response();

        String queueName = response.jsonPath().getString("queueName");
        assertNotNull(queueName, "Queue name should not be null");
        
        System.out.println("Queue: " + queueName);
    }
}
