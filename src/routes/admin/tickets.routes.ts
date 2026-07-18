import { Router } from 'express';
import { getTickets, replyToTicket } from '../../controllers/admin/tickets.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', getTickets);
router.post('/:id/reply', replyToTicket);

export default router;
