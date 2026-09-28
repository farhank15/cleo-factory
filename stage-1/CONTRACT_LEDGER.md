# CONTRACT_LEDGER — Tablekeeper Stage 1

Derived from `dark-factory-wearedevs/tablekeeper/spec/stage-1.md` by `cleo-forge`,
before any code is written. This is the machine-verifiable promise the service keeps.

## L1 — Networking & process

| Item | Value |
|---|---|
| Listen | `0.0.0.0` |
| Port | `PORT` env, default `8080` |
| Start to healthy | ≤ 60 s |
| Concurrency | 50 in-flight, no 5xx |
| Run-time network | **denied** (all deps + assets self-contained in image) |
| Body limit | reject bodies > 10 MiB |

## L2 — Content conventions

| Rule | Enforcement |
|---|---|
| Requests/responses | `application/json; charset=utf-8` |
| Unknown request fields | ignored |
| Unknown query params | ignored |
| IDs | opaque strings, ≤ 64 chars, on every endpoint that takes them |
| Timestamps in responses | RFC 3339, **explicit offset** `±HH:MM` (never bare `Z`), no fractional seconds for slot instants |
| Error body | `{"error":{"code":"…","message":"…"}}` for all 4xx/5xx |
| 204 | no body, `Content-Length: 0` |

## L3 — Time model (DST, §9)

- A reservation occupies the **half-open** interval `[starts_at, starts_at + reservation_duration_minutes)` measured in **absolute** wall-clock time (`reservation_duration_minutes` is absolute minutes, NOT wall minutes).
- `starts_at_local` is a **bare** `YYYY-MM-DDTHH:MM` (no offset, no seconds, no `Z`).
  - Any other shape → `422 validation_failed`.
  - A real calendar date is required (`2026-02-30` → `422 validation_failed`).
- Resolution against the restaurant `timezone` (IANA):
  - **Spring-forward gap** (skipped local time) → `422 invalid_local_time`; such slots never appear in availability.
  - **Fall-back** repeated hour → resolves to the **first** occurrence (offset before the clocks change, e.g. `02:00` → `+02:00` in Berlin). The hour appears **once** in availability.
  - Offset follows IANA rules for the exact zone/date.
- Slot grid: `slot_minutes` steps measured from `opens` (alignment via `(t - opensMin) % slot == 0`, allowing negative multiples so pre-opens grid-aligned times are rejected by the hours rule, not the grid rule).
- Opening range: `starts_at >= opens` and `ends_at <= closes` using **local wall** comparison on the booking date; duration is absolute so a reservation started in the repeated hour ends at the earlier-wall local time.

## L4 — Authentication (§6)

| Action | Response |
|---|---|
| Signup: email exists | `409 email_taken` |
| Signup: password < 8 | `422 validation_failed` |
| Signup: email not `local@domain` | `422 validation_failed` |
| Signup: a field wrong JSON type | `400 malformed_request` |
| Login: wrong password / unknown email | `401 unauthenticated` |
| Bearer token missing/malformed/unknown | `401 unauthenticated` |
| Authenticated but touching another's resource | `404 not_found` (no 403 — existence is hidden) |
| Passwords | scrypt (built-in `crypto`), salted, verified with `timingSafeEqual`; never plaintext |
| Tokens | random, multiple valid per user, never expire |

Public (no bearer) endpoints: `GET /health`, `POST /_test/reset`, `GET/_test/export`, `POST /_test/import`, `POST /auth/signup`, `POST /auth/login`, `GET /restaurants`, `GET /restaurants/{id}`, `GET /availability`. All others require `Authorization: Bearer <token>`.

## L5 — Idempotency (§7)

Applies to `POST /reservations` and `POST /reservation-moves`.

| Situation | Response |
|---|---|
| Key absent/empty | `400 missing_idempotency_key` |
| Key > 255 chars | `422 validation_failed` |
| First use | normal response (`201`) |
| Same key + same body (after parse) | `200`, body identical |
| Same key + different body | `409 idempotency_key_reuse` (even if the new body is otherwise invalid) |
| Original request **failed** with 4xx | key not retained → retry is a first use |

- Key scoped per **user**; same key string across users is independent.
- "Same body" = canonical JSON value (sorted keys, whitespace ignored).
- Resolution order: authenticate → key present/length → parse body → **idempotency lookup** → endpoint field validation → resource checks.
- Successful receipts (2xx) are stored and replayed verbatim forever, even after the resource is amended/cancelled; they produce no further state change.
- Concurrent identical key+body → exactly one `201`, the rest `200` (same body).

