package com.datalake.spark.model;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;

/**
 * Represents a job message received from RabbitMQ.
 */
public class JobMessage {
    private String jobId;
    private String jobType;  // "upload" or "query"
    private String filePath;
    private String fileName;
    private String tableName;
    private String projectId;
    
    // Query-specific fields
    private String source;      // Table identifier (projectId.tableName)
    private String queryJson;  // The full query specification as JSON string
    
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime timestamp;

    // Constructors
    public JobMessage() {}

    public JobMessage(String jobId, String filePath, String fileName, String tableName, String projectId) {
        this.jobId = jobId;
        this.jobType = "upload";
        this.filePath = filePath;
        this.fileName = fileName;
        this.tableName = tableName;
        this.projectId = projectId;
        this.timestamp = LocalDateTime.now();
    }

    // Getters and Setters
    public String getJobId() {
        return jobId;
    }

    public void setJobId(String jobId) {
        this.jobId = jobId;
    }

    public String getJobType() {
        return jobType;
    }

    public void setJobType(String jobType) {
        this.jobType = jobType;
    }

    public String getFilePath() {
        return filePath;
    }

    public void setFilePath(String filePath) {
        this.filePath = filePath;
    }

    public String getFileName() {
        return fileName;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public String getTableName() {
        return tableName;
    }

    public void setTableName(String tableName) {
        this.tableName = tableName;
    }

    public String getProjectId() {
        return projectId;
    }

    public void setProjectId(String projectId) {
        this.projectId = projectId;
    }

    public String getQueryJson() {
        return queryJson;
    }

    public void setQueryJson(String queryJson) {
        this.queryJson = queryJson;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    @Override
    public String toString() {
        return "JobMessage{" +
                "jobId='" + jobId + '\'' +
                ", filePath='" + filePath + '\'' +
                ", fileName='" + fileName + '\'' +
                ", tableName='" + tableName + '\'' +
                ", projectId='" + projectId + '\'' +
                ", timestamp=" + timestamp +
                '}';
    }
}