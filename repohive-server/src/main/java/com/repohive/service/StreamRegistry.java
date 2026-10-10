package com.repohive.service;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/** At most five open progress streams per client address. */
@Component
public class StreamRegistry {

    public static final int MAX_PER_IP = 5;

    private final Map<String, Set<String>> openByIp = new HashMap<>();

    public synchronized boolean tryRegister(String ip, String streamId) {
        Set<String> set = openByIp.computeIfAbsent(ip, k -> new HashSet<>());
        if (set.size() >= MAX_PER_IP && !set.contains(streamId)) {
            return false;
        }
        set.add(streamId);
        return true;
    }

    public synchronized void unregister(String ip, String streamId) {
        Set<String> set = openByIp.get(ip);
        if (set == null) {
            return;
        }
        set.remove(streamId);
        if (set.isEmpty()) {
            openByIp.remove(ip);
        }
    }

    public synchronized int open(String ip) {
        Set<String> set = openByIp.get(ip);
        return set == null ? 0 : set.size();
    }
}
