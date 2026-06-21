package com.datalake.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

/**
 * Main entry point for the Data Lakehouse API Service.
 * 
 * This Spring Boot application provides RESTful endpoints for:
 * - File uploads (CSV data ingestion)
 * - Query execution (structured queries against Iceberg tables)
 * - Job status tracking (monitoring upload and query jobs)
 * - Queue statistics (RabbitMQ monitoring)
 */
@SpringBootApplication
public class DataLakeApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(DataLakeApiApplication.class, args);
    }

    /**
     * Configure ObjectMapper for JSON serialization/deserialization.
     * 
     * This bean is shared across the application (singleton scope) and includes:
     * - JavaTimeModule for handling Java 8 date/time types (LocalDateTime, etc.)
     * 
     * Used by:
     * - REST controllers for request/response JSON conversion
     * - JobStatusService for Redis serialization
     * - RabbitMQ message serialization
     */
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        return mapper;
    }
}