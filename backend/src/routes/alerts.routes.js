import { Router } from 'express';
import { all, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const data = await all(`SELECT a.*, p.title as project_title FROM alerts a LEFT JOIN projects p ON a.project_id=p.id
    WHERE a.user_id=? ORDER BY a.is_read ASC, a.created_at DESC`, [req.user.id]);
  res.json({ success: true, data });
});

router.put('/:id/read', async (req, res) => {
  await run('UPDATE alerts SET is_read=1 WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

export default router;
