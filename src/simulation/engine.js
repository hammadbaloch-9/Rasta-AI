/**
 * RAASTA AI — deterministic microscopic traffic simulation engine.
 *
 * Design goals (per PRP §7):
 *  - Four connected signalised intersections with vehicles moving through them.
 *  - Explicit safe signal phases (never conflicting greens, amber + all-red clearance).
 *  - Fixed-time baseline and a rule-based demand-responsive adaptive controller.
 *  - Every reported metric is measured from simulation state (nothing hardcoded).
 *  - Same scenario + duration + seed ⇒ the same arrival stream in both modes,
 *    making fixed-vs-adaptive comparisons fair and reproducible.
 *
 * Simplifications are documented in docs/SIMULATION_MODEL.md.
 */

import { buildNetwork, linkPosition, chooseExitSide, sideOf, OPPOSITE } from './network.js';
import { SignalController } from './signalController.js';
import { createRng } from './rng.js';
import { jainsFairness } from './metrics.js';
import { round } from '../utils/misc.js';

const SIDES = ['N', 'S', 'E', 'W'];
const MIN_GAP_M = 7; // minimum bumper-to-bumper spacing used by the prototype
const QUEUE_CAPACITY_PER_LANE = 12; // vehicles that fit between the stop line and the link end
const STOPPED_SPEED_MS = 0.5; // below this speed a vehicle is counted as stopped
const LEFT_OF = { N: 'W', S: 'E', E: 'N', W: 'S' };

export class SimulationEngine {
  constructor(options) {
    const {
      scenario,
      mode = 'adaptive',
      seed = 42,
      durationSec = 600,
      demandScale = 1,
      overrides = {},
      tickSec = 1,
      sampleIntervalSec = 5,
      decisionLogLimit = 250,
      record = false,
      recordFrameIntervalSec = 1,
      maxRecordedFrames = 1200,
      maxFrameVehicleEntries = 120000,
      maxVehicles = 8000,
    } = options;

    if (!scenario) throw new Error('SimulationEngine requires a scenario');
    if (!['fixed', 'adaptive'].includes(mode)) throw new Error(`Unknown control mode: ${mode}`);

    this.scenario = scenario;
    this.mode = mode;
    this.seed = seed;
    this.durationSec = durationSec;
    this.demandScale = demandScale;
    this.overrides = overrides || {};
    this.tickSec = tickSec;
    this.sampleIntervalSec = sampleIntervalSec;
    this.decisionLogLimit = decisionLogLimit;
    this.record = Boolean(record);
    this.recordFrameIntervalSec = recordFrameIntervalSec;
    this.maxRecordedFrames = maxRecordedFrames;
    this.maxFrameVehicleEntries = maxFrameVehicleEntries;
    this.maxVehicles = maxVehicles;

    this.network = buildNetwork(scenario, { laneOverrides: this.overrides.laneOverrides || {} });
    this.signalConfig = { ...scenario.signal, ...(this.overrides.signal || {}) };
    this.rng = createRng(seed);

    this.controllers = new Map();
    for (const intersection of this.network.intersections.values()) {
      this.controllers.set(
        intersection.id,
        new SignalController({ intersection, mode, config: this.signalConfig })
      );
    }

    // Blocked approaches (closures) ------------------------------------------------
    this.blocked = new Set();
    if (!this.overrides.clearBlocked) {
      for (const b of scenario.blockedApproaches || []) {
        this.blocked.add(`${b.intersectionId}:${b.approach}`);
      }
    }
    for (const b of this.overrides.blockApproaches || []) {
      this.blocked.add(`${b.intersectionId}:${b.approach}`);
    }

    // Demand ------------------------------------------------------------------------
    this.entryRates = { ...(scenario.demand?.entries || {}) };
    this.entryLinks = this.network.entries.map((entry) => ({
      ...entry,
      ratePerHour: this.entryRates[`${entry.intersectionId}:${entry.side}`] ?? 0,
      link: this.network.links.get(entry.linkId),
    }));

    // Aggregates --------------------------------------------------------------------
    this.approachStats = new Map();
    for (const intersection of this.network.intersections.values()) {
      for (const side of SIDES) {
        const key = `${intersection.id}:${side}`;
        const link = intersection.approaches[side];
        this.approachStats.set(key, {
          key,
          intersectionId: intersection.id,
          intersectionName: intersection.name,
          side,
          name: link ? `${side} — ${link.name}` : `${side} approach`,
          lanes: link?.lanes ?? intersection.lanesPerApproach,
          blocked: this.blocked.has(key),
          arrivals: 0,
          discharged: 0,
          signalWaitSum: 0,
          signalWaitCount: 0,
          maxSignalWaitSec: 0,
          maxQueue: 0,
          queueSum: 0,
          queueSamples: 0,
          movements: { straight: 0, left: 0, right: 0 },
          recentArrivals: [],
        });
      }
    }

    this.intersectionStats = new Map();
    for (const intersection of this.network.intersections.values()) {
      this.intersectionStats.set(intersection.id, {
        id: intersection.id,
        name: intersection.name,
        arrivals: 0,
        discharged: 0,
        signalWaitSum: 0,
        signalWaitCount: 0,
        maxQueue: 0,
        queueSum: 0,
        queueSamples: 0,
        maxQueueBySide: { N: 0, S: 0, E: 0, W: 0 },
      });
    }

    // Counters ----------------------------------------------------------------------
    this.t = 0;
    this.tickCount = 0;
    this.vehicles = new Map();
    this.vehicleCounter = 0;
    this.vehiclesSpawned = 0;
    this.vehiclesCompleted = 0;
    this.totalWaitAccumulated = 0;
    this.completedWaitSum = 0;
    this.completedTravelTimeSum = 0;
    this.totalStops = 0;
    this.stoppedSum = 0;
    this.stoppedSamples = 0;
    this.maxStopped = 0;
    this.queueSumNetwork = 0;
    this.queueSamplesNetwork = 0;
    this.maxQueueNetwork = 0;
    this.spawnCapReached = false;

    this.dischargeCredit = new Map();
    this.decisions = [];
    this.decisionCount = 0;
    this.timeSeries = [];
    this.frames = [];
    this.framesTruncated = false;
    this.frameVehicleEntries = 0;
    this.sampleAccumulator = 0;
    this.frameAccumulator = 0;

    // Emergency corridor (stretch feature) -------------------------------------------
    const em = this.overrides.emergency;
    this.emergencyConfig = em && em.enabled ? em : null;
    this.emergencySpawned = false;
    this.emergencyVehicleIds = new Set();

    this.completed = false;
  }

