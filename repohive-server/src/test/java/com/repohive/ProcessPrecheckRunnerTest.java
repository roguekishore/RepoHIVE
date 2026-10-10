package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.repohive.config.AppConfig;
import com.repohive.config.AppConfigFactory;
import com.repohive.model.PrecheckResult;
import com.repohive.service.PrecheckFailedException;
import com.repohive.service.ProcessPrecheckRunner;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProcessPrecheckRunnerTest {

    private static AppConfig config(Path dir, String token) {
        Map<String, String> env = new HashMap<>(Map.of(
                "REPOHIVE_MODE", "local", "REPOHIVE_SITE_ORIGIN", "http://localhost:3000", "REPOHIVE_DATA_DIR", "data",
                "REPOHIVE_STORE", "local:store", "REPOHIVE_ORCHESTRATOR", "local", "REPOHIVE_INTERNAL_SECRET", "s"));
        if (token != null) {
            env.put("REPOHIVE_GITHUB_TOKEN", token);
        }
        return AppConfigFactory.parse(env::get, dir);
    }

    /**
     * The fake pre-check is a Node one-liner (`node -e`), not a shell script, so the tests run the same on Windows and
     * Linux. Node is a project prerequisite. The `--` keeps node from reading the runner's `--repo` as one of its own options; the runner's
     * arguments follow it, so `process.argv[1]` is the first of them. Scripts hold no double quotes: Windows would need them escaped on the command line.
     */
    private static ProcessPrecheckRunner runner(Path dir, String token, String script, Duration timeout) {
        return new ProcessPrecheckRunner(config(dir, token), timeout, List.of("node", "-e", script, "--"));
    }

    /** A script that prints one JSON line built from a JavaScript object literal. */
    private static String emit(String objectLiteral) {
        return "console.log(JSON.stringify(" + objectLiteral + "))";
    }

    @Test
    void parsesAnAcceptedLine(@TempDir Path dir) {
        String script = emit("{ok:true,repo:'github.com/a/b',commitSha:'c0ffee',tier:'M',snapshotId:'" + "5".repeat(32)
                + "',javaFiles:12,javaBytes:3400,truncated:false}");
        PrecheckResult result = runner(dir, null, script, Duration.ofSeconds(10)).run("a/b");
        assertThat(result).isEqualTo(new PrecheckResult.Accepted("github.com/a/b", "c0ffee", "M", "5".repeat(32), 12, 3400, false));
    }

    @Test
    void parsesARejection(@TempDir Path dir) {
        PrecheckResult result = runner(dir, null, emit("{ok:false,reason:'not-found',message:'No such repository.'}"), Duration.ofSeconds(10)).run("a/b");
        assertThat(result).isEqualTo(new PrecheckResult.Rejected("not-found", "No such repository."));
        assertThat(((PrecheckResult.Rejected) result).code()).isEqualTo("NOT_FOUND");
    }

    @Test
    void theRepoTextIsOneArgumentAndFixturesAreAbsolute(@TempDir Path dir) {
        // argv[2] is the repo text, argv[4] the fixture directory: a shell would have split or expanded the text.
        String script = emit("{ok:false,reason:'x',message:[process.argv[1],process.argv[2],process.argv[4]].join('|')}");
        PrecheckResult result = runner(dir, null, script, Duration.ofSeconds(10)).run("a b;$(touch pwned) c");
        String message = ((PrecheckResult.Rejected) result).message();
        assertThat(message).isEqualTo("--repo|a b;$(touch pwned) c|" + dir.toAbsolutePath().resolve("data/tarballs"));
        assertThat(dir.resolve("pwned")).doesNotExist();
    }

    @Test
    void theTokenReachesTheChildEnvironment(@TempDir Path dir) {
        PrecheckResult result = runner(dir, "tok-123", emit("{ok:false,reason:'x',message:process.env.REPOHIVE_GITHUB_TOKEN}"), Duration.ofSeconds(10)).run("a/b");
        assertThat(((PrecheckResult.Rejected) result).message()).isEqualTo("tok-123");
    }

    @Test
    void aCrashATimeoutAndUnreadableOutputAreFailuresWithoutTheToken(@TempDir Path dir) {
        assertThatThrownBy(() -> runner(dir, "tok-123", "console.error('tok-123');process.exitCode=1", Duration.ofSeconds(10)).run("a/b"))
                .isInstanceOf(PrecheckFailedException.class).hasMessageNotContaining("tok-123");
        assertThatThrownBy(() -> runner(dir, null, "setTimeout(() => {}, 20000)", Duration.ofMillis(300)).run("a/b")).isInstanceOf(PrecheckFailedException.class)
                .hasMessageContaining("timed out");
        for (String script : new String[] {"console.log('not json')", "0", emit("{ok:true}"), emit("{ok:false}"), "console.log('[1]')"}) {
            assertThatThrownBy(() -> runner(dir, null, script, Duration.ofSeconds(10)).run("a/b")).as(script).isInstanceOf(PrecheckFailedException.class);
        }
    }
}
