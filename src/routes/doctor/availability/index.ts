import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { availabilitySchema, getAvailability, saveAvailability } from '../../../controllers/doctor/availability.controller';

const router = Router();

router.use(authenticate, authorize('doctor'));
router.get('/', getAvailability);
router.put('/', validate(availabilitySchema), saveAvailability);

export default router;