  // ---------------------------------------------------------------------------------
  // Demand
  // ---------------------------------------------------------------------------------

  surgeMultiplier(t) {
    const surge = this.scenario.demand?.surge;
    if (!surge) return 1;
    const start = surge.startFraction * this.durationSec;
    const end = surge.endFraction * this.durationSec;
    if (t < start) return surge.fromMultiplier;
    if (t <= end) {
      const frac = (t - start) / Math.max(1e-6, end - start);
      return surge.fromMultiplier + (surge.toMultiplier - surge.fromMultiplier) * frac;
    }
    return 1;
  }

  spawnArrivals(t) {
    const surge = this.surgeMultiplier(t);

    for (const entry of this.entryLinks) {
      const ratePerHour = entry.ratePerHour * this.demandScale * surge;
      if (ratePerHour <= 0) continue;
      const p = (ratePerHour / 3600) * this.tickSec;
      if (this.rng.chance(p)) {
        this.spawnVehicle({
          originIntersectionId: entry.intersectionId,
          originSide: entry.side,
          t,
        });
      }
    }

    const em = this.emergencyConfig;
    if (em && !this.emergencySpawned && t >= (em.afterSec ?? 60)) {
      this.emergencySpawned = true;
      this.spawnVehicle({
        originIntersectionId: em.entryIntersectionId,
        originSide: em.entrySide,
        destinationId: em.destinationIntersectionId ?? null,
        isEmergency: true,
        t,
      });
    }
  }

