package com.datalake.spark.service;

import java.io.IOException;

import org.apache.spark.sql.SparkSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.datalake.spark.config.AppConfig;
import com.datalake.spark.model.JobMessage;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.rabbitmq.client.Delivery;

/**
 * Main service that consumes messages from RabbitMQ and processes jobs.
 */
public class MessageConsumerService {
    private static final Logger log = LoggerFactory.getLogger(MessageConsumerService.class);
    
    private final RabbitMQService rabbitmqService;
    private final JobProcessor jobProcessor;
    private final ObjectMapper mapper;

    public MessageConsumerService(AppConfig config, SparkSession spark, MinioService minioService, RedisService redisService) {
        this.rabbitmqService = new RabbitMQService(config);

        // Setup JSON mapper
        this.mapper = new ObjectMapper();
        this.mapper.registerModule(new JavaTimeModule());
        // Ignore any unknown properties in the JSON instead of failing.
        this.mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        // Initialize services
        StatusService statusService = new StatusService(config, mapper);
        this.jobProcessor = new JobProcessor(spark, minioService, statusService, redisService);
    }

    /**
     * Starts the message consumer.
     * Connects to RabbitMQ and begins consuming messages.
     */
    public void start() throws Exception {
        log.info("Starting message consumer service");
        
        // Connect to RabbitMQ
        rabbitmqService.connect();
        
        // Start consuming messages
        rabbitmqService.startConsuming(this::handleMessage);
        
        log.info("Message consumer service started successfully");
    }

    /**
     * Handles incoming messages from RabbitMQ.
     */
    private void handleMessage(String consumerTag, Delivery delivery) {
        JobMessage job = null;
        
        try {
            String payload = new String(delivery.getBody());
            log.info("Received message: {}", payload);

            // Parse job message
            job = mapper.readValue(payload, JobMessage.class);
            
            // Process the job
            jobProcessor.processJob(job);
            
            // Acknowledge successful processing
            rabbitmqService.ack(delivery.getEnvelope().getDeliveryTag());
            
        } catch (Exception e) {
            log.error("Error processing message", e);
            
            // Handle failure and send status update
            if (job != null) {
                jobProcessor.handleFailure(job, e);
            } else {
                // If we couldn't parse the message, try to extract jobId
                handleUnparsableMessage(delivery, e);
            }
            
            // Negative acknowledgment (do not requeue)
            try {
                rabbitmqService.nack(delivery.getEnvelope().getDeliveryTag());
            } catch (IOException ex) {
                log.error("Failed to NACK message", ex);
            }
        }
    }

    /**
     * Handles messages that couldn't be parsed.
     */
    private void handleUnparsableMessage(Delivery delivery, Exception originalException) {
        log.error("Failed to parse message, attempting to extract jobId for status update");
        
        try {
            String payload = new String(delivery.getBody());
            // Try to extract jobId even if full parsing failed
            JobMessage partialJob = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                    .readValue(payload, JobMessage.class);
            
            if (partialJob != null && partialJob.getJobId() != null) {
                jobProcessor.handleFailure(partialJob, originalException);
            }
        } catch (Exception e) {
            log.error("Could not extract jobId from unparsable message", e);
        }
    }

    /**
     * Shuts down the consumer service.
     */
    public void shutdown() {
        log.info("Shutting down message consumer service");
        rabbitmqService.close();
    }
}
