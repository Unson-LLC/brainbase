import { describe, expect, it, vi } from 'vitest';

import { ManaChatService } from '../../../../../public/modules/domain/mana/mana-chat-service.js';

describe('ManaChatService.capture', () => {
    it('generates one capture_id and sends it to the canonical capture route', async () => {
        const response = { taskId: 'ct1.opaque.signature', title: '確認する' };
        const httpClient = { post: vi.fn().mockResolvedValue(response) };
        const store = {
            getState: vi.fn(() => ({ mana: { captures: [] } })),
            setState: vi.fn()
        };
        const eventBus = { emit: vi.fn().mockResolvedValue(undefined) };
        const captureIdFactory = vi.fn(() => '8e6e906c-2156-4b41-af50-d00a5ba344e6');
        const service = new ManaChatService({ httpClient, store, eventBus, captureIdFactory });

        await expect(service.capture('確認する', 'task')).resolves.toBe(response);

        expect(captureIdFactory).toHaveBeenCalledTimes(1);
        expect(httpClient.post).toHaveBeenCalledWith('/api/brainbase/mana/capture', {
            capture_id: '8e6e906c-2156-4b41-af50-d00a5ba344e6',
            content: '確認する',
            type: 'task'
        });
        expect(store.setState).toHaveBeenCalledWith({ mana: { captures: [response] } });
        expect(eventBus.emit).toHaveBeenCalledTimes(1);
    });
});