  /** Candidate destinations with a route and an exit stub. */
  eligibleDestinations(originId, explicitDestinationId = null) {
    if (explicitDestinationId && explicitDestinationId !== originId) {
      const path = this.network.shortestPath(originId, explicitDestinationId);
      if (path && (this.network.exitSidesByIntersection.get(explicitDestinationId) || []).length) {
        return [{ id: explicitDestinationId, path }];
      }
    }

    const candidates = [];
    for (const id of this.network.intersections.keys()) {
      if (id === originId) continue;
      if (!(this.network.exitSidesByIntersection.get(id) || []).length) continue;
      const path = this.network.shortestPath(originId, id);
      if (path) candidates.push({ id, path });
    }
    return candidates;
  }

  spawnVehicle({ originIntersectionId, originSide, destinationId = null, isEmergency = false, t }) {
    if (this.vehiclesSpawned >= this.maxVehicles) {
      this.spawnCapReached = true;
      return null;
    }

    const origin = this.network.intersections.get(originIntersectionId);
    if (!origin) return null;
    const entryLink = origin.approaches[originSide];
    if (!entryLink) return null;

    const candidates = this.eligibleDestinations(originIntersectionId, destinationId);
    if (!candidates.length) return null;

    const chosen = isEmergency && destinationId
      ? candidates[0]
      : this.rng.pick(candidates);

    const destination = this.network.intersections.get(chosen.id);
    const path = chosen.path;
    const previousId = path.length > 1 ? path[path.length - 2] : null;
    const arrivalSide = previousId ? sideOf(this.network.intersections.get(previousId), destination) : originSide;
    const exitSide = chooseExitSide(destination, arrivalSide, this.rng) || Object.keys(destination.outgoing).find((s) => destination.outgoing[s]);

    this.vehicleCounter += 1;
    const vehicle = {
      id: `v${this.vehicleCounter}`,
      isEmergency,
      entryT: t,
      origin: `${originIntersectionId}:${originSide}`,
      destinationId: chosen.id,
      exitSide,
      path,
      hop: 0, // index in `path` of the intersection the vehicle is approaching
      linkId: entryLink.id,
      pos: 0,
      speed: entryLink.speedLimitKmh / 3.6,
      state: 'moving',
      waitingTime: 0,
      stoppedEvents: 0,
      wasMoving: true,
      queueEnteredAt: null,
      exiting: false,
    };

    entryLink.vehicles.push(vehicle);
    this.vehicles.set(vehicle.id, vehicle);
    this.vehiclesSpawned += 1;
    if (isEmergency) this.emergencyVehicleIds.add(vehicle.id);

    return vehicle;
  }

  // ---------------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------------

  moveVehicles(t) {
    const dt = this.tickSec;

    for (const link of this.network.links.values()) {
      if (!link.vehicles.length) continue;

      const speedMs = link.speedLimitKmh / 3.6;
      const remaining = [];
      let leader = null;

      for (let i = 0; i < link.vehicles.length; i += 1) {
        const vehicle = link.vehicles[i];
        const oldPos = vehicle.pos;
        const maxPos = leader ? Math.min(link.lengthM, leader.pos - MIN_GAP_M) : link.lengthM;
        let newPos = Math.min(oldPos + speedMs * dt, maxPos);
        if (newPos < oldPos) newPos = oldPos;

        vehicle.pos = newPos;
        vehicle.speed = (newPos - oldPos) / dt;

        if (vehicle.pos >= link.lengthM - 1e-6) {
          if (link.exit) {
            // Reached the end of the exit stub: trip complete.
            this.completeVehicle(vehicle, t);
            leader = vehicle;
            continue;
          }

          const intersection = this.network.intersections.get(link.toId);
          const approach = intersection.approaches[link.side];
          const capacity = (approach.lanes ?? intersection.lanesPerApproach) * QUEUE_CAPACITY_PER_LANE;

          if (approach.queue.length < capacity) {
            vehicle.state = 'queued';
            vehicle.speed = 0;
            vehicle.queueEnteredAt = t;
            approach.queue.push(vehicle);
            this.registerQueueArrival(intersection, link.side, t);
            leader = vehicle;
            continue;
          }

          // Queue storage full: hold the vehicle at the end of the link (spillback).
          vehicle.pos = link.lengthM;
          vehicle.state = 'blocked';
        } else {
          vehicle.state = 'moving';
        }

        remaining.push(vehicle);
        leader = vehicle;
      }

      link.vehicles = remaining;
    }
  }

