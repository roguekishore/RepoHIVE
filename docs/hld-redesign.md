# High-Level Design (HLD): RepoHIVE Architecture Redesign

**Document Status:** Proposed Target Architecture  
**Author:** Engineering Team  
**Scope:** Application Backend, Storage Layout, Edge Serving, and Orchestration Simplification  

---

## 1. Executive Summary & Motivation

RepoHIVE visualizes large-scale Java codebases through hierarchical dependency clustering (Louvain community detection, Newman modularity, and adaptive preserve-vs-reconstruct graph algorithms). While the core analysis engine and AST extraction pipeline are robust and deterministic, the surrounding application architecture accumulated significant accidental complexity.

### 1.1 Current State Challenges

1. **Hybrid Web Monolith Confusion:**
   The viewer application inside `packages/web` combines React UI components, server-side Next.js route handlers, an embedded SQLite database (`better-sqlite3`), scrypt-based session authentication, and background worker polling scripts (`run-worker.mjs`). This co-location violates traditional separation of concerns and creates confusion for engineers accustomed to standard Spring Boot / React architectures.

2. **Cryptic Storage & Leaked Infrastructure Plumbing:**
   Artifact storage in AWS S3 uses single-letter root prefixes:
   - `/s/{snapshotId}/views/...` for immutable snapshots (32-character SHA-256 hashes).
   - `/r/github.com/{owner}/{repo}/latest.json` for mutable pointer files storing the active snapshot ID.
   
   To support local development without S3, the Next.js application implements mock CDN proxy routes (`app/r/[...path]/route.ts` and `app/s/[...path]/route.ts`). Leaking S3 storage keys and CDN routing mechanics into the frontend layer creates unnecessary mental overhead.

3. **Two-Database Split & Distributed Locking Overhead:**
   RepoHIVE currently maintains two separate databases for disjoint purposes:
   - **SQLite:** Application database storing user accounts, passwords, sessions, and daily quotas.
   - **DynamoDB:** Used strictly as a cloud job ledger, distributed mutex (preventing duplicate concurrent indexing of the same repo), and a concurrency semaphore for Large/XL AWS Fargate tasks.
   
   This required deploying a dedicated control Lambda (`control.ts`), managing heartbeat lease timers, handling DynamoDB SDK serialization, and executing a 10-state AWS Step Functions state machine (`state-machine.asl.json`).

4. **Multi-File Version Skew Risks:**
   Serving mutable pointer files or `/latest` paths over edge CDNs introduces the risk of **version skew**: during edge cache invalidation windows, a client can load `knowledge-graph.json` from a new snapshot while loading `hierarchy.json` from an older snapshot still lingering at an edge location.

### 1.2 Target Redesign Objectives

- **Decoupled Architecture:** Clean physical separation between the client UI (React SPA) and backend application logic (Spring Boot 3.x REST API).
- **Core Engine Preservation:** Preserve the battle-tested, deterministic TypeScript pipeline (`@repohive/parser`, `@repohive/core`, `@repohive/engine`, `@repohive/indexer`) without regression.
- **Human-Readable Storage Hierarchy:** Organize S3 artifacts by GitHub repository coordinates: `repohive-artifacts/{owner}/{repo}/{snapshotId}/views/...`.
- **Production-Grade Edge Serving (Approach 2):** Immutable S3 snapshots with database-managed active pointers. Guarantees 0% version skew, $0.00 CloudFront invalidation costs, infinite edge caching, and sub-millisecond global rollbacks.
- **Zero DynamoDB:** Eliminate DynamoDB, the helper `control.ts` Lambda, and complex lease timers by utilizing native AWS SQS FIFO queues for Fargate task concurrency.
- **Single Source of Truth:** Centralize all application state, user quotas, and active repository snapshot IDs in a single relational database (SQLite/PostgreSQL) managed by Spring Boot.

---

## 2. High-Level Architecture

