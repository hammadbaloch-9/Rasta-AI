import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { listExperimentsQuerySchema, exportQuerySchema } from '../validation/schemas.js';
import { listAll, getOne, exportOne } from '../controllers/experimentController.js';

const router = Router();

router.get('/', validate(listExperimentsQuerySchema, 'query'), listAll);
router.get('/:id/export', validate(exportQuerySchema, 'query'), exportOne);
router.get('/:id', getOne);

export default router;
