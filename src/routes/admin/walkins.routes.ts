import { Router } from 'express';
import {
  adminWalkinSchema,
  listPaymentAudit,
  listWalkinDoctors,
  listWalkins,
  loadWalkinDesk,
  prepareWalkin,
} from '../../controllers/admin/walkins.controller';
import {
  clinicPaymentSchema,
  createClinicBooking,
  recordClinicPayment,
  undoClinicPayment,
  updateVisit,
  visitActionSchema,
} from '../../controllers/doctor/clinic.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', listWalkins);
router.get('/doctors', listWalkinDoctors);
router.get('/audit', listPaymentAudit);
router.post('/', validate(adminWalkinSchema), prepareWalkin, createClinicBooking);
router.patch('/:id/visit', validate(visitActionSchema), loadWalkinDesk, updateVisit);
router.post('/:id/payment', validate(clinicPaymentSchema), loadWalkinDesk, recordClinicPayment);
router.delete('/:id/payment', loadWalkinDesk, undoClinicPayment);

export default router;
