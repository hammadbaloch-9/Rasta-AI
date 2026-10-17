/**
 * Predefined Karachi-inspired scenarios for the Simulation Lab.
 *
 * IMPORTANT: All demand values, signal timings and geometry are documented
 * SIMULATION ASSUMPTIONS for the prototype. They are NOT measured or official
 * Karachi traffic counts, and they must not be presented as such.
 */

const BASE_SIGNAL = {
  minGreenSec: 12,
  maxGreenSec: 45,
  amberSec: 3,
  allRedSec: 1,
  fixedCycleSec: 70,
  fixedSplit: 0.5, // share of usable green given to the N-S phase in fixed mode
  saturationFlowPerLane: 1800, // veh/h/lane (assumption)
  switchMargin: 0.35, // adaptive: how much a competing phase must beat the active one
  starvationWaitSec: 90, // adaptive: force a switch if an approach waited longer
  minMeaningfulScore: 0.2, // adaptive: ignore negligible competition
  emergencyExtraGreenSec: 25,
  emergencyLookaheadM: 220,
};

const APPROACH_SIDES = ['N', 'S', 'E', 'W'];

/**
 * A 2x2 intersection core (four connected signalised intersections).
 * Coordinates are meters on a local canvas; y grows southwards.
 */
const CORE_NETWORK = {
  name: 'Saddar Core (2x2 grid)',
  width: 1200,
  height: 960,
  entryLengthM: 420,
  intersections: [
    {
      id: 'I1',
      name: 'Saddar Chowk',
      x: 300,
      y: 200,
      lat: 24.8607,
      lng: 67.029,
      lanesPerApproach: 2,
    },
    {
      id: 'I2',
      name: 'Empress Market',
      x: 900,
      y: 200,
      lat: 24.8602,
      lng: 67.0335,
      lanesPerApproach: 2,
    },
    {
      id: 'I3',
      name: 'Regal Chowk',
      x: 300,
      y: 760,
      lat: 24.8563,
      lng: 67.0285,
      lanesPerApproach: 2,
    },
    {
      id: 'I4',
      name: 'Fresco Chowk',
      x: 900,
      y: 760,
      lat: 24.8559,
      lng: 67.0332,
      lanesPerApproach: 2,
    },
  ],
  roads: [
    {
      id: 'R1',
      name: 'M.A. Jinnah Road (north leg)',
      from: 'I1',
      to: 'I2',
      lengthM: 600,
      speedLimitKmh: 45,
      lanes: 2,
    },
    {
      id: 'R2',
      name: 'Shahrah-e-Iraq (west leg)',
      from: 'I1',
      to: 'I3',
      lengthM: 560,
      speedLimitKmh: 40,
      lanes: 2,
    },
    {
      id: 'R3',
      name: 'Dr. Ziauddin Ahmed Road (east leg)',
      from: 'I2',
      to: 'I4',
      lengthM: 560,
      speedLimitKmh: 45,
      lanes: 2,
    },
    {
      id: 'R4',
      name: 'Abdullah Haroon Road (south leg)',
      from: 'I3',
      to: 'I4',
      lengthM: 600,
      speedLimitKmh: 40,
      lanes: 2,
    },
  ],
};

const APPROXIMATE_HOTSPOT_LABELS = {
  I1: 'Saddar Chowk area',
  I2: 'Empress Market area',
  I3: 'Regal Chowk area',
  I4: 'Fresco Chowk area',
};

const buildApproachNames = (roadName, side) => `${side} — ${roadName}`;

const ENTRIES = {
  // Peak-hour synthetic entry flows (veh/h) per boundary approach.
  balanced: {
    'I1:N': 840,
    'I1:W': 840,
    'I2:N': 840,
    'I2:E': 840,
    'I3:W': 840,
    'I3:S': 840,
    'I4:E': 840,
    'I4:S': 840,
  },
  heavyNorthSouth: {
    'I1:N': 1500,
    'I1:W': 420,
    'I2:N': 1500,
    'I2:E': 420,
    'I3:W': 420,
    'I3:S': 1400,
    'I4:E': 420,
    'I4:S': 1400,
  },
  rushSurge: {
    'I1:N': 800,
    'I1:W': 780,
    'I2:N': 800,
    'I2:E': 780,
    'I3:W': 780,
    'I3:S': 800,
    'I4:E': 780,
    'I4:S': 800,
  },
  blockedApproach: {
    'I1:N': 860,
    'I1:W': 820,
    'I2:N': 860,
    'I2:E': 780,
    'I3:W': 880,
    'I3:S': 840,
    'I4:E': 780,
    'I4:S': 840,
  },
};

const SCENARIO_DISCLAIMER =
  'Simulated scenario. Demand, geometry and signal timings are documented prototype assumptions, ' +
  'not measured Karachi traffic data. Results are illustrative and require real-world validation.';