  registerQueueArrival(intersection, side, t) {
    const stats = this.approachStats.get(`${intersection.id}:${side}`);
    if (!stats) return;
    stats.arrivals += 1;
    stats.recentArrivals.push(t);
    const cutoff = t - 60;
    while (stats.recentArrivals.length && stats.recentArrivals[0] < cutoff) {
      stats.recentArrivals.shift();
    }
    const istats = this.intersectionStats.get(intersection.id);
    if (istats) istats.arrivals += 1;
  }

  completeVehicle(vehicle, t) {
    if (!this.vehicles.has(vehicle.id)) return;
    this.vehicles.delete(vehicle.id);
    this.emergencyVehicleIds.delete(vehicle.id);
    this.vehiclesCompleted += 1;
    this.completedTravelTimeSum += Math.max(0, t - vehicle.entryT);
    this.completedWaitSum += vehicle.waitingTime;
  }

  // ---------------------------------------------------------------------------------
  // Discharge through signals
  // ---------------------------------------------------------------------------------

  dischargeIntersection(intersection, t) {
    const controller = this.controllers.get(intersection.id);
    if (controller.state !== 'green') return;

    const saturationRatePerSec =
      (this.signalConfig.saturationFlowPerLane ?? 1800) / 3600;

    for (const side of controller.activePhase.approaches) {
      const key = `${intersection.id}:${side}`;
      if (this.blocked.has(key)) continue; // closed approach: no service possible

      const approach = intersection.approaches[side];
      if (!approach) continue;

      if (!approach.queue.length) {
        this.dischargeCredit.set(key, 0);
        continue;
      }

      // Emergency corridor simplification: a priority vehicle in a served queue is
      // moved to the front so it clears the intersection first.
      const emergencyIndex = approach.queue.findIndex((v) => v.isEmergency);
      if (emergencyIndex > 0) {
        const [emergencyVehicle] = approach.queue.splice(emergencyIndex, 1);
        approach.queue.unshift(emergencyVehicle);
      }

      const lanes = approach.lanes ?? intersection.lanesPerApproach;
      let credit = (this.dischargeCredit.get(key) ?? 0) + saturationRatePerSec * lanes * this.tickSec;

      while (credit >= 1 && approach.queue.length) {
        const vehicle = approach.queue[0];
        const atDestination = vehicle.hop >= vehicle.path.length - 1;

        let outLink = null;
        let turn = null;

        if (atDestination) {
          outLink = intersection.outgoing[vehicle.exitSide] || null;
        } else {
          const nextId = vehicle.path[vehicle.hop + 1];
          const nextIntersection = this.network.intersections.get(nextId);
          if (!nextIntersection) break;
          const outSide = sideOf(intersection, nextIntersection);
          outLink = intersection.outgoing[outSide] || null;

          const heading = OPPOSITE[side];
          turn = outSide === heading ? 'straight' : outSide === LEFT_OF[heading] ? 'left' : 'right';
        }

        if (!outLink) {
          // No exit available (only possible for malformed networks): finish the trip.
          approach.queue.shift();
          this.recordDischarge(vehicle, intersection, side, t, turn);
          this.completeVehicle(vehicle, t);
          credit -= 1;
          continue;
        }

        // Spillback check: do not discharge into an occupied link mouth.
        const tail = outLink.vehicles[outLink.vehicles.length - 1];
        if (tail && tail.pos < MIN_GAP_M) break;

        approach.queue.shift();
        this.recordDischarge(vehicle, intersection, side, t, turn);

        if (atDestination) vehicle.exiting = true;
        else vehicle.hop += 1;

        vehicle.state = 'moving';
        vehicle.linkId = outLink.id;
        vehicle.pos = 0;
        vehicle.speed = 0;
        vehicle.queueEnteredAt = null;
        outLink.vehicles.push(vehicle);

        credit -= 1;
      }

      this.dischargeCredit.set(key, Math.min(credit, 1));
    }
  }

