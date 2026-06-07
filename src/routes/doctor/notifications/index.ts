import { Router } from 'express';
import {
  getNotifications,
  markRead,
  markAllRead,
} from '../../../controllers/doctor/notifications.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('doctor'), getNotifications);
router.patch('/read-all', authenticate, authorize('doctor'), markAllRead);
router.patch('/:id/read', authenticate, authorize('doctor'), markRead);

export default router;
