import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningCandidateModal } from '../../../public/modules/ui/modals/learning-candidate-modal.js';

describe('LearningCandidateModal', () => {
    let modal;
    let onApply;
    let onReject;
    let onApplyAll;
    let onRejectAll;

    beforeEach(() => {
        document.body.innerHTML = '';
        onApply = vi.fn(async () => ({}));
        onReject = vi.fn(async () => ({}));
        onApplyAll = vi.fn(async () => ({}));
        onRejectAll = vi.fn(async () => ({}));
        modal = new LearningCandidateModal({ onApply, onReject, onApplyAll, onRejectAll });
    });

    it('relatedItems がある場合に関連候補一覧を表示して切り替えられる', async () => {
        modal.open({
            candidateId: 'prm_1',
            pillar: 'wiki',
            riskLevel: 'low',
            title: 'symlink を必ず解決してから比較する',
            sourcePreview: 'symlink を必ず解決してから比較する',
            sourceType: 'codex_session_log',
            outcome: 'success',
            mergedEpisodeCount: 1,
            canonicalSummary: 'symlink を必ず解決してから比較する',
            evaluationSummary: {},
            proposedContent: '# stories/symlink',
            targetRef: 'stories/symlink',
            relatedItems: [
                {
                    candidateId: 'prm_1',
                    pillar: 'wiki',
                    riskLevel: 'low',
                    title: 'symlink を必ず解決してから比較する',
                    sourcePreview: 'symlink を必ず解決してから比較する',
                    sourceType: 'codex_session_log',
                    outcome: 'success',
                    mergedEpisodeCount: 1,
                    canonicalSummary: 'symlink を必ず解決してから比較する',
                    evaluationSummary: {},
                    proposedContent: '# stories/symlink',
                    targetRef: 'stories/symlink'
                },
                {
                    candidateId: 'prm_2',
                    pillar: 'skill',
                    riskLevel: 'low',
                    title: 'brainbase-symlink-を必ず解決してから比較する',
                    sourcePreview: 'symlink を必ず解決してから比較する',
                    sourceType: 'codex_session_log',
                    outcome: 'success',
                    mergedEpisodeCount: 1,
                    canonicalSummary: 'symlink を必ず解決してから比較する',
                    evaluationSummary: {},
                    proposedContent: '# skill',
                    targetRef: '.claude/skills/brainbase-symlink/SKILL.md'
                }
            ]
        });

        const relatedButtons = document.querySelectorAll('[data-related-candidate-id]');
        expect(relatedButtons).toHaveLength(2);
        expect(document.getElementById('learning-candidate-modal-title').textContent).toContain('symlink を必ず解決してから比較する');

        relatedButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('learning-candidate-modal-title').textContent).toContain('brainbase-symlink-を必ず解決してから比較する');
        expect(document.getElementById('learning-candidate-target-ref').textContent).toContain('.claude/skills/brainbase-symlink/SKILL.md');
    });

    it('relatedItems が複数ある場合に一括反映と一括却下を呼べる', async () => {
        modal.open({
            candidateId: 'prm_1',
            pillar: 'wiki',
            riskLevel: 'low',
            title: 'symlink を必ず解決してから比較する',
            sourcePreview: 'symlink を必ず解決してから比較する',
            sourceType: 'codex_session_log',
            outcome: 'success',
            mergedEpisodeCount: 1,
            canonicalSummary: 'symlink を必ず解決してから比較する',
            evaluationSummary: {},
            proposedContent: '# stories/symlink',
            targetRef: 'stories/symlink',
            relatedItems: [
                { candidateId: 'prm_1', pillar: 'wiki', title: 'one' },
                { candidateId: 'prm_2', pillar: 'skill', title: 'two' }
            ]
        });

        document.getElementById('learning-candidate-apply-all-btn').click();
        expect(onApplyAll).toHaveBeenCalledWith([
            expect.objectContaining({ candidateId: 'prm_1' }),
            expect.objectContaining({ candidateId: 'prm_2' })
        ]);

        modal.open({
            candidateId: 'prm_1',
            pillar: 'wiki',
            riskLevel: 'low',
            title: 'symlink を必ず解決してから比較する',
            sourcePreview: 'symlink を必ず解決してから比較する',
            sourceType: 'codex_session_log',
            outcome: 'success',
            mergedEpisodeCount: 1,
            canonicalSummary: 'symlink を必ず解決してから比較する',
            evaluationSummary: {},
            proposedContent: '# stories/symlink',
            targetRef: 'stories/symlink',
            relatedItems: [
                { candidateId: 'prm_1', pillar: 'wiki', title: 'one' },
                { candidateId: 'prm_2', pillar: 'skill', title: 'two' }
            ]
        });

        document.getElementById('learning-candidate-reject-all-btn').click();
        expect(onRejectAll).toHaveBeenCalledWith([
            expect.objectContaining({ candidateId: 'prm_1' }),
            expect.objectContaining({ candidateId: 'prm_2' })
        ]);
    });
});
