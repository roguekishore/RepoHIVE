package com.repohive.service;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/** The owner and repository names GitHub allows (repo-name.ts). */
public final class RepoNames {

    private static final Pattern OWNER = Pattern.compile("^[A-Za-z0-9-]{1,39}$");
    private static final Pattern REPO = Pattern.compile("^[A-Za-z0-9._-]{1,100}$");

    private RepoNames() {}

    /** The lowercase repo key github.com/owner/repo, or empty for an invalid name. */
    public static Optional<String> repoKey(String owner, String repo) {
        if (owner == null || repo == null || !OWNER.matcher(owner).matches() || !REPO.matcher(repo).matches()
                || repo.equals(".") || repo.equals("..")) {
            return Optional.empty();
        }
        return Optional.of("github.com/" + owner.toLowerCase(Locale.ROOT) + "/" + repo.toLowerCase(Locale.ROOT));
    }
}
