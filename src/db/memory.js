/**
 * In-memory repository implementation.
 *
 * Used automatically when MongoDB is not configured or not reachable, so the
 * API is fully functional out of the box for local development and demos.
 * Data is intentionally ephemeral and is lost when the process restarts.
 */

import { newId, nowIso } from '../utils/misc.js';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

class MemoryCollection {
  constructor(prefix) {
    this.prefix = prefix;
    this.store = new Map();
  }

  insert(doc) {
    const id = doc.id || newId(this.prefix);
    const timestamp = nowIso();
    const record = {
      ...clone(doc),
      id,
      createdAt: doc.createdAt || timestamp,
      updatedAt: timestamp,
    };
    this.store.set(id, record);
    return clone(record);
  }

  findById(id) {
    const record = this.store.get(id);
    return record ? clone(record) : null;
  }

  update(id, patch) {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...clone(patch),
      id,
      updatedAt: nowIso(),
    };
    this.store.set(id, updated);
    return clone(updated);
  }

  delete(id) {
    return this.store.delete(id);
  }

  list({ filter = {}, limit = 20, offset = 0, sortKey = 'createdAt', sortDir = -1 } = {}) {
    const matches = [...this.store.values()].filter((doc) =>
      Object.entries(filter).every(([key, value]) => value === undefined || doc[key] === value)
    );

    matches.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * sortDir;
    });

    return {
      items: matches.slice(offset, offset + limit).map(clone),
      total: matches.length,
    };
  }

  clear() {
    this.store.clear();
  }
}

export function createMemoryRepositories() {
  const simulations = new MemoryCollection('sim');
  const experiments = new MemoryCollection('exp');

  return {
    mode: 'memory',
    simulations: {
      async create(doc) {
        return simulations.insert(doc);
      },
      async findById(id) {
        return simulations.findById(id);
      },
      async update(id, patch) {
        return simulations.update(id, patch);
      },
      async delete(id) {
        return simulations.delete(id);
      },
      async list({ filter, limit = 20, offset = 0 }) {
        return simulations.list({ filter, limit, offset });
      },
      async clear() {
        simulations.clear();
      },
    },
    experiments: {
      async create(doc) {
        return experiments.insert(doc);
      },
      async findById(id) {
        return experiments.findById(id);
      },
      async update(id, patch) {
        return experiments.update(id, patch);
      },
      async list({ filter, limit = 20, offset = 0 }) {
        return experiments.list({ filter, limit, offset });
      },
      async clear() {
        experiments.clear();
      },
    },
  };
}

export default createMemoryRepositories;
