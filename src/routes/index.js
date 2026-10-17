import { Router } from 'express';
import { health, apiIndex, metricDefinitions } from '../controllers/healthController.js';
import scenarioRoutes from './scenarioRoutes.js';
import simulationRoutes from './simulationRoutes.js';
import hotspotRoutes from './hotspotRoutes.js';
import recommendationRoutes from './recommendationRoutes.js';
import experimentRoutes from './experimentRoutes.js';
import { getDashboard } from '../controllers/dashboardController.js';

const router = Router();

router.get('/', apiIndex);
router.get('/health', health);
router.get('/metrics/definitions', metricDefinitions);
router.get('/dashboard', getDashboard);

router.use('/scenarios', scenarioRoutes);
router.use('/simulations', simulationRoutes);
router.use('/hotspots', hotspotRoutes);
router.use('/recommendations', recommendationRoutes);
router.use('/experiments', experimentRoutes);

export default router;
