package com.repohive.controller;

import com.repohive.model.ActiveSession;
import com.repohive.model.RemainingQuota;
import com.repohive.service.AccountService;
import com.repohive.service.ClientIpResolver;
import com.repohive.service.QuotaService;
import com.repohive.service.SessionCookies;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class QuotaController {

    record QuotaBody(int remainingAccount, int remainingIp, int limitAccount, int limitIp) {}

    private final AccountService accounts;
    private final QuotaService quota;
    private final SessionCookies cookies;
    private final ClientIpResolver clientIp;

    public QuotaController(AccountService accounts, QuotaService quota, SessionCookies cookies, ClientIpResolver clientIp) {
        this.accounts = accounts;
        this.quota = quota;
        this.cookies = cookies;
        this.clientIp = clientIp;
    }

    @GetMapping("/api/quota")
    public void quota(HttpServletRequest request, HttpServletResponse response) {
        Optional<ActiveSession> session = accounts.resolveSession(cookies.parse(request));
        if (session.isEmpty()) {
            JsonResponses.error(response, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Sign in to view quota.");
            return;
        }
        RemainingQuota remaining = quota.remaining(session.get().accountId(), clientIp.resolve(request));
        JsonResponses.json(
                response,
                HttpStatus.OK,
                new QuotaBody(remaining.accountRemaining(), remaining.ipRemaining(), remaining.accountLimit(), remaining.ipLimit()));
    }
}
