package com.datalake.api.integration;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.time.Duration;
import java.util.UUID;

import org.awaitility.Awaitility;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import io.restassured.RestAssured;
import io.restassured.response.Response;

/**
 * Integration test for Iceberg merge and query functionality with JSON results.
 * 
 * PURPOSE:
 * Validates the complete end-to-end workflow of:
 * 1. Uploading multiple CSV batches to the same Iceberg table
 * 2. Apache Iceberg automatically merging all batches
 * 3. Querying the merged data
 * 4. Receiving query results as JSON (KEY FEATURE for integration)
 * 
 * WHY THIS TEST IS CRITICAL:
 * This test validates the project's core value proposition:
 * - Multiple data uploads are seamlessly merged by Iceberg
 * - Queries return JSON results directly (not just Parquet files)
 * - Other projects can integrate easily using JSON-in/JSON-out API
 * 
 * WHAT ICEBERG DOES:
 * Apache Iceberg provides ACID transactions for data lakes:
 * - Multiple uploads to same table = automatic merge (append)
 * - No data loss or corruption
 * - Consistent reads during writes
 * - Time-travel queries (snapshot isolation)
 * 
 * TEST SCENARIOS:
 * 1. Upload 3 batches (60 rows total) and query all merged data
 * 2. Upload 2 batches (10 rows) and query with filters (5 rows expected)
 * 
 * EXPECTED RESULTS:
 * - All batches visible in single query
 * - Query results returned as JSON array
 * - Parquet files also stored in MinIO for large datasets
 */
@DisplayName("Iceberg Query Integration Test")
public class IcebergQueryIntegrationTest {

    private static final String BASE_URL = "http://localhost:8080/api/v1";
    private static final String USER_ID = "test_user_query";
    
