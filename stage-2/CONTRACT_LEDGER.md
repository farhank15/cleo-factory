# CONTRACT_LEDGER — Tablekeeper Stage 2

The authoritative, machine-verifiable contract for `stage-2/`. It is the single test
oracle: `@cleo-forge` implements to it, `@cleo-sentinel` tests against it. Derived by
`@cleo-architect` from `tablekeeper/spec/stage-2.md` + the `test/stage_2/*` suite (which
may assert *weaker* wording than this ledger; this ledger is stricter where the prose is
explicit). "Must" = required; "may" = allowed.

> The canonical copy lives at the repository root `CONTRACT_LEDGER.md`. This file mirrors it
> inside `stage-2/` so the implementer has it at hand. Keep them in sync.

## 0. Scope snapshot
A single-container, zero-dependency-in-at-runtime Node.js HTTP service serving an
interactive browser UI for diner reservations. State is in-memory and is replaced atomically
only by `POST /_test/reset` / `POST /_test/import`. The service never makes an outbound
network call at run time. All static assets (HTML, CSS, JS) are self-contained.

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
| Request/response (API) | `application/json; charset=utf-8` |
| Request/response (UI) | `text/html; charset=utf-8` |
| Body limit | reject `Content-Length`/bodies > 10 MiB → `400 malformed_request` |

## L2 — Conventions
- Unknown request fields: **ignored**. Unknown query params: **ignored**.
- IDs are opaque strings ≤ 64 chars. References are 6–12 `[A-Z0-9]`.
- Timestamps in **responses** are RFC 3339 with explicit offset.
- `starts_at_local` is `YYYY-MM-DDTHH:MM` (no offset, no seconds).
- Every 4xx/5xx body: `{"error":{"code":"<code>","message":"<any>"}}`
- Two `confirmed` reservations on the same table with overlapping intervals cannot coexist.

## L3 — Error code table (status + code)
| Status | `code` | When (stage 2) |
|---|---|---|
| 400 | `malformed_request` | Body unparseable, or a field of the wrong JSON type |
| 400 | `missing_idempotency_key` | `Idempotency-Key` absent or empty |
| 401 | `unauthenticated` | Missing/malformed/unknown Bearer token |
| 403 | `forbidden` | Reserved |
| 404 | `not_found` | Unknown resource, or not visible to caller |
| 409 | `idempotency_key_reuse` | Same key, same user, **different** body |
| 409 | `email_taken` | Signup email already registered |
| 409 | `table_unavailable` | Overlapping confirmed booking |
| 409 | `cutoff_passed` | Cancel/amend within `cancellation_cutoff_minutes` |
| 409 | `reservation_cancelled` | Amendment/move on cancelled booking |
| 422 | `validation_failed` | Missing field, rule violation, invalid format, etc. |
| 422 | `not_on_slot_grid` | `starts_at_local` not on the `slot_minutes` grid |
| 422 | `outside_opening_hours` | Start before `opens`, end after `closes` |
| 422 | `invalid_local_time` | `starts_at_local` in spring-forward gap |
| 422 | `party_exceeds_capacity` | `party_size` > table/combination capacity |
| 422 | `combination_not_allowed` | Invalid table pair or >2 tables |
| 500 | `internal_error` | Defensive last resort; **must never occur** |

## L4 — Authentication (§6)
- Public (no bearer): `/health`, `/_test/reset`, `/_test/export`, `/_test/import`,
  `/auth/signup`, `/auth/login`, `/restaurants`, `/restaurants/{id}`, `/availability`,
  and UI routes (`/`, `/signup`, `/login`, `/lookup`).
- All other endpoints require `Authorization: Bearer <token>`.
- Passwords: salted scrypt hash. Tokens: 32 random bytes hex, non-expiring.

## L5 — Idempotency (§7)
- `POST /reservations` and `POST /reservation-moves` require `Idempotency-Key`.
- Resolution order: authenticate → key present & ≤255 chars → parse body → idempotent lookup →
  validation → mutation.
- Successful (2xx) receipts stored forever and replayed verbatim.
- Failed (4xx) requests store nothing, key is reusable.

## L6 — Endpoints

### Health
`GET /health` → `200 {"status":"ok"}`

### Fixture & test control
- `POST /_test/reset` → `204`. Atomically replaces all state.
- `GET /_test/export` → `200 {"track":"tablekeeper","format_version":1,"state":{opaque}}`.
- `POST /_test/import` → `204`. Atomically replaces state with export.

### Restaurants
- `GET /restaurants` (public) → `200 {"restaurants":[{"id","name","timezone"}]}`
- `GET /restaurants/{id}` (public) → fixture shape including `combinable: [["t_1","t_2"]]`

### Availability
`GET /availability?restaurant_id=&date=&party_size=` (public).
- All three required; else `422 validation_failed`.
- `party_size`: plaintext digits `^[0-9]+$` only.
- Response `200`:
```json
{
  "restaurant_id": "r_anker",
  "date": "2026-09-24",
  "timezone": "Europe/Berlin",
  "slots": [
    {
      "starts_at_local": "2026-09-24T19:00",
      "starts_at": "2026-09-24T19:00:00+02:00",
      "available_table_ids": ["t_3"],
      "available_options": [
        { "table_ids": ["t_3"], "capacity": 6 },
        { "table_ids": ["t_1", "t_2"], "capacity": 6 }
      ]
    }
  ]
}
```
- `available_options` lists every single table and every declared pair with
  `capacity >= party_size` and no overlapping confirmed reservation on any member.
