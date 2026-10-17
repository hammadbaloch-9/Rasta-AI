/**
 * Road-network construction for the simulator.
 *
 * A scenario describes intersections on a local metric canvas and the roads
 * between them. This module expands that into:
 *   - directed links (one per travel direction)
 *   - external entry/exit stubs for the boundary of the network
 *   - explicit signal phases (N-S green, E-W green)
 *   - precomputed routes between intersections
 *
 * Compass convention: y grows southwards (screen coordinates), so a neighbour
 * with a larger y is to the SOUTH.
 */

export const SIDE_VECTORS = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function sideOf(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

const phaseDefinitions = (sides) => {
  const ns = sides.filter((s) => s === 'N' || s === 'S');
  const ew = sides.filter((s) => s === 'E' || s === 'W');
  const phases = [];
  if (ns.length) phases.push({ index: 0, name: 'NS', approaches: ns, label: 'North–South green' });
  if (ew.length) phases.push({ index: phases.length, name: 'EW', approaches: ew, label: 'East–West green' });
  return phases;
};

/**
 * Build the runtime network.
 * @param {object} scenario - scenario definition (see config/scenarios.js)
 * @param {object} options
 * @param {object} options.laneOverrides - { [intersectionId]: { lanesPerApproach } }
 */
export function buildNetwork(scenario, options = {}) {
  const { laneOverrides = {} } = options;
  const entryLengthM = scenario.network.entryLengthM ?? 420;

  const intersections = new Map();

  for (const spec of scenario.network.intersections) {
    const lanes = laneOverrides[spec.id]?.lanesPerApproach ?? spec.lanesPerApproach ?? 2;
    intersections.set(spec.id, {
      id: spec.id,
      name: spec.name,
      x: spec.x,
      y: spec.y,
      lat: spec.lat,
      lng: spec.lng,
      lanesPerApproach: lanes,
      approaches: { N: null, S: null, E: null, W: null },
      outgoing: { N: null, S: null, E: null, W: null },
      phases: [],
    });
  }

  const links = new Map();
  const addLink = (link) => {
    links.set(link.id, link);
    return link;
  };

  // --- Internal roads (both directions) ---
  for (const road of scenario.network.roads) {
    const a = intersections.get(road.from);
    const b = intersections.get(road.to);
    if (!a || !b) throw new Error(`Road ${road.id} references an unknown intersection`);

    const sideFromA = sideOf(a, b);
    const sideFromB = OPPOSITE[sideFromA];

    const ab = addLink({
      id: `${road.id}:${road.from}>${road.to}`,
      roadId: road.id,
      name: road.name,
      fromId: road.from,
      toId: road.to,
      side: sideFromB, // side of the destination through which the vehicle arrives
      lengthM: road.lengthM,
      speedLimitKmh: road.speedLimitKmh ?? 40,
      lanes: road.lanes ?? a.lanesPerApproach,
      external: false,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      vehicles: [],
      queue: [],
    });

    const ba = addLink({
      id: `${road.id}:${road.to}>${road.from}`,
      roadId: road.id,
      name: road.name,
      fromId: road.to,
      toId: road.from,
      side: sideFromA,
      lengthM: road.lengthM,
      speedLimitKmh: road.speedLimitKmh ?? 40,
      lanes: road.lanes ?? b.lanesPerApproach,
      external: false,
      x1: b.x,
      y1: b.y,
      x2: a.x,
      y2: a.y,
      vehicles: [],
      queue: [],
    });

    a.outgoing[sideFromA] = ab;
    b.approaches[sideFromB] = ab;
    b.outgoing[sideFromB] = ba;
    a.approaches[sideFromA] = ba;
  }

  // --- External entry / exit stubs ---
  const entries = [];
  const exits = [];

  for (const intersection of intersections.values()) {
    for (const side of Object.keys(SIDE_VECTORS)) {
      const vec = SIDE_VECTORS[side];

      if (!intersection.approaches[side]) {
        const inbound = addLink({
          id: `EXT:${intersection.id}:in:${side}`,
          roadId: null,
          name: `${side} approach`,
          fromId: null,
          toId: intersection.id,
          side,
          lengthM: entryLengthM,
          speedLimitKmh: 40,
          lanes: intersection.lanesPerApproach,
          external: true,
          entry: true,
          x1: intersection.x + vec.x * entryLengthM,
          y1: intersection.y + vec.y * entryLengthM,
          x2: intersection.x,
          y2: intersection.y,
          vehicles: [],
          queue: [],
        });
        intersection.approaches[side] = inbound;
        entries.push({ intersectionId: intersection.id, side, linkId: inbound.id });
      }

      if (!intersection.outgoing[side]) {
        const outbound = addLink({
          id: `EXT:${intersection.id}:out:${side}`,
          roadId: null,
          name: `${side} exit`,
          fromId: intersection.id,
          toId: null,
          side,
          lengthM: entryLengthM,
          speedLimitKmh: 40,
          lanes: intersection.lanesPerApproach,
          external: true,
          exit: true,
          x1: intersection.x,
          y1: intersection.y,
          x2: intersection.x + vec.x * entryLengthM,
          y2: intersection.y + vec.y * entryLengthM,
          vehicles: [],
          queue: [],
        });
        intersection.outgoing[side] = outbound;
        exits.push({ intersectionId: intersection.id, side, linkId: outbound.id });
      }
    }

    intersection.phases = phaseDefinitions(Object.keys(SIDE_VECTORS));
  }

  // --- Route precomputation (Dijkstra over road lengths) ---
  const routeCache = new Map();

  const shortestPath = (fromId, toId) => {
    if (fromId === toId) return [fromId];
    const key = `${fromId}>${toId}`;
    if (routeCache.has(key)) return routeCache.get(key);

    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set(intersections.keys());
    for (const id of unvisited) dist.set(id, Infinity);
    dist.set(fromId, 0);

    while (unvisited.size) {
      let current = null;
      let best = Infinity;
      for (const id of unvisited) {
        if (dist.get(id) < best) {
          best = dist.get(id);
          current = id;
        }
      }
      if (current === null || best === Infinity) break;
      unvisited.delete(current);
      if (current === toId) break;

      const node = intersections.get(current);
      for (const side of Object.keys(node.outgoing)) {
        const link = node.outgoing[side];
        if (!link || link.external) continue;
        const next = link.toId;
        if (!unvisited.has(next)) continue;
        const alt = dist.get(current) + link.lengthM;
        if (alt < dist.get(next)) {
          dist.set(next, alt);
          prev.set(next, current);
        }
      }
    }

    if (!Number.isFinite(dist.get(toId))) return null;

    const path = [toId];
    let cursor = toId;
    while (cursor !== fromId) {
      cursor = prev.get(cursor);
      if (!cursor) return null;
      path.unshift(cursor);
    }
    routeCache.set(key, path);
    return path;
  };

  const exitSidesByIntersection = new Map();
  for (const intersection of intersections.values()) {
    exitSidesByIntersection.set(
      intersection.id,
      Object.keys(intersection.outgoing).filter((side) => intersection.outgoing[side]?.exit)
    );
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    width: scenario.network.width,
    height: scenario.network.height,
    entryLengthM,
    intersections,
    links,
    entries,
    exits,
    shortestPath,
    exitSidesByIntersection,
    sideVectors: SIDE_VECTORS,
  };
}

/** Position of a vehicle on a link, in world coordinates (meters). */
export function linkPosition(link, pos) {
  const ratio = link.lengthM > 0 ? Math.min(1, Math.max(0, pos / link.lengthM)) : 0;
  return {
    x: link.x1 + (link.x2 - link.x1) * ratio,
    y: link.y1 + (link.y2 - link.y1) * ratio,
  };
}

/**
 * Choose the exit side at the destination, preferring to continue straight
 * through the intersection (a vehicle arriving from the west exits east).
 */
export function chooseExitSide(intersection, arrivalSide, rng) {
  const available = Object.keys(intersection.outgoing).filter(
    (side) => intersection.outgoing[side]?.exit
  );
  if (!available.length) return null;
  const straight = OPPOSITE[arrivalSide];
  if (available.includes(straight)) return straight;
  return rng ? rng.pick(available) : available[0];
}

/** Describe an approach (for metrics / UI labels). */
export function describeApproach(intersection, side) {
  const link = intersection.approaches[side];
  return {
    intersectionId: intersection.id,
    intersectionName: intersection.name,
    side,
    linkId: link ? link.id : null,
    name: link ? `${side} — ${link.name}` : `${side} approach`,
  };
}

export default buildNetwork;
