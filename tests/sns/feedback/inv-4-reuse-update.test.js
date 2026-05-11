// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { FeedbackService } from '../../../server/services/sns/feedback-service.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('feedback INV-4: reuse_count updater hook', () => {
    it('INV-4: updateSourceEntityReuse calls reuseRecorder.incrementReuse', async () => {
        const recorder = { incrementReuse: vi.fn() };
        const fb = new FeedbackService({
            xClient: new InMemoryXClient(),
            graphWriter: { appendEvent: async () => ({ id: 'e' }) },
            reuseRecorder: recorder
        });
        await fb.updateSourceEntityReuse('source-entity-1');
        expect(recorder.incrementReuse).toHaveBeenCalledWith('source-entity-1');
    });
});
