package com.repohive.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.ObjectHeaders;
import com.repohive.model.StoredObject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * Directory-backed store, the same format as packages/indexer/src/artifact-store-local.ts: the body is at
 * {@code <root>/<key>} and its headers at {@code <root>/<key>.headers.json}.
 */
public final class LocalObjectStore implements ObjectStore {

    public static final String HEADERS_SUFFIX = ".headers.json";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Path base;

    public LocalObjectStore(Path root) {
        this.base = root.toAbsolutePath().normalize();
    }

    public Path root() {
        return base;
    }

    private Path pathOf(String key) {
        if (key.isEmpty() || key.contains("\\") || Arrays.stream(key.split("/", -1)).anyMatch(
                part -> part.isEmpty() || part.equals(".") || part.equals("..") || part.indexOf('\0') >= 0)) {
            throw new IllegalArgumentException("not an object key");
        }
        Path file = base.resolve(key).normalize();
        if (!file.startsWith(base)) {
            throw new IllegalArgumentException("not an object key");
        }
        return file;
    }

    @Override
    public void put(String key, byte[] body, ObjectHeaders headers) {
        Path file = pathOf(key);
        try {
            Files.createDirectories(file.getParent());
            Files.write(file, body);
            Files.write(Path.of(file + HEADERS_SUFFIX), JSON.writeValueAsString(headers).getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The object at key, or empty when the body or its headers file is missing. */
    public Optional<StoredObject> get(String key) {
        Path file = pathOf(key);
        try {
            byte[] body = Files.readAllBytes(file);
            byte[] headers = Files.readAllBytes(Path.of(file + HEADERS_SUFFIX));
            return Optional.of(new StoredObject(body, JSON.readValue(headers, ObjectHeaders.class)));
        } catch (NoSuchFileException e) {
            return Optional.empty();
        } catch (IOException e) {
            // A directory where a file was expected is "not an object"; anything else is a real failure.
            if (Files.isDirectory(file)) {
                return Optional.empty();
            }
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public List<String> list(String prefix) {
        List<String> found = new ArrayList<>();
        if (Files.isDirectory(base)) {
            try (Stream<Path> walk = Files.walk(base)) {
                walk.filter(Files::isRegularFile)
                        .filter(p -> !p.getFileName().toString().endsWith(HEADERS_SUFFIX))
                        .map(p -> base.relativize(p).toString().replace(java.io.File.separatorChar, '/'))
                        .filter(key -> key.startsWith(prefix))
                        .forEach(found::add);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        found.sort(String::compareTo);
        return found;
    }

    @Override
    public void delete(List<String> keys) {
        for (String key : keys) {
            Path file = pathOf(key);
            try {
                Files.deleteIfExists(file);
                Files.deleteIfExists(Path.of(file + HEADERS_SUFFIX));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }
}