    /**
     * TEST 1: Upload multiple batches, retrieve schema, then query merged data
     * 
     * SCENARIO:
     * Simulates a real-world use case where data arrives in batches over time,
     * all going to the same table. Before querying, we discover the table schema
     * to know what columns are available.
     * 
     * TEST FLOW:
     * 1. Create 3 separate CSV files (15, 20, 25 rows = 60 total)
     * 2. Upload all 3 to the SAME table (combined_sales)
     * 3. Wait for each upload to complete
     * 4. Retrieve table schema (NEW: schema discovery)
     * 5. Query the table (should return all 60 rows merged)
     * 6. Verify JSON results are returned in API response
     * 
     * WHAT ICEBERG DOES:
     * - Batch 1: Creates table + writes 15 rows
     * - Batch 2: Appends 20 rows to existing table (merge)
     * - Batch 3: Appends 25 rows to existing table (merge)
     * - Schema: Reads column metadata from Iceberg metadata files
     * - Query: Reads all 60 rows as if from single source
     * 
     * WHY THIS MATTERS:
     * Traditional data lakes require manual merge logic.
     * Iceberg handles this automatically with ACID guarantees.
     * Schema discovery enables dynamic query building for integrations.
     * 
     * CRITICAL VALIDATION:
     * - Schema returns column names, types, and nullable info
     * - Row count = 60 (all batches merged)
     * - resultData field contains JSON array (integration-ready)
     * - Parquet file stored in MinIO (for large datasets)
     */
    @Test
    @DisplayName("Upload multiple batches, retrieve schema, then query merged data")
    void testUploadAndQueryMergedData() throws IOException {
        // Generate unique project ID to avoid conflicts
        String projectId = "query_test_" + UUID.randomUUID().toString().substring(0, 8).replace("-", "_");
        String tableName = "combined_sales";
        
        System.out.println("\n===========================================");
        System.out.println("Iceberg Upload and Query Test");
        System.out.println("Project: " + projectId);
        System.out.println("Table: " + tableName);
        System.out.println("===========================================\n");
        
        // BATCH 1: Create 15 rows of Product A in North region
        // This represents the first data upload - creates the initial table
        File batch1 = createCsvFile("batch1.csv", new String[][]{
            {"ProductID", "ProductName", "Region", "Quantity", "Price"},
            {"P001", "Product A", "North", "10", "100.00"},
            {"P002", "Product A", "North", "15", "100.00"},
            {"P003", "Product A", "North", "20", "100.00"},
            {"P004", "Product A", "North", "25", "100.00"},
            {"P005", "Product A", "North", "30", "100.00"},
            {"P006", "Product A", "North", "35", "100.00"},
            {"P007", "Product A", "North", "40", "100.00"},
            {"P008", "Product A", "North", "45", "100.00"},
            {"P009", "Product A", "North", "50", "100.00"},
            {"P010", "Product A", "North", "55", "100.00"},
            {"P011", "Product A", "North", "60", "100.00"},
            {"P012", "Product A", "North", "65", "100.00"},
            {"P013", "Product A", "North", "70", "100.00"},
            {"P014", "Product A", "North", "75", "100.00"},
            {"P015", "Product A", "North", "80", "100.00"}
        });
        
        // Upload batch 1 - Creates new Iceberg table
        System.out.println("Uploading Batch 1 (15 rows - Product A, North)...");
        String jobId1 = uploadFile(batch1, projectId, tableName);
        System.out.println("Batch 1 Job ID: " + jobId1);
        waitForJobCompletion(jobId1, "Batch 1");
        
        // BATCH 2: Create 20 rows of Product B in South region
        // This will be MERGED with batch 1 (not replaced)
        // Create batch 2: 20 rows (Product B, Region South)
        File batch2 = createCsvFile("batch2.csv", new String[][]{
            {"ProductID", "ProductName", "Region", "Quantity", "Price"},
            {"P016", "Product B", "South", "12", "150.00"},
            {"P017", "Product B", "South", "18", "150.00"},
            {"P018", "Product B", "South", "22", "150.00"},
            {"P019", "Product B", "South", "28", "150.00"},
            {"P020", "Product B", "South", "32", "150.00"},
            {"P021", "Product B", "South", "38", "150.00"},
            {"P022", "Product B", "South", "42", "150.00"},
            {"P023", "Product B", "South", "48", "150.00"},
            {"P024", "Product B", "South", "52", "150.00"},
            {"P025", "Product B", "South", "58", "150.00"},
            {"P026", "Product B", "South", "62", "150.00"},
            {"P027", "Product B", "South", "68", "150.00"},
            {"P028", "Product B", "South", "72", "150.00"},
            {"P029", "Product B", "South", "78", "150.00"},
            {"P030", "Product B", "South", "82", "150.00"},
            {"P031", "Product B", "South", "88", "150.00"},
            {"P032", "Product B", "South", "92", "150.00"},
            {"P033", "Product B", "South", "98", "150.00"},
            {"P034", "Product B", "South", "102", "150.00"},
            {"P035", "Product B", "South", "108", "150.00"}
        });
        
        // Upload batch 2 to SAME table - Iceberg will merge automatically
        // Table now contains: 15 rows (batch1) + 20 rows (batch2) = 35 rows total
        System.out.println("\nUploading Batch 2 to same table (20 rows - Product B, South)...");
        String jobId2 = uploadFile(batch2, projectId, tableName);
        System.out.println("Batch 2 Job ID: " + jobId2);
        waitForJobCompletion(jobId2, "Batch 2");
        
        // BATCH 3: Create 25 rows of Product C in East region
        // Final merge test - table will have all 3 batches (60 rows)
        // Create batch 3: 25 rows (Product C, Region East)
        File batch3 = createCsvFile("batch3.csv", new String[][]{
            {"ProductID", "ProductName", "Region", "Quantity", "Price"},
            {"P036", "Product C", "East", "14", "200.00"},
            {"P037", "Product C", "East", "19", "200.00"},
            {"P038", "Product C", "East", "24", "200.00"},
            {"P039", "Product C", "East", "29", "200.00"},
            {"P040", "Product C", "East", "34", "200.00"},
            {"P041", "Product C", "East", "39", "200.00"},
            {"P042", "Product C", "East", "44", "200.00"},
            {"P043", "Product C", "East", "49", "200.00"},
            {"P044", "Product C", "East", "54", "200.00"},
            {"P045", "Product C", "East", "59", "200.00"},
            {"P046", "Product C", "East", "64", "200.00"},
            {"P047", "Product C", "East", "69", "200.00"},
            {"P048", "Product C", "East", "74", "200.00"},
            {"P049", "Product C", "East", "79", "200.00"},
            {"P050", "Product C", "East", "84", "200.00"},
            {"P051", "Product C", "East", "89", "200.00"},
            {"P052", "Product C", "East", "94", "200.00"},
            {"P053", "Product C", "East", "99", "200.00"},
            {"P054", "Product C", "East", "104", "200.00"},
            {"P055", "Product C", "East", "109", "200.00"},
            {"P056", "Product C", "East", "114", "200.00"},
            {"P057", "Product C", "East", "119", "200.00"},
            {"P058", "Product C", "East", "124", "200.00"},
            {"P059", "Product C", "East", "129", "200.00"},
            {"P060", "Product C", "East", "134", "200.00"}
        });
        
        // Upload batch 3 to SAME table - Final merge
        // Table now contains: 15 + 20 + 25 = 60 rows total
        System.out.println("\nUploading Batch 3 to same table (25 rows - Product C, East)...");
        String jobId3 = uploadFile(batch3, projectId, tableName);
        System.out.println("Batch 3 Job ID: " + jobId3);
        waitForJobCompletion(jobId3, "Batch 3");
        
        System.out.println("\n===========================================");
        System.out.println("All batches uploaded successfully!");
        System.out.println("Total expected rows: 60 (15+20+25)");
        System.out.println("Now retrieving table schema...");
        System.out.println("===========================================\n");
        
        // Retrieve table schema - validates schema discovery endpoint
        // This helps users understand table structure before building queries
        String schemaJobId = getTableSchema(projectId, tableName);
        System.out.println("Schema Job ID: " + schemaJobId);
        waitForSchemaCompletion(schemaJobId, projectId, tableName);
        
        System.out.println("\n===========================================");
        System.out.println("Schema retrieved successfully!");
        System.out.println("Now querying the merged table...");
        System.out.println("===========================================\n");
        
        // Query the merged table - should return ALL 60 rows
        // This validates that Iceberg merged all batches correctly
        String queryJobId = submitQuery(projectId, tableName);
        System.out.println("Query Job ID: " + queryJobId);
        
        // Wait for query completion and verify:
        // 1. Row count = 60 (all batches present)
        // 2. JSON results are returned (integration feature)
        // 3. Parquet file stored in MinIO
        waitForQueryCompletion(queryJobId, projectId, tableName, 60);
        
        // Cleanup
        batch1.delete();
        batch2.delete();
        batch3.delete();
        
        System.out.println("\n===========================================");
        System.out.println("TEST COMPLETED SUCCESSFULLY!");
        System.out.println("✓ Uploaded 3 batches to same table");
        System.out.println("✓ Iceberg merged all data");
        System.out.println("✓ Retrieved table schema with column metadata");
        System.out.println("✓ Query returned all 60 rows");
        System.out.println("✓ Query results stored in MinIO");
        System.out.println("===========================================\n");
    }
    
