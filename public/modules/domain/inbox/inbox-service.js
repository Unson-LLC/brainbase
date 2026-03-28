import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * Inboxのビジネスロジック
 * InboxViewから抽出したInbox管理機能を集約
 */
export class InboxService {
    constructor() {
        this.httpClient = httpClient;
        this.store = appStore;
        this.eventBus = eventBus;
    }

    /**
     * Inbox一覧取得
     * @returns {Promise<Array>} Inboxアイテム配列
     */
    async loadInbox() {
        const [notifications, learningCandidates] = await Promise.all([
            this.httpClient.get('/api/inbox/pending'),
            this.httpClient.get('/api/learning/promotions?status=evaluated&apply_mode=manual', { suppressAuthError: true }).catch(() => [])
        ]);
        const items = [
            ...(Array.isArray(learningCandidates) ? learningCandidates.map((candidate) => ({
                kind: 'learning',
                id: candidate.id,
                candidateId: candidate.id,
                pillar: candidate.pillar,
                title: candidate.title || candidate.target_ref || '学習候補',
                targetRef: candidate.target_ref,
                sourcePreview: candidate.source_preview || '',
                sourceType: candidate.source_type || null,
                outcome: candidate.outcome || null,
                riskLevel: candidate.risk_level || 'low',
                evaluationSummary: candidate.evaluation_summary || {},
                proposedContent: candidate.proposed_content || '',
                updatedAt: candidate.updated_at || candidate.created_at || null
            })) : []),
            ...(Array.isArray(notifications) ? notifications.map((item) => ({ ...item, kind: 'notification' })) : [])
        ];
        this.store.setState({ inbox: items });
        await this.eventBus.emit(EVENTS.INBOX_LOADED, { items });
        return items;
    }

    /**
     * Inboxアイテムを確認済みにする
     * @param {string} itemId - 確認済みにするアイテムのID
     * @returns {Promise<{success: boolean, itemId: string, eventResult: Object}>}
     */
    async markAsDone(itemId) {
        await this.httpClient.post(`/api/inbox/${itemId}/done`);
        await this.loadInbox(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.INBOX_ITEM_COMPLETED, { itemId });
        return { success: true, itemId, eventResult };
    }

    /**
     * すべてのInboxアイテムを確認済みにする
     * @returns {Promise<{success: boolean, count: number}>}
     */
    async markAllAsDone() {
        const beforeCount = this.getInboxCount();
        await this.httpClient.post('/api/inbox/mark-all-done');
        await this.loadInbox(); // リロード
        return { success: true, count: beforeCount };
    }

    async applyLearningCandidate(candidateId) {
        await this.httpClient.post(`/api/learning/promotions/${candidateId}/apply`);
        await this.loadInbox();
        return { success: true, candidateId };
    }

    async rejectLearningCandidate(candidateId) {
        await this.httpClient.post(`/api/learning/promotions/${candidateId}/reject`, {});
        await this.loadInbox();
        return { success: true, candidateId };
    }

    /**
     * 現在のInboxアイテム数を取得
     * @returns {number} Inboxアイテム数
     */
    getInboxCount() {
        const { inbox } = this.store.getState();
        return inbox ? inbox.length : 0;
    }
}
