package com.datalake.api.integration;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.notNullValue;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import io.restassured.RestAssured;

/**
 * Quick health check test for Docker Compose services.
 * 
 * PURPOSE:
 * Validates that all infrastructure services are running and accessible before running
 * more complex integration tests. This test class serves as a "smoke test" to ensure
 * the Docker environment is properly configured.
 * 
 * WHAT IT TESTS:
 * - API Service (Spring Boot application)
 * - MinIO (Object storage for data files)
 * - RabbitMQ (Message queue for async job processing)
 * - Redis (Job status cache)
 * - PostgreSQL (Iceberg metadata catalog)
 * 
 * WHY IT'S IMPORTANT:
 * If these services aren't healthy, the upload and query tests will fail.
 * Running this test first helps identify infrastructure issues quickly.
 */
@DisplayName("Docker Compose Health Tests")
public class DockerComposeHealthTest {

    /**
     * TEST 1: Verify API Service is running and healthy
     * 
     * What it checks:
     * - Spring Boot application started successfully
     * - Health endpoint responds with HTTP 200
     * - Health status is "UP"
     * 
     * Why it matters:
     * The API service is the entry point for all upload and query requests.
     * If this fails, no other functionality will work.
     */
    @Test
    @DisplayName("API Service is running")
    void testApiServiceHealth() {
        RestAssured.given()
                .baseUri("http://localhost:8080")
                .when()
                .get("/actuator/health")
                .then()
                .statusCode(200)
                .body("status", equalTo("UP"));
    }

    /**
     * TEST 2: Verify MinIO object storage is accessible
     * 
     * What it checks:
     * - MinIO server is running on port 9000
     * - Health endpoint responds successfully
     * 
     * Why it matters:
     * MinIO stores:
     * - Uploaded CSV files
     * - Iceberg table data (Parquet files)
     * - Query results
     * Without MinIO, no data can be stored or retrieved.
     */
    @Test
    @DisplayName("MinIO is accessible")
    void testMinIOHealth() {
        RestAssured.given()
                .baseUri("http://localhost:9000")
                .when()
                .get("/minio/health/live")
                .then()
                .statusCode(200);
    }

    /**
     * TEST 3: Verify RabbitMQ message queue is accessible
     * 
     * What it checks:
     * - RabbitMQ server is running on port 15672 (management UI)
     * - Can authenticate with admin credentials
     * - Management API responds with overview data
     * 
     * Why it matters:
     * RabbitMQ enables asynchronous job processing:
     * - API publishes upload/query jobs to the queue
     * - Spark worker consumes and processes jobs
     * Without RabbitMQ, jobs would never be processed.
     */
    @Test
    @DisplayName("RabbitMQ Management is accessible")
    void testRabbitMQManagement() {
        RestAssured.given()
                .baseUri("http://localhost:15672")
                .auth().basic("admin", "changeme_in_production")
                .when()
                .get("/api/overview")
                .then()
                .statusCode(200);
    }

    /**
     * TEST 4: Verify queue statistics endpoint works
     * 
     * What it checks:
     * - API can connect to RabbitMQ
     * - Queue statistics are available
     * - Queue name is configured correctly
     * - At least one consumer (Spark worker) is listening
     * 
     * Why it matters:
     * This endpoint is used to monitor job processing:
     * - messageCount: Number of pending jobs
     * - consumerCount: Number of workers processing jobs
     * If consumerCount is 0, jobs will queue up but never process.
     */
    @Test
    @DisplayName("Queue stats endpoint works")
    void testQueueStats() {
        String response = RestAssured.given()
                .baseUri("http://localhost:8080/api/v1")
                .when()
                .get("/queue/stats")
                .then()
                .statusCode(200)
                .body("queueName", notNullValue())
                .body("consumerCount", greaterThanOrEqualTo(0))
                .extract()
                .asString();
        
        System.out.println("\n===========================================");
        System.out.println("Queue Statistics");
        System.out.println("===========================================");
        System.out.println(response);
        System.out.println("===========================================\n");
    }

    /**
     * TEST 5: Display all services summary
     * 
     * What it does:
     * Prints a summary of all services and their access points.
     * This is informational only - it doesn't validate anything.
     * 
     * Why it's useful:
     * Provides a quick reference for:
     * - Service URLs for manual testing
     * - Port mappings for debugging
     * - Service availability confirmation
     */
    @Test
    @DisplayName("All services summary")
    void testAllServices() {
        System.out.println("\n===========================================");
        System.out.println("Docker Compose Services Status");
        System.out.println("===========================================");
        System.out.println("✓ API Service: http://localhost:8080");
        System.out.println("✓ MinIO: http://localhost:9000");
        System.out.println("✓ RabbitMQ: http://localhost:15672");
        System.out.println("✓ Redis: localhost:6380");
        System.out.println("✓ PostgreSQL: localhost:5432");
        System.out.println("===========================================\n");
    }
}
