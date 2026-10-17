# RAASTA AI — Karachi Smart Traffic Management System
## Product Requirements Proposal (PRP) Master Reference Specification

> **Document Status:** Official Reference derived from the 14-page RAASTA AI PRP PDF.  
> **Source Document:** [`docs/RAASTA_AI_PRP.pdf`](./RAASTA_AI_PRP.pdf)  
> **Tagline:** *Simulate. Optimize. Prove.*  
> **Target Audience:** 24+ student MERN development team | 5-Hour Delivery Target.

---

### 1. Executive Summary & Product Vision
- **Vision:** A Karachi-focused traffic simulation and decision-support web application that compares conventional fixed-time traffic signals against an adaptive controller under identical simulated traffic conditions.
- **Core Product:** **Karachi Traffic Decision Lab** — an environment where operators, planners, and judges can test interventions, observe vehicle movement, queue lengths, delays, and throughput, and understand which problems can be alleviated through signal optimization versus those requiring physical infrastructure changes.
- **Core Promise:** RAASTA AI does not simply display traffic congestion; it enables teams to test interventions, measure simulated effects objectively, and explain actionable operational/infrastructure decisions.

---

### 2. Problem Statement, Goals & Non-Goals

#### 2.1 The Problem
Karachi's traffic congestion stems from uneven directional demand, uncoordinated fixed-time signal cycles, turning conflicts, lane bottlenecks, and unpredictable incidents. Traditional static dashboards only display delays without answering whether an intervention will actually work. Simulation provides the necessary controlled, repeatable environment.

#### 2.2 Core MVP Goals
1. Deliver a working end-to-end web application in under 5 hours.
2. Simulate a network of **at least four connected signalised intersections** with realistic vehicle queues and movements.
3. Provide two distinct control modes: **Fixed-Time Baseline** and **Adaptive Signal Control**.
4. Enable rigorous, fair A/B comparisons with **identical demand profiles, duration, network layout, and random seed**.
5. Compute real metrics derived strictly from internal simulation state (waiting time, queue lengths, throughput, stops, fairness).
6. Flag persistent congestion hotspots and provide explainable, rule-based infrastructure intervention recommendations.
7. Support a collaborative team workflow across 6 specialized sub-teams with clear branch ownership.

#### 2.3 Non-Goals for the 5-Hour MVP
- Controlling physical public traffic lights or interfacing with live city infrastructure.
- Claiming citywide real-time coverage without verified camera or sensor feeds.
- Training complex Deep Reinforcement Learning (RL) models from scratch during the hackathon.
- Making final engineering approvals or claiming flyovers/underpasses are mandatory based purely on prototype simulation metrics.
- Constructing a complete digital twin of all Karachi roads.

---

### 3. Proposed Differentiators
1. **Karachi Scenario Lab:** Named corridors and intersections (e.g., Saddar / M.A. Jinnah / Sharea Faisal corridors) with explicit geometric and demand assumptions.
2. **Peak-Hour Stress Tests:** Configurable traffic demand patterns (normal flow, rush-hour surge, uneven directional imbalance, and blocked lanes/incidents).
3. **Explainable Adaptive Control:** Transparent decision logging showing *why* an approach was granted green time based on queues, waiting accumulation, and arrival rates.
4. **Infrastructure Decision Lab:** Evaluating whether signal optimization resolves the bottleneck or if hypothetical road layout changes (channelization, turn bans, grade separation) are warranted.
5. **Evidence Mode:** Storing exact run parameters, random seeds, and raw time-series metrics so judges can independently verify and reproduce comparisons.

---

### 4. System Architecture & Tech Stack

#### 4.1 Recommended Technology Stack
- **Frontend:** React + Vite (Single Page Application)
- **Styling:** Bootstrap 5.3 (or Tailwind CSS), Dark Navy / Teal theme
- **Visualization & Charts:** Recharts (delays, throughput, queues over time)
- **Geographic Context:** Leaflet + OpenStreetMap (markers, context overlays)
- **Backend:** Node.js + Express (REST API + orchestration)
- **Real-Time Engine:** Socket.IO (`simulation:update` events)
- **Database:** MongoDB + Mongoose (with automated In-Memory fallback)
- **Simulation Engine:** Deterministic JavaScript microscopic simulation engine (1 s ticks, car-following, queue spillback)

