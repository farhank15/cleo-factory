# Tablekeeper Factory Plan

## Overview
Build a restaurant reservation system across four stages, each a complete Dockerized
HTTP service that passes all prior stage suites plus its own.

## Architecture Principles

### Concurrency Model
- **Node.js single-threaded event loop**: all request handlers run synchronously
  (no `await` in handler bodies) so the event loop cannot interleave check-then-act
  sequences within a single request.
- **`better-sqlite3` is avoided** to eliminate native-compilation risk in Docker;
  in-memory JS objects provide equivalent atomicity under synchronous handlers.
- **Zero external runtime dependencies**: only `express` is vendored; password
  hashing uses Node's built-in `crypto.scryptSync`; timezone uses `Intl.DateTimeFormat`.

### Key Invariants (Stage 1)
1. **No double-booking**: overlapping confirmed reservations on the same table return 409.
2. **Idempotency**: POST /reservations and POST /reservation-moves use client-supplied keys;
   first use returns 201, replay returns 200 with identical body, different body returns 409.
3. **Atomic moves**: POST /reservation-moves commits all or nothing.
4. **DST-correct**: spring-forward gaps are rejected; fall-back resolves to first occurrence.
5. **Export/import**: atomic state snapshot and restore with opaque format.

## Stage Deliverables

| Stage | Focus | Tests |
|-------|-------|-------|
| 1 | JSON API: auth, restaurants, availability, reservations, moves, export/import | 1,2 |
| 2 | Browser UI + combined tables + stale/lost response recovery | 1,2,3(overshoot) |
| 3 | Policies (effective-dated), reservation history, recurring series | 1,2,3,4(overshoot) |
| 4 | Closure replanning, series amendments | 1,2,3,4 |

## Room Plan

```arch
{
  "kind": "layered",
  "title": "Tablekeeper Factory Plan",
  "layers": [
    {
      "id": "contract",
      "title": "Contract & Invariants",
      "items": [
        { "id": "ledger", "label": "Stage 1-4 contract ledgers" },
        { "id": "invariants", "label": "Atomic, idempotent, DST-correct" }
      ]
    },
    {
      "id": "factory",
      "title": "Factory",
      "items": [
        { "id": "architect", "label": "cleo-architect: contract & design" },
        { "id": "forge", "label": "cleo-forge: implement service" },
        { "id": "sentinel", "label": "cleo-sentinel: adversarial QA" },
        { "id": "release", "label": "cleo-release: Docker & deployment" },
        { "id": "prime", "label": "cleo-prime: orchestration" }
      ]
    },
    {
      "id": "stages",
      "title": "Stage Folders",
      "items": [
        { "id": "stage1", "label": "stage-1/ (Docker, RUN.md, source)" },
        { "id": "stage2", "label": "stage-2/ (carried forward + UI)" },
        { "id": "stage3", "label": "stage-3/ (policies, history, series)" },
        { "id": "stage4", "label": "stage-4/ (replans, series amendments)" }
      ]
    },
    {
      "id": "grading",
      "title": "Grading",
      "items": [
        { "id": "harness", "label": "harness run --track tablekeeper --repo" },
        { "id": "gate3", "label": "Gate 3: stage-1 builds & serves /health" }
      ]
    }
  ],
  "flows": [
    { "from": "contract", "to": "factory", "label": "ledger → implement" },
    { "from": "factory", "to": "stages", "label": "build each stage" },
    { "from": "stages", "to": "grading", "label": "harness test" }
  ]
}
```

## Build Process per Stage
1. Architect derives CONTRACT_LEDGER from spec + test suite
2. Forge implements service in `stage-N/`
3. Release certifies Dockerfile + RUN.md
4. Sentinel runs adversarial stress tests
5. All pass before promoting to next stage

## Active
- **Stage 1**: contract ledger derivation and baseline service implementation
