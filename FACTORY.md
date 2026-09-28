# CLEO DARK FACTORY: The Autonomous Mesh

## 1. Factory Architecture

CLEO is an autonomous, evidence-gated software factory operating within Band Desktop. It organizes software production into five specialized seats, establishing distinct lines of separation between orchestration, specification auditing, construction, adversarial quality assurance, and container release engineering.

### Seat Roster & Mandates

| Seat Handle | Role | Harness | Model |
|---|---|---|---|
| `@cleo-prime` | Executive Governance & Gater | OpenCode | `opencode/nemotron-3.5-lightning-free` |
| `@cleo-architect` | Contract & Invariant Auditor | OpenCode | `opencode/nemotron-3.5-lightning-free` |
| `@cleo-forge` | Core Node.js Engine Builder | OpenCode | `opencode/nemotron-3.5-lightning-free` |
| `@cleo-sentinel` | Adversarial Red-Team QA | OpenCode | `opencode/nemotron-3.5-lightning-free` |
| `@cleo-release` | SRE, Container & UI Architect | OpenCode | `opencode/nemotron-3.5-lightning-free` |

---

## 2. Design Choices & Technical Moats

### A. Pre-Emptive Spec Ledger Protocol (Anti-Hidden-Test Armor)
Rather than letting the coding agent guess or overlook requirements from prose, `@cleo-architect` systematically derives a machine-verifiable `CONTRACT_LEDGER` before code is committed. This covers all HTTP status codes, explicit timestamp offsets (RFC 3339), half-open interval collision semantics `[starts_at, starts_at + duration)`, and idempotency caching policies.

### B. Single-Threaded Atomic Mutex (Node.js Engine)
To physically prevent double bookings and concurrency race conditions under 50 simultaneous in-flight requests, `@cleo-forge` utilizes an in-memory transactional mutex pattern combined with synchronous event-loop boundaries. Overlapping intervals are rejected deterministically before state mutation occurs.

### C. Adversarial Invariant Probes
`@cleo-sentinel` executes private chaos probes in addition to shipped test harnesses:
- **50-Way Booking Race**: 50 concurrent requests competing for the exact same resource slot to verify that exactly 1 succeeds (201 Created) and 49 receive 409 Conflict.
- **Idempotency Replay**: Millisecond-level key replays verifying identical payload responses without database side effects.
- **Plain HTTP Origin Security**: Audits all browser client code to ensure zero dependency on HTTPS-only Web APIs (e.g. providing fallback for `crypto.randomUUID()`).

### D. Circuit Breaker & Hard-Stop Guardrail
- **Loop Breaker**: Three consecutive verification rejections on the same invariant trigger an escalation back to `@cleo-architect` to revise the structural design.
- **Hard-Stop**: Once `@cleo-release` certifies the container build and `@cleo-sentinel` confirms test clearance, `@cleo-prime` tags the git commit and halts all agent tool calls, guaranteeing zero runaway token consumption.

---

## 3. Failure Handling & Self-Healing Log

| Failure Mode | Detection Agent | Mitigating Agent | Self-Healing Mechanism |
|---|---|---|---|
| Race condition on overlapping time intervals | `@cleo-sentinel` (Concurrency probe) | `@cleo-forge` | Wraps state mutation in an in-memory queue/mutex, rejecting overlapping intervals atomically. |
| Incomplete error payload on off-grid slot | `@cleo-sentinel` (Fuzz probe) | `@cleo-forge` | Aligns validation middleware with `@cleo-architect` contract schema, returning HTTP 422 with proper error codes. |
| Container startup delay / offline network failure | `@cleo-release` (Docker probe) | `@cleo-forge` | Pre-packages all dependencies in the Alpine image layer; eliminates dynamic network resolution. |

---

## 4. Measured Time, Token & Model Spend

*Telemetry recorded during stage runs:*

| Stage | Turns / Messages | Input Tokens | Output Tokens | Total Elapsed Time | Model Spend ($) |
|---|---|---|---|---|---|
| Stage 1 | TBD | TBD | TBD | TBD | $0.00 (OpenCode Free) |
| Stage 2 | TBD | TBD | TBD | TBD | $0.00 (OpenCode Free) |
| Stage 3 | TBD | TBD | TBD | TBD | $0.00 (OpenCode Free) |
| Stage 4 | TBD | TBD | TBD | TBD | $0.00 (OpenCode Free) |

---

## 5. Architectural Limitations & Trade-offs
- **State Longevity**: Container state is ephemeral by design specification and resets upon container restart (`POST /_test/reset` handles seed lifecycle).
- **Scale Horizon**: Single-node in-memory concurrency model is tuned for ultra-low latency within the 2 vCPU / 2 GiB resource envelope, scaling past multi-node horizontal topologies via state export/import contracts.
