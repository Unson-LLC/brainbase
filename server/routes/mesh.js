import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function createMeshRouter(meshService, { authService, owner = {} } = {}) {
  const router = Router();
  router.use(requireAuth(authService, { allowInsecureHeaders: false }));
  // Mesh sends as this node, not as the HTTP caller. Until delegated node
  // identities exist, only the explicitly configured human owner may use it.
  router.use((req, res, next) => {
    if (typeof owner.personId !== 'string' || !owner.personId.trim()
      || typeof owner.organizationId !== 'string' || !owner.organizationId.trim()) {
      return res.status(503).json({ error: 'mesh_owner_not_configured' });
    }
    if (!['bearer', 'cookie'].includes(req.authSource)
      || req.access?.personId !== owner.personId
      || req.access?.organizationId !== owner.organizationId) {
      return res.status(403).json({ error: 'mesh_owner_required' });
    }
    next();
  });

  router.get('/status', (req, res) => {
    if (!meshService) {
      return res.json({ enabled: false });
    }
    res.json({
      enabled: true,
      nodeId: meshService.nodeId,
      role: meshService.role,
      connected: meshService.relay?.isConnected() ?? false,
      peers: meshService.getPeers(),
    });
  });

  router.get('/peers', (req, res) => {
    if (!meshService) {
      return res.status(503).json({ error: 'Mesh not enabled' });
    }
    res.json({ peers: meshService.getPeers({ onlineOnly: true }) });
  });

  router.post('/query', async (req, res) => {
    if (!meshService) {
      return res.status(503).json({ error: 'Mesh not enabled' });
    }
    const { to, question, scope = 'general' } = req.body || {};
    if (typeof to !== 'string' || !to.trim() || to.trim().toLowerCase() === 'all'
      || typeof question !== 'string' || !question.trim()
      || !['status', 'code', 'project', 'general'].includes(scope)) {
      return res.status(400).json({ error: 'A single node, non-empty question and valid scope are required' });
    }
    try {
      const queryId = await meshService.sendQuery(to.trim(), question.trim(), scope);
      res.json({ queryId, status: 'sent', receipt_kind: 'send_ack', answer_status: 'unknown' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
