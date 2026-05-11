// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { FeedbackService } from '../../../server/services/sns/feedback-service.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('feedback S-4: updateSourceEntityReuse', () => {
    it('S-4: incrementReuse called with source_entity_id', async () => {
        const recorder = { incrementReuse: vi.fn() };
        const fb = new FeedbackService({
            xClient: new InMemoryXClient(),
            graphWriter: { appendEvent: async () => ({ id: 'e' }) },
            reuseRecorder: recorder
        });
        await fb.updateSourceEntityReuse('src_x');
        expect(recorder.incrementReuse).toHaveBeenCalledWith('src_x');
    });

    it('S-4: no recorder → silent no-op', async () => {
        const fb = new FeedbackService({
            xClient: new InMemoryXClient(),
            graphWriter: { appendEvent: async () => ({ id: 'e' }) }
        });
        await expect(fb.updateSourceEntityReuse('src_x')).resolves.toBeUndefined();
    });
});
