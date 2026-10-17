# RAASTA AI — Simulation Model & Controller Design

This document describes exactly how the RAASTA AI simulator works, what it measures, and — just
as importantly — what it does **not** model. It is written so that the team can defend the
prototype honestly in a demo and extend it without guessing.

> The simulator is a deliberately small, deterministic, microscopic model built for a hackathon.
> It is **not** SUMO, CityFlow or a calibrated digital twin of Karachi.

---

## 1. Network model

### Geometry

- Each scenario defines 4 intersections on a local metric canvas (`x`, `y` in metres, `y` grows
  southwards) plus the roads between them. The default network is a 2×2 grid.
- Every road becomes **two directed links**, one per travel direction. A link knows its origin,
  destination, length, speed limit, lane count and the side of the destination through which
  vehicles arrive.
- Each intersection has four compass **approaches** (`N`, `S`, `E`, `W`). An approach is the
  incoming link whose destination is that intersection.
- Sides with no internal road get an **external stub** of `entryLengthM` (420 m): an inbound entry
  link where new vehicles are injected, and an outbound exit link where trips end.
- With the default 2×2 grid this yields 8 boundary entries and 8 exits.

### Routing

- Vehicles are generated at a boundary entry, choose a destination intersection among the other
  intersections, and follow a **shortest path by road length** (Dijkstra, precomputed per pair).
- At the destination they leave through an exit stub, preferring to continue straight through the
  intersection.
- Each vehicle tracks its path and current hop. On discharge it selects the outgoing link towards
  the next hop; the turn is classified as `straight`, `left` or `right` for movement statistics.

### Signal phases

Each intersection has exactly two explicit phases:

| Phase | Approaches served |
| --- | --- |
| `NS` (index 0) | `N`, `S` |
| `EW` (index 1) | `E`, `W` |

Compatible movements are modelled by approach group. **All movements from a served approach are
allowed together**; opposing through movements are never green simultaneously. Turning conflicts
inside a phase are not modelled at the movement level (documented simplification).

---

## 2. Demand model

- Each boundary entry has a rate in vehicles per hour from the scenario definition.
- Effective rate per tick:
  `rate_eff = rate_base × demandScale × surge(t)`.
- Arrivals are drawn from a **seeded PRNG** every simulated second with
  `p = rate_eff / 3600 × tickSec` — a Bernoulli approximation of a Poisson process (fine for the
  default 1 s tick and moderate rates).
- The `rush-hour-surge` scenario ramps the multiplier linearly between `startFraction` and
  `endFraction` of the run (0.6× → 1.9×) and then returns to 1.0×.
- **Arrival generation is independent of the controller**, so the same seed produces exactly the
  same vehicles in fixed and adaptive runs. This is what makes paired comparisons fair.

All rates are synthetic and documented in each scenario's `assumptions`. They are not counts from
Karachi.

---

## 3. Vehicle movement

- A vehicle enters at the start of an entry link and moves towards the intersection at the link's
  speed limit (40–45 km/h in the default network).
- Movement uses a simplified **follow-the-leader** rule:
  a vehicle's position each tick is `min(pos + v·Δt, leader.pos − MIN_GAP)`, with a 7 m minimum gap.
  No lane changing, overtaking or lane-specific behaviour is modelled; the lane count controls
  discharge capacity and queue storage, not lane assignment.
- When a vehicle reaches the end of a link it joins the approach **queue** (FIFO) up to
  `lanes × 12` vehicles. If the queue is full, the vehicle stays at the end of the link and blocks
  followers — a simple **spillback** mechanism.
- When discharged it enters the next link at position 0, or completes its trip at the end of an
  exit stub.
- A vehicle is counted as **stopped** when its speed is below 0.5 m/s.

### Discharge (saturation flow)

- While an approach is green, it accumulates discharge credit at
  `saturationFlowPerLane (1800 veh/h) × lanes` and releases one vehicle per whole unit of credit
  (capped carry-over). With 2 lanes this is roughly one vehicle per second.
- Discharge is blocked if the receiving link's mouth is occupied (**spillback**).
- A closed approach (`blocked`) receives no discharge at all — simulating a full lane closure.

---

## 4. Signal controller

Both modes share the same safe state machine:

```
green ──(switch decision)──▶ amber ──(amberSec)──▶ all-red ──(allRedSec)──▶ green (next phase)
```

Safety constraints, enforced in code and covered by tests:

- No direct transition between conflicting greens.
- Minimum green (`minGreenSec`, default 12 s) before any switch.
- Maximum green (`maxGreenSec`, default 45 s), with a bounded extension only for an emergency.
- Amber (3 s) and all-red (1 s) clearance intervals.
- A closed approach is excluded from priority scoring (green cannot serve it).

### Fixed-time baseline

- Cycle length `fixedCycleSec` (default 70 s) minus clearance gives usable green.
- The first phase receives `fixedSplit` (default 0.5) of usable green; remaining phases split the
  rest. Service order alternates phases.

### Adaptive controller (rule-based)

At every tick of green, the controller computes a priority score per approach:

```
Q̂ = queue / max(queue over approaches)
Ŵ = maxWait / max(maxWait over approaches)
Â = arrivalsPerMin / max(arrivalsPerMin over approaches)

score = 0.6·Q̂ + 0.3·Ŵ + 0.1·Â
```

Phase urgency is the maximum score among its approaches. A switch to the competing phase is
considered when **all** hold:

1. minimum green has elapsed,
2. the challenger phase has queued vehicles,
3. its score ≥ `minMeaningfulScore`,
4. its score exceeds the active phase score by more than `switchMargin` (default 35%).

Additional rules:

