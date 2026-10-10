package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.service.SpaService;
import com.repohive.support.Http;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestClockConfig.class)
class SpaServingTest {

    static final Path DIR = TestEnv.tempDir();
    static final Path WEB = DIR.resolve("web");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
        registry.add("REPOHIVE_WEB_DIR", WEB::toString);
    }

    @LocalServerPort int port;

    private static void file(String name, String content) throws IOException {
        Path path = WEB.resolve(name);
        Files.createDirectories(path.getParent());
        Files.writeString(path, content);
    }

    @BeforeAll
    static void export() throws IOException {
        file("index.html", "INDEX-HTML");
        file("index.txt", "INDEX-TXT");
        file("404.html", "NOT-FOUND-HTML");
        file("auth/sign-in.html", "SIGNIN-HTML");
        file("auth/sign-in.txt", "SIGNIN-TXT");
        file("jobs/_.html", "JOB-HTML");
        file("jobs/_.txt", "JOB-TXT");
        file("repos/_/_.html", "REPO-HTML");
        file("repos/_/_.txt", "REPO-TXT");
        file("repos/_/_/knowledge-graph.html", "KG-HTML");
        file("repos/_/_/knowledge-graph.txt", "KG-TXT");
        file("_next/static/chunk.js", "console.log(1)");
        file("_next/static/style.css", "a{}");
        file("icon.png", "PNG");
        file("data.json", "{}");
        file("notes.txt", "PLAIN-NOTES");
        Files.writeString(DIR.resolve("secret.txt"), "SECRET");
    }

    private Http http() {
        return new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
    }

    private Http.Resp get(String path) throws Exception {
        return http().get(path, null, null);
    }

    private Http.Resp rsc(String path) throws Exception {
        return http().send("GET", path, null, Map.of("RSC", "1"));
    }

    private static String type(Http.Resp response) {
        return response.getHeader("Content-Type").replace(" ", "");
    }

    @Test
    void pagesAreServedAsNoCacheHtml() throws Exception {
        Http.Resp root = get("/");
        assertThat(root.getStatus()).isEqualTo(200);
        assertThat(root.getContentAsString()).isEqualTo("INDEX-HTML");
        assertThat(type(root)).isEqualTo("text/html;charset=utf-8");
        assertThat(root.getHeader("Cache-Control")).isEqualTo("no-cache");
        assertThat(get("/auth/sign-in").getContentAsString()).isEqualTo("SIGNIN-HTML");
        assertThat(get("/auth/sign-in.html").getContentAsString()).isEqualTo("SIGNIN-HTML");
        assertThat(get("/index.html").getContentAsString()).isEqualTo("INDEX-HTML");
    }

    @Test
    void anyRepositoryPathIsTheRepositoryPlaceholder() throws Exception {
        for (String path : new String[] {"/repos/acme/widgets", "/repos/acme/widgets/", "/repos/ACME/Widgets", "/repos/-bad-/x%20y", "/repos/o/foo.txt"}) {
            Http.Resp response = get(path);
            assertThat(response.getStatus()).as(path).isEqualTo(200);
            assertThat(response.getContentAsString()).as(path).isEqualTo("REPO-HTML");
            assertThat(response.getHeader("Cache-Control")).isEqualTo("no-cache");
        }
    }

    @Test
    void aSurfaceIsServedWhenItExistsAndIs404Otherwise() throws Exception {
        assertThat(get("/repos/acme/widgets/knowledge-graph").getContentAsString()).isEqualTo("KG-HTML");
        Http.Resp missing = get("/repos/acme/widgets/nope");
        assertThat(missing.getStatus()).isEqualTo(404);
        assertThat(missing.getContentAsString()).isEqualTo("NOT-FOUND-HTML");
        assertThat(type(missing)).isEqualTo("text/html;charset=utf-8");
        assertThat(get("/repos/acme/widgets/knowledge-graph/deeper").getStatus()).isEqualTo(404);
    }

    @Test
    void aJobIsTheJobPlaceholder() throws Exception {
        assertThat(get("/jobs/0123abcd").getContentAsString()).isEqualTo("JOB-HTML");
        assertThat(get("/jobs/x/y").getStatus()).isEqualTo(404);
    }

    @Test
    void payloadRequestsGetTheTxtFiles() throws Exception {
        Http.Resp repo = get("/repos/acme/widgets.txt?_rsc=abc");
        assertThat(repo.getContentAsString()).isEqualTo("REPO-TXT");
        assertThat(type(repo)).isEqualTo("text/x-component");
        assertThat(repo.getHeader("Cache-Control")).isEqualTo("no-cache");
        assertThat(get("/repos/acme/widgets/index.txt?_rsc=abc").getContentAsString()).isEqualTo("REPO-TXT");
        assertThat(rsc("/repos/acme/widgets/knowledge-graph.txt").getContentAsString()).isEqualTo("KG-TXT");
        assertThat(rsc("/repos/acme/widgets/nope.txt").getStatus()).isEqualTo(404);
        assertThat(rsc("/jobs/abc.txt").getContentAsString()).isEqualTo("JOB-TXT");
        assertThat(rsc("/auth/sign-in.txt").getContentAsString()).isEqualTo("SIGNIN-TXT");
        assertThat(rsc("/index.txt").getContentAsString()).isEqualTo("INDEX-TXT");
        assertThat(type(rsc("/index.txt"))).isEqualTo("text/x-component");
    }

    @Test
    void aRepositoryNamedFooDotTxtIsNotAPayloadWithoutTheHeader() throws Exception {
        assertThat(get("/repos/o/foo.txt").getContentAsString()).isEqualTo("REPO-HTML");
        assertThat(rsc("/repos/o/foo.txt").getContentAsString()).isEqualTo("REPO-TXT");
    }

    @Test
    void assetsHaveTheirTypesAndStaticChunksAreImmutable() throws Exception {
        Http.Resp js = get("/_next/static/chunk.js");
        assertThat(type(js)).isEqualTo("text/javascript");
        assertThat(js.getHeader("Cache-Control")).isEqualTo("public, max-age=31536000, immutable");
        assertThat(type(get("/_next/static/style.css"))).isEqualTo("text/css");
        assertThat(type(get("/icon.png"))).isEqualTo("image/png");
        assertThat(type(get("/data.json"))).isEqualTo("application/json");
        Http.Resp notes = get("/notes.txt");
        assertThat(type(notes)).isEqualTo("text/plain");
        assertThat(notes.getContentAsString()).isEqualTo("PLAIN-NOTES");
    }

    @Test
    void unknownPathsAre404Html() throws Exception {
        Http.Resp response = get("/nothing/here");
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(response.getContentAsString()).isEqualTo("NOT-FOUND-HTML");
        assertThat(get("/_next").getStatus()).isEqualTo(404);
        assertThat(get("/repos").getStatus()).isEqualTo(404);
    }

    @Test
    void serverPathsAreNeverServedFromTheSpaDirectory() throws Exception {
        Http.Resp api = get("/api/unknown");
        assertThat(api.getStatus()).isEqualTo(404);
        assertThat(api.getContentAsString()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"Not found.\"}");
        assertThat(get("/artifacts/o/r/x/manifest.json").getContentAsString()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"Not found.\"}");
        assertThat(get("/healthz").getContentAsString()).contains("\"status\"");
        assertThat(get("/api/auth/session").getContentAsString()).isEqualTo("{\"signedIn\":false}");
    }

    @Test
    void thereIsNoDirectoryListingAndNoTraversal() throws Exception {
        assertThat(get("/_next").getContentAsString()).isEqualTo("NOT-FOUND-HTML");
        SpaService spa = new SpaService(WEB);
        for (String path : new String[] {"/../secret.txt", "/%2e%2e/secret.txt", "/auth/../../secret.txt", "/..%2fsecret.txt", "/a\\..\\secret.txt", "/%00"}) {
            Optional<SpaService.Page> page = spa.resolve(path, false);
            assertThat(page).as(path).isPresent();
            assertThat(page.get().status()).as(path).isEqualTo(404);
            assertThat(page.get().file().getFileName().toString()).isEqualTo("404.html");
        }
        assertThat(spa.resolve("/%2e%2e/secret.txt", true).orElseThrow().status()).isEqualTo(404);
    }
}
