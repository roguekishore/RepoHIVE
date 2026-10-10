package com.repohive.service;

import static com.repohive.service.AuthConstants.*;

import com.repohive.model.AccountRecord;
import com.repohive.model.ActiveSession;
import com.repohive.model.AuthOutcome;
import com.repohive.model.AuthRejectCode;
import com.repohive.model.SessionGrant;
import com.repohive.model.StoredPassword;
import com.repohive.repository.AccountRepository;
import com.repohive.repository.SessionRepository;
import com.repohive.repository.SignInFailureRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.Optional;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Account creation, sign-in with lockouts, sessions and sign-out (port of auth/accounts.ts). */
@Service
public class AccountService {

    private final AccountRepository accounts;
    private final SessionRepository sessions;
    private final SignInFailureRepository failures;
    private final PasswordHasher hasher;
    private final RuntimeLimits limits;
    private final Clock clock;
    private final TransactionTemplate tx;

    public AccountService(
            AccountRepository accounts,
            SessionRepository sessions,
            SignInFailureRepository failures,
            PasswordHasher hasher,
            RuntimeLimits limits,
            Clock clock,
            PlatformTransactionManager txManager) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.failures = failures;
        this.hasher = hasher;
        this.limits = limits;
        this.clock = clock;
        this.tx = new TransactionTemplate(txManager);
    }

    public AuthOutcome signUp(String ip, String rawEmail, String password) {
        String email = EmailRules.normalize(rawEmail);
        if (!EmailRules.isValidShape(email)) {
            return new AuthOutcome.Rejected(AuthRejectCode.INVALID_EMAIL, "Enter a valid email address.");
        }
        if (password.length() < PasswordHasher.PASSWORD_MIN_LENGTH || password.length() > PasswordHasher.PASSWORD_MAX_LENGTH) {
            return new AuthOutcome.Rejected(
                    AuthRejectCode.INVALID_PASSWORD,
                    "Password must be " + PasswordHasher.PASSWORD_MIN_LENGTH + " to " + PasswordHasher.PASSWORD_MAX_LENGTH + " characters.");
        }

        Instant now = clock.instant();
        String day = TimeFormat.utcDay(now);
        if (accounts.countSignUpsFromIp(ip, day) >= limits.current().signUpsPerIpPerDay()) {
            return new AuthOutcome.Rejected(AuthRejectCode.SIGNUP_IP_LIMIT, SIGN_UP_IP_LIMIT_MESSAGE);
        }

        StoredPassword stored = hasher.hash(password);
        String id = Ids.randomId();
        AccountRecord record = new AccountRecord(
                id, email,
                HexFormat.of().formatHex(stored.salt()), HexFormat.of().formatHex(stored.hash()),
                stored.scryptN(), stored.scryptR(), stored.scryptP(),
                TimeFormat.iso(now), day, ip);
        try {
            return tx.execute(status -> {
                accounts.insert(record);
                return new AuthOutcome.Granted(createSession(id, now));
            });
        } catch (DataAccessException e) {
            if (isUniqueViolation(e)) {
                return new AuthOutcome.Rejected(AuthRejectCode.EMAIL_TAKEN, "An account with this email already exists.");
            }
            throw e;
        }
    }

    private static boolean isUniqueViolation(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains("UNIQUE")) {
                return true;
            }
        }
        return false;
    }

    public AuthOutcome signIn(String ip, String rawEmail, String password) {
        String email = EmailRules.normalize(rawEmail);
        Optional<AccountRecord> account = accounts.findByEmail(email);
        String accountId = account.map(AccountRecord::id).orElse(null);

        if (isSignInLocked(accountId, ip)) {
            return new AuthOutcome.Rejected(AuthRejectCode.SIGNIN_LOCKED, SIGN_IN_LOCKED_MESSAGE);
        }

        if (account.isEmpty() || !hasher.verify(password, storedPassword(account.get()))) {
            failures.insert(Ids.randomId(), accountId, ip, TimeFormat.iso(clock.instant()));
            return new AuthOutcome.Rejected(AuthRejectCode.SIGNIN_REJECTED, SIGN_IN_GENERIC_MESSAGE);
        }
        return new AuthOutcome.Granted(createSession(accountId, clock.instant()));
    }

    /** Deletes the session when there is one. Always succeeds. */
    public void signOut(String sessionToken) {
        if (sessionToken != null) {
            sessions.delete(SessionTokens.hash(sessionToken));
        }
    }

    /** The signed-in account when the token is valid and unexpired; an expired session is deleted. */
    public Optional<ActiveSession> resolveSession(String sessionToken) {
        if (sessionToken == null) {
            return Optional.empty();
        }
        String tokenHash = SessionTokens.hash(sessionToken);
        Optional<SessionRepository.SessionRow> row = sessions.find(tokenHash);
        if (row.isEmpty()) {
            return Optional.empty();
        }
        if (row.get().expiresAt().compareTo(TimeFormat.iso(clock.instant())) <= 0) {
            sessions.delete(tokenHash);
            return Optional.empty();
        }
        return Optional.of(new ActiveSession(row.get().accountId(), row.get().email()));
    }

    private boolean isSignInLocked(String accountId, String ip) {
        String since = TimeFormat.iso(clock.instant().minus(SIGNIN_LOCKOUT_MINUTES, ChronoUnit.MINUTES));
        if (accountId != null && failures.countForAccountSince(accountId, since) >= SIGNIN_MAX_ACCOUNT_FAILURES) {
            return true;
        }
        return failures.countForIpSince(ip, since) >= SIGNIN_MAX_IP_FAILURES;
    }

    private SessionGrant createSession(String accountId, Instant now) {
        String token = SessionTokens.generate();
        Instant expiresAt = Instant.ofEpochMilli(now.toEpochMilli()).plus(SESSION_DAYS, ChronoUnit.DAYS);
        sessions.insert(SessionTokens.hash(token), accountId, TimeFormat.iso(expiresAt), TimeFormat.iso(now));
        return new SessionGrant(accountId, token, Instant.ofEpochMilli(expiresAt.toEpochMilli()));
    }

    private static StoredPassword storedPassword(AccountRecord a) {
        return new StoredPassword(
                HexFormat.of().parseHex(a.passwordSalt()),
                HexFormat.of().parseHex(a.passwordHash()),
                a.scryptN(), a.scryptR(), a.scryptP());
    }
}