- **Starvation prevention:** switch if a competing approach's maximum wait exceeds
  `starvationWaitSec` (default 90 s).
- **Maximum green:** force a switch at `maxGreenSec`.
- **Closed approaches:** score 0 (cannot use green), reported separately for hotspot analysis.
- **Emergency preemption:** if an emergency vehicle is approaching on a non-green approach, switch
  to its phase once minimum green is satisfied; hold green up to
  `maxGreenSec + emergencyExtraGreenSec` while it clears; priority vehicles in a served queue are
  moved to the front.

The coefficients and thresholds are documented **prototype starting values**, not traffic
engineering standards. The `signal` override lets you tune them per run.

### Explainability

Every switch creates a decision record:

```json
{
  "t": 214,
  "intersectionId": "I2",
  "fromPhase": "NS",
  "toPhase": "EW",
  "reason": "demand_priority",
  "explanation": "Competing phase priority 0.412 exceeds active phase 0.180 by more than 35%.",
  "details": { "currentPhaseScore": 0.18, "challengerScore": 0.412, "margin": 0.35 },
  "greenElapsedSec": 18
}
```

Reasons: `fixed_cycle`, `max_green`, `demand_priority`, `starvation_prevention`,
`emergency_preemption`. The log is capped (`SIM_DECISION_LOG_LIMIT`), with a total count stored in
`metrics.decisionLogEntries`.

---

## 5. Metrics

All metrics are computed from simulation state. Definitions are also exposed via
`GET /api/metrics/definitions`.

| Metric | Calculation |
| --- | --- |
| `averageWaitingTimeSec` | Σ time below 0.5 m/s over all vehicles ÷ vehicles spawned |
| `averageWaitingTimeCompletedSec` | Σ waiting time of completed vehicles ÷ completed |
| `averageTravelTimeSec` | Σ (exit time − entry time) ÷ completed |
| `maxQueueLength` | max over ticks of the network-wide queued/stopped total |
| `averageQueueLength` | network queued/stopped total averaged over ticks |
| `maxQueueLength` (per approach) | max simultaneous queue on that approach |
| `averageQueueLength` (per approach) | time average of that approach's queue |
| `averageSignalWaitSec` (per approach) | mean time between joining the stop-line queue and discharge |
| `throughputVehicles` | completed trips |
| `throughputVehPerHour` | completed ÷ duration × 3600 |
| `completionRatePct` | completed ÷ spawned × 100 |
| `averageStoppedVehicles` | time average of vehicles below 0.5 m/s |
| `totalStops` | count of moving → stopped transitions |
| `fairnessIndex` | Jain's index over per-approach average signal waits (approaches with service) |
| `imbalanceRatio` | max approach average wait ÷ mean approach average wait |

Jain's index: `(Σx)² / (n · Σx²)`, where `x` is each approach's average signal wait. 1 means equal
service; lower values mean some approaches wait far longer than others.

### Percentage improvement

```
lower-is-better :  (fixed − adaptive) / fixed × 100
higher-is-better:  (adaptive − fixed) / fixed × 100
```

- Positive always means **adaptive is better** in the simulated comparison.
- A zero baseline returns `improvementPct: null` with a note — never `Infinity`.
- Metrics with `informational: true` (phase switches) are excluded from the win count.

---

## 6. Reproducibility

A run is defined by:

```
scenario + mode + durationSec + demandScale + seed + overrides + tick settings
```

Given the same inputs, the engine produces byte-identical metrics, time series and decisions
(covered by tests). This lets a judge reproduce any demo comparison by re-running the same seed.

Run documents store the seed, duration, demand scale, overrides and engine version, so an
experiment can be audited later.

---

## 7. What is simplified (and must be stated in a demo)

- Two-phase control only; no protected turn phases, no permissive/opposing turn conflicts.
- Lane assignment is abstracted: lanes add discharge capacity and queue storage, but vehicles do
  not choose or change lanes.
- No pedestrians, buses, motorcycles-specific behaviour, parking, or road-side friction.
- No dynamic rerouting; routes are fixed shortest paths per vehicle.
- Spillback is approximated with link-mouth occupancy, not full block face modelling.
- Incident effects are binary (approach blocked or not), not partial lane closures.
- Emergency preemption is a simplification, not a certified system.
- Demand is synthetic and must be calibrated with field counts before any real-world conclusion.

---

## 8. Using the lab for counterfactuals

The PRP's Infrastructure Decision Lab compares:

| Configuration | How to run |
| --- | --- |
| **A. Baseline layout + fixed timings** | `POST /run` with `mode: "fixed"` |
| **B. Optimised signal timings** | `POST /run` with `mode: "adaptive"` (or `overrides.signal`) |
| **C. Hypothetical redesigned intersection** | `POST /run` with `overrides.laneOverrides` (capacity change) |

Compare A/B/C with the same scenario, duration, demand and seed. Report measured differences only,
label them as simulated, and add the required caveat: a flyover/underpass requires counts,
origin–destination analysis, geometry, safety, access, environmental, cost and feasibility studies.

---

## 9. Tuning guide

| Goal | Override |
| --- | --- |
| More balanced adaptive switching | increase `switchMargin`, `minGreenSec` |
| Faster response to surges | decrease `switchMargin`, increase `starvationWaitSec` sensitivity |
| Longer fixed greens | increase `fixedCycleSec` or change `fixedSplit` |
| More congestion for stress tests | increase scenario demand or `demandScale` |
| Simulate extra approach capacity | `laneOverrides[intersectionId].lanesPerApproach` |
| Simulate a closure | `blockApproaches` or use the `blocked-approach` scenario |
| Reopen a default closure | `clearBlocked: true` |
| Emergency scenario | `overrides.emergency` |