- Singles first, then pairs in `combinable` order. `table_ids` within a pair in `combinable` order.

### Reservations
`POST /reservations` (auth, `Idempotency-Key` required). Body:
`restaurant_id, table_id | table_ids, starts_at_local, party_size` (+unknown fields ignored).

Response `201`:
- `table_ids` always present.
- `table_id` present **only** when set has exactly one member; otherwise omitted.

| Case | Response |
|---|---|
| Pair not in `combinable` | `422 combination_not_allowed` |
| More than two tables | `422 combination_not_allowed` |
| Any table taken for overlapping interval | `409 table_unavailable` |
| `party_size` exceeds combination's capacity | `422 party_exceeds_capacity` |
| Duplicate table id in set | `422 validation_failed` |

## L7 — Combined Tables

### Model
Restaurant fixture gains:
```json
{
  "id": "r_anker",
  "combinable": [ ["t_1", "t_2"], ["t_2", "t_3"] ],
  ...
}
```

- **Pairs only** — never three or more.
- Combining is **not transitive**: `[t_1,t_2]` and `[t_2,t_3]` do not make `{t_1,t_3}` bookable.
- Combination's capacity = sum of tables' capacities.

### Booking moves
`PATCH /reservations/{reference}` accepts `table_ids` under same rules. Cancelling frees
every table in the set.

## L8 — Concurrent bookings and amendments
Concurrent requests must produce the same results as executing them one at a time in some
order. The reservation-allocation critical section contains no `await`.

## L9 — UI Screen Routes and Elements

### Public routes (no auth required)
| Route | Screen |
|---|---|
| `/` | Search and availability grid |
| `/signup` | Signup |
| `/login` | Login |
| `/lookup` | Reservation lookup |

### Auth screens data-testid attributes
| `data-testid` | Element |
|---|---|
| `signup-email`, `signup-password`, `signup-display-name` | Inputs |
| `signup-submit` | Button |
| `login-email`, `login-password`, `login-submit` | Inputs and button |
| `auth-error` | Error message (present only when there is one) |
| `current-user` | Visible on every screen when signed in |
| `logout-button` | Button |

### Search and availability grid — `/`
| `data-testid` | Element |
|---|---|
| `restaurant-select` | Restaurant selector. Option values = restaurant ids |
| `date-input` | Date, value `YYYY-MM-DD` |
| `party-size-input` | Number |
| `search-button` | Runs the search |
| `availability-grid` | Container for results |
| `slot-{table_id}-{HH:MM}` | Single table cell, e.g. `slot-t_2-19:00` |
| `slot-{t_a}+{t_b}-{HH:MM}` | Combination cell, e.g. `slot-t_1+t_2-19:00` in `combinable` order |
| `no-slots` | Shown when day has no slots |

Each cell carries `data-available="true"` or `data-available="false"`.

### Booking form
| `data-testid` | Element |
|---|---|
| `booking-form` | Container |
| `booking-summary` | Contains table label(s) and local start time |
| `booking-party-size` | Number input, pre-filled |
| `booking-submit` | Button |
| `booking-error` | Error message when booking fails |

### Confirmation
| `data-testid` | Element |
|---|---|
| `confirmation` | Container |
| `confirmation-reference` | Text is exactly the reference |
| `confirmation-details` | Contains restaurant name, table label, and local start time |
| `confirmation-tables` | Contains every table label for combined bookings |

### Lookup — `/lookup`
| `data-testid` | Element |
|---|---|
| `lookup-reference-input`, `lookup-submit` | Input and button |
| `reservation-detail` | Container, shown when found |
| `reservation-status` | Text is exactly `confirmed` or `cancelled` |
| `reservation-cancel-button` | Cancels; absent once cancelled |
| `reservation-error` | Shown when not found |
| `reservation-tables` | On lookup screen for combined bookings |

## L10 — Competing clients and uncertain outcomes

### Out-of-order responses
If search A starts before search B but finishes after, the grid, table labels, and booking
form must describe B. Late responses must not restore A's results.

### Table taken after form opens
If another client takes a table after the form opens, show `booking-error` and refresh
availability. Preserve the selected form and inputs. Do not show confirmation.

### Lost booking response
If a booking response is lost (including after the booking commits), show nonempty
`booking-uncertain` text, without `booking-error` or a new confirmation. The form must
retry with the same idempotency key and body. Successful retry removes uncertainty.
Failed retry shows `booking-error`.

## L11 — Existing clients after an upgrade
- Must accept export produced by stage-1 service.
- Browser signed in before export/import must remain signed in.
- Retained booking references must work through lookup screen.
- Bookings whose response was lost before export must remain retryable with same body/key.

## L12 — UI visual requirements
- Warm, confident hospitality character.
- Clear visual hierarchy for dates, times, party size, and table choices.
- Combined tables read as intentional seating options.
- Consistent typography, spacing, color, controls, and feedback.
- States visually distinct: available, unavailable, selected, loading, success, refused,
  uncertain.
- Works at 375 CSS-pixel width and desktop widths without horizontal scrolling.
- Visible labels, keyboard focus, sufficient contrast.
- Considered empty, loading, and error states.

## L13 — Concurrency invariant
Single-threaded. The allocation critical section — idempotency lookup **and** the
availability→reserve mutation — contains **no `await`** (no yielding). Therefore:
- Same slot/table concurrent: ≤1 returns 201, rest 409 `table_unavailable` (no double-book).
- Same user+key+body concurrent: ≤1 returns 201, rest 200 identical, stored once.
- No 5xx under 50-way `burst` load.