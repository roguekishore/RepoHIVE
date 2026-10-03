package com.repohive.controller;

import com.repohive.model.IndexedRepo;
import com.repohive.repository.IndexedRepoRepository;
import com.repohive.service.RepoNames;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Indexed repositories: one by name, and the paged list. */
@RestController
public class RepoController {

    static final int PAGE_SIZE = 50;

    record RepoBody(String repo, String snapshotId, String commitSha, int nodeCount, int edgeCount, String indexedAt) {}

    record ListedRepo(String repoKey, String repoId, String snapshotId, String commitSha, String indexedAt, int nodeCount) {}

    record ListBody(List<ListedRepo> items, int page, int totalPages, int total) {}

    private final IndexedRepoRepository repos;

    public RepoController(IndexedRepoRepository repos) {
        this.repos = repos;
    }

    @GetMapping("/api/repos/{owner}/{repo:.+}")
    public void one(@PathVariable String owner, @PathVariable String repo, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        Optional<IndexedRepo> found = RepoNames.repoKey(owner, repo).flatMap(repos::find);
        if (found.isEmpty()) {
            JsonResponses.error(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "This repository has not been indexed.");
            return;
        }
        IndexedRepo r = found.get();
        JsonResponses.json(response, HttpStatus.OK,
                new RepoBody(r.repoId(), r.snapshotId(), r.commitSha(), r.nodeCount(), r.edgeCount(), r.indexedAt()));
    }

    @GetMapping("/api/repos")
    public void list(@RequestParam(name = "page", required = false) String pageText, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        int total = repos.count();
        int totalPages = total == 0 ? 1 : (total + PAGE_SIZE - 1) / PAGE_SIZE;
        int page = Math.min(parsePage(pageText), totalPages);
        List<ListedRepo> items = repos.page(PAGE_SIZE, (page - 1) * PAGE_SIZE).stream()
                .map(r -> new ListedRepo(r.repo(), r.repoId(), r.snapshotId(), r.commitSha(), r.indexedAt(), r.nodeCount()))
                .toList();
        JsonResponses.json(response, HttpStatus.OK, new ListBody(items, page, totalPages, total));
    }

    /** Non-numeric or below 1 is 1; fractions round down. */
    static int parsePage(String text) {
        if (text == null) {
            return 1;
        }
        double value;
        try {
            value = Double.parseDouble(text.strip());
        } catch (NumberFormatException e) {
            return 1;
        }
        if (Double.isNaN(value) || Double.isInfinite(value) || value < 1) {
            return 1;
        }
        return value >= Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) Math.floor(value);
    }
}
