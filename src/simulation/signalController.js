/**
 * Signal controller for a single intersection.
 *
 * Two modes share one safe state machine:
 *   green -> amber -> all-red -> (next phase) green
 * Conflicting green phases are never active at the same time, and every green
 * honours minimum / maximum green durations before a switch is allowed.
 *
 * Fixed-time mode follows a preconfigured cycle split.
 * Adaptive mode uses the PRP priority score:
 *
 *   score_i = 0.6 * Qnorm_i + 0.3 * Wnorm_i + 0.1 * Anorm_i
 *
 * where Q = queue length, W = maximum waiting time, A = arrival rate.
 * The coefficients are documented prototype starting values, not traffic
 * engineering standards.
 */

const DEFAULT_CONFIG = {
  minGreenSec: 12,
  maxGreenSec: 45,
  amberSec: 3,
  allRedSec: 1,
  fixedCycleSec: 70,
  fixedSplit: 0.5,
  switchMargin: 0.35,
  starvationWaitSec: 90,
  minMeaningfulScore: 0.2,
  emergencyExtraGreenSec: 25,
};

const normalizePositive = (value, max) => (max <= 0 ? 0 : Math.max(0, value) / max);
const round3 = (v) => Math.round(v * 1000) / 1000;

export class SignalController {
  constructor({ intersection, mode, config = {} }) {
    this.intersection = intersection;
    this.phases = intersection.phases;
    this.mode = mode;
    this.config = { ...DEFAULT_CONFIG, ...config };

    const usableCycle = Math.max(
      this.phases.length * this.config.minGreenSec,
      this.config.fixedCycleSec - this.phases.length * (this.config.amberSec + this.config.allRedSec)
    );

    // Fixed green split: the first phase receives fixedSplit of usable green.
    this.fixedGreens = this.phases.map((phase, idx) => {
      if (this.phases.length === 1) return usableCycle;
      if (idx === 0) return usableCycle * this.config.fixedSplit;
      return (usableCycle * (1 - this.config.fixedSplit)) / (this.phases.length - 1);
    });

    this.phaseIndex = 0;
    this.state = 'green';
    this.stateStart = 0;
    this.pendingPhase = null;
    this.switches = 0;
    this.preemptions = 0;
    this.greenSumSec = 0;
    this.greenCount = 0;
    this.lastDecision = null;
    this.lastScores = null;
    this.phaseHistory = [{ t: 0, phase: 0, state: 'green' }];
  }

  get activePhase() {
    return this.phases[this.phaseIndex];
  }

  isGreenFor(side) {
    return this.state === 'green' && this.activePhase.approaches.includes(side);
  }

  elapsed(t) {
    return t - this.stateStart;
  }

  computeScores(ctx) {
    const sides = this.phases.flatMap((p) => p.approaches);
    const maxQueue = Math.max(1, ...sides.map((s) => ctx.approaches[s]?.queue ?? 0));
    const maxWait = Math.max(1, ...sides.map((s) => ctx.approaches[s]?.maxWaitSec ?? 0));
    const maxArrival = Math.max(1e-6, ...sides.map((s) => ctx.approaches[s]?.arrivalRatePerMin ?? 0));

    const scores = {};
    for (const side of sides) {
      const a = ctx.approaches[side] || {};
      const qNorm = normalizePositive(a.queue ?? 0, maxQueue);
      const wNorm = normalizePositive(a.maxWaitSec ?? 0, maxWait);
      const aNorm = normalizePositive(a.arrivalRatePerMin ?? 0, maxArrival);
      // A closed approach cannot use green time, so it must not attract service.
      // It is still reported for hotspot analysis, but scores zero here.
      const blocked = Boolean(a.blocked);
      scores[side] = {
        side,
        score: blocked ? 0 : round3(0.6 * qNorm + 0.3 * wNorm + 0.1 * aNorm),
        queue: a.queue ?? 0,
        maxWaitSec: Math.round((a.maxWaitSec ?? 0) * 10) / 10,
        arrivalRatePerMin: Math.round((a.arrivalRatePerMin ?? 0) * 10) / 10,
        blocked,
        normalized: { queue: round3(qNorm), wait: round3(wNorm), arrival: round3(aNorm) },
      };
    }

    const phaseScores = this.phases.map((phase) => {
      const members = phase.approaches.map((s) => scores[s]);
      return {
        phaseIndex: phase.index,
        name: phase.name,
        // Urgency of the phase = its most urgent approach.
        score: round3(Math.max(...members.map((m) => m.score))),
        sumScore: round3(members.reduce((acc, m) => acc + m.score, 0)),
        maxWaitSec: Math.max(0, ...members.map((m) => (m.blocked ? 0 : m.maxWaitSec))),
      };
    });

    return { scores, phaseScores };
  }

