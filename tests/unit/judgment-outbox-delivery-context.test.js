import { describe, expect, it, vi } from 'vitest';

import { createJudgmentOutboxDeliveryService } from '../../server/services/routine-runtime/judgment-event-outbox.js';

function createService({ env = {} } = {}) {
    const deliver = vi.fn(async () => ({ status: 'processed', delivered: 1, pending: 0 }));
    return {
        deliver,
        service: createJudgmentOutboxDeliveryService({
            outboxDir: '/tmp/outbox',
            deadLetterDir: '/tmp/dead-letter',
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            deliveryAuth: { internalApiKey: 'internal-secret', serviceToken: null },
            env,
            deliver
        })
    };
}

describe('judgment Outbox delivery context', () => {
    it('Ohayoの認証済みorganizationを旧event配送へ渡し、手動envを不要にする', async () => {
        const { deliver, service } = createService();

        await service.deliverPending({ access: { organizationId: 'org_authenticated' } });

        expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org_authenticated'
        }));
    });

    it('認証contextのtenantIdをorganizationとして補完できる', async () => {
        const { deliver, service } = createService();

        await service.deliverPending({ access: { tenantId: 'org_from_tenant' } });

        expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org_from_tenant'
        }));
    });

    it('contextがない既存呼び出しでは従来のenv organizationへフォールバックする', async () => {
        const { deliver, service } = createService({
            env: { BRAINBASE_ORGANIZATION_ID: 'org_env' }
        });

        await service.deliverPending();

        expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org_env'
        }));
    });
});
