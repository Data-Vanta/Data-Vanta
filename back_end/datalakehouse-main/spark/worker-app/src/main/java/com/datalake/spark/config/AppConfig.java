package com.datalake.spark.config;

/**
 * Application configuration loaded from environment variables.
 */
public class AppConfig {
    // RabbitMQ Configuration
    private final String rabbitmqHost;
    private final int rabbitmqPort;
    private final String rabbitmqUser;
    private final String rabbitmqPassword;
    private final String rabbitmqQueue;
    
    // MinIO Configuration
    private final String minioEndpoint;
    private final String minioAccessKey;
    private final String minioSecretKey;
    private final String minioUploadsBucket;

    // Redis Configuration
    private final String redisHost;
    private final int redisPort;

    // API Configuration
    private final String apiBaseUrl;
    
    private AppConfig (Builder builder) {
        this.rabbitmqHost = builder.rabbitmqHost;
        this.rabbitmqPort = builder.rabbitmqPort;
        this.rabbitmqUser = builder.rabbitmqUser;
        this.rabbitmqPassword = builder.rabbitmqPassword;
        this.rabbitmqQueue = builder.rabbitmqQueue;
        this.minioEndpoint = builder.minioEndpoint;
        this.minioAccessKey = builder.minioAccessKey;
        this.minioSecretKey = builder.minioSecretKey;
        this.minioUploadsBucket = builder.minioUploadsBucket;
        this.redisHost = builder.redisHost;
        this.redisPort = builder.redisPort;
        this.apiBaseUrl = builder.apiBaseUrl;
    }

    // fromEnvironment() Creates an AppConfig object by reading all values from environment variables."
    public static AppConfig fromEnvironment() {
        return new Builder()
            .rabbitmqHost(getEnvRequired("RABBITMQ_HOST"))
            .rabbitmqPort(Integer.parseInt(getEnvRequired("RABBITMQ_PORT")))
            .rabbitmqUser(getEnvRequired("RABBITMQ_USER"))
            .rabbitmqPassword(getEnvRequired("RABBITMQ_PASS"))
            .rabbitmqQueue(getEnvRequired("RABBITMQ_QUEUE"))
            .minioEndpoint(getEnvRequired("MINIO_ENDPOINT"))
            .minioAccessKey(getEnvRequired("MINIO_ACCESS_KEY"))
            .minioSecretKey(getEnvRequired("MINIO_SECRET_KEY"))
            .minioUploadsBucket(getEnvRequired("MINIO_UPLOADS_BUCKET"))
            .redisHost(System.getenv().getOrDefault("REDIS_HOST", "redis"))
            .redisPort(Integer.parseInt(System.getenv().getOrDefault("REDIS_PORT", "6379")))
            .apiBaseUrl(getEnvRequired("API_BASE_URL"))
            .build();
    }

    // getEnvRequired() guarantees that your service never runs with missing or invalid environment variables.
    // it protects the app from misconfiguration.
    private static String getEnvRequired(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Required environment variable '" + name + "' is not set");
        }
        return value;
    }

    // Getters
    public String getRabbitmqHost() { return rabbitmqHost; }
    public int getRabbitmqPort() { return rabbitmqPort; }
    public String getRabbitmqUser() { return rabbitmqUser; }
    public String getRabbitmqPassword() { return rabbitmqPassword; }
    public String getRabbitmqQueue() { return rabbitmqQueue; }
    public String getMinioEndpoint() { return minioEndpoint; }
    public String getMinioAccessKey() { return minioAccessKey; }
    public String getMinioSecretKey() { return minioSecretKey; }
    public String getMinioUploadsBucket() { return minioUploadsBucket; }
    public String getRedisHost() { return redisHost; }
    public int getRedisPort() { return redisPort; }
    public String getApiBaseUrl() { return apiBaseUrl; }

    // Builder pattern
    public static class Builder {
        private String rabbitmqHost;
        private int rabbitmqPort;
        private String rabbitmqUser;
        private String rabbitmqPassword;
        private String rabbitmqQueue;
        private String minioEndpoint;
        private String minioAccessKey;
        private String minioSecretKey;
        private String minioUploadsBucket;
        private String redisHost;
        private int redisPort;
        private String apiBaseUrl;

        public Builder rabbitmqHost(String rabbitmqHost) {
            this.rabbitmqHost = rabbitmqHost;
            return this; // to allow chaining
        }

        public Builder rabbitmqPort(int rabbitmqPort) {
            this.rabbitmqPort = rabbitmqPort;
            return this;
        }

        public Builder rabbitmqUser(String rabbitmqUser) {
            this.rabbitmqUser = rabbitmqUser;
            return this;
        }

        public Builder rabbitmqPassword(String rabbitmqPassword) {
            this.rabbitmqPassword = rabbitmqPassword;
            return this;
        }

        public Builder rabbitmqQueue(String rabbitmqQueue) {
            this.rabbitmqQueue = rabbitmqQueue;
            return this;
        }

        public Builder minioEndpoint(String minioEndpoint) {
            this.minioEndpoint = minioEndpoint;
            return this;
        }

        public Builder minioAccessKey(String minioAccessKey) {
            this.minioAccessKey = minioAccessKey;
            return this;
        }

        public Builder minioSecretKey(String minioSecretKey) {
            this.minioSecretKey = minioSecretKey;
            return this;
        }

        public Builder minioUploadsBucket(String minioUploadsBucket) {
            this.minioUploadsBucket = minioUploadsBucket;
            return this;
        }

        public Builder redisHost(String redisHost) {
            this.redisHost = redisHost;
            return this;
        }

        public Builder redisPort(int redisPort) {
            this.redisPort = redisPort;
            return this;
        }

        public Builder apiBaseUrl(String apiBaseUrl) {
            this.apiBaseUrl = apiBaseUrl;
            return this;
        }

        // This takes the values stored in the Builder and creates a real AppConfig object.
        public AppConfig build() {
            return new AppConfig(this);
        }
    }

}
