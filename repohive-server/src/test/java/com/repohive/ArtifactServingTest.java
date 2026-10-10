package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.model.ObjectHeaders;
import com.repohive.service.ArtifactService;
import com.repohive.store.LocalObjectStore;
import com.repohive.support.Http;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestClockConfig.class)
class ArtifactServingTest {

    static final Path DIR = TestEnv.tempDir();

    /** zlib.brotliCompressSync of PLAIN, made once with Node 24. */
    static final String PLAIN = "{\"hello\":\"world\",\"n\":[1,2,3],\"pad\":\"" + "x".repeat(200) + "\"}";
    static final byte[] BROTLI = Base64.getDecoder().decode(
            "G+0AIJwHti1q/YJY/A6TqzGMUOktskW2N93g8JpFp6tvx8jMhAGHHOqBuKglkXm1sCSk8vFNXQkDDGrp5QOTAw==");

    static final String VIEW = "/artifacts/octo/repo/0123456789abcdef0123456789abcdef/views/graph.json";
    static final String CACHE = "public, max-age=31536000, immutable";

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
    }

    @LocalServerPort int port;
    @Autowired ArtifactService artifacts;

    private Http http() {
        return new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
    }

    @BeforeAll
    static void seed() {
        LocalObjectStore store = new LocalObjectStore(DIR.resolve("store"));
        store.put(VIEW.substring(1), BROTLI, new ObjectHeaders("application/json", "br", CACHE));
        store.put("artifacts/octo/repo/plain.txt", "hello".getBytes(StandardCharsets.UTF_8), ObjectHeaders.of("text/plain"));
        // Objects outside artifacts/ must never be reachable.
        store.put("private/octo/repo/history.json", "{\"secret\":true}".getBytes(StandardCharsets.UTF_8), ObjectHeaders.of("application/json"));
        store.put("backup/app-2026-10-03.sqlite", "sqlite".getBytes(StandardCharsets.UTF_8), ObjectHeaders.of("application/x-sqlite3"));
    }

    private Http.Resp get(String path, String acceptEncoding) throws Exception {
        return http().send("GET", path, null, acceptEncoding == null ? Map.of() : Map.of("Accept-Encoding", acceptEncoding));
    }

    @Test
    void passesBrotliThroughToAClientThatAcceptsIt() throws Exception {
        Http.Resp response = get(VIEW, "gzip, br");
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.body()).isEqualTo(BROTLI);
        assertThat(response.getHeader("Content-Encoding")).isEqualTo("br");
        assertThat(response.getHeader("Content-Type")).isEqualTo("application/json");
        assertThat(response.getHeader("Vary")).isEqualTo("Accept-Encoding");
        assertThat(response.getHeader("Cache-Control")).isEqualTo(CACHE);
        assertThat(response.getHeader("Content-Length")).isEqualTo(String.valueOf(BROTLI.length));
        assertThat(get(VIEW, "*").getHeader("Content-Encoding")).isEqualTo("br");
    }

    @Test
    void decompressesForAClientThatDoesNotAcceptBrotli() throws Exception {
        for (String acceptEncoding : new String[] {null, "gzip", "identity", "br;q=0", "gzip, br;q=0.0"}) {
            Http.Resp response = get(VIEW, acceptEncoding);
            assertThat(response.getStatus()).as("Accept-Encoding: " + acceptEncoding).isEqualTo(200);
            assertThat(response.getContentAsString()).isEqualTo(PLAIN);
            assertThat(response.getHeader("Content-Encoding")).isNull();
            assertThat(response.getHeader("Content-Length")).isEqualTo(String.valueOf(PLAIN.length()));
            assertThat(response.getHeader("Vary")).isEqualTo("Accept-Encoding");
            assertThat(response.getHeader("Cache-Control")).isEqualTo(CACHE);
        }
    }

    @Test
    void anObjectWithoutBrotliOrCacheControlIsServedAsStored() throws Exception {
        Http.Resp response = get("/artifacts/octo/repo/plain.txt", "br");
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("hello");
        assertThat(response.getHeader("Content-Encoding")).isNull();
        assertThat(response.getHeader("Cache-Control")).isNull();
        assertThat(response.getHeader("Content-Type")).startsWith("text/plain");
    }

    @Test
    void acceptsBrotliReadsBrWildcardAndQ() {
        assertThat(ArtifactService.acceptsBrotli(null)).isFalse();
        assertThat(ArtifactService.acceptsBrotli("gzip, deflate")).isFalse();
        assertThat(ArtifactService.acceptsBrotli("gzip, br")).isTrue();
        assertThat(ArtifactService.acceptsBrotli("BR")).isTrue();
        assertThat(ArtifactService.acceptsBrotli("*")).isTrue();
        assertThat(ArtifactService.acceptsBrotli("br;q=0")).isFalse();
        assertThat(ArtifactService.acceptsBrotli("br; q=0.5")).isTrue();
        assertThat(ArtifactService.acceptsBrotli("gzip;q=1, br;q=0")).isFalse();
    }

    @Test
    void aMissingObjectIs404Json() throws Exception {
        Http.Resp response = get("/artifacts/octo/repo/nope.json", null);
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"Not found.\"}");
        assertThat(get("/artifacts/octo/repo", null).getStatus()).isEqualTo(404);
    }

    @Test
    void sidecarFilesAreNeverServed() throws Exception {
        for (String path : List.of(VIEW + ".headers.json", "/artifacts/octo/repo/plain.txt.headers.json")) {
            Http.Resp response = get(path, null);
            assertThat(response.getStatus()).as(path).isEqualTo(404);
            assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"Not found.\"}");
        }
    }

    @Test
    void emptyRootAndTraversalPathsAre404OverHttp() throws Exception {
        for (String path : List.of(
                "/artifacts", "/artifacts/", "/artifacts//octo/repo/plain.txt",
                "/artifacts/../private/octo/repo/history.json",
                "/artifacts/octo/../../private/octo/repo/history.json",
                "/artifacts/%2e%2e/private/octo/repo/history.json",
                "/artifacts/%2E%2E/%2E%2E/backup/app-2026-10-03.sqlite",
                "/artifacts/octo/%2e./%2e./private/octo/repo/history.json",
                "/artifacts/.%2e/private/octo/repo/history.json",
                "/artifacts/octo/.//repo/plain.txt",
                "/artifacts/octo\\..\\private/octo/repo/history.json",
                "/artifacts/..%5Cprivate/octo/repo/history.json")) {
            Http.Resp response;
            try {
                response = get(path, null);
            } catch (IllegalArgumentException | java.io.IOException e) {
                continue; // the client refused to even send it
            }
            assertThat(response.getContentAsString()).as(path).doesNotContain("secret").doesNotContain("sqlite");
            assertThat(response.getStatus()).as(path).isIn(400, 404);
        }
    }

    @Test
    void theServiceRefusesUnsafeSegmentsAndSidecarsAndEverythingOutsideArtifacts() {
        for (String rest : List.of(
                "", ".", "..", "../private/octo/repo/history.json", "octo/../../private/octo/repo/history.json",
                "octo//repo/plain.txt", "octo/./repo/plain.txt", "octo/repo/", "%2e%2e/private/octo/repo/history.json",
                "octo%2F..%2F..%2Fprivate%2Focto%2Frepo%2Fhistory.json", "octo\\..\\..\\private\\octo\\repo\\history.json",
                "octo/repo/plain.txt.headers.json", "octo/repo/plain.txt%00", "%zz", "octo/repo")) {
            assertThat(artifacts.find(rest, null)).as(rest).isEmpty();
        }
        assertThat(artifacts.find("octo/repo/plain.txt", null)).isPresent();
        assertThat(artifacts.find("octo/repo/plain.txt".replace("plain", "pla%69n"), null)).isPresent();
    }
}