## L6 — Endpoint contracts (§8, §10, §11)

### Health / test

| Method | Path | Result |
|---|---|---|
| GET | `/health` | `200 {"status":"ok"}` |
| POST | `/_test/reset` | `204`, atomic replace; invalid fixture → `422 validation_failed` |
| GET | `/_test/export` | `200 {track, format_version:1, state}` (opaque, atomic snapshot) |
| POST | `/_test/import` | `204` (state must be the service's own export or a valid fixture); bad JSON → `400 malformed_request`; wrong track/version/missing/invalid → `422 validation_failed` |

### Restaurants

| Method | Path | Result |
|---|---|---|
| GET | `/restaurants` | `200 {restaurants:[{id,name,timezone}]}` |
| GET | `/restaurants/{id}` | fixture shape (id,name,timezone,slot_minutes,reservation_duration_minutes,cancellation_cutoff_minutes,opening_hours,tables); unknown → `404 not_found` |

### Availability

`GET /availability?restaurant_id=&date=&party_size=` — all required (else `422 validation_failed`); `date` `YYYY-MM-DD`; `party_size` plain `^[0-9]+$`, ≥1. Each slot: `starts_at_local`(full), `starts_at`(offset), `available_table_ids` (capacity ≥ party, no overlapping **confirmed** reservation, fixture order). Closed day → `[]`. Unknown restaurant → `404 not_found`.

### Reservations

`POST /reservations` (idempotency key). Body: `restaurant_id, table_id, starts_at_local, party_size`.

| Condition | Code |
|---|---|
| Table held by overlapping confirmed booking | `409 table_unavailable` |
| Not on the slot grid | `422 not_on_slot_grid` |
| Outside opening hours / ends after closes | `422 outside_opening_hours` |
| party exceeds table capacity | `422 party_exceeds_capacity` |
| party < 1 / not integer / wrong type | `422 validation_failed` |
| Skipped local time (gap) | `422 invalid_local_time` |
| Unknown restaurant/table / table of another restaurant | `404 not_found` |
| Missing/bad Idempotency-Key | `400 missing_idempotency_key` / `422 validation_failed` |

Response `201`: `reservation_id, reference(6–12 [A-Z0-9], unique), restaurant_id, table_id, party_size, status:"confirmed", starts_at_local, starts_at, ends_at, created_at`.

| Method | Path | Result |
|---|---|---|
| GET | `/reservations` | `200 {reservations:[…]}` starts_at desc, cancelled included |
| GET | `/reservations/{reference}` | one; not caller's/unknown → `404 not_found` |
| POST | `/reservations/{reference}/cancel` | `200`; already cancelled → `200`; within/inside cutoff or later → `409 cutoff_passed`; not caller's → `404 not_found`. Frees table immediately. |
| PATCH | `/reservations/{reference}` | `200`; cancelled → `409 reservation_cancelled`; within cutoff → `409 cutoff_passed`; same validation as create; table taken → `409 table_unavailable`. No idempotency key. |

### Atomic moves

`POST /reservation-moves` (idempotency key). Body `{moves:[{reference,…fields}]}`, 1–8, distinct refs. Per move: caller's booking, same restaurant; cancelled→`409 reservation_cancelled`, cutoff→`409 cutoff_passed`, field/capacity/grid/hours as above, overlap→`409 table_unavailable`. All commit or none. `201 {reservations:[…]}` in input order (incl. unchanged). Replay → `200`.

## L7 — Concurrency invariant

The allocation path — idempotency lookup **and** the availability→reserve mutation — executes with **no `await`** between the table-overlap check and the reservation/idempotency-commit. The service is single-threaded; this is the atomic critical section that makes overlapping same-slot bookings physically impossible (≤1 succeeds, the rest `409`), and makes concurrent identical key+body requests collapse to one `201` + N×`200`.

## L8 — Self-test / verification

- `Dockerfile` builds a `node:22-alpine` image; `NODE_OPTIONS=--harmony-temporal` (Temporal IANA zones + DST).
- Local: `node --test test/` plus the Python harness suite.
- `python -m harness check --track tablekeeper .` must pass (no secrets, mandates present, stage-1/Dockerfile + RUN.md present).
