# Tablekeeper Stage 2 — Technical Contract Ledger

**Room:** `4cc3a8dc-ca47-4980-8c89-d7e7ba293ce1`  
**Output repo:** `band-work/result` → `stage-2/`  
**Authority:** `stage-2/CONTRACT_LEDGER.md` (oracle: `@cleo-forge` implements, `@cleo-sentinel` tests)

## Contract Ledger Summary

This document extracts the complete technical contract from CONTRACT_LEDGER.md for implementation by @cleo-forge and verification by @cleo-sentinel.

### 1. HTTP Routes & Methods

#### Health & Control (Public)
| Route | Method | Status | Response |
|-------|--------|--------|----------|
| `/health` | GET | 200 | `{"status":"ok"}` |
| `/_test/reset` | POST | 204 | (no body) |
| `/_test/export` | GET | 200 | `{"track":"tablekeeper","format_version":1,"state":{...}}` |
| `/_test/import` | POST | 204 | (no body) |

#### Authentication (Public)
| Route | Method | Status | Response |
|-------|--------|--------|----------|
| `/auth/signup` | POST | 201 | `{"user_id","display_name","token"}` |
| `/auth/login` | POST | 200 | `{"user_id","display_name","token"}` |

#### Restaurants (Public)
| Route | Method | Status | Response |
|-------|--------|--------|----------|
| `/restaurants` | GET | 200 | `{"restaurants":[{"id","name","timezone"}]}` |
| `/restaurants/{id}` | GET | 200 | Full fixture shape with `combinable` array |

#### Availability (Public)
| Route | Method | Status | Response |
|-------|--------|--------|----------|
| `/availability?restaurant_id=&date=&party_size=` | GET | 200 | Slots with `available_table_ids` and `available_options` |

#### Reservations (Auth Required)
| Route | Method | Status | Response |
|-------|--------|--------|----------|
| `/reservations` | POST | 201 | Single reservation |
| `/reservations` | GET | 200 | `{"reservations":[...]}` |
| `/reservations/{reference}` | GET | 200 | Single reservation |
| `/reservations/{reference}` | PATCH | 200 | Updated reservation |
| `/reservations/{reference}/cancel` | POST | 200 | Cancelled reservation |
| `/reservation-moves` | POST | 201 | Multiple reservations after moves |

#### UI Pages (Public)
| Route | Response |
|-------|----------|
| `/` | HTML: Search and availability grid |
| `/signup` | HTML: Signup form |
| `/login` | HTML: Login form |
| `/lookup` | HTML: Reservation lookup |

### 2. Payload Validation Rules

#### POST /auth/signup
```
email: string, valid email format (local@domain.tld), required
password: string, ≥8 chars, required
display_name: string, optional
```
Errors: `409 email_taken`, `422 validation_failed`

#### POST /reservations
```
Idempotency-Key: string header, required, ≤255 chars
restaurant_id: string, required
table_id OR table_ids: one of required
  - table_ids: array of strings, 1-2 elements, no duplicates
  - pairs must be in restaurant's `combinable` array
starts_at_local: string, `YYYY-MM-DDTHH:MM` format, required
party_size: integer ≥1, required
```
Unknown fields ignored.

#### POST /reservation-moves
```
Idempotency-Key: string header, required, ≤255 chars
moves: array of objects, 1-8 items
  Each move:
    reference: string, required (unique within moves)
    table_id OR table_ids: optional override
    starts_at_local: optional string
    party_size: optional integer
```

#### GET /availability
```
restaurant_id: string query param, required
date: `YYYY-MM-DD` format, required
party_size: digits only `^\d+$`, ≥1, required
```

### 3. System Invariants

#### Idempotency Contract
- Resolution order: authenticate → key valid → parse → idempotent lookup → validation → mutation
- Successful receipts stored forever, replayed verbatim
- Failed (4xx) requests store nothing, key reusable
- Concurrent identical first-use → exactly one 201, rest 200 with identical response
- Critical section is `await`-free

#### Combined Tables
- Maximum 2 tables per reservation
- Pairs must be explicitly declared in `combinable` field
- Capacity = sum of table capacities
- Combinations not transitive (pair A+B + B+C does NOT make A+C bookable)

#### Atomic Multi-Item Operations
- `POST /reservation-moves`: all-or-nothing transaction
- Occupancy, records, idempotency receipts mutate together or not at all

#### Concurrency Invariant
- Single-threaded event loop
- Reservation allocation critical section has no `await`
- Under 50-way burst: no 5xx errors

### 4. Error Handling Contract

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `malformed_request` | Unparseable body, wrong JSON type |
| 400 | `missing_idempotency_key` | Empty or absent key |
| 401 | `unauthenticated` | Missing/invalid token |
| 404 | `not_found` | Unknown resource, not caller's |
| 409 | `idempotency_key_reuse` | Same key, different body |
| 409 | `email_taken` | Duplicate signup email |
| 409 | `table_unavailable` | Overlapping confirmed booking |
| 409 | `cutoff_passed` | Within cancellation window |
| 409 | `reservation_cancelled` | Amend/cancel on cancelled booking |
| 422 | `validation_failed` | Missing field, invalid format, duplicate table_id |
| 422 | `not_on_slot_grid` | starts_at_local off grid |
| 422 | `outside_opening_hours` | Before opens/after closes |
| 422 | `invalid_local_time` | Spring-forward gap |
| 422 | `party_exceeds_capacity` | Party > table/pair capacity |
| 422 | `combination_not_allowed` | Table pair not combinable or >2 tables |
| 500 | `internal_error` | Defensive last resort |

### 5. State Persistence & Reset

#### /_test/reset (Atomic)
- Body = fixture object
- Atomically replaces ALL state
- 204 on success, 422 on invalid fixture, 400 on malformed JSON

#### /_test/export (Atomic Snapshot)
- Returns: users, tokens, restaurants, reservations, used_references, idempotency receipts
- Opaque format, round-trips through import

#### /_test/import (Atomic)
- Accepts own export unchanged
- 204 on success, 400 on malformed JSON, 422 on missing/wrong fields

#### Fixture Schema
```json
{
  "users": [{"id","email","password","display_name"}],
  "restaurants": [{
    "id","name","timezone","slot_minutes",
    "reservation_duration_minutes","cancellation_cutoff_minutes",
    "opening_hours":[{"weekday","opens","closes"}],
    "tables":[{"id","label","capacity"}],
    "combinable": [["t1","t2"]]
  }],
  "reservations": []
}
```

### 6. Feature Detection

- `combinable` array in restaurant fixture
- `available_options` in availability response
- `table_ids` array in reservation response (always present)
- `table_id` in reservation response (only when single table)
