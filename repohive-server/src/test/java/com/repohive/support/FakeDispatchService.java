package com.repohive.support;

import com.repohive.dispatch.DispatchService;
import com.repohive.model.ExecutionStatus;
import com.repohive.model.JobInput;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/** Records what was started and answers describe from a map. */
public class FakeDispatchService implements DispatchService {

    public record Started(JobInput input, String name) {}

    public final List<Started> started = new CopyOnWriteArrayList<>();
    public final Map<String, ExecutionStatus> statuses = new ConcurrentHashMap<>();
    public volatile boolean failStart;

    public void reset() {
        started.clear();
        statuses.clear();
        failStart = false;
    }

    @Override
    public String start(JobInput input, String executionName) {
        if (failStart) {
            throw new IllegalStateException("start refused");
        }
        started.add(new Started(input, executionName));
        return "ref:" + executionName;
    }

    @Override
    public ExecutionStatus describe(String executionRef) {
        return statuses.getOrDefault(executionRef, ExecutionStatus.RUNNING);
    }
}
