import { Router } from 'express';
import { getHistory, sendMessage, clearHistory } from '../../../controllers/patient/assistant.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/history', authenticate, authorize('user'), getHistory);
router.post('/message', authenticate, authorize('user'), sendMessage);
router.delete('/history', authenticate, authorize('user'), clearHistory);

export default router;
