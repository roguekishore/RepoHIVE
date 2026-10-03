package com.repohive.store;

import com.repohive.model.ObjectHeaders;
import java.util.ArrayList;
import java.util.List;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.Delete;
import software.amazon.awssdk.services.s3.model.DeleteObjectsRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.ObjectIdentifier;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Object;

/** S3-backed store. The client is injected so tests can pass a mock. */
public final class S3ObjectStore implements ObjectStore {

    private static final int DELETE_BATCH = 1000;

    private final S3Client s3;
    private final String bucket;

    public S3ObjectStore(S3Client s3, String bucket) {
        this.s3 = s3;
        this.bucket = bucket;
    }

    @Override
    public void put(String key, byte[] body, ObjectHeaders headers) {
        PutObjectRequest.Builder request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(headers.contentType());
        if (headers.contentEncoding() != null) {
            request.contentEncoding(headers.contentEncoding());
        }
        if (headers.cacheControl() != null) {
            request.cacheControl(headers.cacheControl());
        }
        s3.putObject(request.build(), RequestBody.fromBytes(body));
    }

    @Override
    public List<String> list(String prefix) {
        List<String> keys = new ArrayList<>();
        String token = null;
        do {
            ListObjectsV2Response page = s3.listObjectsV2(ListObjectsV2Request.builder()
                    .bucket(bucket)
                    .prefix(prefix)
                    .continuationToken(token)
                    .build());
            for (S3Object object : page.contents()) {
                keys.add(object.key());
            }
            token = Boolean.TRUE.equals(page.isTruncated()) ? page.nextContinuationToken() : null;
        } while (token != null);
        keys.sort(String::compareTo);
        return keys;
    }

    @Override
    public void delete(List<String> keys) {
        for (int from = 0; from < keys.size(); from += DELETE_BATCH) {
            List<ObjectIdentifier> batch = keys.subList(from, Math.min(keys.size(), from + DELETE_BATCH)).stream()
                    .map(key -> ObjectIdentifier.builder().key(key).build())
                    .toList();
            s3.deleteObjects(DeleteObjectsRequest.builder()
                    .bucket(bucket)
                    .delete(Delete.builder().objects(batch).quiet(true).build())
                    .build());
        }
    }
}
