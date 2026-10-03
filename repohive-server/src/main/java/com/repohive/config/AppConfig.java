package com.repohive.config;

import com.repohive.model.Mode;
import java.nio.file.Path;

/**
 * Validated application settings. Nullable fields: githubToken (local), clientIpHeader (local), awsRegion,
 * webDir. The secrets are left out of toString.
 */
public record AppConfig(
        Mode mode,
        /** Scheme, host and port, no trailing slash: what a browser sends as Origin. */
        String siteOrigin,
        /** Absolute. */
        Path dataDirectory,
        StoreConfig store,
        OrchestratorConfig orchestrator,
        String githubToken,
        /** Lowercase header name; null in local mode. */
        String clientIpHeader,
        String awsRegion,
        QuotaLimits quota,
        String internalSecret,
        Path indexerDir,
        String node,
        String serverUrl,
        Path webDir) {

    public boolean hosted() {
        return mode.hosted();
    }

    public Path databaseFile() {
        return dataDirectory.resolve("app.sqlite");
    }

    @Override
    public String toString() {
        return "AppConfig[mode=" + mode + ", siteOrigin=" + siteOrigin + ", dataDirectory=" + dataDirectory
                + ", store=" + store + ", orchestrator=" + orchestrator + ", quota=" + quota + "]";
    }
}
