import { Router } from 'express';
import { verifyDoctor } from '../../../controllers/admin/verification.controller';

const router = Router();

router.patch('/:id', verifyDoctor);

export default router;