#### 4.2 Architectural Flow
```
[React + Vite Frontend (UI/UX)]
         │
         ▼  (REST API & Socket.IO Events)
[Node.js + Express Backend Orchestrator]
   ├── Scenario Service (network geometry, demand, seeds)
   ├── Simulation Service (ticks, vehicle queues, physics)
   ├── Signal Controller (Fixed-time vs. Adaptive logic)
   ├── Metrics Service (delay, throughput, fairness, stops)
   └── Hotspot & Infrastructure Intelligence Service
         │
         ▼
[MongoDB Persistence / In-Memory Storage]
```

---

### 5. Core Modules & Feature Requirements

| Module | Priority | Requirements |
|---|---|---|
| **Command Center** | Must-Have | Overview card, active scenario indicator, live vehicle count, average network delay, throughput, active congestion alerts, and network map/layout. |
| **Traffic Simulator** | Must-Have | Canvas/SVG grid of 4 connected intersections, animated vehicle movement, live signal states (Red/Amber/Green), playback controls (Start/Pause/Reset), speed/intensity controls, mode toggle. |
| **Performance Lab** | Must-Have | Paired A/B comparison (Fixed vs. Adaptive) with matched seeds. Metrics: average waiting time, average travel time, maximum queue length, throughput, stops, % improvement calculation. |
| **Infrastructure Intelligence** | Must-Have | Persistent hotspot detection, rule-based screening for interventions: (1) Signal optimization, (2) Lane/road redesign, (3) Turn restrictions, (4) Flyover/Underpass feasibility study. Explanations and caveats. |
| **Emergency Corridor** | Stretch | Dynamic priority preemption for emergency vehicles with safe clearance intervals. |
| **Experiment History** | Stretch | Persist past simulation runs and comparison experiments; export results as JSON / CSV. |

---

### 6. Simulation Model & Adaptive Algorithm

#### 6.1 State Representation
- **Intersection:** Unique ID, connected approaches (N, S, E, W), active phase, phase elapsed time, clearance state.
- **Approach / Lane:** Queue length ($Q$), waiting-time accumulation ($W$), arrival rate ($A$), permitted turning movements.
- **Vehicle:** ID, approach/lane position, velocity, entry time, wait duration, route.
- **Scenario:** Road network layout, demand schedule, run duration, random seed.

#### 6.2 Adaptive Demand-Priority Scoring Formula
$$P_i = 0.6 \cdot Q_i + 0.3 \cdot W_i + 0.1 \cdot A_i$$
- $Q_i$: Normalized current queue length on approach $i$.
- $W_i$: Normalized cumulative waiting time on approach $i$ (prevents starvation).
- $A_i$: Normalized incoming arrival rate on approach $i$.

#### 6.3 Safety & Fairness Constraints
1. **Never switch directly between conflicting green phases.**
2. Enforce strict **minimum green** (e.g. 10 s), **maximum green** (e.g. 60 s), **amber clearance** (e.g. 3–4 s), and **all-red clearance** (e.g. 1–2 s).
3. Prevent starvation of minor approaches via the weighted wait-time parameter $W_i$ and maximum wait thresholds.
4. Model compatible movements explicitly (e.g., dual opposing greens without conflicting left turns).

#### 6.4 Baseline Fixed-Time Control
- Consistent cycle length (e.g., 60 s or 90 s) split evenly or based on historical ratios across phases with identical clearance intervals.

---

### 7. Metrics & Improvement Formulas

#### 7.1 Measured Metrics
- **Average Waiting Time ($s$):** Total vehicle stopped time divided by total vehicle count.
- **Average Travel Time ($s$):** Total time from entry to exit for completed vehicles.
- **Maximum Queue Length (veh):** Peak instantaneous queue observed on any approach.
- **Throughput (veh/hr or veh/sim):** Total vehicles successfully completing their routes.
- **Stops Count:** Cumulative count of vehicle stop events.
- **Fairness Index:** Variance or ratio of delay between the most-delayed and least-delayed approaches.

#### 7.2 Percentage Improvement Formulas
- For metrics where **lower is better** (Delay, Queue, Stops):
  $$\text{Improvement } (\%) = \left(\frac{\text{Fixed} - \text{Adaptive}}{\text{Fixed}}\right) \times 100$$
