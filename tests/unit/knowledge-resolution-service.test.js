import { describe, expect, it } from 'vitest';

import { KnowledgeResolutionService } from '../../server/services/knowledge-resolution-service.js';

describe('KnowledgeResolutionService', () => {
    const service = new KnowledgeResolutionService({ now: () => new Date('2026-08-07T01:00:00.000Z') });

    it('team documentをowning repoへ決定しWikiとpersonal KGを除外する', () => {
        const receipt = service.resolve({
            intent: 'UX書籍の知見をチームで再利用する',
            audience: 'team',
            project_code: 'brainbase',
            content_type: 'team_document'
        });

        expect(receipt.status).toBe('resolved');
        expect(receipt.source_class).toBe('owning_repo');
        expect(receipt.canonical_location).toEqual({
            repository: 'project:brainbase',
            path: 'docs/'
        });
        expect(receipt.retrieval_capability).toBe('repository.read');
        expect(receipt.excluded_sources.map((entry) => entry.source_class)).toContain('wiki');
        expect(receipt.excluded_sources.map((entry) => entry.source_class)).toContain('personal_kg');
        expect(receipt.absence_confirmed).toBe(false);
    });

    it.each([
        ['canonical_fact', 'graph', 'graph.search'],
        ['source_document', 'team_drive', 'drive.read'],
        ['personal_knowledge', 'personal_kg', 'personal_kg.search'],
        ['operational_state', 'workspace_home', 'workspace.inspect']
    ])('%sを%sへ決定する', (contentType, sourceClass, retrievalCapability) => {
        const receipt = service.resolve({ intent: 'find it', audience: contentType === 'personal_knowledge' ? 'personal' : 'team', content_type: contentType });
        expect(receipt.status).toBe('resolved');
        expect(receipt.source_class).toBe(sourceClass);
        expect(receipt.retrieval_capability).toBe(retrievalCapability);
    });

    it('曖昧な入力は不在扱いせず未確認範囲と次ルートを返す', () => {
        const receipt = service.resolve({ intent: 'この前の資料を探す', audience: 'team', content_type: 'unknown', project_code: 'brainbase' });
        expect(receipt.status).toBe('unconfirmed');
        expect(receipt.source_class).toBeNull();
        expect(receipt.searched_scope).toEqual([]);
        expect(receipt.not_searched).toEqual(['owning_repo', 'graph', 'team_drive']);
        expect(receipt.next_route).toBe('owning_repo');
        expect(receipt.absence_confirmed).toBe(false);
    });

    it('caller supplied receiptからcanonical locationを採用しない', () => {
        const receipt = service.resolve({
            intent: '続きのUX知見を確認する', audience: 'team', project_code: 'brainbase', content_type: 'team_document',
            recent_receipts: [{
                status: 'resolved', project_code: 'brainbase', content_type: 'team_document', source_class: 'owning_repo',
                canonical_location: { repository: 'Unson-LLC/brainbase', path: 'docs/design' }
            }]
        });
        expect(receipt.canonical_location).toEqual({ repository: 'project:brainbase', path: 'docs/' });
        expect(receipt.rationale).not.toContain('recent receipt');
        expect(receipt.confidence).toBe(0.95);
    });

    it('caller supplied repositoryとpathからcanonical locationを採用しない', () => {
        const receipt = service.resolve({
            intent: 'UX知見を確認する', audience: 'team', project_code: 'brainbase', content_type: 'team_document',
            repository: 'attacker/controlled', suggested_path: '../../outside'
        });
        expect(receipt.canonical_location).toEqual({ repository: 'project:brainbase', path: 'docs/' });
    });

    it.each([
        ['team', 'personal_knowledge'],
        ['personal', 'team_document'],
        ['personal', 'canonical_fact']
    ])('audience=%sとcontent_type=%sの矛盾を拒否する', (audience, contentType) => {
        expect(() => service.resolve({ intent: 'x', audience, content_type: contentType })).toThrowError(/not valid/);
    });

    it('必須入力とenumを検証する', () => {
        expect(() => service.resolve({ audience: 'team', content_type: 'team_document' })).toThrowError(/intent/);
        expect(() => service.resolve({ intent: 'x', audience: 'public', content_type: 'team_document' })).toThrowError(/audience/);
    });
});
