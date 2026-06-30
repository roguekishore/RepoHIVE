# Research Log — RepoHIVE

> **Purpose:** capture ideas, decisions, experiments, and findings **in your own words**, dated, as
> they happen. The 8th-sem paper is written FROM this log — so the paper is original by construction
> (0% plagiarism). Never paste text from sources here; paraphrase and cite. Track every reference.

## How to use

- Add a dated entry whenever you decide something, learn something, or run an experiment.
- Write in your own words. If you reference a paper/tool, note the citation, not its text.
- Experiments: record setup, what you measured, the actual numbers, and your interpretation.

---

## 2026-06-22 — Project framing and decisions

- Defined the core contribution as **adaptive, per-region hierarchy construction** (preserve vs
  reconstruct by structural quality), distinct from single-global clustering.
- Researched Graphify (prior art, ~63K stars): single global Leiden clustering, no embeddings.
  Confirms structural-first is a sound, defensible basis. It becomes our evaluation baseline.
- Established two separate claims to test: (A) hierarchy beats flat for navigation/retrieval;
  (B) adaptive beats single-global on mixed-quality repos. (B) is a hypothesis to prove.
- Decided embeddings are a future semantic layer (search/naming), never for grouping.

## Reference papers (cite all; from existing spec literature survey)

1. Feng et al. (2020) — CodeBERT — EMNLP Findings
2. Guo et al. (2021) — GraphCodeBERT — ICLR
3. Zhang et al. (2023) — RepoCoder — EMNLP
4. Liu et al. (2023) — Lost in the Middle — TACL
5. Newman (2006) — Modularity and Community Structure in Networks — PNAS
6. Blondel et al. (2008) — Louvain — J. Stat. Mech.
7. Traag et al. (2019) — Leiden — Scientific Reports
8. Allamanis et al. (2018) — Learning to Represent Programs with Graphs — ICLR
9. Sun et al. (2024) — Survey of LLMs for Code Generation — arXiv / ACM CSUR
10. Lin et al. (2024) — RepoGraph — arXiv
