package com.repohive.service;

import com.repohive.model.PrecheckResult;

/** Runs the indexer's pre-check for a repository reference as typed by the user. */
public interface PrecheckRunner {

    /** A crash, a timeout or unreadable output is a {@link PrecheckFailedException}. */
    PrecheckResult run(String repoText);
}
