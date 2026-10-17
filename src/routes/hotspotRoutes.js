import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { hotspotsQuerySchema } from '../validation/schemas.js';
import { listHotspots } from '../controllers/intelligenceController.js';

const router = Router();

router.get('/', validate(hotspotsQuerySchema, 'query'), listHotspots);

export default router;