- For metrics where **higher is better** (Throughput):
  $$\text{Improvement } (\%) = \left(\frac{\text{Adaptive} - \text{Fixed}}{\text{Fixed}}\right) \times 100$$
- *Rule:* Zero denominators must be handled safely; values must never be hardcoded.

---

### 8. Required Experiment Scenarios
1. **Balanced Demand:** Symmetric vehicle arrival rates on all corridors to test controller stability and avoid unnecessary phase flapping.
2. **Heavy North–South Demand:** Major arterial rush-hour simulation checking if the adaptive controller prioritizes heavy queues without indefinitely starving East-West traffic.
3. **Rush-Hour Surge:** Step-increase in arrival rates over time to test how quickly the queue detection responds to rapid congestion buildup.
4. **Blocked Approach / Incident:** Simulated lane obstruction or accident testing hotspot identification and operational rerouting/clearance suggestions.

---

### 9. Infrastructure Intelligence Screening Rules
- **Signal Optimization:** Triggered when high delay is paired with unequal green allocation or demand surges that can be mitigated by phase adjustments.
- **Lane / Road Redesign:** Triggered when queues persist due to physical capacity bottlenecks, merging conflicts, or insufficient storage bays.
- **Turn Restrictions:** Triggered when turning vehicles repeatedly block through-movement lanes.
- **Grade Separation (Flyover / Underpass):** Screened only when extreme congestion persists across both fixed and optimized signal regimes. Must always include the caveat: *"Preliminary simulation screening; requires comprehensive origin-destination surveys, geometric design, and professional traffic engineering validation."*

---

### 10. API Endpoints Contract
- `GET /api/scenarios` — Retrieve all predefined scenario configurations.
- `POST /api/simulations/run` — Execute or start a single simulation run (mode, duration, demand, seed).
- `POST /api/simulations/compare` — Execute paired runs (Fixed vs. Adaptive) with matched settings.
- `GET /api/simulations/:id` — Retrieve simulation status and configuration.
- `GET /api/simulations/:id/metrics` — Retrieve final summary metrics and per-tick time-series data.
- `GET /api/hotspots` — List identified congestion hotspots from simulation runs.
- `POST /api/recommendations/evaluate` — Evaluate hotspot evidence against infrastructure screening rules.
- Socket.IO Event: `simulation:update` — Streaming tick data (intersections, signals, vehicles, queues).

---

### 11. 24-Student Team Organization (6 Sub-Teams)
1. **Team A — Frontend & UX (6 members):** React app shell, sidebar navigation, Command Center, Simulator Canvas, Recharts charts, responsive styling.
2. **Team B — Simulation & Adaptive Logic (5 members):** 4-intersection deterministic engine, vehicle movement, collision/following rules, adaptive priority scoring algorithm, fixed baseline.
3. **Team C — Backend & Database (4 members):** Express routing, controller orchestration, MongoDB Mongoose schemas, Socket.IO streaming, in-memory fallback.
4. **Team D — Maps & Infrastructure Intelligence (3 members):** Leaflet map integration, Karachi scenario geolocation tags, hotspot detection engine, intervention screening rules.
5. **Team E — QA & Evaluation (3 members):** Test execution, verification of improvement formulas, seed reproducibility checks, edge-case testing (zero cars, blocked lane).
6. **Team F — Integration, DevOps & Pitch (3 members):** Repo architecture, CI/branch merging, Docker containerization, README & API docs, 3-minute demo pitch rehearsal.

---

### 12. 5-Hour Hackathon Delivery Timeline
- **00:00 – 00:30 (Architecture & Setup):** Repo initialization, data contracts agreement, backend and frontend scaffolding.
- **00:30 – 01:40 (Simulation Core):** 4-intersection network, vehicle generator, fixed-time cycles, adaptive scoring logic.
- **01:40 – 02:45 (Frontend Integration):** Canvas animation, dashboard telemetry, KPI cards, real-time Recharts.
- **02:45 – 03:40 (Comparison & Intelligence):** Paired A/B experiment lab, hotspot identification, recommendation cards.
- **03:40 – 04:20 (Integration & QA):** End-to-end user journey validation, edge cases, formula verification.
- **04:20 – 05:00 (Feature Freeze & Pitch Rehearsal):** Zero new features. Polish UI, verify reproducible seed demo, rehearse 3-minute presentation.
