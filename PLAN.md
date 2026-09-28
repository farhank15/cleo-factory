# Dark Factory Architecture Plan

```mermaid
graph TD
    Client[HTTP Client] --> Gateway[Reverse Proxy / Express Server]
    Gateway --> Auth[Auth & Session Store]
    Gateway --> Lock[Concurrency Mutex Lock]
    Lock --> Reservations[Reservation & Availability Engine]
    Reservations --> Timezone[Luxon DST Slot Grid]
    Reservations --> State[In-Memory Store / SQLite]
```

## Factory Stages
- [x] Stage 1: Specification Ledger & Concurrency Engine
- [ ] Stage 2: Browser UI & Client Workflow
- [ ] Stage 3: Dynamic Policies & Effective Dating
- [ ] Stage 4: Closure Replanning & Batch Moves
