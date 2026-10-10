package com.repohive.support;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Real HTTP against the embedded server. MockMvc would rewrite the Set-Cookie header, and these tests assert
 * the header byte for byte.
 */
public final class Http {

    /** A response: status, body and headers (names matched case-insensitively). */
    public record Resp(int status, byte[] body, java.net.http.HttpHeaders headers) {

        public int getStatus() {
            return status;
        }

        public String getContentAsString() {
            return new String(body, StandardCharsets.UTF_8);
        }

        public String getHeader(String name) {
            return headers.firstValue(name).orElse(null);
        }
    }

    private static final AtomicInteger COUNTER = new AtomicInteger();
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    private final int port;
    private final String origin;
    private final String ipHeader;

    public Http(int port, String origin, String ipHeader) {
        this.port = port;
        this.origin = origin;
        this.ipHeader = ipHeader;
    }

    /** A fresh address and email so tests sharing one database never meet each other's limits. */
    public static String freshIp() {
        int n = COUNTER.incrementAndGet();
        return "198.51." + (n / 250 % 250) + "." + (n % 250);
    }

    public static String freshEmail() {
        return "user" + COUNTER.incrementAndGet() + "-" + System.nanoTime() + "@example.com";
    }

    public Resp send(String method, String path, String body, Map<String, String> headers) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        headers.forEach(request::header);
        HttpResponse<byte[]> response = CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        return new Resp(response.statusCode(), response.body(), response.headers());
    }

    public Resp post(String path, String body, String ip, String cookie, String originOverride, boolean sendOrigin) throws Exception {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        if (sendOrigin) {
            headers.put("Origin", originOverride == null ? origin : originOverride);
        }
        if (ip != null) {
            headers.put(ipHeader, ip);
        }
        if (cookie != null) {
            headers.put("Cookie", cookie);
        }
        return send("POST", path, body, headers);
    }

    public Resp post(String path, String body, String ip, String cookie) throws Exception {
        return post(path, body, ip, cookie, null, true);
    }

    public Resp get(String path, String ip, String cookie) throws Exception {
        Map<String, String> headers = new LinkedHashMap<>();
        if (ip != null) {
            headers.put(ipHeader, ip);
        }
        if (cookie != null) {
            headers.put("Cookie", cookie);
        }
        return send("GET", path, null, headers);
    }

    public static String credentials(String email, String password) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
    }

    /** name=value from a Set-Cookie header. */
    public static String cookiePair(Resp response) {
        String header = response.getHeader("Set-Cookie");
        return header.substring(0, header.indexOf(';'));
    }
}
