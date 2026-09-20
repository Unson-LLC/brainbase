import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createBrainbaseRouter } from '../../../server/routes/brainbase.js';

describe('Brainbase legacy NocoDB action boundary', () => {
  it('retires action aliases for every method without invoking NocoDB', async () => {
    const nocodbService = {
      createAction: vi.fn(),
      getActions: vi.fn(),
      updateActionStatus: vi.fn(),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/brainbase', createBrainbaseRouter({ nocodbService }));

    const responses = await Promise.all([
      request(app).post('/api/brainbase/actions').send({
        project: 'brainbase',
        taskId: 1,
        tableId: 'legacy-actions',
        actionType: 'reassign',
      }),
      request(app).get('/api/brainbase/actions?project=brainbase'),
      request(app).patch('/api/brainbase/actions/1/status').send({ status: 'approved' }),
      request(app).delete('/api/brainbase/actions/1'),
      request(app).get('/api/brainbase/action-types'),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(410);
      expect(response.body).toMatchObject({
        error: 'capability_retired',
        capability: 'brainbase.nocodb-actions',
      });
    }

    expect(nocodbService.createAction).not.toHaveBeenCalled();
    expect(nocodbService.getActions).not.toHaveBeenCalled();
    expect(nocodbService.updateActionStatus).not.toHaveBeenCalled();
  });
});
