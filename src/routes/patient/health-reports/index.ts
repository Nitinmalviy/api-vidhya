import { Router } from 'express';
import {
  createReport,
  deleteReport,
  getReport,
  listReports,
} from '../../../controllers/patient/health-report.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('user'));

router.post('/', createReport);
router.get('/', listReports);
router.get('/:id', getReport);
router.delete('/:id', deleteReport);

export default router;
