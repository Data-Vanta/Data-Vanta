package com.datalake.spark.service;

import com.datalake.spark.config.AppConfig;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Service for managing RabbitMQ connections and message consumption.
 */
public class RabbitMQService {
    private static final Logger log = LoggerFactory.getLogger(RabbitMQService.class);
    private static final int RETRY_DELAY_SECONDS = 5;
    
    private final AppConfig config;
    private Connection connection;
    private Channel channel;

    public RabbitMQService(AppConfig config) {
        this.config = config;
    }

    /**
     * Establishes connection to RabbitMQ with automatic retry.
     * Enables automatic recovery and declares the queue.
     */
    public void connect() throws IOException, TimeoutException {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost(config.getRabbitmqHost());
        factory.setPort(config.getRabbitmqPort());
        factory.setUsername(config.getRabbitmqUser());
        factory.setPassword(config.getRabbitmqPassword());
        
        // Enable automatic recovery
        factory.setAutomaticRecoveryEnabled(true);
        factory.setNetworkRecoveryInterval(5000);
        factory.setRequestedHeartbeat(30);
        factory.setConnectionTimeout(10000);

        // Retry connection until successful
        while (true) {
            try {
                connection = factory.newConnection();
                channel = connection.createChannel();
                channel.queueDeclare(config.getRabbitmqQueue(), true, false, false, null);
                
                log.info("Connected to RabbitMQ and declared queue '{}'", config.getRabbitmqQueue());
                
                // Add shutdown listener
                connection.addShutdownListener(cause -> 
                    log.warn("RabbitMQ connection shutdown: {}", cause.getReason())
                );
                
                break;
            } catch (IOException | TimeoutException e) {
                log.warn("RabbitMQ connection failed: {}. Retrying in {}s...", 
                    e.getMessage(), RETRY_DELAY_SECONDS);
                try {
                    TimeUnit.SECONDS.sleep(RETRY_DELAY_SECONDS);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Connection interrupted", ie);
                }
            }
        }
    }

    /**
     * Starts consuming messages from the queue.
     *
     * @param deliverCallback Callback to handle incoming messages
     * @throws IOException 
     */
    public void startConsuming(DeliverCallback deliverCallback) throws IOException {
        if(channel == null || !channel.isOpen()) {
            throw new IllegalStateException("RabbitMQ channel is not open");
        }

        channel.basicConsume(
            config.getRabbitmqQueue(),
            false, // manual acknowledgment 
            deliverCallback, // Every time a new message arrives in the queue, RabbitMQ will call this function and pass the message to it.
            consumerTag -> log.info("Consumer cancelled: {}", consumerTag)
        );
        
        log.info("Started consuming messages from queue: {}", config.getRabbitmqQueue());
    }

    /**
     * Acknowledges a message.
     * @param deliveryTag // identifies the specific message that received.
     */
    public void ack(long deliveryTag) throws IOException {
        if (channel != null && channel.isOpen()) {
            channel.basicAck(deliveryTag, false);
        } else {
            log.warn("Channel is not open; cannot ACK message {}", deliveryTag);
        }
    }

    /**
     * Negatively acknowledges a message (requeue = false).
     */
    public void nack(long deliveryTag) throws IOException {
        if (channel != null && channel.isOpen()) {
            /*
             * deliveryTag → the message to reject.
             * false → only reject this single message (not multiple).
             * true → requeue the failed message.
             */
            channel.basicNack(deliveryTag, false, true);
        } else {
            log.warn("Channel is not open; cannot NACK message {}", deliveryTag);
        }
    }

    /**
     * Closes the channel and connection.
     */
    public void close() {
        try {
            if (channel != null && channel.isOpen()) {
                channel.close();
            }
            if (connection != null && connection.isOpen()) {
                connection.close();
            }
            log.info("RabbitMQ connection closed");
        } catch (IOException | TimeoutException e) {
            log.error("Error closing RabbitMQ connection", e);
        }
    }

    public Channel getChannel() {
        return channel;
    }

   
}

   