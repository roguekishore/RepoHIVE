package com.repohive.support;

import com.repohive.dispatch.DispatchService;
import com.repohive.service.PrecheckRunner;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Replaces the process-spawning beans with fakes the test can steer. */
@TestConfiguration(proxyBeanMethods = false)
public class TestJobBeans {

    @Bean
    @Primary
    FakeDispatchService fakeDispatch() {
        return new FakeDispatchService();
    }

    @Bean
    @Primary
    FakePrecheckRunner fakePrecheck() {
        return new FakePrecheckRunner();
    }
}
