import { describe, expect, it, vi } from 'vitest';
import { ManaChatView } from '../../../public/modules/ui/views/mana-chat-view.js';

describe('ManaChatView knowledge formalization copy', () => {
    it('story-knowledge-formalization-language:AC-003 承認完了をGraph登録完了として表示しない', async () => {
        const manaChatService = {
            approveMemoryCandidate: vi.fn(async () => ({}))
        };
        const view = new ManaChatView({ manaChatService });
        view._getCurrentPersonId = () => 'per_actor';
        view._appendMessage = vi.fn();

        await view._approveMemoryCandidate({
            candidateId: 'mem_1',
            ownerPersonId: 'per_owner'
        });

        expect(manaChatService.approveMemoryCandidate).toHaveBeenCalledWith('mem_1', {
            actor_person_id: 'per_actor',
            decision_owner_person_id: 'per_owner',
            reason: 'approved_from_mana_review'
        });
        expect(view._appendMessage).toHaveBeenCalledWith(
            'system',
            '正式登録を承認しました。正本への登録処理は別工程です。'
        );
    });
});
