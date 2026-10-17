# RAASTA AI — API Reference

Base URL: `http://localhost:4000/api` (configurable via `PORT`).

All responses are JSON.

```jsonc
// Success
{ "data": { ... }, "meta": { ... }, "pagination": { ... } }

// Error
{
  "error": {
    "message": "Request validation failed",
    "code": "BAD_REQUEST",
    "requestId": "a1b2c3d4",
    "details": [{ "path": "mode", "message": "Invalid enum value...", "code": "invalid_enum_value" }]
  }
}
```

Status codes used: `200` OK, `201` created, `202` accepted (live run), `400` validation,
`404` not found, `409` conflict (e.g. incomplete run), `500` unexpected error.

Every response carries an `x-request-id` header (echoed in error bodies).

---

## Contents

1. [Health & metadata](#1-health--metadata)
2. [Scenarios](#2-scenarios)
3. [Simulations](#3-simulations)
4. [Live simulations](#4-live-simulations)
5. [Hotspots](#5-hotspots)
6. [Recommendations](#6-recommendations)
7. [Experiments](#7-experiments)
8. [Metric definitions](#8-metric-definitions)
9. [Socket.IO contract](#9-socketio-contract)

---

## 1. Health & metadata

### `GET /api/health`

```bash
curl http://localhost:4000/api/health
```

```json
{
  "status": "ok",
  "service": "raasta-ai-backend",
  "apiVersion": "1.0.0",
  "engine": { "name": "raasta-sim", "version": "1.0.0" },
  "uptimeSec": 42,
  "db": { "mode": "memory", "connected": false, "reason": "MONGODB_URI not set (ephemeral store)", "persistent": false },
  "time": "2026-10-17T08:00:00.000Z"
}
```

### `GET /api`

Returns a discoverable index of endpoints and the Socket.IO contract.

### `GET /api/dashboard`

One call for the Command Center module.

```jsonc
{
  "data": {
    "generatedAt": "2026-10-17T08:00:00.000Z",
    "activeScenario": {
      "id": "saddar-balanced",
      "name": "Saddar Core — Balanced Demand",
      "city": "Karachi",
      "disclaimer": "Simulated scenario...",
      "mapContext": { "center": { "lat": 24.8582, "lng": 67.031 }, "zoom": 15 }
    },
    "latestSimulation": { "id": "sim_...", "mode": "fixed", "status": "completed", "metrics": { } },
    "kpis": {
      "scenarioId": "saddar-balanced",
      "controlMode": "fixed",
      "seed": 42,
      "durationSec": 600,
      "vehiclesSpawned": 1079,
      "vehiclesCompleted": 767,
      "vehiclesActiveAtEnd": 312,
      "averageWaitingTimeSec": 29.46,
      "maxQueueLength": 99,
      "averageQueueLength": 49.42,
      "throughputVehPerHour": 4602,
      "completionRatePct": 71.08,
      "fairnessIndex": 0.979,
      "congestionLevel": "high"
    },
    "alerts": [ { "id": "hs_...", "intersectionId": "I4", "side": "W", "severity": "medium", "likelyCauses": ["general_congestion"] } ],
    "alertSummary": { "totalCandidates": 11, "bySeverity": { "medium": 4, "low": 7 } },
    "recentRuns": [ { "id": "sim_...", "mode": "adaptive", "metrics": { } } ],
    "recentExperiments": [ { "id": "exp_...", "verdict": "adaptive_better_on_balance", "keyFindings": [] } ],
    "note": "Command Center aggregates the latest completed simulation. All values are simulated..."
  },
  "meta": { "congestionThresholds": { "medium": 12, "high": 25, "severe": 40, "unit": "vehicles (average network queue)" } }
}
```

`congestionLevel` is a documented prototype heuristic on the time-averaged network queue
(`low` < 12, `medium` ≥ 12, `high` ≥ 25, `severe` ≥ 40) and/or average waiting time.

---

## 2. Scenarios

### `GET /api/scenarios`

```json
{
  "data": [
    {
      "id": "saddar-balanced",
      "name": "Saddar Core — Balanced Demand",
      "city": "Karachi",
      "description": "Four connected intersections around Saddar with a roughly even directional split...",
      "tags": ["balanced", "must-have", "baseline"],
      "disclaimer": "Simulated scenario. Demand, geometry and signal timings are documented prototype assumptions...",
      "defaults": { "durationSec": 600, "seed": 42, "demandScale": 1 },
      "intersections": [
        { "id": "I1", "name": "Saddar Chowk", "lat": 24.8607, "lng": 67.029 }
      ],
      "totalEntryDemandVehPerHour": 6720,
      "blockedApproaches": [],
      "mapContext": { "center": { "lat": 24.8582, "lng": 67.031 }, "zoom": 15, "note": "Approximate locations..." },
      "worldBounds": { "minX": -120, "minY": -220, "maxX": 1320, "maxY": 1180, "width": 1440, "height": 1400, "paddingM": 420 },
      "signal": { "minGreenSec": 12, "maxGreenSec": 45, "amberSec": 3, "allRedSec": 1, "fixedCycleSec": 70, "fixedSplit": 0.5 },
      "assumptions": ["Synthetic arrivals: ~840 veh/h per external entry...", "..."]
    }
  ],
  "meta": {
    "count": 4,
    "note": "All scenarios are simulated prototypes with documented assumptions; they are not measured Karachi traffic data."
  }
}
```

### `GET /api/scenarios/:id`

Returns the complete scenario definition, including `network.intersections` (x/y in metres, lat/lng,
lanes), `network.roads` (length, speed limit, lanes), `demand` and signal settings. Useful for
drawing the simulator canvas.

`404` if unknown.

---

## 3. Simulations

### `POST /api/simulations/run`

Runs one controller mode over one scenario. Completes synchronously (typically 30–300 ms) unless
`live: true` is used.

#### Request body

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `scenarioId` | string | — | **required**, see `GET /api/scenarios` |
| `mode` | `"fixed"` \| `"adaptive"` | `"adaptive"` | control strategy |
| `durationSec` | integer | scenario default (`600`) | `60–3600` |
| `seed` | integer | scenario default (`42`) | same seed ⇒ same demand |
| `demandScale` | number | `1` | `0.1–3`, multiplies arrival rates |
| `label` | string | `null` | free-form run label |
| `live` | boolean | `false` | stream via Socket.IO |
| `tickMs` | integer | `LIVE_TICK_MS` (100) | real ms per simulated second (live only, `50–2000`) |
| `record` | boolean | `false` | store replay frames (short runs only) |
| `recordFrameIntervalSec` | number | `1` | frame sampling interval |
| `overrides` | object | `{}` | see below |

#### `overrides`

```jsonc
{
  "demandScale": 1.2,
  "laneOverrides": { "I4": { "lanesPerApproach": 3 } },
  "signal": {
    "minGreenSec": 12, "maxGreenSec": 45, "amberSec": 3, "allRedSec": 1,
    "fixedCycleSec": 70, "fixedSplit": 0.5, "switchMargin": 0.35,
    "starvationWaitSec": 90, "minMeaningfulScore": 0.2,
    "saturationFlowPerLane": 1800, "emergencyExtraGreenSec": 25, "emergencyLookaheadM": 220
  },
  "blockApproaches": [{ "intersectionId": "I2", "approach": "E", "reason": "Simulated incident" }],
  "clearBlocked": false,
  "emergency": {
    "enabled": true,
    "afterSec": 120,
    "entryIntersectionId": "I1",
    "entrySide": "N",
    "destinationIntersectionId": "I4"
  }
}
```

> `laneOverrides` is a **hypothetical capacity change** for counterfactual runs. It does not mean a
> flyover has been simulated.

#### Response `201`

```jsonc
{
  "data": {
    "id": "sim_mvc3r0it0001ymgs6g",
    "label": "Baseline demo",
    "scenarioId": "saddar-balanced",
    "scenarioName": "Saddar Core — Balanced Demand",
    "mode": "fixed",
    "seed": 42,
    "durationSec": 600,
    "demandScale": 1,
    "status": "completed",
    "live": false,
    "overrides": {},
    "engine": { "name": "raasta-sim", "version": "1.0.0", "tickSec": 1, "sampleIntervalSec": 5, "arrivalModel": "poisson-per-tick" },
    "metrics": {
      "averageWaitingTimeSec": 29.46,
      "averageWaitingTimeCompletedSec": 33.1,
      "averageTravelTimeSec": 170.89,
      "maxQueueLength": 99,
      "averageQueueLength": 49.42,
      "averageStoppedVehicles": 55.25,
      "throughputVehicles": 767,
      "throughputVehPerHour": 4602,
      "completionRatePct": 71.08,
      "fairnessIndex": 0.979,
      "phaseSwitches": 68,
      "preemptions": 0,
      "vehiclesSpawned": 1079,
      "vehiclesCompleted": 767,
      "vehiclesIncomplete": 312,
      "spawnCapReached": false
    },
    "perIntersection": [
      { "id": "I1", "name": "Saddar Chowk", "maxQueueLength": 15, "averageQueueLength": 3.1,
        "averageSignalWaitSec": 18.2, "phaseSwitches": 17, "preemptions": 0, "averageGreenSec": 31 }
    ],
    "perApproach": [
      { "intersectionId": "I4", "side": "W", "name": "W — Abdullah Haroon Road", "lanes": 2,
        "blocked": false, "arrivals": 60, "discharged": 58,
        "maxQueueLength": 9, "averageQueueLength": 3.2,
        "maxSignalWaitSec": 55, "averageSignalWaitSec": 18.4,
        "movements": { "straight": 40, "left": 8, "right": 10 },
        "dischargedVehPerHour": 348 }
    ],
    "fairness": { "jainIndex": 0.979, "interpretation": "1.0 = every approach receives equally long average signal waits.", "maxApproachAvgWaitSec": 22.1, "imbalanceRatio": 1.3 },
    "timeSeries": [
      { "t": 5, "activeVehicles": 3, "queuedVehicles": 0, "completedVehicles": 0,
        "averageWaitSecSoFar": 0, "totalQueue": 0,
        "intersections": [{ "id": "I1", "phaseIndex": 0, "state": "green", "greenSides": ["N", "S"],
                            "queueBySide": { "N": 0, "S": 0, "E": 0, "W": 0 }, "totalQueue": 0 }] }
    ],
    "decisions": [
      { "t": 31, "intersectionId": "I1", "fromPhase": "NS", "toPhase": "EW", "reason": "fixed_cycle",
        "explanation": "Fixed-time plan: green budget of 31s elapsed.", "greenElapsedSec": 31 }
    ],
    "assumptions": ["Synthetic arrivals: ~840 veh/h per external entry..."],
    "disclaimer": "Simulated scenario...",
    "framesIncluded": false,
    "runtimeMs": 74,
    "createdAt": "2026-10-17T08:00:00.000Z",
    "completedAt": "2026-10-17T08:00:00.074Z"
  },
  "meta": {
    "links": {
      "self": "/api/simulations/sim_...",
      "metrics": "/api/simulations/sim_.../metrics",
      "frames": "/api/simulations/sim_.../frames",
      "hotspots": "/api/hotspots?simulationId=sim_..."
    },
    "note": "All metrics are measured from simulation state. Demand is synthetic and documented in the scenario assumptions."
  }
}
```

For `live: true`, see [§4](#4-live-simulations).

---

### `POST /api/simulations/compare`

Runs fixed **and** adaptive with identical scenario, duration, demand and seed(s), persists an
experiment, and returns direction-aware improvement percentages.

#### Request body

| Field | Type | Default |
| --- | --- | --- |
| `scenarioId` | string | **required** |
| `durationSec` | integer | scenario default |
| `seed` | integer | scenario default (used if `seeds` absent) |
| `seeds` | integer[] | `[seed]`, max 10 |
| `demandScale` | number | `1` |
| `label` | string | `null` |
| `overrides` | object | `{}` |

```bash
curl -X POST http://localhost:4000/api/simulations/compare \
  -H 'Content-Type: application/json' \
  -d '{ "scenarioId": "saddar-balanced", "durationSec": 600, "seeds": [1, 2, 3] }'
```

#### Response `201`

```jsonc
{
  "data": {
    "experiment": {
      "id": "exp_mvc3r3q00008l01dsj",
      "label": "Demo experiment",
      "scenarioId": "saddar-balanced",
      "scenarioName": "Saddar Core — Balanced Demand",
      "seeds": [1, 2, 3],
      "durationSec": 600,
      "demandScale": 1,
      "overrides": {},
      "createdAt": "2026-10-17T08:00:00.000Z",
      "runtimeMs": 412,
      "disclaimer": "Simulated scenario...",
      "assumptions": ["..."]
    },
    "runs": {
      "fixed": [{ "id": "sim_...", "mode": "fixed", "seed": 1, "metrics": { "averageWaitingTimeSec": 30.2 } }],
      "adaptive": [{ "id": "sim_...", "mode": "adaptive", "seed": 1, "metrics": { "averageWaitingTimeSec": 21.1 } }]
    },
    "comparison": {
      "rows": [
        {
          "key": "averageWaitingTimeSec",
          "label": "Average waiting time",
          "unit": "s",
          "direction": "lower",
          "informational": false,
          "fixed": 30.27,
          "adaptive": 21.23,
          "improvementPct": 29.86,
          "better": "adaptive",
          "note": null
        }
      ],
      "summary": {
        "verdict": "adaptive_better_on_balance",
        "explanation": "Adaptive control improved more decisive metrics than it worsened in this simulated comparison.",
        "adaptiveWins": 4,
        "fixedWins": 1,
        "decisiveMetrics": 9,
        "seeds": [1, 2, 3],
        "caveat": "Simulated comparison with synthetic demand...",
        "keyFindings": ["Average waiting time: 30.27s → 21.23s (improved by 29.86%).", "..."]
      }
    },
    "aggregate": {
      "fixed": { "count": 3, "averageWaitingTimeSec": { "mean": 30.27, "stdDev": 1.1, "min": 29.1, "max": 31.4 } },
      "adaptive": { "count": 3, "averageWaitingTimeSec": { "mean": 21.23, "stdDev": 0.8, "min": 20.2, "max": 22.1 } }
    }
  }
}
```

**Improvement sign convention:** positive always means adaptive performed better.

- lower-is-better: `(fixed − adaptive) / fixed × 100`
- higher-is-better: `(adaptive − fixed) / fixed × 100`
- zero baseline: `improvementPct: null` with an explicit `note` (never `Infinity`).

`better` is `"adaptive"`, `"fixed"`, `"equal"` or `null` (not computable). `phaseSwitches` is
informational and excluded from the win count.

---

### `GET /api/simulations`

Query: `limit` (1–100, default 20), `offset`, `scenarioId`, `mode`, `status`, `experimentId`.

Returns summaries only (no time series/frames) plus pagination.

```json
{
  "data": [
    { "id": "sim_...", "label": null, "scenarioId": "saddar-balanced", "mode": "adaptive",
      "seed": 42, "durationSec": 600, "status": "completed", "live": false,
      "createdAt": "...", "runtimeMs": 88,
      "metrics": { "averageWaitingTimeSec": 21.01, "maxQueueLength": 59, "throughputVehicles": 784 } }
  ],
  "pagination": { "total": 12, "limit": 20, "offset": 0, "hasMore": false }
}
```

### `GET /api/simulations/:id`

Full run document. Frames are **excluded** by default (`framesIncluded: false`); add
`?includeFrames=true` to embed them.

`404` if not found.

### `GET /api/simulations/:id/metrics`

```json
{
  "data": {
    "simulationId": "sim_...",
    "status": "completed",
    "scenarioId": "saddar-balanced",
    "mode": "adaptive",
    "seed": 42,
    "durationSec": 600,
    "metrics": { "...": "..." },
    "fairness": { "jainIndex": 0.96, "interpretation": "...", "maxApproachAvgWaitSec": 24.1, "imbalanceRatio": 1.4 },
    "perIntersection": [],
    "perApproach": [],
    "timeSeries": [],
    "decisions": [],
    "disclaimer": "..."
  }
}
```

### `GET /api/simulations/:id/frames`

Recorded replay frames (only when the run was created with `record: true`):

```json
{
  "data": {
    "simulationId": "sim_...",
    "recorded": true,
    "framesTruncated": false,
    "count": 120,
    "frames": [
      {
        "t": 1,
        "vehicles": [{ "id": "v1", "x": 300, "y": 620, "speedKph": 40 }],
        "signals": {
          "I1": { "phaseIndex": 0, "phaseName": "NS", "state": "green", "greenSides": ["N", "S"] }
        }
      }
    ],
    "note": "Recorded frames are sampled at a fixed interval from the deterministic engine."
  }
}
```

### `GET /api/simulations/:id/state`

Live/current state. For a running live simulation: the latest tick snapshot. For a completed run:
`{ completed: true, metrics, timeSeries }`-style summary.

### `DELETE /api/simulations/:id`

`{ "data": { "id": "sim_...", "deleted": true } }`

---

## 4. Live simulations

`POST /api/simulations/run` with `"live": true` responds **`202 Accepted`**:

```json
{
  "data": { "id": "sim_...", "status": "running", "live": true, "scenarioId": "...", "mode": "adaptive" },
  "meta": {
    "live": true,
    "socket": {
      "event": "simulation:update",
      "subscribeEvent": "simulation:subscribe",
      "room": "simulation:sim_...",
      "simulationId": "sim_..."
    },
    "polling": "/api/simulations/sim_.../state"
  }
}
```

The engine advances one simulated second every `tickMs` real milliseconds. At completion the
document is persisted with `status: "completed"` and full metrics, and a `simulation:completed`
event is emitted.

---

## 5. Hotspots

### `GET /api/hotspots?simulationId=<id>&limit=10&minSeverity=medium`

If `simulationId` is omitted, the **latest completed** simulation is used
(`meta.derivedFrom = "latest_completed_simulation"`).

```jsonc
{
  "data": {
    "simulationId": "sim_...",
    "scenarioId": "blocked-approach",
    "scenarioName": "Saddar Core — Blocked Approach (Road Works)",
    "mode": "fixed",
    "seed": 42,
    "durationSec": 600,
    "generatedAt": "2026-10-17T08:00:00.000Z",
    "thresholds": {
      "averageQueueLength": 5, "maxQueueLength": 12, "averageSignalWaitSec": 30,
      "serviceRatio": 0.85, "leftTurnShare": 0.25, "approachImbalance": 1.8, "blockedMinQueue": 3
    },
    "summary": {
      "totalCandidates": 12,
      "returned": 10,
      "bySeverity": { "critical": 1, "high": 2, "medium": 2, "low": 7 },
      "topIntersections": ["I4", "I2", "I1"],
      "note": "Ranked by a transparent rule-based score; no machine-learning confidence is implied."
    },
    "hotspots": [
      {
        "id": "hs_sim_..._I4_W",
        "simulationId": "sim_...",
        "intersectionId": "I4",
        "intersectionName": "Fresco Chowk",
        "side": "W",
        "approachName": "W — Abdullah Haroon Road",
        "location": { "lat": 24.8559, "lng": 67.0332, "label": "Fresco Chowk", "approximate": true },
        "severity": "critical",
        "score": 0.85,
        "evidenceStrength": "high",
        "evidence": {
          "observedPeriodSec": 600, "controlMode": "fixed", "seed": 42,
          "averageQueueLength": 14.35, "maxQueueLength": 25,
          "averageSignalWaitSec": 0, "maxSignalWaitSec": 0,
          "arrivals": 24, "discharged": 0, "serviceRatio": 0,
          "blocked": true, "lanes": 2,
          "turningMovements": { "straight": 0, "left": 0, "right": 0 },
          "leftTurnShare": 0, "queueShareOfNetworkPct": 22.4,
          "intersectionAverageQueueLength": 4.8, "approachQueueImbalance": 3.1
        },
        "indicators": [
          { "metric": "averageQueueLength", "value": 14.35, "unit": "vehicles", "threshold": 5, "exceeded": true },
          { "metric": "averageSignalWaitSec", "value": 0, "unit": "s", "threshold": 30, "exceeded": false }
        ],
        "likelyCauses": ["approach_closure"],
        "preliminaryInterventions": ["Incident / closure management", "Diversion or rerouting"],
        "caveat": "Derived from simulated data only. Preliminary screening for further investigation; professional traffic-engineering validation required."
      }
    ],
    "caveat": "Hotspots are simulated screening candidates. They must not be used to justify construction or operational changes without field data and professional review."
  }
}
```

`409` if the selected simulation is not completed.

---

## 6. Recommendations

### `POST /api/recommendations/evaluate`

Accepts **one** of:

```jsonc
{ "simulationId": "sim_..." }   // detect + screen every hotspot
{ "hotspot": { ... } }          // screen a hotspot object (e.g. stored by the client)
{ "metrics": { ... } }          // screen caller-supplied aggregate metrics (low confidence)
```

```jsonc
{
  "data": {
    "simulationId": "sim_...",
    "scenarioId": "blocked-approach",
    "mode": "fixed",
    "seed": 42,
    "generatedAt": "2026-10-17T08:00:00.000Z",
    "summary": {
      "hotspotsEvaluated": 12,
      "bySeverity": { "critical": 1, "high": 2, "medium": 2, "low": 7 },
      "highestSeverity": "critical",
      "note": "Interventions are ranked for further investigation; they are not approvals."
    },
    "evaluations": [
      {
        "hotspotId": "hs_...",
        "intersectionId": "I4",
        "intersectionName": "Fresco Chowk",
        "side": "W",
        "severity": "critical",
        "score": 0.85,
        "evidenceStrength": "high",
        "likelyCauses": ["approach_closure"],
        "interventions": [
          {
            "type": "incident_management",
            "title": "Manage or remove the closure, then re-measure",
            "rationale": "This approach is closed in the scenario, so no control strategy can discharge the queue...",
            "supportingEvidence": ["Average queue length: 14.35 vehicles", "..."],
            "confidence": "high",
            "studyRequired": false,
            "canSignalTimingSolve": false,
            "nextSteps": ["Confirm the closure or incident with field observation.", "..."]
          }
        ],
        "caveats": ["Simulated output with synthetic demand...", "..."],
        "disclaimer": "Preliminary simulation-based screening only. Not an engineering recommendation..."
      }
    ],
    "caveat": "Preliminary simulation-based screening only..."
  }
}
```

Intervention `type` values: `incident_management`, `signal_optimization`, `turn_restriction`,
`lane_or_road_redesign`, `grade_separation_study`.

Rules (documented and deterministic):

| Evidence | Intervention |
| --- | --- |
| Approach closed / blocked | `incident_management` (explicitly: signals cannot restore capacity) |
| High signal wait and/or demand imbalance | `signal_optimization` |
| Left-turn share ≥ 25% with queues | `turn_restriction` + `lane_or_road_redesign` |
| Service ratio < 0.85 with persistent queues | `lane_or_road_redesign` |
| Severe + persistent + long run (score ≥ 0.65, ≥ 600 s) | `grade_separation_study` (study only, low confidence, with mandatory caveat) |

`grade_separation_study` is **never** emitted for a closure hotspot.

---

## 7. Experiments

### `GET /api/experiments?limit=&offset=&scenarioId=`

List of experiments with `verdict` and `keyFindings` from the stored comparison.

### `GET /api/experiments/:id`

Experiment document plus `runsDetail.fixed[]` / `runsDetail.adaptive[]` run summaries.

### `GET /api/experiments/:id/export?format=json|csv`

- `json` — full experiment, runs and comparison with a `disclaimer`.
- `csv` — one row per compared metric:
  `metric,unit,direction,fixed_mean,adaptive_mean,improvement_pct,better`

Response headers include `Content-Type` and `Content-Disposition` (download filename).

---

## 8. Metric definitions

`GET /api/metrics/definitions` returns definitions, directions and units for every metric,
including the improvement formula and the "simulated data" caveat. See the README table for the
summary.

---

## 9. Socket.IO contract

Transport: Socket.IO v4 on the same host/port, default path `/socket.io`.

### Events

| Event | Direction | Payload |
| --- | --- | --- |
| `server:hello` | server → client | `{ service, apiVersion, engineVersion, time }` on connection |
| `simulation:subscribe` | client → server | `{ simulationId }` |
| `simulation:subscribed` | server → client | `{ simulationId, room }` |
| `simulation:update` | server → client | see below |
| `simulation:completed` | server → client | `{ simulationId, status: "completed", metrics }` |
| `simulation:failed` | server → client | `{ simulationId, error }` |
| `simulation:unsubscribe` | client → server | `{ simulationId }` |

### `simulation:update`

```jsonc
{
  "simulationId": "sim_...",
  "status": "running",
  "t": 137,
  "durationSec": 600,
  "progressPct": 22.8,
  "completed": false,
  "mode": "adaptive",
  "scenarioId": "rush-hour-surge",
  "counts": { "active": 184, "completed": 96, "spawned": 280, "queued": 41 },
  "metricsSoFar": { "averageWaitingTimeSec": 18.2, "maxQueueLength": 37, "throughputVehicles": 96 },
  "intersections": [
    { "id": "I1", "name": "Saddar Chowk", "phaseIndex": 0, "phaseName": "NS",
      "state": "green", "greenSides": ["N", "S"], "queueBySide": { "N": 3, "S": 5, "E": 2, "W": 1 },
      "totalQueue": 11, "switches": 12 }
  ],
  "vehicles": [ { "id": "v184", "x": 512, "y": 200, "speedKph": 23 } ],
  "signals": { "I1": { "phaseIndex": 0, "phaseName": "NS", "state": "green", "greenSides": ["N", "S"] }, "I2": {} }
}
```

> Payload fields: `counts` holds vehicle totals; `vehicles` is the array of vehicle positions for
> rendering; `signals` holds the authoritative signal states per intersection. Poll
> `GET /api/simulations/:id/state` for the same snapshot outside Socket.IO.

### Client example

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');
socket.emit('simulation:subscribe', { simulationId });

socket.on('simulation:update', (state) => {
  // render state.vehicles (positions) and state.signals (authoritative signal states)
});

socket.on('simulation:completed', ({ metrics }) => {
  console.log('Run complete', metrics.averageWaitingTimeSec);
});
```

---

## Simulation document reference

| Field | Description |
| --- | --- |
| `id` | Simulation id (`sim_...` in memory mode, ObjectId string in Mongo) |
| `status` | `queued` \| `running` \| `completed` \| `failed` |
| `engine` | Engine name/version and tick settings (provenance) |
| `metrics` | Aggregated measured metrics |
| `perIntersection` | Per-intersection aggregates |
| `perApproach` | Per-approach aggregates, movements and blocked flag |
| `fairness` | Jain index, explanation, max approach wait, imbalance ratio |
| `timeSeries` | Sampled network state (default every 5 s) |
| `decisions` | Explainable signal decisions (capped at `SIM_DECISION_LOG_LIMIT`) |
| `frames` | Optional recorded replay frames (separate guard on payload size) |
| `assumptions` | Scenario assumptions + synthetic-data notice |
| `disclaimer` | Prototype limitation text |
| `experimentId` | Set when the run belongs to a comparison experiment |
| `runtimeMs` | Wall-clock engine runtime |
