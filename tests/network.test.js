import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, sideOf } from '../src/simulation/network.js';
import { scenarios } from '../src/config/scenarios.js';

const scenario = scenarios[0];

test('network has four connected intersections with four approaches each', () => {
  const net = buildNetwork(scenario);
  assert.equal(net.intersections.size, 4);

  for (const intersection of net.intersections.values()) {
    for (const side of ['N', 'S', 'E', 'W']) {
      assert.ok(intersection.approaches[side], `${intersection.id} missing approach ${side}`);
      assert.ok(intersection.outgoing[side], `${intersection.id} missing outgoing ${side}`);
      assert.ok(Array.isArray(intersection.approaches[side].queue));
    }
    assert.equal(intersection.phases.length, 2);
    assert.deepEqual(intersection.phases[0].approaches, ['N', 'S']);
    assert.deepEqual(intersection.phases[1].approaches, ['E', 'W']);
  }
});

test('approach side matches the destination geometry', () => {
  const net = buildNetwork(scenario);
  const i1 = net.intersections.get('I1');
  const i2 = net.intersections.get('I2'); // east of I1
  const i3 = net.intersections.get('I3'); // south of I1

  assert.equal(sideOf(i1, i2), 'E');
  assert.equal(sideOf(i1, i3), 'S');

  // The I1 -> I2 link arrives at I2 from the west.
  const link = i1.outgoing.E;
  assert.equal(link.toId, 'I2');
  assert.equal(link.side, 'W');
  assert.equal(i2.approaches.W.id, link.id);

  // Therefore I1's west side is an external entry.
  assert.equal(i1.approaches.W.external, true);
  assert.equal(i1.approaches.E.toId, 'I1');
});

test('eight boundary entries and exits exist', () => {
  const net = buildNetwork(scenario);
  assert.equal(net.entries.length, 8);
  assert.equal(net.exits.length, 8);
  for (const entry of net.entries) {
    assert.ok(net.links.get(entry.linkId).entry);
  }
});

test('routes connect every pair of intersections', () => {
  const net = buildNetwork(scenario);
  const ids = [...net.intersections.keys()];
  for (const from of ids) {
    for (const to of ids) {
      const path = net.shortestPath(from, to);
      assert.ok(path, `no route ${from} -> ${to}`);
      assert.equal(path[0], from);
      assert.equal(path[path.length - 1], to);
    }
  }
  assert.deepEqual(net.shortestPath('I1', 'I4').length, 3);
});

test('scenario demand keys map to real entry points', () => {
  const net = buildNetwork(scenario);
  const entryKeys = new Set(net.entries.map((e) => `${e.intersectionId}:${e.side}`));
  for (const key of Object.keys(scenario.demand.entries)) {
    assert.ok(entryKeys.has(key), `demand key ${key} has no matching entry`);
  }
});