const baseScenario = (id, name, description, tags) => ({
  id,
  name,
  city: 'Karachi',
  description,
  tags,
  disclaimer: SCENARIO_DISCLAIMER,
  network: JSON.parse(JSON.stringify(CORE_NETWORK)),
  signal: { ...BASE_SIGNAL },
  defaults: {
    durationSec: 600,
    seed: 42,
    demandScale: 1,
  },
  mapContext: {
    center: { lat: 24.8582, lng: 67.031 },
    zoom: 15,
    note: 'Approximate locations shown for context only. Not a live traffic feed.',
  },
  approachSides: APPROACH_SIDES,
  hotspotLabels: APPROXIMATE_HOTSPOT_LABELS,
});

export const scenarios = [
  {
    ...baseScenario(
      'saddar-balanced',
      'Saddar Core — Balanced Demand',
      'Four connected intersections around Saddar with a roughly even directional split. Baseline stability test for both controllers.',
      ['balanced', 'must-have', 'baseline']
    ),
    demand: {
      profile: 'balanced',
      entries: ENTRIES.balanced,
      arrivalModel: 'poisson-per-tick',
      assumptions: [
        'Synthetic arrivals: ~840 veh/h per external entry (about 6,720 veh/h network-wide at peak).',
        'Two lanes per approach, 40–45 km/h free-flow speeds, 1,800 veh/h/lane saturation flow.',
        'Signal plan: NS/EW two-phase control with amber and all-red clearance.',
        'Demand represents a busy peak period and is generated, not measured.',
      ],
    },
  },
  {
    ...baseScenario(
      'shahrah-faisal-ns-surge',
      'Saddar Core — Heavy North–South Demand',
      'Strongly unbalanced demand: north–south entries are heavily loaded while east–west legs are light. Tests whether adaptive control prioritises the loaded axis without starving the other.',
      ['unbalanced', 'demand-priority']
    ),
    demand: {
      profile: 'heavyNorthSouth',
      entries: ENTRIES.heavyNorthSouth,
      arrivalModel: 'poisson-per-tick',
      assumptions: [
        'Synthetic arrivals: ~1,500 veh/h on each north entry and ~1,400 veh/h on each south entry.',
        'East–west legs carry roughly 420 veh/h per entry.',
        'Represents a stylised commuter axis during peak hours with a strong directional imbalance.',
      ],
    },
  },
  {
    ...baseScenario(
      'rush-hour-surge',
      'Saddar Core — Rush-Hour Surge',
      'Demand ramps from light to heavy mid-run and recedes. Tests detection of growing queues and controller stability under changing load.',
      ['dynamic-demand', 'surge', 'stress']
    ),
    demand: {
      profile: 'rushSurge',
      entries: ENTRIES.rushSurge,
      arrivalModel: 'poisson-per-tick',
      surge: {
        startFraction: 0.25,
        endFraction: 0.65,
        fromMultiplier: 0.6,
        toMultiplier: 1.9,
      },
      assumptions: [
        'Arrival rates ramp linearly from 60% to 190% of the base rate between 25% and 65% of the run, then step back to base.',
        'Base rate ~780–800 veh/h per external entry (peak multiplier ~1.9).',
      ],
    },
  },
  {
    ...baseScenario(
      'blocked-approach',
      'Saddar Core — Blocked Approach (Road Works)',
      'One westbound approach into Fresco Chowk is closed (simulated road works). Tests hotspot detection and shows why some problems cannot be solved by signal timing alone.',
      ['incident', 'blocked', 'hotspot']
    ),
    demand: {
      profile: 'blockedApproach',
      entries: ENTRIES.blockedApproach,
      arrivalModel: 'poisson-per-tick',
      assumptions: [
        'The westbound approach into Fresco Chowk (I4) is fully blocked for the whole run.',
        'All other approaches operate normally with ~780–880 veh/h per external entry.',
        'Represents a full closure with no capacity, not a partial incident.',
      ],
    },
    blockedApproaches: [
      {
        intersectionId: 'I4',
        approach: 'W',
        reason: 'Simulated road works: complete closure of the westbound approach',
      },
    ],
  },
];

export const scenarioById = (id) => scenarios.find((s) => s.id === id) || null;

/** World bounds including the external entry/exit stubs (for canvas rendering). */
export const worldBounds = (scenario) => {
  const pad = scenario.network.entryLengthM ?? 420;
  const xs = scenario.network.intersections.map((i) => i.x);
  const ys = scenario.network.intersections.map((i) => i.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, paddingM: pad };
};

export const scenarioSummaries = () =>
  scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    city: s.city,
    description: s.description,
    tags: s.tags,
    disclaimer: s.disclaimer,
    defaults: s.defaults,
    intersections: s.network.intersections.map((i) => ({
      id: i.id,
      name: i.name,
      lat: i.lat,
      lng: i.lng,
    })),
    totalEntryDemandVehPerHour: Object.values(s.demand.entries).reduce((a, b) => a + b, 0),
    blockedApproaches: s.blockedApproaches || [],
    mapContext: s.mapContext,
    worldBounds: worldBounds(s),
    signal: s.signal,
    assumptions: s.demand.assumptions,
  }));

export { BASE_SIGNAL, APPROACH_SIDES, buildApproachNames };
export default scenarios;
