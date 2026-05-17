import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({ success: true, area: 'patient', feature: 'dashboard' });
});

export default router;

