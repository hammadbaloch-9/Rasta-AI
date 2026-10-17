import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { evaluateRecommendationsSchema } from '../validation/schemas.js';
import { evaluateRecommendations } from '../controllers/intelligenceController.js';

const router = Router();

router.post('/evaluate', validate(evaluateRecommendationsSchema), evaluateRecommendations);

export default router;