  /** Advance the controller by one tick. Returns a decision record when a switch starts. */
  update(t, ctx) {
    const elapsed = this.elapsed(t);
    let decision = null;

    if (this.state === 'green') {
      const { scores, phaseScores } = this.computeScores(ctx);
      this.lastScores = { t: Math.round(t * 10) / 10, scores, phaseScores };

      const emergencySides = (ctx.emergencyApproaches || []).filter(Boolean);
      const emergencyPhase = emergencySides.length
        ? this.phases.find((p) => p.approaches.some((s) => emergencySides.includes(s)))
        : null;

      let switchTo = null;
      let reason = null;
      let details = null;

      if (emergencyPhase && emergencyPhase.index !== this.phaseIndex) {
        if (elapsed >= this.config.minGreenSec) {
          switchTo = emergencyPhase.index;
          reason = 'emergency_preemption';
          details = { emergencySides, targetPhase: emergencyPhase.name };
        }
      } else if (emergencyPhase && emergencyPhase.index === this.phaseIndex) {
        // Hold green for the emergency approach, with a bounded extension.
        if (elapsed >= this.config.maxGreenSec + this.config.emergencyExtraGreenSec) {
          const challenger = this.pickChallenger(phaseScores);
          switchTo = challenger.phaseIndex;
          reason = 'max_green';
          details = { extendedForEmergency: true, challenger };
        }
      } else if (this.mode === 'fixed') {
        if (elapsed >= this.fixedGreens[this.phaseIndex]) {
          switchTo = (this.phaseIndex + 1) % this.phases.length;
          reason = 'fixed_cycle';
          details = { greenPlannedSec: Math.round(this.fixedGreens[this.phaseIndex] * 10) / 10 };
        }
      } else {
        const challenger = this.pickChallenger(phaseScores);
        const currentPhaseScore = phaseScores.find((p) => p.phaseIndex === this.phaseIndex);
        const currentScore = currentPhaseScore?.score ?? 0;
        const challengerScore = challenger.score ?? 0;
        const challengerHasQueue = this.phases[challenger.phaseIndex].approaches.some(
          (side) => (ctx.approaches[side]?.queue ?? 0) > 0
        );

        if (elapsed >= this.config.maxGreenSec) {
          switchTo = challenger.phaseIndex;
          reason = 'max_green';
          details = { currentPhase: currentPhaseScore, challenger };
        } else if (elapsed >= this.config.minGreenSec && challenger.phaseIndex !== this.phaseIndex) {
          if (challenger.maxWaitSec >= this.config.starvationWaitSec && challengerHasQueue) {
            switchTo = challenger.phaseIndex;
            reason = 'starvation_prevention';
            details = { challenger, thresholdSec: this.config.starvationWaitSec };
          } else if (
            challengerHasQueue &&
            challengerScore >= this.config.minMeaningfulScore &&
            challengerScore > currentScore * (1 + this.config.switchMargin)
          ) {
            switchTo = challenger.phaseIndex;
            reason = 'demand_priority';
            details = {
              currentPhaseScore: currentScore,
              challengerScore,
              margin: this.config.switchMargin,
              scores,
            };
          }
        }
      }

      if (switchTo !== null && switchTo !== undefined) {
        decision = this.beginAmber(t, switchTo, reason, details);
      }
    } else if (this.state === 'amber') {
      if (elapsed >= this.config.amberSec) {
        this.state = 'allRed';
        this.stateStart = t;
        this.phaseHistory.push({ t, phase: this.phaseIndex, state: 'allRed' });
        if (this.phaseHistory.length > 400) this.phaseHistory.shift();
      }
    } else if (this.state === 'allRed') {
      if (elapsed >= this.config.allRedSec) {
        this.phaseIndex = this.pendingPhase ?? (this.phaseIndex + 1) % this.phases.length;
        this.pendingPhase = null;
        this.state = 'green';
        this.stateStart = t;
        this.phaseHistory.push({ t, phase: this.phaseIndex, state: 'green' });
        if (this.phaseHistory.length > 400) this.phaseHistory.shift();
      }
    }

    return decision;
  }

