package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.repohive.model.ObjectHeaders;
import com.repohive.store.LocalObjectStore;
import com.repohive.store.S3ObjectStore;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectsRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectsResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Object;

class ObjectStoreTest {

    @TempDir Path root;

    @Test
    void localStoreWritesABodyAndAHeadersSidecarLikeTheIndexer() throws Exception {
        LocalObjectStore store = new LocalObjectStore(root);
        store.put("artifacts/o/r/id/manifest.json", "{}".getBytes(StandardCharsets.UTF_8), new ObjectHeaders("application/json", "br", "public, max-age=1"));
        store.put("backup/app-2026-10-03.sqlite", new byte[] {1, 2, 3}, "application/x-sqlite3");

        assertThat(Files.readAllBytes(root.resolve("artifacts/o/r/id/manifest.json"))).isEqualTo("{}".getBytes(StandardCharsets.UTF_8));
        assertThat(Files.readString(root.resolve("artifacts/o/r/id/manifest.json.headers.json")))
                .isEqualTo("{\"contentType\":\"application/json\",\"contentEncoding\":\"br\",\"cacheControl\":\"public, max-age=1\"}");
        // Absent optional fields are left out, as JSON.stringify leaves out undefined.
        assertThat(Files.readString(root.resolve("backup/app-2026-10-03.sqlite.headers.json"))).isEqualTo("{\"contentType\":\"application/x-sqlite3\"}");

        var object = store.get("artifacts/o/r/id/manifest.json").orElseThrow();
        assertThat(object.headers()).isEqualTo(new ObjectHeaders("application/json", "br", "public, max-age=1"));
        assertThat(store.get("artifacts/missing.json")).isEmpty();
    }

    @Test
    void localStoreListsKeysWithoutSidecarsInOrderAndDeletesBothFiles() throws Exception {
        LocalObjectStore store = new LocalObjectStore(root);
        store.put("b/2", new byte[0], "x/y");
        store.put("b/1", new byte[0], "x/y");
        store.put("a/1", new byte[0], "x/y");
        assertThat(store.list("")).containsExactly("a/1", "b/1", "b/2");
        assertThat(store.list("b/")).containsExactly("b/1", "b/2");
        store.delete(List.of("b/1", "never-existed"));
        assertThat(store.list("")).containsExactly("a/1", "b/2");
        assertThat(Files.exists(root.resolve("b/1.headers.json"))).isFalse();
    }

    @Test
    void localStoreRefusesKeysThatEscapeTheRoot() {
        LocalObjectStore store = new LocalObjectStore(root);
        for (String key : List.of("", "../x", "a/../b", "a//b", "a/./b", "a\\b", "/abs")) {
            assertThatThrownBy(() -> store.put(key, new byte[0], "x/y")).as(key).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void s3StorePutsWithContentHeaders() {
        S3Client s3 = mock(S3Client.class);
        when(s3.putObject(any(PutObjectRequest.class), any(RequestBody.class))).thenReturn(PutObjectResponse.builder().build());
        new S3ObjectStore(s3, "bucket").put("backup/app-2026-10-03.sqlite", new byte[] {9}, "application/x-sqlite3");

        ArgumentCaptor<PutObjectRequest> request = ArgumentCaptor.forClass(PutObjectRequest.class);
        verify(s3).putObject(request.capture(), any(RequestBody.class));
        assertThat(request.getValue().bucket()).isEqualTo("bucket");
        assertThat(request.getValue().key()).isEqualTo("backup/app-2026-10-03.sqlite");
        assertThat(request.getValue().contentType()).isEqualTo("application/x-sqlite3");
        assertThat(request.getValue().contentEncoding()).isNull();
    }

    @Test
    void s3StoreListFollowsContinuationTokens() {
        S3Client s3 = mock(S3Client.class);
        when(s3.listObjectsV2(any(ListObjectsV2Request.class)))
                .thenReturn(ListObjectsV2Response.builder()
                        .contents(S3Object.builder().key("backup/b").build(), S3Object.builder().key("backup/a").build())
                        .isTruncated(true)
                        .nextContinuationToken("t1")
                        .build())
                .thenReturn(ListObjectsV2Response.builder()
                        .contents(S3Object.builder().key("backup/c").build())
                        .isTruncated(false)
                        .build());
        assertThat(new S3ObjectStore(s3, "bucket").list("backup/")).containsExactly("backup/a", "backup/b", "backup/c");

        ArgumentCaptor<ListObjectsV2Request> requests = ArgumentCaptor.forClass(ListObjectsV2Request.class);
        verify(s3, times(2)).listObjectsV2(requests.capture());
        assertThat(requests.getAllValues().get(0).prefix()).isEqualTo("backup/");
        assertThat(requests.getAllValues().get(0).continuationToken()).isNull();
        assertThat(requests.getAllValues().get(1).continuationToken()).isEqualTo("t1");
    }

    @Test
    void s3StoreDeletesInBatchesOfAThousand() {
        S3Client s3 = mock(S3Client.class);
        when(s3.deleteObjects(any(DeleteObjectsRequest.class))).thenReturn(DeleteObjectsResponse.builder().build());
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < 1001; i++) {
            keys.add("k" + i);
        }
        new S3ObjectStore(s3, "bucket").delete(keys);

        ArgumentCaptor<DeleteObjectsRequest> requests = ArgumentCaptor.forClass(DeleteObjectsRequest.class);
        verify(s3, times(2)).deleteObjects(requests.capture());
        assertThat(requests.getAllValues().get(0).delete().objects()).hasSize(1000);
        assertThat(requests.getAllValues().get(1).delete().objects()).hasSize(1);
        assertThat(requests.getAllValues().get(0).bucket()).isEqualTo("bucket");
    }

    @Test
    void s3StoreDeleteOfNothingMakesNoCall() {
        S3Client s3 = mock(S3Client.class);
        new S3ObjectStore(s3, "bucket").delete(List.of());
        verify(s3, times(0)).deleteObjects(any(DeleteObjectsRequest.class));
    }
}