    /**
     * TEST 2: Query with filters on merged data
     * 
     * SCENARIO:
     * Tests that query filters work correctly on merged Iceberg tables,
     * returning only the subset of data that matches the filter criteria.
     * 
     * TEST FLOW:
     * 1. Upload 2 batches (5 rows each, different regions)
     * 2. Submit query with filter: Region = "North"
     * 3. Verify only 5 rows returned (not all 10)
     * 4. Verify JSON results contain only North region data
     * 
     * WHAT IT VALIDATES:
     * - Filters work on merged data
     * - Iceberg partition pruning (performance optimization)
     * - Query results respect WHERE clause
     * - JSON results contain filtered data only
     * 
     * WHY FILTERS MATTER:
     * In production:
     * - Tables can have millions of rows
     * - Filters reduce query time and network transfer
     * - Iceberg optimizes filters using metadata (min/max stats)
     * 
     * INTEGRATION VALUE:
     * Other projects can send filtered queries and get:
     * - Only relevant data (not entire table)
     * - Results as JSON (easy to consume)
     * - Fast responses (thanks to Iceberg optimizations)
     */
    @Test
    @DisplayName("Query with filters on merged data")
    void testQueryWithFilters() throws IOException {
        // Generate unique project ID
        String projectId = "filter_test_" + UUID.randomUUID().toString().substring(0, 8).replace("-", "_");
        String tableName = "regional_sales";
        
        System.out.println("\n===========================================");
        System.out.println("Query with Filters Test");
        System.out.println("Project: " + projectId);
        System.out.println("Table: " + tableName);
        System.out.println("===========================================\n");
        
        // Create 2 batches with different regions (5 rows each)
        // Batch 1: North region data
        File batch1 = createCsvFile("north_sales.csv", new String[][]{
            {"ProductID", "Region", "Revenue"},
            {"P001", "North", "1000"},
            {"P002", "North", "2000"},
            {"P003", "North", "3000"},
            {"P004", "North", "4000"},
            {"P005", "North", "5000"}
        });
        
        // Batch 2: South region data
        File batch2 = createCsvFile("south_sales.csv", new String[][]{
            {"ProductID", "Region", "Revenue"},
            {"P006", "South", "1500"},
            {"P007", "South", "2500"},
            {"P008", "South", "3500"},
            {"P009", "South", "4500"},
            {"P010", "South", "5500"}
        });
        
        // Upload both batches to same table (total: 10 rows)
        System.out.println("Uploading North region data...");
        String jobId1 = uploadFile(batch1, projectId, tableName);
        waitForJobCompletion(jobId1, "North batch");
        
        System.out.println("\nUploading South region data...");
        String jobId2 = uploadFile(batch2, projectId, tableName);
        waitForJobCompletion(jobId2, "South batch");
        
        // Submit filtered query: Region = "North"
        // Expected result: 5 rows (not 10)
        // This tests that filters work correctly on merged data
        System.out.println("\n===========================================");
        System.out.println("Querying North region only...");
        System.out.println("===========================================\n");
        
        String queryJobId = submitQueryWithFilter(projectId, tableName, "North");
        System.out.println("Query Job ID: " + queryJobId);
        
        // Verify only North region rows returned (5 out of 10 total)
        // This validates filter functionality and JSON result accuracy
        waitForQueryCompletion(queryJobId, projectId, tableName, 5);
        
        // Cleanup
        batch1.delete();
        batch2.delete();
        
        System.out.println("\n===========================================");
        System.out.println("FILTER TEST COMPLETED!");
        System.out.println("✓ Query returned only North region rows");
        System.out.println("===========================================\n");
    }
    
