package com.repohive.repository;

import com.repohive.model.JobRow;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/** job_executions. Every write that depends on the current status says so in its WHERE clause. */
@Repository
public class JobRepository {

    private static Integer nullableInt(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static final RowMapper<JobRow> MAPPER = (rs, n) -> new JobRow(
            rs.getString("id"),
            rs.getString("repo"),
            rs.getString("commit_sha"),
            rs.getString("snapshot_id"),
            rs.getString("account_id"),
            rs.getString("tier"),
            rs.getString("status"),
            rs.getString("state"),
            rs.getString("progress_stage"),
            nullableInt(rs, "progress_completed"),
            nullableInt(rs, "progress_total"),
            rs.getString("failure_class"),
            rs.getString("failure_code"),
            rs.getString("failure_message"),
            rs.getInt("retier_count"),
            rs.getInt("restarted"),
            rs.getString("execution_ref"),
            rs.getString("created_at"),
            rs.getString("queued_at"),
            rs.getString("started_at"),
            rs.getString("updated_at"),
            rs.getString("ended_at"));

    private final JdbcTemplate jdbc;

    public JobRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<JobRow> find(String id) {
        return jdbc.query("SELECT * FROM job_executions WHERE id = ?", MAPPER, id).stream().findFirst();
    }

    public Optional<String> findOpenJobId(String repo) {
        return jdbc.queryForList(
                        "SELECT id FROM job_executions WHERE repo = ? AND status IN ('QUEUED', 'RUNNING') LIMIT 1", String.class, repo)
                .stream().findFirst();
    }

    public int countOpen() {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM job_executions WHERE status IN ('QUEUED', 'RUNNING')", Integer.class);
        return count == null ? 0 : count;
    }

    public int countRunningLarge() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM job_executions WHERE status = 'RUNNING' AND tier IN ('L', 'XL')", Integer.class);
        return count == null ? 0 : count;
    }

    /** Whether a QUEUED L or XL job precedes (created_at, id) in dispatch order. */
    public boolean hasOlderQueuedLarge(String createdAt, String id) {
        return !jdbc.queryForList(
                        "SELECT 1 FROM job_executions WHERE status = 'QUEUED' AND tier IN ('L', 'XL') AND id <> ?"
                                + " AND (created_at < ? OR (created_at = ? AND id < ?)) LIMIT 1",
                        Integer.class, id, createdAt, createdAt, id)
                .isEmpty();
    }

    public List<JobRow> queuedLarge() {
        return jdbc.query(
                "SELECT * FROM job_executions WHERE status = 'QUEUED' AND tier IN ('L', 'XL') ORDER BY created_at ASC, id ASC", MAPPER);
    }

    public List<JobRow> running() {
        return jdbc.query("SELECT * FROM job_executions WHERE status = 'RUNNING' ORDER BY created_at ASC, id ASC", MAPPER);
    }

    public void insert(String id, String repo, String commitSha, String snapshotId, String accountId, String tier, String now) {
        jdbc.update(
                "INSERT INTO job_executions (id, repo, commit_sha, snapshot_id, account_id, tier, status, state, created_at, queued_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 'queued', ?, ?, ?)",
                id, repo, commitSha, snapshotId, accountId, tier, now, now, now);
    }

    /** QUEUED to RUNNING for the dispatch at this retier count; false when the row moved on meanwhile. */
    public boolean markRunning(String id, int retierCount, String executionRef, String now) {
        return jdbc.update(
                "UPDATE job_executions SET status = 'RUNNING', execution_ref = ?, started_at = ?, updated_at = ?"
                        + " WHERE id = ? AND status = 'QUEUED' AND retier_count = ?",
                executionRef, now, now, id, retierCount) > 0;
    }

    public void markWaiting(String id, String now) {
        jdbc.update(
                "UPDATE job_executions SET state = 'waiting-for-slot', updated_at = ? WHERE id = ? AND status = 'QUEUED' AND state <> 'waiting-for-slot'",
                now, id);
    }

    public void updateProgress(String id, String state, boolean replaceProgress, String stage, Integer completed, Integer total, String now) {
        if (replaceProgress) {
            jdbc.update(
                    "UPDATE job_executions SET state = ?, progress_stage = ?, progress_completed = ?, progress_total = ?, updated_at = ? WHERE id = ?",
                    state, stage, completed, total, now, id);
        } else {
            jdbc.update("UPDATE job_executions SET state = ?, updated_at = ? WHERE id = ?", state, now, id);
        }
    }

    /** Ends a job that is still in the expected status (and, when given, still has the expected execution). */
    public boolean end(String id, String expectedStatus, String expectedRef, String status, String state,
            String failureClass, String failureCode, String failureMessage, String now) {
        String sql = "UPDATE job_executions SET status = ?, state = ?, failure_class = ?, failure_code = ?, failure_message = ?,"
                + " ended_at = ?, updated_at = ? WHERE id = ? AND status = ?";
        if (expectedRef == null) {
            return jdbc.update(sql, status, state, failureClass, failureCode, failureMessage, now, now, id, expectedStatus) > 0;
        }
        return jdbc.update(sql + " AND execution_ref = ?", status, state, failureClass, failureCode, failureMessage, now, now, id,
                expectedStatus, expectedRef) > 0;
    }

    /** Sends a job back to the queue under a bigger tier. */
    public void requeueRetier(String id, String tier, int retierCount, String now) {
        jdbc.update(
                "UPDATE job_executions SET tier = ?, state = 'queued', status = 'QUEUED', queued_at = ?, retier_count = ?,"
                        + " execution_ref = NULL, started_at = NULL, progress_stage = NULL, progress_completed = NULL,"
                        + " progress_total = NULL, updated_at = ? WHERE id = ?",
                tier, now, retierCount, now, id);
    }

    /** The one restart: a new execution replaces the one that ended. */
    public boolean markRestarted(String id, String oldRef, String newRef, String now) {
        return jdbc.update(
                "UPDATE job_executions SET restarted = 1, execution_ref = ?, started_at = ?, updated_at = ?"
                        + " WHERE id = ? AND status = 'RUNNING' AND execution_ref = ?",
                newRef, now, now, id, oldRef) > 0;
    }

    /** Waiting L/XL jobs whose queued_at is before the cutoff. */
    public List<JobRow> queuedLargeBefore(String cutoff) {
        return jdbc.query(
                "SELECT * FROM job_executions WHERE status = 'QUEUED' AND tier IN ('L', 'XL') AND queued_at < ? ORDER BY created_at ASC, id ASC",
                MAPPER, cutoff);
    }
}
