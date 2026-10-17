import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  runSimulationSchema,
  compareSchema,
  listSimulationsQuerySchema,
} from '../validation/schemas.js';
import {
  createRun,
  compareRuns,
  listRuns,
  getRun,
  getRunMetrics,
  getRunFrames,
  getRunState,
  removeRun,
} from '../controllers/simulationController.js';

const router = Router();

router.post('/run', validate(runSimulationSchema), createRun);
router.post('/compare', validate(compareSchema), compareRuns);
router.get('/', validate(listSimulationsQuerySchema, 'query'), listRuns);
router.get('/:id', getRun);
router.get('/:id/metrics', getRunMetrics);
router.get('/:id/frames', getRunFrames);
router.get('/:id/state', getRunState);
router.delete('/:id', removeRun);

export default router;
