import { Router } from 'express';
import {
  getNotifications,
  markRead,
  markAllRead,
} from '../../../controllers/patient/notifications.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('user'), getNotifications);
router.patch('/read-all', authenticate, authorize('user'), markAllRead);
router.patch('/:id/read', authenticate, authorize('user'), markRead);

export default router;
