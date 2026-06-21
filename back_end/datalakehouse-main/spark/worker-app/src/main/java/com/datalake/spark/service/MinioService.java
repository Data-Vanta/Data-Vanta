package com.datalake.spark.service;

import com.datalake.spark.config.AppConfig;
import io.minio.GetObjectArgs;
import io.minio.PutObjectArgs;
import io.minio.MinioClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Service for handling MinIO operations.
 */
public class MinioService {
    private static final Logger log = LoggerFactory.getLogger(MinioService.class);
    private final MinioClient client;
    private final String uploadsBucket;

    public MinioService(AppConfig config) {
        this.uploadsBucket = config.getMinioUploadsBucket();
        this.client = MinioClient.builder()
                .endpoint(config.getMinioEndpoint())
                .credentials(config.getMinioAccessKey(), config.getMinioSecretKey())
                .build();
        
        log.info("MinIO service initialized for bucket: {}", uploadsBucket);
    }

    /**
     * Downloads an object from MinIO to a local temporary file.
     *
     * @param objectPath The path of the object in MinIO
     * @param fileName The original file name
     * @return Path to the downloaded temporary file
     * @throws IOException if download fails
     */
    public Path downloadObject(String objectPath, String fileName) throws IOException {
        log.info("Downloading object from MinIO: {}", objectPath);
        
        Path tmpDir = Files.createTempDirectory("spark-worker-");
        Path outPath = tmpDir.resolve(fileName != null ? fileName : "upload");

        try (InputStream in = client.getObject(
                GetObjectArgs.builder()
                        .bucket(uploadsBucket)
                        .object(objectPath)
                        .build());
             FileOutputStream fos = new FileOutputStream(outPath.toFile())) {
            
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                fos.write(buffer, 0, bytesRead);
            }
        } catch (Exception e) {
            // Clean up on failure
            try {
                Files.deleteIfExists(outPath);
                Files.deleteIfExists(tmpDir);
            } catch (IOException ignored) {}
            
            throw new IOException("Failed to download object from MinIO: " + objectPath, e);
        }

        log.info("Successfully downloaded object to: {}", outPath);
        return outPath;
    }

    /**
     * Cleans up temporary files.
     *
     * @param filePath Path to the file to delete
     */
    public void cleanupTempFile(Path filePath) {
        if (filePath == null) return;
        
        try {
            Path parent = filePath.getParent();
            Files.deleteIfExists(filePath);
            if (parent != null) {
                Files.deleteIfExists(parent);
            }
            log.debug("Cleaned up temporary file: {}", filePath);
        } catch (IOException e) {
            log.warn("Failed to cleanup temporary file: {}", filePath, e);
        }
    }

    /**
     * Uploads a file to MinIO.
     *
     * @param file The local file to upload
     * @param objectPath The destination path in MinIO (including bucket as first segment)
     * @throws Exception if upload fails
     */
    public void uploadFile(File file, String objectPath) throws Exception {
        // Parse bucket from objectPath (format: "bucket/path/to/file")
        String[] parts = objectPath.split("/", 2);
        String bucket = parts.length > 1 ? parts[0] : uploadsBucket;
        String path = parts.length > 1 ? parts[1] : objectPath;
        
        log.info("Uploading file to MinIO bucket '{}': {}", bucket, path);
        
        try (FileInputStream fis = new FileInputStream(file)) {
            client.putObject(
                PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(path)
                    .stream(fis, file.length(), -1)
                    .build()
            );
            
            log.info("Successfully uploaded file to bucket '{}': {}", bucket, path);
        } catch (Exception e) {
            throw new Exception("Failed to upload file to MinIO: " + objectPath, e);
        }
    }
}