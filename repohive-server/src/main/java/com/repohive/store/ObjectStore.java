package com.repohive.store;

import com.repohive.model.ObjectHeaders;
import java.util.List;

/** A flat key/value object store: a local directory or an S3 bucket. */
public interface ObjectStore {

    void put(String key, byte[] body, ObjectHeaders headers);

    default void put(String key, byte[] body, String contentType) {
        put(key, body, ObjectHeaders.of(contentType));
    }

    /** Keys starting with prefix, in byte-wise order. */
    List<String> list(String prefix);

    void delete(List<String> keys);
}