  recordDischarge(vehicle, intersection, side, t, turn) {
    const wait = vehicle.queueEnteredAt != null ? Math.max(0, t - vehicle.queueEnteredAt) : 0;

    const stats = this.approachStats.get(`${intersection.id}:${side}`);
    if (stats) {
      stats.discharged += 1;
      stats.signalWaitSum += wait;
      stats.signalWaitCount += 1;
      stats.maxSignalWaitSec = Math.max(stats.maxSignalWaitSec, wait);
      if (turn) stats.movements[turn] = (stats.movements[turn] || 0) + 1;
    }

    const istats = this.intersectionStats.get(intersection.id);
    if (istats) {
      istats.discharged += 1;
      istats.signalWaitSum += wait;
      istats.signalWaitCount += 1;
    }

    vehicle.queueEnteredAt = null;
  }

  // ---------------------------------------------------------------------------------
  // Waiting time accounting
  // ---------------------------------------------------------------------------------

  updateWaiting() {
    const dt = this.tickSec;
    let stoppedNow = 0;

    for (const vehicle of this.vehicles.values()) {
      const effectivelyStopped =
        vehicle.state === 'queued' || vehicle.state === 'blocked' || vehicle.speed < STOPPED_SPEED_MS;

      if (effectivelyStopped) {
        stoppedNow += 1;
        vehicle.waitingTime += dt;
        this.totalWaitAccumulated += dt;
        if (vehicle.wasMoving) {
          vehicle.stoppedEvents += 1;
          this.totalStops += 1;
          vehicle.wasMoving = false;
        }
      } else {
        vehicle.wasMoving = true;
      }
    }

    this.stoppedSum += stoppedNow;
    this.stoppedSamples += 1;
    this.maxStopped = Math.max(this.maxStopped, stoppedNow);
  }

  // ---------------------------------------------------------------------------------
  // Controller context
  // ---------------------------------------------------------------------------------

  queueLengthFor(intersection, side) {
    const approach = intersection.approaches[side];
    if (!approach) return 0;
    let blockedOnLink = 0;
    for (const vehicle of approach.vehicles) {
      if (vehicle.pos >= approach.lengthM - 1) blockedOnLink += 1;
    }
    return approach.queue.length + blockedOnLink;
  }

  maxWaitFor(approach, t) {
    let maxWait = 0;
    for (const vehicle of approach.queue) {
      if (vehicle.queueEnteredAt != null) {
        maxWait = Math.max(maxWait, t - vehicle.queueEnteredAt);
      }
    }
    return maxWait;
  }

  emergencyApproachesFor(intersection) {
    if (!this.emergencyVehicleIds.size) return [];
    const sides = new Set();
    const lookahead = this.signalConfig.emergencyLookaheadM ?? 220;

    for (const id of this.emergencyVehicleIds) {
      const vehicle = this.vehicles.get(id);
      if (!vehicle) continue;

      if (vehicle.state === 'queued') {
        if (vehicle.path[vehicle.hop] === intersection.id) {
          const link = this.network.links.get(vehicle.linkId);
          if (link) sides.add(link.side);
        }
      } else {
        const link = this.network.links.get(vehicle.linkId);
        if (link && link.toId === intersection.id && link.lengthM - vehicle.pos <= lookahead) {
          sides.add(link.side);
        }
      }
    }

    return [...sides];
  }

  controllerContext(intersection, t) {
    const approaches = {};
    for (const side of SIDES) {
      const key = `${intersection.id}:${side}`;
      const approach = intersection.approaches[side];
      const stats = this.approachStats.get(key);
      approaches[side] = {
        queue: this.queueLengthFor(intersection, side),
        maxWaitSec: approach ? this.maxWaitFor(approach, t) : 0,
        arrivalRatePerMin: stats ? stats.recentArrivals.length : 0,
        blocked: this.blocked.has(key),
      };
    }
    return { approaches, emergencyApproaches: this.emergencyApproachesFor(intersection) };
  }

