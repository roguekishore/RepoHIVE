package com.repohive.repository;

import com.repohive.model.IndexedRepo;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class IndexedRepoRepository {

    private static final RowMapper<IndexedRepo> MAPPER = (rs, n) -> new IndexedRepo(
            rs.getString("repo"),
            rs.getString("snapshot_id"),
            rs.getString("commit_sha"),
            rs.getInt("node_count"),
            rs.getInt("edge_count"),
            rs.getString("indexed_at"));

    private static final String COLUMNS = "repo, snapshot_id, commit_sha, node_count, edge_count, indexed_at";

    private final JdbcTemplate jdbc;

    public IndexedRepoRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<IndexedRepo> find(String repoKey) {
        return jdbc.query("SELECT " + COLUMNS + " FROM indexed_repositories WHERE repo = ?", MAPPER, repoKey).stream().findFirst();
    }

    public int count() {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM indexed_repositories", Integer.class);
        return count == null ? 0 : count;
    }

    /** Newest first; the repo key breaks ties so the order is stable. */
    public List<IndexedRepo> page(int limit, int offset) {
        return jdbc.query(
                "SELECT " + COLUMNS + " FROM indexed_repositories ORDER BY indexed_at DESC, repo ASC LIMIT ? OFFSET ?",
                MAPPER, limit, offset);
    }

    /** Points the repo at a snapshot (insert or replace). */
    public void upsert(String repo, String snapshotId, String commitSha, String engineVersion, String viewsVersion,
            int nodeCount, int edgeCount, String indexedAt, String jobId) {
        jdbc.update(
                "INSERT INTO indexed_repositories (repo, snapshot_id, commit_sha, engine_version, views_version, node_count, edge_count, indexed_at, job_id)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT(repo) DO UPDATE SET snapshot_id = excluded.snapshot_id, commit_sha = excluded.commit_sha,"
                        + " engine_version = excluded.engine_version, views_version = excluded.views_version,"
                        + " node_count = excluded.node_count, edge_count = excluded.edge_count,"
                        + " indexed_at = excluded.indexed_at, job_id = excluded.job_id",
                repo, snapshotId, commitSha, engineVersion, viewsVersion, nodeCount, edgeCount, indexedAt, jobId);
    }
}
