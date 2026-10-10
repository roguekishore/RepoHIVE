package com.repohive.service;

import com.repohive.config.AppConfig;
import com.repohive.config.StoreConfig;
import com.repohive.model.StoredObject;
import com.repohive.store.LocalObjectStore;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.brotli.dec.BrotliInputStream;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriUtils;

/** Local-mode serving of artifacts/<rest> from the local store (port of serveStoredObject). */
@Service
public class ArtifactService {

    /** What to send for a found object. */
    public record Served(String contentType, String cacheControl, boolean brotli, byte[] body) {}

    private final LocalObjectStore store;

    public ArtifactService(AppConfig config) {
        this.store = !config.hosted() && config.store() instanceof StoreConfig.Local local
                ? new LocalObjectStore(local.directory())
                : null;
    }

    /** Whether this server serves artifacts at all (local mode only). */
    public boolean enabled() {
        return store != null;
    }

    /**
     * The object behind the raw (still percent-encoded) path after /artifacts/, or empty for anything that is
     * missing, unsafe or a sidecar file.
     */
    public Optional<Served> find(String rawRest, String acceptEncoding) {
        if (store == null) {
            return Optional.empty();
        }
        String rest;
        try {
            rest = UriUtils.decode(rawRest, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        if (rest.isEmpty() || rest.indexOf('\0') >= 0) {
            return Optional.empty();
        }
        String[] segments = rest.split("/", -1);
        for (String part : segments) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.contains("\\")) {
                return Optional.empty();
            }
        }
        if (segments[segments.length - 1].endsWith(LocalObjectStore.HEADERS_SUFFIX)) {
            return Optional.empty();
        }
        Optional<StoredObject> object = store.get("artifacts/" + rest);
        if (object.isEmpty()) {
            return Optional.empty();
        }
        StoredObject stored = object.get();
        String contentType = stored.headers().contentType() == null ? "application/octet-stream" : stored.headers().contentType();
        byte[] body = stored.body();
        boolean brotli = false;
        if ("br".equals(stored.headers().contentEncoding())) {
            if (acceptsBrotli(acceptEncoding)) {
                brotli = true;
            } else {
                body = decompress(body);
            }
        }
        return Optional.of(new Served(contentType, stored.headers().cacheControl(), brotli, body));
    }

    private static byte[] decompress(byte[] body) {
        try (BrotliInputStream in = new BrotliInputStream(new ByteArrayInputStream(body))) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Whether an Accept-Encoding value accepts brotli (br or * listed with a non-zero q). */
    public static boolean acceptsBrotli(String acceptEncoding) {
        if (acceptEncoding == null) {
            return false;
        }
        for (String part : acceptEncoding.split(",")) {
            String[] pieces = part.strip().toLowerCase().split(";");
            String coding = pieces[0].strip();
            if (!coding.equals("br") && !coding.equals("*")) {
                continue;
            }
            String q = null;
            for (int i = 1; i < pieces.length; i++) {
                String p = pieces[i].strip();
                if (p.startsWith("q=")) {
                    q = p;
                    break;
                }
            }
            if (q == null) {
                return true;
            }
            try {
                if (Double.parseDouble(q.substring(2)) > 0) {
                    return true;
                }
            } catch (NumberFormatException ignored) {
                // Number("abc") is NaN, which is not > 0: this entry does not accept br.
            }
        }
        return false;
    }
}
