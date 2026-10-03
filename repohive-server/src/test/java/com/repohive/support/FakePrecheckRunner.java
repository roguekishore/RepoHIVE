package com.repohive.support;

import com.repohive.model.PrecheckResult;
import com.repohive.service.PrecheckFailedException;
import java.util.function.Function;

/** A pre-check whose answer the test sets. */
public class FakePrecheckRunner implements com.repohive.service.PrecheckRunner {

    public volatile Function<String, PrecheckResult> answer;
    public volatile boolean crash;
    public volatile int calls;

    public void reset() {
        answer = null;
        crash = false;
        calls = 0;
    }

    @Override
    public PrecheckResult run(String repoText) {
        calls++;
        if (crash) {
            throw new PrecheckFailedException("boom");
        }
        return answer.apply(repoText);
    }
}