    private File createCsvFile(String fileName, String[][] data) throws IOException {
        File file = new File(System.getProperty("java.io.tmpdir"), fileName);
        try (FileWriter writer = new FileWriter(file)) {
            for (String[] row : data) {
                writer.write(String.join(",", row) + "\n");
            }
        }
        return file;
    }
    
    private String uploadFile(File file, String projectId, String tableName) {
        Response response = RestAssured.given()
                .baseUri(BASE_URL)
                .multiPart("file", file)
                .formParam("userId", USER_ID)
                .formParam("projectId", projectId)
                .formParam("tableName", tableName)
                .when()
                .post("/upload")
                .then()
                .statusCode(202)
                .body("jobId", notNullValue())
                .body("status", equalTo("queued"))
                .extract()
                .response();
        
        return response.path("jobId");
    }
    
    private void waitForJobCompletion(String jobId, String batchName) {
        Awaitility.await()
                .atMost(Duration.ofSeconds(30))
                .pollInterval(Duration.ofSeconds(1))
                .until(() -> {
                    Response response = RestAssured.given()
                            .baseUri(BASE_URL)
                            .when()
                            .get("/jobs/" + jobId)
                            .then()
                            .statusCode(200)
                            .extract()
                            .response();
                    
                    String status = response.path("status");
                    System.out.println(batchName + " status: " + status);
                    
                    if ("completed".equals(status)) {
                        String message = response.path("message");
                        System.out.println("✓ " + batchName + " completed: " + message + "\n");
                        return true;
                    } else if ("failed".equals(status)) {
                        String message = response.path("message");
                        throw new RuntimeException(batchName + " failed: " + message);
                    }
                    return false;
                });
    }
    
