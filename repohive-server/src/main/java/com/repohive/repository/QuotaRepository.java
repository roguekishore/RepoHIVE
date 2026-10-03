package com.repohive.repository;

import java.util.List;
import java.util.OptionalInt;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class QuotaRepository {

    private final JdbcTemplate jdbc;

    public QuotaRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public OptionalInt precheckCount(String bucket) {
        List<Integer> rows = jdbc.queryForList("SELECT count FROM precheck_hourly WHERE bucket = ?", Integer.class, bucket);
        return rows.isEmpty() ? OptionalInt.empty() : OptionalInt.of(rows.get(0));
    }

    public void insertPrecheckBucket(String bucket) {
        jdbc.update("INSERT INTO precheck_hourly (bucket, count) VALUES (?, 1)", bucket);
    }

    public void incrementPrecheckBucket(String bucket) {
        jdbc.update("UPDATE precheck_hourly SET count = count + 1 WHERE bucket = ?", bucket);
    }

    public int countAccountCharges(String accountId, String utcDay) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM index_charges WHERE account_id = ? AND utc_day = ? AND refunded = 0",
                Integer.class, accountId, utcDay);
        return count == null ? 0 : count;
    }

    public int countIpCharges(String ip, String utcDay) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM index_charges WHERE ip = ? AND utc_day = ? AND refunded = 0",
                Integer.class, ip, utcDay);
        return count == null ? 0 : count;
    }

    /** An account has an index in flight when it owns a QUEUED or RUNNING job. */
    public boolean hasAccountInflight(String accountId) {
        return !jdbc.queryForList(
                        "SELECT 1 FROM job_executions WHERE account_id = ? AND status IN ('QUEUED', 'RUNNING') LIMIT 1",
                        Integer.class, accountId)
                .isEmpty();
    }

    public void insertCharge(String jobId, String accountId, String ip, String utcDay, String chargedAt) {
        jdbc.update(
                "INSERT INTO index_charges (job_id, account_id, ip, utc_day, charged_at, refunded) VALUES (?, ?, ?, ?, ?, 0)",
                jobId, accountId, ip, utcDay, chargedAt);
    }

    /** True when this call changed the row from not refunded to refunded. */
    public boolean markRefunded(String jobId) {
        return jdbc.update("UPDATE index_charges SET refunded = 1 WHERE job_id = ? AND refunded = 0", jobId) > 0;
    }

    public void deleteCharge(String jobId) {
        jdbc.update("DELETE FROM index_charges WHERE job_id = ?", jobId);
    }
}
