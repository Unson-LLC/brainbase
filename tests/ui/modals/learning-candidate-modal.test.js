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

    it('story-knowledge-formalization-language:AC-006 異なる保存先や分類待ちを含む関連候補は一括反映させない', async () => {
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

        expect(document.getElementById('learning-candidate-apply-all-btn').classList).toContain('hidden');
        expect(onApplyAll).not.toHaveBeenCalled();
        expect(document.getElementById('learning-candidate-reject-all-btn').textContent).toBe('すべて見送る（2件）');
        expect(document.getElementById('learning-candidate-action-description').textContent)
            .toContain('保存先や操作が異なるため、一括処理できません');
    });

    it('同じ保存先の関連候補だけを具体的な操作名で一括処理する', async () => {
        modal.open({
            candidateId: 'prm_1',
            pillar: 'skill',
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
                { candidateId: 'prm_1', pillar: 'skill', title: 'one' },
                { candidateId: 'prm_2', pillar: 'skill', title: 'two' }
            ]
        });

        const applyAllButton = document.getElementById('learning-candidate-apply-all-btn');
        expect(applyAllButton.textContent).toBe('再利用できる手順にする（2件）');
        applyAllButton.click();
        expect(onApplyAll).toHaveBeenCalledWith([
            expect.objectContaining({ candidateId: 'prm_1' }),
            expect.objectContaining({ candidateId: 'prm_2' })
        ]);

        modal.open({
            candidateId: 'prm_1',
            pillar: 'skill',
            relatedItems: [
                { candidateId: 'prm_1', pillar: 'skill', title: 'one' },
                { candidateId: 'prm_2', pillar: 'skill', title: 'two' }
            ]
        });
        document.getElementById('learning-candidate-reject-all-btn').click();
        expect(onRejectAll).toHaveBeenCalledWith([
            expect.objectContaining({ candidateId: 'prm_1' }),
            expect.objectContaining({ candidateId: 'prm_2' })
        ]);
    });

    it('story-knowledge-formalization-language:AC-002 story-knowledge-formalization-language:AC-005 Skill候補には再利用先が分かる具体的な操作名を表示する', () => {
        modal.open({
            candidateId: 'prm_skill',
            pillar: 'skill',
            title: '契約書の保存手順',
            targetRef: '.claude/skills/contracts/SKILL.md'
        });

        const applyButton = document.getElementById('learning-candidate-apply-btn');
        const rejectButton = document.getElementById('learning-candidate-reject-btn');
        expect(applyButton.textContent).toBe('再利用できる手順にする');
        expect(applyButton.disabled).toBe(false);
        expect(rejectButton.textContent).toBe('今回は見送る');
    });

    it('story-knowledge-formalization-language:AC-007 legacy Wiki候補は正本の分類が済むまで反映できない', () => {
        modal.open({
            candidateId: 'prm_wiki',
            pillar: 'wiki',
            title: '契約書の保存場所',
            targetRef: 'contracts/storage-policy'
        });

        const applyButton = document.getElementById('learning-candidate-apply-btn');
        expect(applyButton.textContent).toBe('保存先の分類が必要');
        expect(applyButton.disabled).toBe(true);
        expect(applyButton.title).toContain('Graph・所有repo・Drive');
        expect(document.getElementById('learning-candidate-action-description').textContent)
            .toContain('Graph・所有repo・Drive');
        expect(applyButton.getAttribute('aria-describedby')).toBe('learning-candidate-action-description');
    });

    it('story-knowledge-formalization-language:AC-003 Memory Candidateの承認をGraph登録完了と誤認させない', () => {
        modal = new LearningCandidateModal({
            currentPersonId: 'per_owner',
            onApproveMemory: vi.fn(async () => ({}))
        });
        modal.open({
            kind: 'memory_candidate',
            candidateId: 'mem_1',
            ownerPersonId: 'per_owner',
            currentPersonId: 'per_owner',
            promotionStatus: 'pending_approval',
            memory: { summary: '契約書は指定フォルダへ保存する' }
        });

        const applyButton = document.getElementById('learning-candidate-apply-btn');
        expect(applyButton.textContent).toBe('正式登録を承認する');
        expect(applyButton.title).toContain('正本への登録処理は別工程');
    });

    it('機密情報の修正が必要なMemory Candidateは停止理由を可視表示する', () => {
        modal = new LearningCandidateModal({ currentPersonId: 'per_owner' });
        modal.open({
            kind: 'memory_candidate',
            candidateId: 'mem_redaction',
            ownerPersonId: 'per_owner',
            currentPersonId: 'per_owner',
            redactionStatus: 'needs_redaction',
            memory: { summary: '契約書の保存場所' }
        });

        expect(document.getElementById('learning-candidate-apply-btn').disabled).toBe(true);
        expect(document.getElementById('learning-candidate-action-description').textContent)
            .toContain('機密情報の修正が必要なため、正式登録を承認できません');
    });
});