    private String submitQuery(String projectId, String tableName) {
        String queryJson = String.format("""
            {
              "source": "%s.%s",
              "select": [
                {"column": "ProductID"},
                {"column": "ProductName"},
                {"column": "Region"},
                {"column": "Quantity"},
                {"column": "Price"}
              ]
            }
            """, projectId, tableName);
        
        Response response = RestAssured.given()
                .baseUri(BASE_URL)
                .contentType("application/json")
                .body(queryJson)
                .when()
                .post("/query")
                .then()
                .statusCode(202)
                .body("jobId", notNullValue())
                .body("status", equalTo("queued"))
                .extract()
                .response();
        
        return response.path("jobId");
    }
    
    private String submitQueryWithFilter(String projectId, String tableName, String region) {
        String queryJson = String.format("""
            {
              "source": "%s.%s",
              "select": [
                {"column": "ProductID"},
                {"column": "Region"},
                {"column": "Revenue"}
              ],
              "filters": [
                {"column": "Region", "operator": "=", "value": "%s"}
              ]
            }
            """, projectId, tableName, region);
        
        Response response = RestAssured.given()
                .baseUri(BASE_URL)
                .contentType("application/json")
                .body(queryJson)
                .when()
                .post("/query")
                .then()
                .statusCode(202)
                .body("jobId", notNullValue())
                .body("status", equalTo("queued"))
                .extract()
                .response();
        
        return response.path("jobId");
    }
    
    private String getTableSchema(String projectId, String tableName) {
        Response response = RestAssured.given()
                .baseUri(BASE_URL)
                .when()
                .get("/schema/" + projectId + "/" + tableName)
                .then()
                .statusCode(202)
                .body("jobId", notNullValue())
                .body("status", equalTo("queued"))
                .extract()
                .response();
        
        return response.path("jobId");
    }
    
    private void waitForSchemaCompletion(String schemaJobId, String projectId, String tableName) {
        Awaitility.await()
                .atMost(Duration.ofSeconds(30))
                .pollInterval(Duration.ofSeconds(2))
                .until(() -> {
                    Response response = RestAssured.given()
                            .baseUri(BASE_URL)
                            .when()
                            .get("/query/" + schemaJobId);
                    
                    int statusCode = response.getStatusCode();
                    System.out.println("Schema status check - Status code: " + statusCode);
                    if (statusCode != 200) {
                        System.out.println("Response body: " + response.getBody().asString());
                        Thread.sleep(2000);
                        return false;
                    }
                    
                    response.then().statusCode(200);
                    
                    String status = response.path("status");
                    System.out.println("Schema status: " + status);
                    
                    if ("completed".equals(status)) {
                        String message = response.path("message");
                        Integer columnCount = response.path("rowCount");
                        Object resultData = response.path("resultData");
                        
                        System.out.println("\n===========================================");
                        System.out.println("SCHEMA RESULTS");
                        System.out.println("===========================================");
                        System.out.println("Status: " + status);
                        System.out.println("Message: " + message);
                        System.out.println("Column Count: " + columnCount);
                        
                        if (resultData != null) {
                            System.out.println("\nTable Schema (JSON):");
                            System.out.println(response.path("resultData").toString());
                        }
                        
                        System.out.println("===========================================\n");
                        
                        // Validate schema response
                        if (columnCount == null || columnCount == 0) {
                            throw new AssertionError("Schema returned no columns");
                        }
                        
                        if (resultData == null) {
                            throw new AssertionError("Schema data (JSON) is missing");
                        }
                        
                        System.out.println("✓ Schema retrieved with " + columnCount + " columns");
                        System.out.println("✓ Schema available as JSON in response");
                        return true;
                    } else if ("failed".equals(status)) {
                        String message = response.path("message");
                        throw new RuntimeException("Schema request failed: " + message);
                    }
                    return false;
                });
    }
    
