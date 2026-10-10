package com.repohive.repository;

import com.repohive.model.AccountRecord;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class AccountRepository {

    private static final RowMapper<AccountRecord> MAPPER = (rs, i) -> new AccountRecord(
            rs.getString("id"),
            rs.getString("email"),
            rs.getString("password_salt"),
            rs.getString("password_hash"),
            rs.getInt("scrypt_n"),
            rs.getInt("scrypt_r"),
            rs.getInt("scrypt_p"),
            rs.getString("created_at"),
            rs.getString("created_utc_day"),
            rs.getString("created_ip"));

    private final JdbcTemplate jdbc;

    public AccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public int countSignUpsFromIp(String ip, String utcDay) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM accounts WHERE created_ip = ? AND created_utc_day = ?", Integer.class, ip, utcDay);
        return count == null ? 0 : count;
    }

    /** Throws a DataAccessException when the email is already taken. */
    public void insert(AccountRecord a) {
        jdbc.update(
                "INSERT INTO accounts (id, email, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p,"
                        + " created_at, created_utc_day, created_ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                a.id(), a.email(), a.passwordSalt(), a.passwordHash(), a.scryptN(), a.scryptR(), a.scryptP(),
                a.createdAt(), a.createdUtcDay(), a.createdIp());
    }

    public Optional<AccountRecord> findByEmail(String email) {
        List<AccountRecord> rows = jdbc.query("SELECT * FROM accounts WHERE email = ?", MAPPER, email);
        return rows.stream().findFirst();
    }

    public Optional<String> findEmailById(String id) {
        return jdbc.queryForList("SELECT email FROM accounts WHERE id = ?", String.class, id).stream().findFirst();
    }
}
