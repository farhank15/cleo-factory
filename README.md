# CLEO DARK FACTORY

The official submission for the WeAreDevelopers x BAND Dark Factory Hackathon.

- **Track**: `tablekeeper` (Restaurant Reservation System)
- **Team**: farhank15
- **Architecture**: 5-Seat Autonomous Mesh (`cleo-prime`, `cleo-architect`, `cleo-forge`, `cleo-sentinel`, `cleo-release`)
- **Runtime**: OpenCode with Zero-Outbound Node.js Engine

## Repository Structure
- `FACTORY.md`: Complete architecture rationale, seat definitions, failure-handling matrix, and telemetry.
- `mandates/`: Standing mandate files for each seat in Band Desktop.
- `room.json`: Official session export downloaded directly from Band Desktop.
- `stage-1/`: Buildable containerized service implementing Stage 1 specifications.
- `stage-2/`: Extended service implementing Stage 2 specifications (when completed).
- `stage-3/`: Extended service implementing Stage 3 specifications (when completed).
- `stage-4/`: Extended service implementing Stage 4 specifications (when completed).

## Verification
Run offline validation:
```bash
python -m harness check --track tablekeeper .
```
