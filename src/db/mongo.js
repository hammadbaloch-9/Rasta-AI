import mongoose from 'mongoose';
import Simulation from '../models/simulation.js';
import Experiment from '../models/experiment.js';

const toPlain = (doc) => {
  if (!doc) return null;
  // Mongoose documents run the schema toObject transform (which already sets id),
  // while .lean() queries return raw objects that still carry _id.
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (obj._id !== undefined) {
    obj.id = String(obj._id);
    delete obj._id;
  }
  delete obj.__v;
  return obj;
};

const cleanFilter = (filter = {}) =>
  Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined && value !== null));

export function createMongoRepositories() {
  return {
    mode: 'mongo',
    simulations: {
      async create(doc) {
        const created = await Simulation.create(doc);
        return toPlain(created);
      },
      async findById(id) {
        if (!mongoose.isValidObjectId(id)) return null;
        const doc = await Simulation.findById(id).lean();
        return toPlain(doc);
      },
      async update(id, patch) {
        if (!mongoose.isValidObjectId(id)) return null;
        const doc = await Simulation.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
        return toPlain(doc);
      },
      async delete(id) {
        if (!mongoose.isValidObjectId(id)) return false;
        const result = await Simulation.findByIdAndDelete(id);
        return Boolean(result);
      },
      async list({ filter, limit = 20, offset = 0 }) {
        const query = cleanFilter(filter);
        const [items, total] = await Promise.all([
          Simulation.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
          Simulation.countDocuments(query),
        ]);
        return { items: items.map(toPlain), total };
      },
      async clear() {
        await Simulation.deleteMany({});
      },
    },
    experiments: {
      async create(doc) {
        const created = await Experiment.create(doc);
        return toPlain(created);
      },
      async findById(id) {
        if (!mongoose.isValidObjectId(id)) return null;
        const doc = await Experiment.findById(id).lean();
        return toPlain(doc);
      },
      async update(id, patch) {
        if (!mongoose.isValidObjectId(id)) return null;
        const doc = await Experiment.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
        return toPlain(doc);
      },
      async list({ filter, limit = 20, offset = 0 }) {
        const query = cleanFilter(filter);
        const [items, total] = await Promise.all([
          Experiment.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
          Experiment.countDocuments(query),
        ]);
        return { items: items.map(toPlain), total };
      },
      async clear() {
        await Experiment.deleteMany({});
      },
    },
  };
}

export default createMongoRepositories;
