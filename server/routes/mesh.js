import { Router } from 'express';

export function createMeshRouter(meshService) {
  const router = Router();

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
      return res.json({ peers: [] });
    }
    res.json({ peers: meshService.getPeers({ onlineOnly: true }) });
  });

  router.post('/query', async (req, res) => {
    if (!meshService) {
      return res.status(503).json({ error: 'Mesh not enabled' });
    }
    const { to, question, scope } = req.body;
    if (!to || !question) {
      return res.status(400).json({ error: 'Missing required fields: to, question' });
    }
    try {
      const queryId = await meshService.sendQuery(to, question, scope);
      res.json({ queryId, status: 'sent' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