The redesigned system separates concerns into four distinct functional planes:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          1. CLIENT PLANE                               │
│  React SPA (Vite / Static Web Server)                                  │
│  • Canvas Zoom Engine      • Sigma.js Knowledge Graph                  │
│  • Sunburst Hierarchy      • Architecture & DSM Views                  │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
        1. Lightweight Metadata                      │ 2. Heavy Precomputed Views
           GET /api/repos/{owner}/{repo}             │    GET /artifacts/{owner}/{repo}/{id}/*
                    │                                │
                    ▼                                ▼
┌──────────────────────────────────────┐   ┌─────────────────────────────┐
│          2. CONTROL PLANE            │   │      3. ARTIFACT PLANE      │
│  Spring Boot 3.x (Port 8080)         │   │  AWS CloudFront + S3 Bucket │
│  • Spring Security (Auth & Sessions) │   │  • Edge Cache (1-year TTL)  │
│  • User Quota & Rate Limiting        │   │  • Immutable JSON Views     │
│  • Job Dispatcher (Lambda / SQS FIFO)│   │  • Origin Access Control    │
│  • SQLite / PostgreSQL Database      │   │  • Zero-Load on Web Server  │
└──────────────────┬───────────────────┘   └──────────────▲──────────────┘
                   │                                      │
                   │ Dispatch (Lambda or SQS)             │ Upload Views
                   ▼                                      │
┌─────────────────────────────────────────────────────────┴──────────────┐
│                          4. WORKER FLEET                               │
│  • Small / Medium Repos (≤1,500 files): AWS Lambda (10 GB RAM)         │
│  • Large / XL Repos (>1,500 files): AWS Fargate Container (32 GB RAM)  │
│  • Pipeline: Tree-Sitter AST → Louvain Cohesion → Views Precomputation │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Storage & CDN Architecture

### 3.1 S3 Bucket Structure

The cryptic single-letter roots (`/s/` and `/r/`) are removed in favor of a predictable, repository-centric hierarchy:

```
s3://repohive-artifacts/
└── {owner}/
    └── {repo}/
        └── {snapshotId}/
            ├── graph.json                      # Stitcher output (flat entity graph)
            ├── index/                          # Core 5 index files (Format v1)
            │   ├── repository.json             # Root metadata & summary counts
            │   ├── hierarchy.json              # Canonical ID array & tree positions
            │   ├── nodes.json                  # Compact attribute columns & strings
            │   ├── edges.json                  # Leaf dependencies & cross-group edges
            │   └── metadata.json               # Region modularity & decision audit
            └── views/                          # Precomputed view payloads (for UI)
                ├── knowledge-graph.json        # 2D graph with layout positions
                ├── hierarchy.json              # Zoom map & sunburst model
                ├── architecture.json           # Layered architectural abstraction
                ├── decision-audit.json         # Modularity decision trace
                ├── flat-baseline.json          # Unclustered comparison baseline
                └── adaptivity.json             # Modularity trade-off curves
```

### 3.2 Serving Strategy: Production-Grade Immutable Edge (Approach 2)

#### The Problem with Mutable CDN Pointers (`/latest/`)
When precomputed views consist of multiple linked JSON files, writing to a mutable `/latest/` path on S3 and triggering CloudFront cache invalidations introduces **Version Skew**:
- CloudFront invalidations take 10 to 30 seconds to propagate across all edge locations worldwide.
- A user loading a repository during that window might fetch `knowledge-graph.json` from the new snapshot (from an updated edge location) and `hierarchy.json` from an older snapshot (from an edge location that has not yet invalidated).
- Furthermore, wildcard invalidations at high frequency incur recurring AWS costs ($0.005 per path after the 1,000 free monthly paths).

#### The Immutable Solution (Gold Standard)
1. **S3 Immutability:** S3 stores only immutable, content-addressed snapshot directories (`/{snapshotId}/`). No `/latest/` directory is created in S3.
2. **Database Pointer:** The relational database stores the active snapshot ID in the `indexed_repositories` table (`snapshot_id = '4e960f11'`).
3. **Infinite Edge Cache:** Every artifact served by CloudFront carries permanent caching headers:
   ```http
   Cache-Control: public, max-age=31536000, immutable
   ```

#### Client Request Lifecycle
1. **Initial Page Load:** User navigates to `https://repohive.dev/repos/google/guava/knowledge-graph`.
2. **Metadata Lookup (Lightweight):**
   ```http
   GET /api/repos/google/guava HTTP/1.1
   Host: repohive.dev
   ```
   Spring Boot executes a primary-key index lookup in SQLite/PostgreSQL (<1 ms) and responds:
   ```json
   {
     "repo": "google/guava",
     "snapshotId": "4e960f11a2614b8c9d0123456789abcd",
     "commitSha": "7f8b9c2d1e0a",
     "nodeCount": 24500,
     "edgeCount": 68200,
     "indexedAt": "2026-10-02T14:32:00Z"
   }
   ```
3. **Heavy View Fetch (Edge Speed):**
   React extracts `snapshotId` and requests the visualization payload directly from CloudFront:
   ```http
   GET /artifacts/google/guava/4e960f11a2614b8c9d0123456789abcd/views/knowledge-graph.json HTTP/1.1
   Host: repohive.dev
   ```
   CloudFront serves the pre-compressed Brotli/JSON asset directly from edge cache. The application server is bypassed entirely.
4. **View Switching (0 Metadata Calls):**
   When the user switches tabs (e.g., from Knowledge Graph to Hierarchy Sunburst), React already holds the `snapshotId` in memory. It immediately fetches:
   ```http
   GET /artifacts/google/guava/4e960f11a2614b8c9d0123456789abcd/views/hierarchy.json HTTP/1.1
   ```
   This requires **only 1 network request** directly to CloudFront.

#### Benefits Summary
- **0% Version Skew:** All view files share the exact same snapshot path. Cross-file inconsistencies are mathematically impossible.
- **$0.00 Invalidation Cost:** Zero CloudFront cache invalidations are ever needed.
- **Instant Rollback:** Reverting to any prior index run requires a single database statement:
  ```sql
  UPDATE indexed_repositories SET snapshot_id = 'previous_hash' WHERE repo = 'google/guava';
  ```
  The entire platform switches globally in under 1 millisecond.

---

## 4. Backend Application Redesign: Spring Boot 3.x

The backend logic currently residing in `packages/web/src/server/` is refactored into a standalone Spring Boot 3.x application (`repohive-server`).

### 4.1 Project Structure

```
repohive-server/
├── pom.xml
└── src/
    ├── main/
    │   ├── java/com/repohive/
    │   │   ├── RepohiveApplication.java
    │   │   ├── config/
    │   │   │   ├── SecurityConfig.java         # Spring Security, cookies, CORS
    │   │   │   ├── AwsConfig.java              # S3, Lambda, SQS client beans
    │   │   │   ├── DatabaseConfig.java         # DataSource & HikariCP pool
    │   │   │   └── AppProperties.java          # Quota, rate limits, timeouts
    │   │   ├── controller/
    │   │   │   ├── AuthController.java         # /api/auth/**
    │   │   │   ├── IntakeController.java       # /api/index
    │   │   │   ├── RepoController.java         # /api/repos/**
    │   │   │   ├── JobController.java          # /api/jobs/** (with SseEmitter)
    │   │   │   ├── QuotaController.java        # /api/quota
    │   │   │   ├── InternalJobController.java  # /api/internal/jobs/** (webhooks)
    │   │   │   └── HealthController.java       # /healthz
    │   │   ├── service/
    │   │   │   ├── AuthService.java            # Account & session management
    │   │   │   ├── IntakeService.java          # GitHub HEAD check, repo validation
    │   │   │   ├── DispatchService.java        # Lambda invoke & SQS FIFO dispatch
    │   │   │   ├── QuotaService.java           # Quotas & IP rate limiter
    │   │   │   ├── JobReconciliationService.java # Worker monitoring & refunds
    │   │   │   └── BackupService.java          # Scheduled SQLite vacuum backups
    │   │   ├── model/
    │   │   │   ├── entity/                     # JPA / JDBC entities
    │   │   │   │   ├── AccountEntity.java
    │   │   │   │   ├── SessionEntity.java
    │   │   │   │   ├── IndexChargeEntity.java
    │   │   │   │   ├── IndexedRepoEntity.java
    │   │   │   │   └── JobExecutionEntity.java
    │   │   │   └── dto/                        # Request/Response records
    │   │   │       ├── AuthRequests.java
    │   │   │       ├── IndexRequest.java
    │   │   │       ├── RepoMetadataResponse.java
    │   │   │       └── JobStatusResponse.java
    │   │   └── repository/
    │   │       ├── AccountRepository.java
    │   │       ├── SessionRepository.java
    │   │       ├── IndexChargeRepository.java
    │   │       ├── IndexedRepoRepository.java
    │   │       └── JobExecutionRepository.java
    │   └── resources/
    │       ├── application.yml
    │       └── db/migration/                   # Flyway database migrations
    │           ├── V1__init_schema.sql
    │           └── V2__add_job_executions.sql
    └── test/
        └── java/com/repohive/
            ├── controller/
            ├── service/
            └── e2e/HostingParityTest.java
```

### 4.2 Database Schema (Unified Relational Store)

All application data is consolidated into a single relational database (SQLite for lightweight single-node deployments; PostgreSQL for multi-node):

```sql
-- Accounts
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    daily_quota INTEGER NOT NULL DEFAULT 3
);

-- Sessions
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

-- Daily Quota Charges
CREATE TABLE index_charges (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    repo TEXT NOT NULL,
    charged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    refunded BOOLEAN NOT NULL DEFAULT FALSE,
    refund_reason TEXT
);
CREATE INDEX idx_index_charges_account_date ON index_charges(account_id, charged_at);

-- Indexed Repositories (Active Pointers)
CREATE TABLE indexed_repositories (
    repo TEXT PRIMARY KEY,                       -- e.g. "google/guava"
    snapshot_id TEXT NOT NULL,                   -- e.g. "4e960f11a261..."
    commit_sha TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    indexed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Job Executions (Replaces DynamoDB JobLedger)
CREATE TABLE job_executions (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    tier TEXT NOT NULL CHECK(tier IN ('LAMBDA', 'FARGATE')),
    status TEXT NOT NULL CHECK(status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    progress_percentage INTEGER NOT NULL DEFAULT 0,
    current_phase TEXT,                          -- 'DOWNLOADING', 'PARSING', 'CLUSTERING', 'SERIALIZING'
    error_message TEXT,
    snapshot_id TEXT,
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_job_executions_repo_status ON job_executions(repo, status);
```

### 4.3 Authentication & Security Implementation

1. **Password Hashing (SCrypt Parity):**
   Matches Node's `crypto.scrypt` configuration using BouncyCastle / Spring Security:
   - Cost factor ($N$): $16384$ ($2^{14}$)
   - Block size ($r$): $8$
   - Parallelization ($p$): $1$
   - Key length: $64$ bytes
2. **Session Cookies:**
   - Name: `repohive_session`
   - Attributes: `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`
   - Expiration: Rolling 7-day expiration.
3. **Lockout Protection:**
   - 5 consecutive invalid login attempts for an email within 15 minutes locks the account temporarily for 15 minutes.
   - IP-level brute-force rate limiter: Max 20 auth attempts per IP per 10 minutes.

### 4.4 REST API Specifications

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/api/auth/sign-up` | Create account & set session cookie | No |
| `POST` | `/api/auth/sign-in` | Authenticate & set session cookie | No |
| `GET`  | `/api/auth/session` | Get current authenticated user details | Yes |
| `POST` | `/api/auth/sign-out` | Revoke session & clear cookie | Yes |
| `GET`  | `/api/quota` | Get today's used, remaining, and limit quota | Yes |
| `POST` | `/api/index` | Submit a GitHub repository for indexing | Yes |
| `GET`  | `/api/repos/{owner}/{repo}` | Get active snapshot ID & metadata | No |
| `GET`  | `/api/jobs/{jobId}` | Get job execution status | Yes |
| `GET`  | `/api/jobs/{jobId}/events` | Server-Sent Events (SSE) job progress stream | Yes |
| `POST` | `/api/internal/jobs/complete` | Webhook called by worker when indexing completes | Secret Token |
| `GET`  | `/healthz` | System liveness probe & DB connection health | No |

---

## 5. Orchestration & Concurrency: Eliminating DynamoDB

### 5.1 Why DynamoDB is Eliminated
In the existing implementation, DynamoDB handled:
1. Job deduplication (preventing concurrent indexing of the same repo).
2. Large/XL Fargate concurrency limiting (enforcing max 1 Fargate container at a time).
3. State persistence between the Step Function and the web box.

This added significant maintenance overhead: AWS SDK DynamoDB dependencies, lock lease timers, state machine polling, and the `control.ts` helper Lambda.

### 5.2 SQS FIFO Concurrency Architecture

We replace DynamoDB and the Step Function concurrency slot lock with an **AWS SQS FIFO Queue**:

```
                  ┌──────────────────────────────────────────────┐
                  │          USER SUBMITS REPO (/api/index)      │
                  └──────────────────────┬───────────────────────┘
                                         │
                         Check file count / repo size
                                         │
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
           Small / Medium (≤1,500 files)            Large / XL (>1,500 files)
                     │                                       │
                     ▼                                       ▼
         Direct Lambda Invocation                 Push to AWS SQS FIFO
         Type: Event (Asynchronous)               Queue: repohive-jobs.fifo
                     │                            MessageGroupId: "fargate-worker"
                     │                                       │
                     │                                       ▼
                     │                            Fargate Worker Container
                     │                            • Polls SQS (MaxConcurrency: 1)
                     │                            • Processes job strictly 1-at-a-time
                     │                            • Deletes message upon success
                     │                                       │
                     └───────────────────┬───────────────────┘
                                         ▼
                           Worker Uploads to S3:
                           repohive-artifacts/{owner}/{repo}/{snapshotId}/...
                                         │
                                         ▼
                           Notify Server Webhook:
                           POST /api/internal/jobs/complete
                           (Updates SQLite & marks SUCCEEDED)
```

#### Why SQS FIFO Guarantees Zero Distributed Lock Code
- **Native Message Deduplication:** `MessageDeduplicationId = "{owner}_{repo}_{commitSha}"`. If a user clicks index twice, SQS automatically ignores the duplicate.
- **Strict 1-at-a-Time Execution:** By assigning `MessageGroupId = "fargate-worker"`, AWS SQS guarantees that messages in that group are delivered strictly in order and **only one consumer receives a message at any given moment**.
- Next jobs stay safely queued in SQS until the running Fargate container completes and acknowledges the message.
- Zero database locks. Zero lease timers. Zero custom control Lambdas.

---

## 6. Frontend Integration & Local Development

### 6.1 Decoupled React Frontend (Pure SPA)

The frontend is converted into a standard React SPA:
- **Build Output:** Static HTML, JavaScript, and CSS bundle (built with Vite or static Next.js export).
- **Hosting:** Served by Caddy, Nginx, or CloudFront.
- **API Routing:** All `/api/**` calls proxy to Spring Boot on port 8080.
- **View Data Routing:** All `/artifacts/**` calls route directly to CloudFront/S3.

### 6.2 Eliminating Local Mock Routes (`app/r/` and `app/s/`)

Previously, `packages/web/src/app/r/[...path]/route.ts` and `app/s/[...path]/route.ts` acted as fake CDNs in local mode.
In the redesigned architecture:
1. **Local Mode (`npm run dev`):**
   - The local indexing worker outputs artifacts to:
     `.repohive-local/artifacts/{owner}/{repo}/{snapshotId}/...`
   - Caddy (or Vite's built-in dev proxy) maps `/artifacts/*` directly to that local folder using static file serving:
     ```caddyfile
     # Local Caddyfile
     repohive.localhost {
         handle /api/* {
             reverse_proxy localhost:8080
         }
         handle /artifacts/* {
             uri strip_prefix /artifacts
             root * .repohive-local/artifacts
             file_server
         }
         handle {
             reverse_proxy localhost:3000
         }
     }
     ```
2. **Production Mode (AWS):**
   - CloudFront handles `/artifacts/*` directly to S3 via Origin Access Control (OAC).
   - Neither Next.js nor Spring Boot ever touches view requests.

---

## 7. Migration & Parity Verification Plan

To ensure a flawless transition with zero downtime and verified behavioral equivalence, implementation follows a 5-step phased rollout:

### Phase 1: Spring Boot Server Scaffold & Parity Testing
- Initialize Spring Boot 3.x project with Flyway migrations.
- Implement `/api/auth/**`, `/api/quota`, and `/api/repos/{owner}/{repo}`.
- Run the existing integration test suite (`packages/web/scripts/hosting-3-e2e.mjs`) against the Spring Boot port (8080) to verify 100% API compatibility.

### Phase 2: S3 Path Refactoring in Worker Fleet
- Update `packages/indexer/src/run-job.ts` to write artifacts to:
  `{owner}/{repo}/{snapshotId}/...` instead of `s/{snapshotId}/...`.
- Remove emission of `r/{owner}/{repo}/latest.json`.
- Retain exact JSON minification and Index Format v1 specifications.

### Phase 3: CloudFront Distribution Update
- Update Terraform (`deploy/terraform/main/cloudfront.tf`):
  - Path pattern: `/artifacts/*` -> Origin: S3 Artifacts Bucket.
  - Forward headers: Clean origin request policy with OAC.
  - Cache policy: `Managed-CachingOptimized` (1-year TTL, Brotli/Gzip enabled).

### Phase 4: SQS FIFO Integration & DynamoDB Decommissioning
- Provision SQS FIFO queue `repohive-jobs.fifo` in Terraform.
- Configure Fargate task definition to consume from SQS.
- Decommission DynamoDB table `repohive-ledger-*`, `control.ts` Lambda, and Step Functions ASL definitions.

### Phase 5: Frontend Migration & Cleanup
- Update React view fetch hooks in `packages/web` to use `/artifacts/{owner}/{repo}/{snapshotId}/views/...`.
- Delete `app/r/` and `app/s/` mock routes.
- Remove dead CSS tokens and zombie fields from `ZoomNode`.
- Perform end-to-end browser verification across all 6 view screens using the Broadleaf Commerce fixture.

---

## 8. Architectural Comparison Matrix

| Dimension | Current Architecture | Redesigned Architecture |
|---|---|---|
| **Backend Framework** | Next.js App Router (hybrid Node.js) | Spring Boot 3.x (Java 21) |
| **Frontend Framework** | Next.js React 19 (tightly coupled) | Decoupled React 19 SPA |
| **Relational Database** | `better-sqlite3` embedded in web app | SQLite / PostgreSQL via Spring Data JPA |
| **Job Ledger / State** | AWS DynamoDB (distributed lock table) | Unified Relational DB (`job_executions`) |
| **Total Databases** | 2 (SQLite + DynamoDB) | 1 (Single relational database) |
| **S3 Storage Paths** | Cryptic `/s/{hash}/` and `/r/.../latest.json` | Clean `/{owner}/{repo}/{snapshotId}/` |
| **Latest Pointer Strategy** | Mutable file in S3 (`latest.json`) | Indexed DB column (`snapshot_id`) |
| **Edge Version Skew Risk** | Present during CDN invalidation windows | 0% (Mathematically impossible) |
| **CloudFront Invalidation Cost** | $0.005/path after 1,000 runs/month | $0.00 (Zero invalidations required) |
| **Rollback Capability** | Re-upload files to S3 /latest/ | Instant (1 SQL statement in DB) |
| **Fargate Concurrency Lock** | Custom DynamoDB leases & helper Lambda | Native AWS SQS FIFO (`MessageGroupId`) |
| **Local Dev Mock Routes** | `app/r/` and `app/s/` inside Next.js | Standard static file proxy (Caddy / Vite) |
| **Orchestration Complexity** | 10-state ASL Step Function + Lambda | SQS FIFO + Direct Worker Webhook |
