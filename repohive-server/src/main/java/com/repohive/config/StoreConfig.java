package com.repohive.config;

import java.nio.file.Path;

public sealed interface StoreConfig {

    /** A directory-backed store; `directory` is absolute. */
    record Local(Path directory) implements StoreConfig {}

    record S3(String bucket) implements StoreConfig {}
}
