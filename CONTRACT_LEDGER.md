# CONTRACT_LEDGER — Tablekeeper Stage 1

The authoritative, machine-verifiable contract for `stage-1/`. It is the single test
oracle: `@cleo-forge` implements to it, `@cleo-sentinel` tests against it. Derived by
`@cleo-architect` from `tablekeeper/spec/stage-1.md` + the `test/stage_1/*` suite (which
may assert *weaker* wording than this ledger; this ledger is stricter where the prose is
explicit). "Must" = required; "may" = allowed.

## 0. Scope snapshot
A single-container, zero-dependency-in-at-runtime Node.js HTTP service. State is in-memory
and is replaced atomically only by `POST /_test/reset` / `POST /_test/import`. The service
never makes an outbound network call at run time.

## L1 — Networking & process
| Item | Required |
|---|---|
| Listen | `0.0.0.0` |
| Port | `PORT` env, default `8080` (integer) |
| First healthy (`/health` 200) | ≤ 60 s after `docker run` |
| Concurrency | ≥ 50 in flight, **no 5xx ever** (incl. under the 50-way `burst` barrier) |
| Per-request timeout | ≤ 5 s, except `POST /_test/reset` ≤ 10 s |
| Resources | ≤ 2 vCPU, ≤ 2 GiB |
| Runtime outbound network | **forbidden** (all deps/assets self-contained) |
| Request/response | `application/json; charset=utf-8` |
| Body limit | reject `Content-Length`/bodies > 10 MiB → `400 malformed_request` |

## L2 — Conventions
- Unknown request fields: **ignored**. Unknown query params: **ignored**.
- IDs (user_id, restaurant_id, table_id, reservation_id, reference, Idempotency-Key): opaque
  strings ≤ 64 chars (references 6–12 `[A-Z0-9]`). Length/ID-format violations on fixture
  IDs → `422 validation_failed`.
- Timestamps in **responses** are RFC 3339 with an **explicit** offset `±HH:MM` (e.g.
  `2026-09-24T19:00:00+02:00`); seconds always present; **no fractional seconds**. Bare `Z`
  is tolerated by some tests but the ledger requires an explicit offset.
- `starts_at_local` is a **bare** local wall time `YYYY-MM-DDTHH:MM` (no offset, no seconds,
  no `Z`, no `T..Z` forms). Any other shape → `422 validation_failed`.
- Every 4xx/5xx body: `{"error":{"code":"<code>","message":"<any wording>"}}`. `message`
  wording is unconstrained; only `status` + `error.code` are asserted. `204` has no body.
- Two `confirmed` reservations on the **same table** with intervals intersect in the
  half-open sense `[a.start, a.end) ∩ [b.start, b.end) ≠ ∅` cannot both exist. A 90-min
  booking at 19:00 occupies `[19:00, 20:30)` and does **not** conflict a booking starting at
  20:30. Cancelled reservations are **not** considered occupied.

