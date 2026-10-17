import { Router } from 'express';
import { listScenarios, getScenario } from '../controllers/scenarioController.js';

const router = Router();

router.get('/', listScenarios);
router.get('/:id', getScenario);

export default router;
