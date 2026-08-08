import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import { listLabs, getLab } from '../../../controllers/patient/labs.controller';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', listLabs);
router.get('/:id', getLab);

export default router;
