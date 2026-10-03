package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.support.Http;
import org.junit.jupiter.api.Test;

class RepoApiTest extends JobTestBase {

    private void indexed(String repo, String snapshot, String indexedAt, int nodes) {
        jdbc.update("INSERT INTO indexed_repositories (repo, snapshot_id, commit_sha, engine_version, views_version, node_count, edge_count, indexed_at, job_id)"
                + " VALUES (?, ?, 'abc123', 'e1', 'v1', ?, 7, ?, 'j')", repo, snapshot, nodes, indexedAt);
    }

    @Test
    void oneRepositoryHasTheDocumentedShapeAndIsNotCached() throws Exception {
        indexed("github.com/acme/widgets", SNAPSHOT, "2026-10-03T10:00:00.000Z", 42);
        Http.Resp response = http.get("/api/repos/acme/widgets", null, null);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(response.getContentAsString()).isEqualTo(
                "{\"repo\":\"acme/widgets\",\"snapshotId\":\"" + SNAPSHOT + "\",\"commitSha\":\"abc123\",\"nodeCount\":42,\"edgeCount\":7,\"indexedAt\":\"2026-10-03T10:00:00.000Z\"}");
    }

    @Test
    void namesAreLowercasedAndDottedRepoNamesWork() throws Exception {
        indexed("github.com/acme/my.repo-1", SNAPSHOT, "2026-10-03T10:00:00.000Z", 1);
        assertThat(http.get("/api/repos/ACME/My.Repo-1", null, null).getStatus()).isEqualTo(200);
    }

    @Test
    void unknownAndInvalidNamesAre404WithNoStore() throws Exception {
        for (String path : new String[] {"/api/repos/acme/missing", "/api/repos/-bad_owner/x", "/api/repos/acme/bad%20name", "/api/repos/" + "a".repeat(40) + "/x"}) {
            Http.Resp response = http.get(path, null, null);
            assertThat(response.getStatus()).as(path).isEqualTo(404);
            assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"This repository has not been indexed.\"}");
            assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        }
    }

    @Test
    void emptyListIsOnePage() throws Exception {
        Http.Resp response = http.get("/api/repos", null, null);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(response.getContentAsString()).isEqualTo("{\"items\":[],\"page\":1,\"totalPages\":1,\"total\":0}");
    }

    @Test
    void listIsNewestFirstWithRepoIdsAndPages() throws Exception {
        indexed("github.com/a/old", "1".repeat(32), "2026-10-01T00:00:00.000Z", 1);
        indexed("github.com/b/new", "2".repeat(32), "2026-10-03T00:00:00.000Z", 2);
        String body = http.get("/api/repos", null, null).getContentAsString();
        assertThat(body).startsWith("{\"items\":[{\"repoKey\":\"github.com/b/new\",\"repoId\":\"b/new\",\"snapshotId\":\"" + "2".repeat(32)
                + "\",\"commitSha\":\"abc123\",\"indexedAt\":\"2026-10-03T00:00:00.000Z\",\"nodeCount\":2},");
        assertThat(body).endsWith("\"page\":1,\"totalPages\":1,\"total\":2}");
        assertThat(body.indexOf("b/new")).isLessThan(body.indexOf("a/old"));
    }

    @Test
    void pagingClampsAndTreatsGarbageAsPageOne() throws Exception {
        for (int i = 0; i < 120; i++) {
            indexed(String.format("github.com/o/r%03d", i), SNAPSHOT, String.format("2026-10-03T00:%02d:%02d.000Z", i / 60, i % 60), i);
        }
        assertThat(http.get("/api/repos", null, null).getContentAsString()).contains("\"page\":1,\"totalPages\":3,\"total\":120");
        String second = http.get("/api/repos?page=2", null, null).getContentAsString();
        assertThat(second).contains("\"page\":2").contains("\"repoId\":\"o/r069\"").doesNotContain("\"repoId\":\"o/r070\"");
        String last = http.get("/api/repos?page=99", null, null).getContentAsString();
        assertThat(last).contains("\"page\":3,\"totalPages\":3");
        assertThat(last.split("repoKey", -1).length - 1).isEqualTo(20);
        for (String bad : new String[] {"abc", "0", "-4", ""}) {
            assertThat(http.get("/api/repos?page=" + bad, null, null).getContentAsString()).as(bad).contains("\"page\":1,");
        }
    }
}