  // ---------------------------------------------------------------------------------
  // Sampling
  // ---------------------------------------------------------------------------------

  collectQueues(trackStats = true) {
    const perIntersection = [];
    let networkQueue = 0;

    for (const intersection of this.network.intersections.values()) {
      const controller = this.controllers.get(intersection.id);
      const queueBySide = {};
      let total = 0;

      for (const side of SIDES) {
        const q = this.queueLengthFor(intersection, side);
        queueBySide[side] = q;
        total += q;

        if (trackStats) {
          const stats = this.approachStats.get(`${intersection.id}:${side}`);
          if (stats) {
            stats.queueSum += q;
            stats.queueSamples += 1;
            stats.maxQueue = Math.max(stats.maxQueue, q);
          }

          const istats = this.intersectionStats.get(intersection.id);
          if (istats) {
            istats.maxQueueBySide[side] = Math.max(istats.maxQueueBySide[side], q);
          }
        }
      }

      if (trackStats) {
        const istats = this.intersectionStats.get(intersection.id);
        if (istats) {
          istats.queueSum += total;
          istats.queueSamples += 1;
          istats.maxQueue = Math.max(istats.maxQueue, total);
        }
      }

      networkQueue += total;

      perIntersection.push({
        id: intersection.id,
        name: intersection.name,
        phaseIndex: controller.phaseIndex,
        phaseName: controller.activePhase?.name ?? null,
        state: controller.state,
        greenSides: controller.state === 'green' ? controller.activePhase.approaches : [],
        queueBySide,
        totalQueue: total,
        switches: controller.switches,
      });
    }

    if (trackStats) {
      this.queueSumNetwork += networkQueue;
      this.queueSamplesNetwork += 1;
      this.maxQueueNetwork = Math.max(this.maxQueueNetwork, networkQueue);
    }

    return { perIntersection, networkQueue };
  }

  sampleTimeSeries(t, perIntersection, networkQueue) {
    this.timeSeries.push({
      t: round(t, 1),
      activeVehicles: this.vehicles.size,
      queuedVehicles: networkQueue,
      completedVehicles: this.vehiclesCompleted,
      averageWaitSecSoFar: round(this.totalWaitAccumulated / Math.max(1, this.vehiclesSpawned)),
      totalQueue: networkQueue,
      intersections: perIntersection.map((i) => ({
        id: i.id,
        phaseIndex: i.phaseIndex,
        state: i.state,
        greenSides: i.greenSides,
        queueBySide: i.queueBySide,
        totalQueue: i.totalQueue,
      })),
    });
  }

  buildFrame(t) {
    const vehicles = [];
    for (const vehicle of this.vehicles.values()) {
      const link = this.network.links.get(vehicle.linkId);
      if (!link) continue;
      const position = linkPosition(link, vehicle.pos);
      vehicles.push({
        id: vehicle.id,
        x: Math.round(position.x),
        y: Math.round(position.y),
        speedKph: Math.round(vehicle.speed * 3.6),
        ...(vehicle.isEmergency ? { emergency: true } : {}),
      });
    }

    const signals = {};
    for (const [id, controller] of this.controllers) {
      signals[id] = {
        phaseIndex: controller.phaseIndex,
        phaseName: controller.activePhase?.name ?? null,
        state: controller.state,
        greenSides: controller.state === 'green' ? controller.activePhase.approaches : [],
      };
    }

    return { t: round(t, 1), vehicles, signals };
  }

  recordFrame(t) {
    if (!this.record) return;
    if (this.frames.length >= this.maxRecordedFrames) {
      this.framesTruncated = true;
      return;
    }
    if (this.frameAccumulator < this.recordFrameIntervalSec - 1e-9) return;
    this.frameAccumulator = 0;

    const frame = this.buildFrame(t);
    this.frameVehicleEntries += frame.vehicles.length;

    if (this.frameVehicleEntries > this.maxFrameVehicleEntries) {
      this.framesTruncated = true;
      return;
    }

    this.frames.push(frame);
  }

