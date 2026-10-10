package com.repohive.config;

import com.repohive.store.LocalObjectStore;
import com.repohive.store.ObjectStore;
import com.repohive.store.S3ObjectStore;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.scheduling.annotation.EnableScheduling;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.ssm.SsmClient;
import software.amazon.awssdk.services.ssm.model.GetParameterRequest;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
public class AppConfiguration {

    @Bean
    @ConditionalOnMissingBean
    Clock clock() {
        return Clock.systemUTC();
    }

    /** Validated once at start-up; a ConfigError stops the application. */
    @Bean
    AppConfig appConfig(Environment env) {
        Path cwd = Path.of("").toAbsolutePath();
        return new AppConfigFactory(env::getProperty, cwd, parameter -> readSecretParameter(env.getProperty("AWS_REGION"), parameter)).parse();
    }

    /** Reads an SSM SecureString once, at start-up. */
    private static String readSecretParameter(String region, String name) {
        try (SsmClient ssm = SsmClient.builder().region(Region.of(region.strip())).build()) {
            return ssm.getParameter(GetParameterRequest.builder().name(name).withDecryption(true).build())
                    .parameter()
                    .value();
        }
    }

    /**
     * SQLite file under REPOHIVE_DATA_DIR. One connection: SQLite is single-writer, and a pool of one serialises
     * access. Never hold a transaction open across a network call or a child process.
     */
    @Bean(destroyMethod = "close")
    DataSource dataSource(AppConfig config) {
        try {
            Files.createDirectories(config.dataDirectory());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        HikariConfig hikari = new HikariConfig();
        hikari.setPoolName("repohive-sqlite");
        hikari.setDriverClassName("org.sqlite.JDBC");
        hikari.setJdbcUrl("jdbc:sqlite:" + config.databaseFile() + "?journal_mode=WAL&busy_timeout=5000");
        hikari.setMaximumPoolSize(1);
        hikari.setMinimumIdle(1);
        hikari.setConnectionInitSql("PRAGMA foreign_keys = ON");
        return new HikariDataSource(hikari);
    }

    @Bean
    ObjectStore objectStore(AppConfig config) {
        return switch (config.store()) {
            case StoreConfig.Local local -> new LocalObjectStore(local.directory());
            case StoreConfig.S3 s3 -> new S3ObjectStore(
                    S3Client.builder().region(Region.of(config.awsRegion())).build(), s3.bucket());
        };
    }
}
