import { asyncHandler } from '../utils/asyncHandler.js';
import { listExperiments, getExperiment, exportExperiment } from '../services/compareService.js';

export const listAll = asyncHandler(async (req, res) => {
  const result = await listExperiments(req.validatedQuery);
  res.json({ data: result.items, pagination: result.pagination });
});

export const getOne = asyncHandler(async (req, res) => {
  const result = await getExperiment(req.params.id);
  res.json({ data: result });
});

export const exportOne = asyncHandler(async (req, res) => {
  const { format } = req.validatedQuery;
  const file = await exportExperiment(req.params.id, format);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
});