  // ---------------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------------

  step() {
    if (this.completed) return null;
    const dt = this.tickSec;
    this.t += dt;
    this.tickCount += 1;
    const t = this.t;

    // 1. Controllers decide based on the state carried into this tick.
    for (const intersection of this.network.intersections.values()) {
      const controller = this.controllers.get(intersection.id);
      const decision = controller.update(t, this.controllerContext(intersection, t));
      if (decision) {
        this.decisionCount += 1;
        if (this.decisions.length < this.decisionLogLimit) this.decisions.push(decision);
      }
    }

    // 2. New arrivals.
    this.spawnArrivals(t);

    // 3. Move vehicles; vehicles reaching a stop line join the approach queue.
    this.moveVehicles(t);

    // 4. Discharge through green signals.
    for (const intersection of this.network.intersections.values()) {
      this.dischargeIntersection(intersection, t);
    }

    // 5. Accumulate waiting time / stopped counts.
    this.updateWaiting();

    // 6. Sample queues and (optionally) recorded frames.
    const { perIntersection, networkQueue } = this.collectQueues();

    this.sampleAccumulator += dt;
    if (this.sampleAccumulator >= this.sampleIntervalSec - 1e-9) {
      this.sampleAccumulator = 0;
      this.sampleTimeSeries(t, perIntersection, networkQueue);
    }

    this.frameAccumulator += dt;
    this.recordFrame(t);

    if (t >= this.durationSec - 1e-9) {
      this.completed = true;
    }

    return this.getState(perIntersection, networkQueue);
  }

  runToCompletion() {
    while (!this.completed) this.step();
    return this.finalize();
  }

  /** Lightweight state snapshot used by live streaming / polling. */
  getState(perIntersection = null, networkQueue = null) {
    const queues = perIntersection || this.collectQueues(false).perIntersection;
    const queueTotal =
      networkQueue ?? queues.reduce((acc, i) => acc + (i.totalQueue ?? 0), 0);

    return {
      t: round(this.t, 1),
      durationSec: this.durationSec,
      progressPct: round((this.t / this.durationSec) * 100, 1),
      completed: this.completed,
      mode: this.mode,
      scenarioId: this.scenario.id,
      counts: {
        active: this.vehicles.size,
        completed: this.vehiclesCompleted,
        spawned: this.vehiclesSpawned,
        queued: queueTotal,
      },
      metricsSoFar: {
        averageWaitingTimeSec: round(this.totalWaitAccumulated / Math.max(1, this.vehiclesSpawned)),
        maxQueueLength: this.maxQueueNetwork,
        throughputVehicles: this.vehiclesCompleted,
      },
      intersections: queues,
    };
  }

  // ---------------------------------------------------------------------------------
  // Finalisation
  // ---------------------------------------------------------------------------------

