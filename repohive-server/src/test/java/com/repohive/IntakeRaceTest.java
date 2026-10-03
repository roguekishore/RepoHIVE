package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doReturn;

import com.repohive.model.PrecheckResult;
import com.repohive.repository.JobRepository;
import com.repohive.support.Http;
import com.repohive.support.Seed;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** Two requests for the same repository that both pass the join check: the unique index decides. */
class IntakeRaceTest extends JobTestBase {

    @MockitoSpyBean JobRepository jobs;

    @Test
    void aUniqueIndexRaceBecomesJoinedWithTheWinnersIdAndNoCharge() throws Exception {
        String cookie = signUp();
        precheck.answer = text -> new PrecheckResult.Accepted(REPO, "c0ffee", "S", SNAPSHOT, 1, 1, false);
        String winner = Seed.job(jdbc, clock.instant(), Seed.account(jdbc), REPO, "S");
        int charges = jdbc.queryForObject("SELECT COUNT(*) FROM index_charges", Integer.class);

        // The join check sees nothing (the winner commits "after" it); every later look is real.
        doReturn(Optional.empty()).doCallRealMethod().when(jobs).findOpenJobId(REPO);

        Http.Resp response = http.post("/api/index", "{\"repo\":\"acme/widgets\"}", Http.freshIp(), cookie);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("{\"status\":\"joined\",\"jobId\":\"" + winner + "\"}");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM index_charges", Integer.class)).isEqualTo(charges);
        assertThat(dispatch.started).isEmpty();
    }
}
