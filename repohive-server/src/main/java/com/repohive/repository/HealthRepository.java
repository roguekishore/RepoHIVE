package com.repohive.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class HealthRepository {

    private final JdbcTemplate jdbc;

    public HealthRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void ping() {
        jdbc.queryForObject("SELECT 1", Integer.class);
    }

    /** The newest indexed_at, or null when nothing is indexed. */
    public String lastCompletedJobAt() {
        String value = jdbc.queryForObject("SELECT MAX(indexed_at) FROM indexed_repositories", String.class);
        return value == null || value.isEmpty() ? null : value;
    }
}