## L3 — Error code table (status + code)
| Status | `code` | When (stage 1) |
|---|---|---|
| 400 | `malformed_request` | Body unparseable, or a field of the wrong JSON type (incl. wrong type on a required field), or body > 10 MiB |
| 400 | `missing_idempotency_key` | `Idempotency-Key` absent or empty |
| 401 | `unauthenticated` | Missing/malformed/unknown `Authorization: Bearer <token>`; no token on a write endpoint |
| 403 | `forbidden` | Reserved (not raised by stage 1) |
| 404 | `not_found` | Unknown resource, or a resource not visible to the caller (incl. another diner's reservation — leaks nothing) |
| 409 | `idempotency_key_reuse` | Same key by same user, **different** body |
| 409 | `email_taken` | Signup email already registered |
| 409 | `table_unavailable` | Overlapping confirmed booking on that table (incl. within a move batch) |
| 409 | `cutoff_passed` | Cancel/amend now, or ≥ `cancellation_cutoff_minutes` before `starts_at` (a past start counts as "later") |
| 409 | `reservation_cancelled` | Amendment/move on a cancelled booking |
| 422 | `validation_failed` | Missing field/param, or a rule violation with no more specific code (incl. `party_size<1`/non-integer/wrong type, bad `starts_at_local` shape, impossible date, `Idempotency-Key` length >255, bad query integer format) |
| 422 | `not_on_slot_grid` | `starts_at_local` not on the `slot_minutes` grid from `opens` |
| 422 | `outside_opening_hours` | Start before `opens`, end after `closes`, or slot falls on a closed day |
| 422 | `invalid_local_time` | `starts_at_local` lands in a spring-forward gap |
| 422 | `party_exceeds_capacity` | `party_size` > the table's `capacity` |
| 500 | `internal_error` | Defensive last resort only; **must never occur** for any input or any load |

Field-level precedence (must match test order):
1. Wrong JSON type / unparseable → `400 malformed_request` (before resource lookup).
2. Unknown restaurant / table / table-of-another-restaurant → `404 not_found`.
3. `party_size` wrong type/non-integer/<1 → `422 validation_failed`; party > capacity → `422 party_exceeds_capacity`.
4. `starts_at_local` shape → `422 validation_failed`; impossible date (`2026-02-30`) → `422 validation_failed`; spring-forward gap → `422 invalid_local_time`; off-grid → `422 not_on_slot_grid`; outside hours → `422 outside_opening_hours`.
5. Overlap → `409 table_unavailable`.

## L4 — Authentication (§6)
- Public (no bearer): `GET /health`, `POST /_test/reset`, `GET /_test/export`, `POST /_test/import`, `POST /auth/signup`, `POST /auth/login`, `GET /restaurants`, `GET /restaurants/{id}`, `GET /availability`. All other endpoints require `Authorization: Bearer <token>`.
- `POST /auth/signup` → `201 {user_id, display_name, token}`. Rules: email exists → `409 email_taken`; password<8 → `422 validation_failed`; email not `local@domain` → `422 validation_failed`; non-string field → `400 malformed_request`.
- `POST /auth/login` → `200 {user_id, display_name, token}`. Wrong password or unknown email → `401 unauthenticated`.
- Missing/malformed/unknown token → `401 unauthenticated`. Authenticated but touching another's resource → `404 not_found` (never `403`).
- Passwords: scrypt (built-in `crypto`), salted, verified with `timingSafeEqual`. Stored form `scrypt$N$r$p$<saltHex>$<hashHex>`. Plaintext forbidden.
- Tokens: 32 random bytes hex, non-expiring, multiple valid per user/concurrent sessions.

## L5 — Idempotency (§7), state machine
Applies to `POST /reservations` and `POST /reservation-moves` (and is scoped to each).

Resolution order: authenticate → key present & ≤255 chars → parse body → idempotent lookup →
field/resource validation → mutation. A **successful** (2xx) receipt is stored forever and
replayed verbatim; a **failed** (4xx) request stores nothing, so the key is reusable.

| State (per user+path+key) | Trigger | Result |
|---|---|---|
| absent | first use, valid | `201`, store `{bodySig, status:201, response}` |
| absent | first use, invalid body | 4xx (no receipt stored) |
| present, `bodySig` equal | replay | `200`, original `response` verbatim (no state change), even if resource later amended/cancelled |
| present, `bodySig` differs | reuse w/ different body | `409 idempotency_key_reuse` (even if new body would be invalid) |
| absent/empty key | — | `400 missing_idempotency_key` |
| key length > 255 | — | `422 validation_failed` |

- "Same body" = same JSON value after parse; key order and whitespace do **not** matter (canonical/sorted-key comparison).
- Key is part of the (user, path, key) tuple — the same key string on a different path is a **different** request and must succeed normally.
- Concurrent identical first-use requests (50-way barrier, same key+same body) → exactly one `201`, the rest `200` with the identical body; the operation takes effect **once**. (Achieved by single-threaded event loop + a synchronous, `await`-free critical section.)
- `PATCH /reservations/{reference}` has **no** idempotency key.
- Replay receipts survive export/import and must keep working after a reset+import-restore.

## L6 — Endpoints (§8, §10, §11)
### Health
`GET /health` (public) → `200 {"status":"ok"}`.

### Fixture & test control
- `POST /_test/reset` (public, 10s) — body = fixture §4; atomically **replaces all state**; `204 No Content`. Invalid fixture → `422 validation_failed`; malformed JSON → `400 malformed_request`. On `204`, the next request sees only the fixture (reset is synchronous).
- `GET /_test/export` (public) → `200 {"track":"tablekeeper","format_version":1,"state":{opaque}}`. Atomic read-only snapshot: users (+`password_hash`), tokens, restaurants (fixture shape), reservations (+computed `starts_at`/`ends_at`/`created_at`), `used_references`, and idempotency receipts (`key`,`body`,`status`,`response`). Opaque to caller; round-trips through import.
- `POST /_test/import` (public) — full export object; atomically **replaces** state; `204`. Invalid JSON → `400`; missing/wrong `track`/`format_version`/`state` or invalid state → `422 validation_failed` **without changing destination**. Accepts this service's own export unchanged. `POST /_test/reset` clears imported state too.

### Restaurants
- `GET /restaurants` (public) → `200 {"restaurants":[{"id","name","timezone"}]}` (fixture order).
- `GET /restaurants/{id}` (public, 404 if unknown) → the restaurant **fixture shape**: `id, name, timezone, slot_minutes, reservation_duration_minutes, cancellation_cutoff_minutes, opening_hours[{weekday,opens,closes}], tables[{id,label,capacity}]`.

### Availability
`GET /availability?restaurant_id=&date=&party_size=` (public).
- All three required else `422 validation_failed`. `date` = `YYYY-MM-DD` (impossible date → `422`); `party_size` = plain `^[0-9]+$` digits, ≥1 (`0`/`-1`/`abc`/`1e9`/`4.0`/`+4` → `422`); unknown restaurant → `404`.
- Response `200 {"restaurant_id","date","timezone","slots":[{starts_at_local:"YYYY-MM-DDTHH:00",starts_at:"...+offset",available_table_ids:[...]}]}`.
- A slot per `slot_minutes` step from `opens` while `slot + reservation_duration_minutes ≤ closes`. `available_table_ids` = tables with `capacity ≥ party_size` and **no overlapping confirmed** reservation, in fixture order; a slot with none still appears with `[]`. Closed day → `{"slots":[]}`.
- Skipped spring-forward local times **never** appear as slots.

### Reservations
`POST /reservations` (auth, **`Idempotency-Key` required**). Body: `restaurant_id, table_id, starts_at_local, party_size` (+unknown fields ignored).
- `201` body: `reservation_id, reference(6–12 [A-Z0-9], globally unique, immutable), restaurant_id, table_id, party_size, status:"confirmed", starts_at_local, starts_at, ends_at, created_at`.
- `reference` globally unique across all reservations, never changes on amend/cancel.
- `409 table_unavailable` (overlap); `422 not_on_slot_grid`; `422 outside_opening_hours` (start<opens, end>closes, or end on a later calendar day); `422 party_exceeds_capacity`; `422 validation_failed` (party<1/non-integer/wrong type, bad `starts_at_local` shape, `Idempotency-Key`>255); `422 invalid_local_time` (gap); `404 not_found` (unknown restaurant/table, or table of another restaurant); `400 missing_idempotency_key`; `409 idempotency_key_reuse`; `400 malformed_request`.

- `GET /reservations` (auth) → `200 {"reservations":[...]}` = caller's only, **starts_at descending**, confirmed **and** cancelled. Empty → `{"reservations":[]}`.
- `GET /reservations/{reference}` (auth) → one; not caller's/unknown → `404 not_found` (leak guard).
- `POST /reservations/{reference}/cancel` (auth) → `200` with current state; already cancelled → `200`; within cutoff or after → `409 cutoff_passed`; not caller's → `404`. Frees the table **immediately** (next availability offers the slot).
- `PATCH /reservations/{reference}` (auth, **no** idempotency key) — any subset of `table_id, starts_at_local, party_size`; unknown fields ignored. Validation identical to create; `409 cutoff_passed` measured against the **current** `starts_at`; cancelled → `409 reservation_cancelled`; table taken → `409 table_unavailable`; `reference`+`reservation_id` survive. A **failed** amendment leaves the original booking & occupancy **unchanged** (validate fully before mutating).

### Atomic moves
`POST /reservation-moves` (auth, **`Idempotency-Key` required**). Body `{"moves":[{reference, table_id?, starts_at_local?, party_size?}]}`.
- `201 {"reservations":[...]}` in input order (unchanged items included).
- 1..8 moves; distinct references → else `422 validation_failed`. Each move: caller's booking, same restaurant → `404 not_found` (unknown/another owner), `422 validation_failed` (mixed restaurants). Per move, in input order: cancelled → `409`, cutoff → `409` (cutoff precedes other changes for that booking), then table/capacity/party/grid/hours/gap codes as in create; overlap among resulting bookings or vs an unlisted confirmed booking → `409 table_unavailable`.
- **All-or-nothing:** occupancy, reservation records, idempotency receipts, and any retry counters mutate together or not at all. Replay → `200` original body.

## L7 — Concurrency invariant
The service is single-threaded. The reservation-allocation critical section — idempotency lookup **and** the availability→reserve mutation (overlap check → create → idempotency-store) — contains **no `await`** and no yielding point. Therefore, for concurrent requests:
- Same slot/table: ≤1 returns 201, the rest 409 `table_unavailable` (physically impossible to double-book).
- Same user + key + body: ≤1 returns 201, the rest 200 (identical body), stored once.
- No 5xx under the 50-way `burst` (barrier-synchronized) load. This is the primary `@cleo-sentinel` concurrency probe.

## L8 — Time / DST (§9)
- Resolution is against the restaurant `timezone` (IANA). The transitions that must resolve correctly: Europe/Berlin 2026-03-29 (spring) / 2026-10-25 (fall); America/New_York 2026-03-08 / 2026-11-01. Dates may be in the past; never reject solely for age.
- Spring-forward gap: local times in the skipped hour → `422 invalid_local_time`; such slots never appear in `/availability`.
- Fall-back repeated hour: resolve to the **first** occurrence (offset before the clocks change, e.g. Berlin `02:00 → +02:00`); the slot appears **once** in availability; the second occurrence is not bookable.
- `reservation_duration_minutes` is **absolute** real time: a 90-min booking starting 01:30 on a fall-back night ends at local `02:00` (not `03:00`). `starts_at`/`ends_at` carry the correct per-occurrence offset.
- Slot grid alignment is `(wallMinutes(start) − opensMin) % slot_minutes == 0`.
- Opening-hours check uses **local wall** comparison: `start ≥ opens` and `start+duration ≤ closes`, same calendar day (a reservation ending on the next calendar day → `outside_opening_hours`).

## L9 — Reset/import seed & validation (§4)
- Fixture: `{users:[{id,email,password,display_name}], restaurants:[{id,name,timezone,slot_minutes,reservation_duration_minutes,cancellation_cutoff_minutes,opening_hours, tables:[{id,label,capacity}]}, reservations:[]]}`.
- Seeded `users` log in immediately with the given `password`.
- Seeded `reservations` carry `id, reference, user_id, restaurant_id, table_id, starts_at_local, party_size` (+optional status/starts_at/ends_at/created_at; service computes the rest). They must be **valid** (table belongs to the restaurant, party ≤ capacity, real date, on-grid, within hours, non-overlapping with other seeds) — otherwise `POST /_test/reset` → `422 validation_failed`. Invalid seed reference (`x`, `lower01`, `TOO-LONG-WITH-DASH`, >64-char id) → `422`.
- `weekday` ∈ `mon..sun`; `opens`/`closes` `HH:MM` 24h, `closes > opens`, never crossing midnight.

## L10 — Build & run (this service)
- `Dockerfile` builds on `node:22-alpine`; runtime `PORT` env (default 8080); listens `0.0.0.0`.
- No `npm install` of network deps at run time (no runtime dependencies; vendored build only).
- `RUN.md` documents: `docker build -t tablekeeper-stage1 stage-1` and
  `docker run --rm -e PORT=8080 -p 8080:8080 tablekeeper-stage1`.
- `python -m harness check --track tablekeeper .` must report 0 problems.
- `python -m harness run --track tablekeeper --repo . --stage 1 --mode host|isolated` runs the graded suite.
