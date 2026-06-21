package com.datalake.spark.service;

import org.apache.spark.sql.Dataset;
import org.apache.spark.sql.Row;
import org.apache.spark.sql.SparkSession;
import org.apache.spark.sql.catalyst.analysis.NoSuchTableException;
import org.apache.spark.sql.catalyst.analysis.TableAlreadyExistsException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;

/**
 * Service for handling Spark and Iceberg operations.
 */
public class SparkService {
    private static final Logger log = LoggerFactory.getLogger(SparkService.class);

    /**
     * Creates and configures a SparkSession.
     * Iceberg extensions are configured via spark-defaults.conf in the Docker image.
     *
     * @return Configured SparkSession
     */
    public static SparkSession createSparkSession() {
        log.info("Creating SparkSession");
        return SparkSession.builder()
                .appName("datalake-worker")
                .getOrCreate();
    }

    /**
     * Reads a file into a Spark DataFrame based on file type.
     *
     * @param spark SparkSession
     * @param filePath Path to the file
     * @return DataFrame containing the file data
     * @throws IllegalArgumentException if file type is not supported
     */
    public static Dataset<Row> readFile(SparkSession spark, Path filePath) {
        String fileName = filePath.toString().toLowerCase();
        log.info("Reading file: {}", fileName);

        if (fileName.endsWith(".csv")) {
            return spark.read()
                    .option("header", "true")
                    .option("inferSchema", "true")
                    .csv(filePath.toString());
        } else if (fileName.endsWith(".json")) {
            return spark.read()
                    .option("multiLine", "true")
                    .json(filePath.toString());
        } else if (fileName.endsWith(".parquet")) {
            return spark.read().parquet(filePath.toString());
        } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
            throw new UnsupportedOperationException(
                "XLSX/XLS file processing not yet implemented. Please convert to CSV format."
            );
        } else {
            throw new IllegalArgumentException("Unsupported file type: " + fileName);
        }
    }

    /**
     * Writes a DataFrame to an Iceberg table.
     * Creates the table if it doesn't exist, otherwise appends to it.
     *
     * @param spark SparkSession
     * @param df DataFrame to write
     * @param projectId Project identifier
     * @param tableName Table name
     * @return Number of rows written
     * @throws NoSuchTableException 
     * @throws TableAlreadyExistsException 
     */
    public static long writeToIceberg(SparkSession spark, Dataset<Row> df, String projectId, String tableName) 
        throws NoSuchTableException, TableAlreadyExistsException {

        String sanitizedTableName = (tableName != null && !tableName.isBlank()) ? tableName : "default_table";
        
        // Create namespace if it doesn't exist
        // Format: local.{projectId} which maps to warehouse/wh/{projectId}/
        String namespace = String.format("local.%s", projectId);
        spark.sql(String.format("CREATE NAMESPACE IF NOT EXISTS %s", namespace));
        
        String fullTableName = String.format("%s.%s", namespace, sanitizedTableName);
        log.info("Writing to Iceberg table: {}", fullTableName);

        boolean tableExists = spark.catalog().tableExists(fullTableName);

        if (tableExists) {
            log.info("Table {} exists - appending new data", fullTableName);
            df.writeTo(fullTableName).append();
        } else {
            log.info("Table {} not found - creating new table", fullTableName);
            df.writeTo(fullTableName)
                    .using("iceberg")
                    .tableProperty("format-version", "2")
                    .create();
        }

        long rowCount = df.count();
        log.info("Successfully wrote {} rows to {}", rowCount, fullTableName);
        
        return rowCount;
    }
}