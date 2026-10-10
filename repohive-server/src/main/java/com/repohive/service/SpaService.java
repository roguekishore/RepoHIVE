package com.repohive.service;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.util.UriUtils;

/**
 * Maps a browser path to a file of the exported SPA (packages/web/README.md, "Static export and host mapping").
 * Rules, in order: bare repository to repos/_/_, repository surface to repos/_/_/&lt;surface&gt; (404 when absent),
 * job to jobs/_, else the exact file, &lt;path&gt;.html, &lt;path&gt;/index.html, else 404.html with status 404.
 * A payload request (RSC: 1 or _rsc) strips .txt or /index.txt first and serves the .txt files instead.
 */
public class SpaService {

    /** A file to send. status is 200 or 404. */
    public record Page(Path file, int status, String contentType, String cacheControl) {}

    private static final Pattern REPO = Pattern.compile("^/repos/([^/]+)/([^/]+)/?$");
    private static final Pattern SURFACE = Pattern.compile("^/repos/([^/]+)/([^/]+)/([^/]+)$");
    private static final Pattern JOB = Pattern.compile("^/jobs/([^/]+)$");

    private final Path root;

    public SpaService(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    /** Whether the server owns the path (never served from the SPA directory). */
    public static boolean isServerPath(String path) {
        return path.equals("/api") || path.startsWith("/api/") || path.equals("/artifacts") || path.startsWith("/artifacts/")
                || path.equals("/healthz") || path.startsWith("/healthz/");
    }

    /** @param rawPath the request path, still percent-encoded; empty when there is nothing to serve */
    public Optional<Page> resolve(String rawPath, boolean payload) {
        String path;
        try {
            path = UriUtils.decode(rawPath, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return notFound();
        }
        if (!path.startsWith("/") || path.indexOf('\0') >= 0 || path.contains("\\")) {
            return notFound();
        }
        for (String segment : path.split("/", -1)) {
            if (segment.equals("..") || segment.equals(".")) {
                return notFound();
            }
        }
        if (payload) {
            if (path.endsWith("/index.txt")) {
                path = path.substring(0, path.length() - "index.txt".length());
            } else if (path.endsWith(".txt")) {
                path = path.substring(0, path.length() - ".txt".length());
            }
        }
        String ext = payload ? ".txt" : ".html";

        if (REPO.matcher(path).matches()) {
            return serve("repos/_/_" + ext, payload, true);
        }
        Matcher surface = SURFACE.matcher(path);
        if (surface.matches()) {
            Optional<Page> page = serve("repos/_/_/" + surface.group(3) + ext, payload, true);
            return page.isPresent() ? page : notFound();
        }
        if (JOB.matcher(path).matches()) {
            return serve("jobs/_" + ext, payload, true);
        }

        String relative = path.substring(1);
        if (!relative.isEmpty() && !relative.endsWith("/")) {
            Optional<Page> exact = serve(relative, payload, false);
            if (exact.isPresent()) {
                return exact;
            }
        }
        String base = relative.endsWith("/") ? relative.substring(0, relative.length() - 1) : relative;
        if (!base.isEmpty()) {
            Optional<Page> withExt = serve(base + ext, payload, false);
            if (withExt.isPresent()) {
                return withExt;
            }
        }
        Optional<Page> index = serve((base.isEmpty() ? "" : base + "/") + "index" + ext, payload, false);
        return index.isPresent() ? index : notFound();
    }

    private Optional<Page> notFound() {
        Path file = root.resolve("404.html");
        if (!Files.isRegularFile(file)) {
            return Optional.empty();
        }
        return Optional.of(new Page(file, 404, "text/html; charset=utf-8", "no-cache"));
    }

    private Optional<Page> serve(String relative, boolean payload, boolean noCache) {
        Path file = root.resolve(relative).normalize();
        if (!file.startsWith(root) || !Files.isRegularFile(file)) {
            return Optional.empty();
        }
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        String cache = null;
        if (relative.startsWith("_next/static/")) {
            cache = "public, max-age=31536000, immutable";
        } else if (noCache || name.endsWith(".html") || name.endsWith(".txt")) {
            cache = "no-cache";
        }
        return Optional.of(new Page(file, 200, contentType(name, payload), cache));
    }

    static String contentType(String name, boolean payload) {
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".txt")) return payload ? "text/x-component" : "text/plain";
        if (name.endsWith(".js") || name.endsWith(".mjs")) return "text/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }
}
