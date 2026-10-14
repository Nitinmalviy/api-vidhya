import { Router } from 'express';
import {
  createMember,
  createMemberSchema,
  listTeam,
  removeMember,
  updateMember,
  updateMemberSchema,
} from '../../controllers/admin/team.controller';
import { requireSuperAdmin } from '../../middleware/adminAccess';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router();

router.use(authenticate, authorize('admin'), requireSuperAdmin);

router.get('/', listTeam);
router.post('/', validate(createMemberSchema), createMember);
router.patch('/:id', validate(updateMemberSchema), updateMember);
router.delete('/:id', removeMember);

export default router;
