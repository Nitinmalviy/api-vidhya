import { Router } from 'express';
import { getHistory, sendMessage, clearHistory, guestMessage } from '../../../controllers/patient/assistant.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

// Public: guest trial chat (rate-limited, nothing persisted)
router.post('/guest-message', guestMessage);

router.get('/history', authenticate, authorize('user'), getHistory);
router.post('/message', authenticate, authorize('user'), sendMessage);
router.delete('/history', authenticate, authorize('user'), clearHistory);

export default router;