  finalize() {
    const duration = Math.max(1, this.durationSec);

    const perApproach = [...this.approachStats.values()].map((s) => ({
      intersectionId: s.intersectionId,
      intersectionName: s.intersectionName,
      side: s.side,
      name: s.name,
      lanes: s.lanes,
      blocked: s.blocked,
      arrivals: s.arrivals,
      discharged: s.discharged,
      maxQueueLength: s.maxQueue,
      averageQueueLength: round(s.queueSum / Math.max(1, s.queueSamples)),
      maxSignalWaitSec: round(s.maxSignalWaitSec),
      averageSignalWaitSec:
        s.signalWaitCount > 0 ? round(s.signalWaitSum / s.signalWaitCount) : null,
      movements: s.movements,
      dischargedVehPerHour: round((s.discharged / duration) * 3600),
    }));

    const perIntersection = [...this.intersectionStats.values()].map((s) => {
      const controller = this.controllers.get(s.id);
      return {
        id: s.id,
        name: s.name,
        arrivals: s.arrivals,
        discharged: s.discharged,
        maxQueueLength: s.maxQueue,
        averageQueueLength: round(s.queueSum / Math.max(1, s.queueSamples)),
        maxQueueBySide: s.maxQueueBySide,
        averageSignalWaitSec:
          s.signalWaitCount > 0 ? round(s.signalWaitSum / s.signalWaitCount) : null,
        phaseSwitches: controller ? controller.switches : 0,
        preemptions: controller ? controller.preemptions : 0,
        averageGreenSec: controller ? round(controller.greenSumSec / Math.max(1, controller.greenCount)) : null,
      };
    });

    const approachesWithService = perApproach.filter((a) => a.discharged > 0);
    const waits = approachesWithService.map((a) => a.averageSignalWaitSec);
    const fairnessIndex = jainsFairness(waits);
    const meanApproachWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
    const maxApproachWait = waits.length ? Math.max(...waits) : 0;

    const totalSwitches = [...this.controllers.values()].reduce((a, c) => a + c.switches, 0);
    const totalPreemptions = [...this.controllers.values()].reduce((a, c) => a + c.preemptions, 0);
    const totalGreen = [...this.controllers.values()].reduce((a, c) => a + c.greenSumSec, 0);
    const greenCount = [...this.controllers.values()].reduce((a, c) => a + c.greenCount, 0);

    const metrics = {
      // Primary comparison metrics
      averageWaitingTimeSec: round(this.totalWaitAccumulated / Math.max(1, this.vehiclesSpawned)),
      averageWaitingTimeCompletedSec: round(this.completedWaitSum / Math.max(1, this.vehiclesCompleted)),
      averageTravelTimeSec: round(this.completedTravelTimeSum / Math.max(1, this.vehiclesCompleted)),
      averageTravelTimeMin: round(this.completedTravelTimeSum / Math.max(1, this.vehiclesCompleted) / 60),
      maxQueueLength: this.maxQueueNetwork,
      averageQueueLength: round(this.queueSumNetwork / Math.max(1, this.queueSamplesNetwork)),
      averageStoppedVehicles: round(this.stoppedSum / Math.max(1, this.stoppedSamples)),
      maxStoppedVehicles: this.maxStopped,
      throughputVehicles: this.vehiclesCompleted,
      throughputVehPerHour: round((this.vehiclesCompleted / duration) * 3600),
      completionRatePct: round((this.vehiclesCompleted / Math.max(1, this.vehiclesSpawned)) * 100),
      fairnessIndex: fairnessIndex == null ? null : round(fairnessIndex, 4),
      maxApproachAvgWaitSec: round(maxApproachWait),
      imbalanceRatio: meanApproachWait > 0 ? round(maxApproachWait / meanApproachWait) : null,

      // Supporting metrics
      totalWaitingTimeSec: round(this.totalWaitAccumulated),
      totalWaitingTimeVehicleHours: round(this.totalWaitAccumulated / 3600, 3),
      totalStops: this.totalStops,
      vehiclesSpawned: this.vehiclesSpawned,
      vehiclesCompleted: this.vehiclesCompleted,
      vehiclesIncomplete: this.vehiclesSpawned - this.vehiclesCompleted,
      vehiclesActiveAtEnd: this.vehicles.size,
      demandVehPerHour: round((this.vehiclesSpawned / duration) * 3600),
      phaseSwitches: totalSwitches,
      preemptions: totalPreemptions,
      averageGreenSec: greenCount ? round(totalGreen / greenCount) : null,
      decisionLogEntries: this.decisionCount,
      spawnCapReached: this.spawnCapReached,
      emergencyVehiclesUsed: this.emergencyVehicleIds.size > 0 || this.emergencySpawned,
    };

    return {
      metrics,
      perIntersection,
      perApproach,
      fairness: {
        jainIndex: metrics.fairnessIndex,
        interpretation: '1.0 = every approach receives equally long average signal waits.',
        maxApproachAvgWaitSec: metrics.maxApproachAvgWaitSec,
        imbalanceRatio: metrics.imbalanceRatio,
      },
      timeSeries: this.timeSeries,
      decisions: this.decisions,
      frames: this.record ? this.frames : null,
      framesTruncated: this.framesTruncated,
    };
  }
}

export default SimulationEngine;
