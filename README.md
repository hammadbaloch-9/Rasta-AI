# RAASTA AI — Backend

**Karachi Smart Traffic Management System · Karachi Traffic Decision Lab**
_Simulate. Optimize. Prove._

Backend for the RAASTA AI hackathon prototype described in the PRP: a deterministic traffic
simulation engine, a fixed-time baseline, an explainable adaptive signal controller, paired
experiments, hotspot detection and preliminary infrastructure screening.

> **Decision-support prototype.** All traffic demand is synthetic and documented as an assumption.
> This backend does not connect to live Karachi traffic feeds, does not control real signals, and
> must not be used to justify construction. Real-world use requires field data and professional
> traffic-engineering validation.

---

## Contents

- [What is implemented](#what-is-implemented)
- [Quick start](#quick-start)
- [Environment configuration](#environment-configuration)
- [Database modes](#database-modes)
- [API overview](#api-overview)
- [Example requests](#example-requests)
- [Realtime (Socket.IO)](#realtime-socketio)
- [Architecture](#architecture)
- [Simulation model in brief](#simulation-model-in-brief)
- [Metrics definitions](#metrics-definitions)
- [Scenarios](#scenarios)
- [Testing](#testing)
- [Docker](#docker)
- [Demo script](#demo-script)
- [Assumptions and limitations](#assumptions-and-limitations)
- [Notes for the frontend team](#notes-for-the-frontend-team)

---

## What is implemented

Mapped to the PRP's must-have modules and API contracts:

| PRP requirement | Backend implementation |
| --- | --- |
| Four connected intersections | 2×2 signalised grid (Saddar-inspired) with four approaches each, external entry/exit stubs and routing |
| Moving vehicles, queues, signal phases | Deterministic microscopic engine at 1 s ticks with car-following, queue storage and spillback |
| Fixed-time baseline | Two-phase NS/EW cycle with configurable green split, amber and all-red clearance |
| Adaptive controller | Rule-based priority score (`0.6 Q + 0.3 W + 0.1 A`), min/max green, amber/all-red, starvation prevention, explainable decisions |
| Fair paired comparison | Fixed vs adaptive with identical scenario, duration, demand and seed; single or multi-seed experiments |
| Measured metrics | Waiting time, travel time, queues, throughput, stops, fairness — all computed from simulation state |
| Hotspots | Rule-based detection on persistent queues / waits per approach, with evidence and evidence-strength labels |
| Infrastructure intelligence | Rule-based intervention screening with explicit caveats; no construction claims |
| Emergency corridor (stretch) | Optional emergency vehicle with preemption, queue priority and documented limitations |
| Experiment history (stretch) | Experiments persisted with runs, aggregate statistics, comparison rows and JSON/CSV export |
| Scenario library | Four PRP-required scenarios, each with documented assumptions |
| API contracts | Every endpoint listed in PRP §11, plus health, metric definitions, frames and live state |
| Realtime | Socket.IO live simulations with a stable `simulation:update` event |

**Not implemented (by design):** real traffic-light control, live city feeds, deep RL training,
citywide digital twin, and any construction approval logic.

---

## Quick start

Requirements: **Node.js ≥ 18.17** (tested on Node 20). MongoDB is optional.

```bash
cd raasta-ai-backend
npm install
npm start
```

The API starts on `http://localhost:4000` and **works without MongoDB** — if no `MONGODB_URI` is
configured (or it is unreachable), it falls back to an in-memory store and says so in `/api/health`.

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/scenarios
```

Run the full demo (server must be running):

```bash
npm run demo
```

Run tests:

```bash
npm test              # 49 tests, in-memory store
npm run verify:mongo  # end-to-end MongoDB persistence verification (ephemeral MongoDB)
```

---

## Environment configuration

Copy `.env.example` to `.env`. Every setting is optional; defaults are sensible for the hackathon.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | HTTP bind address |
| `NODE_ENV` | `development` | `production` hides internal error details |
| `DB_MODE` | `auto` | `auto` \| `mongo` \| `memory` |
| `MONGODB_URI` | — | Enables MongoDB persistence |
| `MONGODB_DB_NAME` | `raasta_ai` | Database name |
| `MONGODB_TIMEOUT_MS` | `5000` | Connection timeout before falling back |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |
| `SIM_DEFAULT_DURATION_SEC` | `600` | Default run length |
| `SIM_MIN_DURATION_SEC` / `SIM_MAX_DURATION_SEC` | `60` / `3600` | Accepted duration range |
| `SIM_TICK_SEC` | `1` | Simulated seconds per tick |
| `SIM_SAMPLE_INTERVAL_SEC` | `5` | Time-series sampling interval |
| `SIM_DECISION_LOG_LIMIT` | `250` | Max decision records stored per run |
| `SIM_MAX_RECORDED_FRAMES` | `1200` | Cap on replay frames |
| `SIM_MAX_FRAME_VEHICLE_ENTRIES` | `120000` | Payload guard for recorded frames |
| `SIM_MAX_VEHICLES` | `8000` | Hard vehicle cap per run |
| `LIVE_TICK_MS` | `100` | Real ms per simulated second for live runs (10× speed) |

---

## Database modes

`DB_MODE=auto` (default) tries MongoDB when `MONGODB_URI` is set and falls back to memory on
failure. This keeps local development frictionless while allowing persistence in deployment.

- **memory** — ephemeral, zero setup, perfect for the 5-hour build and demos.
- **mongo** — requires MongoDB; startup fails if it is unreachable (use for production-like runs).

Start MongoDB locally with Docker if needed:

```bash
docker run -d -p 27017:27017 --name raasta-mongo mongo:7
```

Health always reports which mode is active:

```json
{ "db": { "mode": "memory", "connected": false, "persistent": false } }
```

---

## API overview

Base URL: `/api`. Full contracts and examples: **[docs/API.md](docs/API.md)** · OpenAPI:
**[docs/openapi.yaml](docs/openapi.yaml)** · Postman:
**[docs/RAASTA.postman_collection.json](docs/RAASTA.postman_collection.json)**

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service, DB mode, engine version |
| `GET` | `/api/metrics/definitions` | Metric definitions and formulas |
| `GET` | `/api/dashboard` | Command Center: latest KPIs, congestion alerts, recent runs and experiments |
| `GET` | `/api/scenarios` | List scenarios |
| `GET` | `/api/scenarios/:id` | Scenario detail incl. network geometry |
| `POST` | `/api/simulations/run` | Run a fixed or adaptive simulation (instant or live) |
| `POST` | `/api/simulations/compare` | Paired fixed-vs-adaptive experiment (1–10 seeds) |
| `GET` | `/api/simulations` | List runs (filters + pagination) |
| `GET` | `/api/simulations/:id` | Run status, configuration and results |
| `GET` | `/api/simulations/:id/metrics` | Metrics, per-intersection/approach data, time series, decisions |
| `GET` | `/api/simulations/:id/frames` | Recorded replay frames (if `record: true`) |
| `GET` | `/api/simulations/:id/state` | Live state snapshot (polling fallback) |
| `DELETE` | `/api/simulations/:id` | Delete a run |
| `GET` | `/api/hotspots?simulationId=` | Hotspot candidates (latest completed run if omitted) |
| `POST` | `/api/recommendations/evaluate` | Screen interventions for a run, hotspot or metrics |
| `GET` | `/api/experiments` | Experiment history |
| `GET` | `/api/experiments/:id` | Experiment detail with runs |
| `GET` | `/api/experiments/:id/export?format=json\|csv` | Downloadable report |

Responses use `{ "data": ... }` (plus `meta`/`pagination` where relevant). Errors use
`{ "error": { "message", "code", "requestId", "details?" } }`.

---

## Example requests

### Run a fixed-time baseline

```bash
curl -X POST http://localhost:4000/api/simulations/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scenarioId": "saddar-balanced",
    "mode": "fixed",
    "durationSec": 600,
    "seed": 42,
    "label": "Baseline demo"
  }'
```

### Run adaptive control on the same demand

```bash
curl -X POST http://localhost:4000/api/simulations/run \
  -H 'Content-Type: application/json' \
  -d '{ "scenarioId": "saddar-balanced", "mode": "adaptive", "durationSec": 600, "seed": 42 }'
```

### Paired comparison over three seeds

```bash
curl -X POST http://localhost:4000/api/simulations/compare \
  -H 'Content-Type: application/json' \
  -d '{ "scenarioId": "saddar-balanced", "durationSec": 600, "seeds": [1, 2, 3] }'
```

### Hotspots and intervention screening

```bash
curl "http://localhost:4000/api/hotspots?simulationId=<SIM_ID>"

curl -X POST http://localhost:4000/api/recommendations/evaluate \
  -H 'Content-Type: application/json' \
  -d '{ "simulationId": "<SIM_ID>" }'
```

### Overrides (counterfactuals)

```bash
# Closed approach vs reopened approach
curl -X POST http://localhost:4000/api/simulations/run -H 'Content-Type: application/json' -d '{
  "scenarioId": "blocked-approach", "mode": "adaptive", "durationSec": 600, "seed": 42,
  "overrides": { "clearBlocked": true }
}'

# Hypothetical extra capacity (documented as a capacity change, not a real flyover)
curl -X POST http://localhost:4000/api/simulations/run -H 'Content-Type: application/json' -d '{
  "scenarioId": "saddar-balanced", "mode": "fixed", "durationSec": 600, "seed": 42,
  "overrides": { "laneOverrides": { "I4": { "lanesPerApproach": 3 } } }
}'
```

### Emergency corridor

```bash
curl -X POST http://localhost:4000/api/simulations/run -H 'Content-Type: application/json' -d '{
  "scenarioId": "saddar-balanced", "mode": "fixed", "durationSec": 400, "seed": 42,
  "overrides": {
    "emergency": {
      "enabled": true, "afterSec": 120,
      "entryIntersectionId": "I1", "entrySide": "N",
      "destinationIntersectionId": "I4"
    }
  }
}'
```

### Live run (Socket.IO)

```bash
curl -X POST http://localhost:4000/api/simulations/run -H 'Content-Type: application/json' -d '{
  "scenarioId": "rush-hour-surge", "mode": "adaptive",
  "durationSec": 300, "seed": 7,
  "live": true, "tickMs": 100
}'
```

Returns `202` with a `simulationId` and the room name; subscribe on the socket with
`simulation:subscribe`.

---

## Realtime (Socket.IO)

Connect to the same host/port. The contract is intentionally small and stable:

| Event | Direction | Payload |
| --- | --- | --- |
| `simulation:subscribe` | client → server | `{ simulationId }` |
| `simulation:subscribed` | server → client | `{ simulationId, room }` |
| `simulation:update` | server → client | tick `t`, progress, active/completed counts, intersections (phase, state, queues), vehicle positions, signal states |
| `simulation:completed` | server → client | `{ simulationId, status, metrics }` |
| `simulation:failed` | server → client | `{ simulationId, error }` |

Polling fallback: `GET /api/simulations/:id/state`.

The frontend must render the engine's signal states and positions — do not invent them locally.

---

## Architecture

```
HTTP request
   │
   ├─ routes → validation (zod) → controller
   │                                   │
   │                                   ▼
   │                        service layer (run / compare / hotspots / recommendations)
   │                                   │
   │                 ┌─────────────────┼──────────────────┐
   │                 ▼                 ▼                  ▼
   │        simulation engine      repositories      rule engines
   │        (deterministic)     (mongo | memory)   (hotspots, interventions)
   │                 │                                  │
   └──── Socket.IO ◄─┘                                  └─ documented thresholds
```

```
raasta-ai-backend/
├── src/
│   ├── index.js                 # HTTP server + Socket.IO + graceful shutdown
│   ├── app.js                   # Express app, middleware, routes
│   ├── config/
│   │   ├── env.js               # environment parsing
│   │   └── scenarios.js         # Karachi scenario definitions (documented assumptions)
│   ├── simulation/
│   │   ├── rng.js               # seeded PRNG (reproducible demand)
│   │   ├── network.js           # intersections, directed links, entries/exits, routing
│   │   ├── signalController.js  # fixed + adaptive controller with safety constraints
│   │   ├── engine.js            # ticks, movement, queues, discharge, metrics collection
│   │   ├── metrics.js           # fairness, aggregation, comparison formulas
│   │   └── version.js
│   ├── services/
│   │   ├── simulationService.js     # instant + live runs, retrieval, listing
│   │   ├── compareService.js        # paired experiments, history, export
│   │   ├── hotspotService.js        # hotspot detection rules
│   │   └── recommendationService.js # intervention screening rules
│   ├── controllers/ routes/ middleware/ validation/
│   ├── models/                  # Mongoose schemas
│   ├── db/                      # mongo + memory repositories (same interface)
│   └── realtime/socket.js
├── tests/                       # node:test suites (49 tests)
├── scripts/demo.js
├── docs/                        # API.md, SIMULATION_MODEL.md, openapi.yaml
├── Dockerfile / docker-compose.yml / .env.example
└── README.md
```

---

## Simulation model in brief

See **[docs/SIMULATION_MODEL.md](docs/SIMULATION_MODEL.md)** for the full description.

- **Network** — 2×2 grid of signalised intersections; each road is two directed links; boundary
  roads become entry/exit stubs. Vehicles choose a destination and follow a shortest path.
- **Demand** — synthetic per-entry arrival rates, drawn from a seeded PRNG each tick
  (Bernoulli approximation of a Poisson process). Optional surge profile and demand scaling.
- **Movement** — vehicles advance at the link speed limit, constrained by a minimum gap to the
  vehicle ahead; they queue at the stop line and spill back when queue storage is full.
- **Signals** — `green → amber → all-red → green`. Never conflicting greens. Fixed mode uses a
  configured cycle split; adaptive mode re-evaluates every tick using
  `score = 0.6·Qnorm + 0.3·Wnorm + 0.1·Anorm`, with minimum green, maximum green, a switching
  margin, starvation prevention and optional emergency preemption.
- **Reproducibility** — identical scenario + duration + demand + seed produce identical results,
  which makes fixed-vs-adaptive comparisons fair. Run documents store the seed and all settings.

---

## Metrics definitions

`GET /api/metrics/definitions` returns these programmatically. Highlights:

| Metric | Definition |
| --- | --- |
| Average waiting time | Total time all vehicles spent below 0.5 m/s ÷ vehicles that entered the network |
| Average travel time | Mean elapsed time of vehicles that completed their trips |
| Max queue length | Largest simultaneous queued/stopped total on a single approach |
| Throughput | Vehicles that completed their trip and exited |
| Fairness | Jain's index over per-approach average signal waits (1.0 = equal) |
| Improvement % | Lower-is-better: `(fixed − adaptive)/fixed × 100`. Higher-is-better: `(adaptive − fixed)/fixed × 100`. Zero baselines are reported as not computable, never as Infinity |

All values are **measured**, never hardcoded.

---

## Scenarios

| ID | Scenario | Purpose |
| --- | --- | --- |
| `saddar-balanced` | Saddar Core — Balanced Demand | Baseline stability; ~840 veh/h per entry |
| `shahrah-faisal-ns-surge` | Heavy North–South Demand | Directional imbalance; 1,400–1,500 veh/h N/S |
| `rush-hour-surge` | Rush-Hour Surge | Demand ramps 0.6× → 1.9× mid-run |
| `blocked-approach` | Blocked Approach (Road Works) | Full closure of I4 west approach; tests hotspot and incident logic |

Each scenario response includes `assumptions` and a `disclaimer` stating that demand and geometry
are prototype assumptions, not measured city data.

---

## Testing

```bash
npm test
```

49 tests cover:

- deterministic PRNG behaviour
- network geometry, approach orientation, routing, demand-key validity
- engine execution in both modes, reproducibility, demand parity across modes
- signal safety invariants (min green, spacing between switches, max green, no conflicting greens)
- blocked approach behaviour and `clearBlocked` override
- emergency preemption
- recording/frames
- metrics: fairness, zero-denominator handling, improvement direction, aggregation
- hotspot detection, blocked-approach classification, recommendation screening
- full HTTP API: health, scenarios, runs, metrics, frames, compare, experiments, export,
  validation errors, 404s and deletion

---

## Docker

```bash
docker compose up --build
```

Starts the API (`:4000`) and MongoDB (`:27017`) with persistence.

---

## Demo script

With the API running:

```bash
npm run demo
```

Produces a console walkthrough (baseline → adaptive → multi-seed comparison → hotspots →
interventions) and writes `reports/raasta-demo-*.json` and `.md`.

Environment overrides: `RAASTA_API_URL`, `DEMO_SCENARIO`, `DEMO_DURATION`, `DEMO_SEEDS`.

---

## Assumptions and limitations

- Demand, geometry and signal timings are **documented prototype assumptions**, not measured
  Karachi data. Every scenario states this in its `assumptions` and `disclaimer`.
- The simulator is a deliberately small deterministic model, not SUMO/CityFlow. Car-following,
  turning behaviour and lane changes are simplified (see docs).
- Hotspots are screening candidates derived from simulated queues and waits, with transparent
  thresholds and evidence-strength labels — not verified defects.
- Intervention output ranks options for further investigation. It never approves construction;
  grade-separation mentions always require a separate feasibility study.
- Emergency priority is a documented simplification (priority queuing + preemption), not a
  certified emergency-preemption system.
- No live Karachi traffic feed is connected. Map coordinates are approximate context only.
- No authentication, authorisation or rate limiting is implemented. Add these before exposing the
  API publicly; it is intended for a local demo / trusted network.

---

## Notes for the frontend team

1. Call `GET /api/scenarios` first; render the network from `scenario.network` (x/y in metres).
   Use `worldBounds` (included in scenario summaries) as the canvas extent — it includes the
   external entry/exit stubs, so vehicles never render outside the frame.
2. Never compute signal states client-side — display `state`, `greenSides` and queues from
   `/api/simulations/:id/metrics` (time series) or Socket.IO updates.
3. For animation, either:
   - run `live: true` and consume `simulation:update` (recommended), or
   - run `record: true`, then replay `GET /api/simulations/:id/frames`.
4. Show the `disclaimer`/`assumptions` fields and label all results as **simulated**.
5. Use `POST /api/simulations/compare` for the Performance Lab — it already returns
   `comparison.rows` with direction-aware improvements and guarded zero denominators.
6. Handle `improvementPct: null` (not computable) in the UI instead of rendering `Infinity`.
7. `GET /api/dashboard` returns everything the Command Center needs in one call: latest KPIs,
   a prototype congestion level, hotspot alerts, recent runs and experiments.

---

## License

MIT — hackathon prototype, provided as-is.