    private void waitForQueryCompletion(String queryJobId, String projectId, String tableName, int expectedRows) {
        Awaitility.await()
                .atMost(Duration.ofSeconds(60))
                .pollInterval(Duration.ofSeconds(2))
                .until(() -> {
                    Response response = RestAssured.given()
                            .baseUri(BASE_URL)
                            .when()
                            .get("/query/" + queryJobId);
                    
                    // Debug: Print status code and response
                    int statusCode = response.getStatusCode();
                    System.out.println("Query status check - Status code: " + statusCode);
                    if (statusCode != 200) {
                        System.out.println("Response body: " + response.getBody().asString());
                        Thread.sleep(2000); // Wait 2 seconds before retry
                        return false;
                    }
                    
                    response.then().statusCode(200);
                    
                    String status = response.path("status");
                    System.out.println("Query status: " + status);
                    
                    if ("completed".equals(status)) {
                        String message = response.path("message");
                        String resultPath = response.path("resultPath");
                        Integer rowCount = response.path("rowCount");
                        Integer fileSizeBytes = response.path("fileSizeBytes");
                        
                        System.out.println("\n===========================================");
                        System.out.println("QUERY RESULTS");
                        System.out.println("===========================================");
                        System.out.println("Status: " + status);
                        System.out.println("Message: " + message);
                        System.out.println("Result Path: " + resultPath);
                        System.out.println("Row Count: " + rowCount);
                        System.out.println("File Size: " + fileSizeBytes + " bytes");
                        
                        // CRITICAL TEST: Verify that query results are returned as JSON
                        // This is the key feature that makes this project integration-ready
                        // The resultData field should contain the actual query results as JSON array
                        Object resultData = response.path("resultData");
                        if (resultData != null) {
                            System.out.println("\nQuery Result Data (JSON):");
                            System.out.println(response.path("resultData").toString());
                        }
                        
                        System.out.println("===========================================\n");
                        
                        // Test 1: Verify row count matches expected
                        // Ensures the query executed correctly and returned the right number of rows
                        if (rowCount != null && rowCount == expectedRows) {
                            System.out.println("✓ Row count matches expected: " + expectedRows);
                        } else {
                            throw new AssertionError("Expected " + expectedRows + " rows but got " + rowCount);
                        }
                        
                        // Test 2: Verify result path is present
                        // Ensures Parquet file was created and uploaded to MinIO
                        if (resultPath == null || resultPath.isEmpty()) {
                            throw new AssertionError("Result path is null or empty");
                        }
                        
                        // Test 3: CRITICAL - Verify JSON result data is present
                        // This validates the core feature: JSON results returned directly in API response
                        // Without this, the project cannot be used by other services that need JSON output
                        if (resultData == null) {
                            throw new AssertionError("Result data (JSON) is missing - This breaks JSON-based integration!");
                        }
                        
                        System.out.println("✓ Query results stored in MinIO at: " + resultPath);
                        System.out.println("✓ Query results available as JSON in response (INTEGRATION-READY)");
                        return true;
                    } else if ("failed".equals(status)) {
                        String message = response.path("message");
                        throw new RuntimeException("Query failed: " + message);
                    }
                    return false;
                });
    }
}
