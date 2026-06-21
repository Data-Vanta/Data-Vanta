package com.datalake.spark;

import org.apache.spark.sql.SparkSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.datalake.spark.config.AppConfig;
import com.datalake.spark.service.MessageConsumerService;
import com.datalake.spark.service.MinioService;
import com.datalake.spark.service.RedisService;
import com.datalake.spark.service.SparkService;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Main application entry point for the Spark Worker.
 * Initializes services and starts consuming messages from RabbitMQ.
 */
public class WorkerApp{

    private static final Logger log = LoggerFactory.getLogger(WorkerApp.class);

    public static void main (String[] args) throws Exception {
        log.info("Starting Spark worker application");

        AppConfig config = AppConfig.fromEnvironment();

        // Initialize core services
        SparkSession spark = SparkService.createSparkSession();
        MinioService minioService = new MinioService(config);
        RedisService redisService = new RedisService(config, new ObjectMapper());

        // Start message consumer
        MessageConsumerService consumerService = new MessageConsumerService(
            config, 
            spark, 
            minioService,
            redisService
        );

        consumerService.start();
        
        log.info("Worker application started successfully");
        
        // Keep the process running
        Thread.currentThread().join();
    }
}