  beginAmber(t, targetPhase, reason, details) {
    const greenElapsed = this.elapsed(t);
    this.greenSumSec += greenElapsed;
    this.greenCount += 1;
    this.state = 'amber';
    this.stateStart = t;
    this.pendingPhase = targetPhase;
    this.switches += 1;
    if (reason === 'emergency_preemption') this.preemptions += 1;

    const decision = {
      t: Math.round(t * 10) / 10,
      intersectionId: this.intersection.id,
      intersectionName: this.intersection.name,
      fromPhase: this.activePhase.name,
      fromPhaseIndex: this.phaseIndex,
      toPhase: this.phases[targetPhase]?.name ?? String(targetPhase),
      toPhaseIndex: targetPhase,
      state: 'amber',
      reason,
      explanation: this.explain(reason, details),
      details: details || null,
      greenElapsedSec: Math.round(greenElapsed * 10) / 10,
    };

    this.lastDecision = decision;
    this.phaseHistory.push({ t, phase: this.phaseIndex, state: 'amber' });
    if (this.phaseHistory.length > 400) this.phaseHistory.shift();

    return decision;
  }

  pickChallenger(phaseScores) {
    const others = phaseScores.filter((p) => p.phaseIndex !== this.phaseIndex);
    if (!others.length) {
      return { phaseIndex: this.phaseIndex, name: this.activePhase.name, score: 0, maxWaitSec: 0 };
    }
    return others.sort(
      (a, b) => b.score - a.score || b.maxWaitSec - a.maxWaitSec || a.phaseIndex - b.phaseIndex
    )[0];
  }

  explain(reason, details) {
    switch (reason) {
      case 'fixed_cycle':
        return `Fixed-time plan: green budget of ${details?.greenPlannedSec ?? '?'}s elapsed.`;
      case 'max_green':
        return details?.extendedForEmergency
          ? 'Maximum green reached after an emergency extension; returning to normal control.'
          : 'Maximum green reached; switching service to the competing phase.';
      case 'starvation_prevention':
        return `An approach has waited more than ${
          details?.thresholdSec ?? this.config.starvationWaitSec
        }s; switching to prevent starvation.`;
      case 'emergency_preemption':
        return `Emergency vehicle approaching on ${details?.emergencySides?.join(', ') ?? '?'}; preempting for ${
          details?.targetPhase ?? 'the target phase'
        }.`;
      case 'demand_priority':
        return `Competing phase priority ${details?.challengerScore?.toFixed?.(3) ?? '?'} exceeds active phase ${
          details?.currentPhaseScore?.toFixed?.(3) ?? '?'
        } by more than ${(this.config.switchMargin * 100).toFixed(0)}%.`;
      default:
        return 'Phase switch.';
    }
  }

  snapshot(t) {
    return {
      intersectionId: this.intersection.id,
      intersectionName: this.intersection.name,
      mode: this.mode,
      phaseIndex: this.phaseIndex,
      phaseName: this.activePhase?.name ?? null,
      greenSides: this.state === 'green' ? this.activePhase.approaches : [],
      state: this.state,
      elapsedSec: Math.round(this.elapsed(t) * 10) / 10,
      switches: this.switches,
      preemptions: this.preemptions,
      lastDecision: this.lastDecision,
      scores: this.lastScores,
      phaseHistoryTail: this.phaseHistory.slice(-6),
    };
  }
}

export default SignalController;
