import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import {
  listReminders,
  createReminder,
  updateReminder,
  toggleReminder,
  deleteReminder,
  listDoseLogs,
  markDoseTaken,
  unmarkDoseTaken,
} from '../../../controllers/patient/medicine-reminders.controller';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', listReminders);
router.post('/', createReminder);
router.put('/:id', updateReminder);
router.patch('/:id/toggle', toggleReminder);
router.delete('/:id', deleteReminder);

router.get('/:id/doses', listDoseLogs);
router.post('/:id/doses', markDoseTaken);
router.delete('/:id/doses', unmarkDoseTaken);

export default router;
