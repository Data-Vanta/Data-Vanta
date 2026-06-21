package com.datalake.api.service;

import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.errors.MinioException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.PostConstruct;
import java.io.InputStream;

/**
 * MinIO-backed FileStorageService.
 * Uploads incoming MultipartFile streams to the configured MinIO bucket and returns a public URL.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class FileStorageService {

	@Value("${minio.endpoint}")
	private String minioEndpoint;

	@Value("${minio.access-key}")
	private String accessKey;

	@Value("${minio.secret-key}")
	private String secretKey;

	@Value("${minio.bucket.uploads}")
	private String uploadsBucket;

	private MinioClient minioClient;

	@PostConstruct
	public void init() {
		try {
			// Initialize MinIO client only if endpoint is present
			if (minioEndpoint == null || minioEndpoint.isBlank()) {
				log.warn("MinIO endpoint is not configured; FileStorageService will be disabled");
				return;
			}

			minioClient = MinioClient.builder()
					.endpoint(minioEndpoint)
					.credentials(accessKey, secretKey)
					.build();

			try {
				boolean found = minioClient.bucketExists(io.minio.BucketExistsArgs.builder().bucket(uploadsBucket).build());
				if (!found) {
					minioClient.makeBucket(io.minio.MakeBucketArgs.builder().bucket(uploadsBucket).build());
					log.info("Created MinIO bucket: {}", uploadsBucket);
				}
			} catch (Exception e) {
				log.warn("Could not verify/create MinIO bucket {}: {}", uploadsBucket, e.getMessage());
			}
		} catch (Exception e) {
			log.warn("FileStorageService initialization failed: {}", e.getMessage());
		}
	}

	/**
	 * Store file under uploads/{jobId}/{fileName} and return the object path.
	 * This is useful so workers can later download by object path.
	 */
	public String storeFile(MultipartFile multipartFile, String jobId) throws Exception {
		String original = multipartFile.getOriginalFilename();
		String objectPath = String.format("uploads/%s/%s", jobId, (original != null ? original : "upload"));

		try (InputStream in = multipartFile.getInputStream()) {
			PutObjectArgs putArgs = PutObjectArgs.builder()
					.bucket(uploadsBucket)
					.object(objectPath)
					.stream(in, multipartFile.getSize(), -1)
					.contentType(multipartFile.getContentType())
					.build();

			minioClient.putObject(putArgs);
			log.info("Uploaded file to MinIO at path: {}/{}", uploadsBucket, objectPath);
			return objectPath;
		} catch (MinioException e) {
			log.error("MinIO error while uploading file: {}", e.getMessage());
			throw e;
		}
	}
}

