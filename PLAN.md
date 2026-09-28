# Tablekeeper Stage 2 — Architecture Plan

**Room:** `4cc3a8dc-ca47-4980-8c89-d7e7ba293ce1`  
**Output repo:** `band-work/result` → `stage-2/`  
**Authority:** `stage-2/CONTRACT_LEDGER.md` (oracle: `@cleo-forge` implements, `@cleo-sentinel` tests)

## Design Summary

Extend stage-1 server with HTML page generation and serving for interactive diner UI. All existing stage-1 APIs remain unchanged.

### Key Extensions

1. **HTML Routes** - `/`, `/signup`, `/login`, `/lookup` serve inline HTML with embedded CSS/JS
2. **Combined Tables** - `GET /availability` returns `available_options` with combinable pairs, `POST /reservations` accepts `table_ids` array
3. **UI State Management** - Out-of-order response handling via request counter, 5-second booking timeout with retry, `booking-uncertain` state

## Architecture

```arch
{
  "kind": "layered",
  "title": "Tablekeeper Stage 2 — Architecture",
  "layers": [
    {
      "id": "delivery",
      "title": "Delivery",
      "items": [
        {
          "id": "docker",
          "label": "Docker: node:22-alpine, --network none, 0.0.0.0:${PORT:-8080}",
          "details": {
            "port": 8080,
            "network": "none",
            "runtime": "node:22-alpine"
          }
        }
      ]
    },
    {
      "id": "http_ui",
      "title": "HTTP UI Routes",
      "items": [
        {
          "id": "route_search",
          "label": "Route: / (search page)",
          "methods": ["GET"],
          "response": "text/html; charset=utf-8"
        },
        {
          "id": "route_signup",
          "label": "Route: /signup",
          "methods": ["GET"],
          "response": "text/html; charset=utf-8"
        },
        {
          "id": "route_login",
          "label": "Route: /login",
          "methods": ["GET"],
          "response": "text/html; charset=utf-8"
        },
        {
          "id": "route_lookup",
          "label": "Route: /lookup",
          "methods": ["GET"],
          "response": "text/html; charset=utf-8"
        }
      ]
    },
    {
      "id": "http_api",
      "title": "HTTP API Routes",
      "items": [
        {
          "id": "api_health",
          "label": "GET /health",
          "status": 200
        },
        {
          "id": "api_reset",
          "label": "POST /_test/reset",
          "status": 204
        },
        {
          "id": "api_export",
          "label": "GET /_test/export",
          "status": 200
        },
        {
          "id": "api_import",
          "label": "POST /_test/import",
          "status": 204
        },
        {
          "id": "api_availability",
          "label": "GET /availability (with available_options)",
          "status": 200
        },
        {
          "id": "api_reservations",
          "label": "POST /reservations (table_ids extension)",
          "status": 201
        },
        {
          "id": "api_reservation_moves",
          "label": "POST /reservation-moves",
          "status": 201
        }
      ]
    },
    {
      "id": "ui",
      "title": "UI Components",
      "items": [
        {
          "id": "ui_search",
          "label": "Search page with availability grid",
          "dataTestId": "availability-grid"
        },
        {
          "id": "ui_auth",
          "label": "Signup/login forms",
          "dataTestId": "signup-form, login-form"
        },
        {
          "id": "ui_lookup",
          "label": "Reservation lookup",
          "dataTestId": "lookup-form"
        },
        {
          "id": "ui_booking",
          "label": "Booking form with retry logic",
          "dataTestId": "booking-form"
        }
      ]
    },
    {
      "id": "core",
      "title": "Core Engine",
      "items": [
        {
          "id": "mutex",
          "label": "Concurrency: await-free critical section"
        },
        {
          "id": "state",
          "label": "State: restaurants, tables, combinable pairs, reservations",
          "dataStructures": ["Map(users)", "Map(tokens)", "Map(restaurants)", "Map(tables)", "Map(reservations)", "Map(idem)", "Set(references)"]
        },
        {
          "id": "combinable_model",
          "label": "Combined Tables Model",
          "rules": ["Pairs only (max 2 tables)", "Non-transitive", "Capacity = sum"]
        }
      ]
    },
    {
      "id": "security",
      "title": "Security & Auth",
      "items": [
        {
          "id": "auth_passwords",
          "label": "scrypt password hashing"
        },
        {
          "id": "auth_tokens",
          "label": "32 random bytes hex tokens"
        },
        {
          "id": "auth_public_routes",
          "label": "Public routes: /, /signup, /login, /lookup, /health, /availability"
        }
      ]
    },
    {
      "id": "verify",
      "title": "Verification",
      "items": [
        {
          "id": "harness",
          "label": "harness run --stage 2 --mode isolated"
        },
        {
          "id": "ui_tests",
          "label": "Node tests: UI forms, concurrency, offline"
        }
      ]
    }
  ],
  "flows": [
    {
      "from": "docker",
      "to": "http_ui",
      "label": "serve HTML pages"
    },
    {
      "from": "docker",
      "to": "http_api",
      "label": "serve JSON API"
    },
    {
      "from": "http_ui",
      "to": "ui",
      "label": "render pages"
    },
    {
      "from": "http_api",
      "to": "core",
      "label": "allocate & mutate"
    },
    {
      "from": "http_api",
      "to": "security",
      "label": "authenticate tokens"
    },
    {
      "from": "core",
      "to": "verify",
      "label": "grader drives tests"
    }
  ]
}
```

## Deliverables for @cleo-forge

- `src/app.js` - HTML route handlers and API endpoints
- `src/ui.js` - Page generation functions: `searchPage()`, `signupPage()`, `loginPage()`, `lookupPage()`
- `src/state.js` - State management with combinable support
- `src/auth.js` - Password hashing and token generation
- `src/tz.js` - Timezone/DST handling
- `test/helper.js` - Test fixtures with `combinable: [['t1','t2']]`
- `Dockerfile` - Zero-dependency build (node:22-alpine)
- All 59 tests pass

## Stage 1 Reference

- Completed at `30916c9` with tags `accept-stage-1`, `stage-1-accepted`
- Zero-dependency in-memory reservation service
- 120/120 harness tests pass
- Adversarial probes verified (50-way concurrency, idempotency, DST)