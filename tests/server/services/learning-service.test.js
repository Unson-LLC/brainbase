import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LearningService,
    buildSkillCandidateContent,
    classifyWikiDocumentType,
    deriveCanonicalWikiTargetRef,
    deriveSkillSlug,
    deriveSkillTargetRef,
    isValidSkillName,
    shouldCreateSkillCandidate,
    shouldCreateWikiCandidate
} from '../../../server/services/learning-service.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';
import { PgCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import {
    createProposedOntologyFixture,
    createSignedActiveOntologyFixture
} from '../../helpers/ontology-test-fixtures.js';

describe('learning-service helpers', () => {
    it('wiki document type を canonical 種別へ分類する', () => {
        expect(classifyWikiDocumentType({
            summary: 'API schema と checklist を仕様として整理する',
            evidence: { proposed_rule: 'input/output contract' }
        })).toBe('specs');

        expect(classifyWikiDocumentType({
            summary: '設計判断を decision として残す',
            evidence: {}
        })).toBe('decisions');
    });

    it('二本柱の必要性を独立判定する（skill 側は ASCII skill_name が必要）', () => {
        const episode = {
            skill_name: 'xterm-refit',
            summary: '障害回避の手順と原則を標準化する',
            evidence: {
                proposed_rule: '再接続条件を固定する',
                proposed_steps: 'xtermを再fitする。再接続後にサイズを同期し直す十分な手順。'
            }
        };

        expect(shouldCreateWikiCandidate(episode)).toBe(true);
        expect(shouldCreateSkillCandidate(episode)).toBe(true);
    });

    it('wiki/skill target ref を新ルールで導出する（JP summary からは skill 名を作らない）', () => {
        expect(deriveCanonicalWikiTargetRef({
            summary: '標準化ルールの整理',
            evidence: {}
        })).toContain('architecture/');

        // JP summary のみでは ASCII skill slug を導出できない
        expect(deriveSkillSlug({
            project_id: 'brainbase',
            summary: '障害回避手順の更新'
        })).toBeNull();

        // 明示的な skill_refs があればそれをそのまま使う
        expect(deriveSkillTargetRef({
            skill_refs: ['.claude/skills/xterm-resize-fix/SKILL.md']
        })).toBe('.claude/skills/xterm-resize-fix/SKILL.md');

        // 明示的な skill_name（ASCII kebab）があればそれを使う
        expect(deriveSkillTargetRef({
            project_id: 'brainbase',
            skill_name: 'xterm-resize-fix',
            summary: 'x'
        })).toBe('.claude/skills/xterm-resize-fix/SKILL.md');
    });

    it('skill candidate content は linked wiki を必ず含む', () => {
        const output = buildSkillCandidateContent({
            source_type: 'review',
            outcome: 'failure',
            summary: 'xterm折り返し崩れの修正',
            evidence: { proposed_steps: 'resize を戻る時だけ走らせる' }
        }, 'architecture/xterm-wrap');

        expect(output).toContain('## Linked Wiki');
        expect(output).toContain('architecture/xterm-wrap');
    });

    // codex/Claude skill loader 互換: name は 64 文字以下、description は YAML 安全
    it('skill name フィールドは codex 制限の 64 文字以下に切り詰める', () => {
        const longSummary = 'codex skill loader は name フィールドが 64 文字を超えるとエラーになるため slugify と name フィールドを短く保つこと';
        const output = buildSkillCandidateContent({
            source_type: 'review',
            outcome: 'failure',
            summary: longSummary,
            project_id: 'brainbase',
            evidence: {}
        }, 'architecture/long-summary');

        const nameLine = output.split('\n').find((line) => line.startsWith('name:'));
        expect(nameLine).toBeDefined();
        const nameValue = nameLine.replace(/^name:\s*/, '').replace(/^"|"$/g, '');
        expect(nameValue.length).toBeLessThanOrEqual(64);
    });

    it('description に `:` を含む場合は YAML 安全に quote する', () => {
        const output = buildSkillCandidateContent({
            source_type: 'review',
            outcome: 'failure',
            summary: 'DEPRECATED: 古いskillは使用しない。新規はXを使う',
            evidence: {}
        }, 'architecture/deprecated');

        const descLine = output.split('\n').find((line) => line.startsWith('description:'));
        expect(descLine).toBeDefined();
        // `:` を含む値は double quote で囲まれている必要がある
        expect(descLine).toMatch(/^description: "[^"]*"$/);
    });
});

describe('skill name quality gate', () => {
    it('isValidSkillName は ASCII kebab-case のみを true とする', () => {
        expect(isValidSkillName('xterm-resize-fix')).toBe(true);
        expect(isValidSkillName('brainbase-gog-driveはlsを使い-非対話削除は-forceが必要')).toBe(false);
        expect(isValidSkillName('')).toBe(false);
        expect(isValidSkillName('a')).toBe(false);
        expect(isValidSkillName('-bad')).toBe(false);
        expect(isValidSkillName('Bad-Case')).toBe(false);
    });

    it('deriveSkillSlug は JP summary のみで skill_name/skill_refs が無ければ null を返す', () => {
        expect(deriveSkillSlug({
            project_id: 'brainbase',
            summary: '障害回避手順の更新'
        })).toBeNull();
    });

    it('deriveSkillSlug は有効な skill_name があればそれを優先して返す', () => {
        expect(deriveSkillSlug({
            skill_name: 'xterm-resize-fix',
            summary: '日本語の要約'
        })).toBe('xterm-resize-fix');
    });

    it('shouldCreateSkillCandidate は JP summary の一行学習を skill 化しない', () => {
        expect(shouldCreateSkillCandidate({
            summary: '日本語の教訓',
            evidence: { proposed_steps: '短い' }
        })).toBe(false);
    });

    it('shouldCreateSkillCandidate は ASCII skill_name + 十分な手順があれば skill 化する', () => {
        expect(shouldCreateSkillCandidate({
            skill_name: 'xterm-resize-fix',
            summary: 'fix xterm resize',
            evidence: { proposed_steps: 'resize を戻る時だけ走らせる。十分な長さの手順。' }
        })).toBe(true);
    });
});

describe('LearningService', () => {
    let pool;
    let service;
    let selectQueue;
    let wikiService;
    let repoRoot;
    let ontologyFixtures;

    beforeEach(() => {
        selectQueue = [];
        wikiService = {
            savePage: vi.fn(async () => ({ success: true })),
            setPageAccess: vi.fn(async () => ({ success: true }))
        };
        repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-learning-service-'));
        ontologyFixtures = [];
        pool = {
            query: vi.fn(async (sql) => {
                if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE') || sql.includes('CREATE INDEX')) {
                    return { rows: [], rowCount: 0 };
                }
                if (sql.includes('FROM learning_artifact_ingestions li')) return { rows: selectQueue.shift() || [] };
                if (sql.includes('SELECT id, source_type')) return { rows: selectQueue.shift() || [] };
                if (sql.includes('SELECT id, pillar')) return { rows: selectQueue.shift() || [] };
                if (sql.includes('FROM skill_usage_logs')) return { rows: selectQueue.shift() || [] };
                return { rows: [], rowCount: 1 };
            })
        };
        pool.connect = vi.fn(async () => ({ query: pool.query, release: vi.fn() }));
        service = new LearningService({
            pool,
            wikiService,
            repoRoot,
            candidateRepository: new PgCandidateRepository({ pool })
        });
    });

    afterEach(() => {
        if (repoRoot && fs.existsSync(repoRoot)) {
            fs.rmSync(repoRoot, { recursive: true, force: true });
        }
        for (const fixture of ontologyFixtures) fixture.cleanup();
    });

    it('recordEpisode validates review/explicit_learn and inserts normalized fields', async () => {
        const result = await service.recordEpisode({
            source_type: 'review',
            outcome: 'failure',
            summary: 'レビュー差分から再利用ルールを抽出',
            promotion_hint: 'both',
            skill_refs: ['.claude/skills/example/SKILL.md']
        });

        expect(result.id).toMatch(/^lep_/);
        expect(result.promotion_hint).toBe('both');
        expect(pool.query).toHaveBeenCalled();
    });

    it('searchPersonalKgCandidates tokenizes compound queries as an all-token fallback', async () => {
        await service.searchPersonalKgCandidates({
            query: 'AI駆動経営 判断 Ship',
            limit: 5
        });

        const searchCall = pool.query.mock.calls.find(
            (call) => typeof call[0] === 'string' && call[0].includes('SELECT id, cognitive_type, body')
        );

        expect(searchCall).toBeTruthy();
        expect(searchCall[0]).toContain("body ILIKE $2 ESCAPE '\\'");
        expect(searchCall[0]).toContain("OR (body ILIKE $3 ESCAPE '\\' AND body ILIKE $4 ESCAPE '\\' AND body ILIKE $5 ESCAPE '\\')");
        expect(searchCall[0]).toContain("CASE WHEN body ILIKE $2 ESCAPE '\\' THEN 0 ELSE 1 END");
        expect(searchCall[1]).toEqual([
            'sato_keigo',
            '%AI駆動経営 判断 Ship%',
            '%AI駆動経営%',
            '%判断%',
            '%Ship%',
            5
        ]);
    });

    it('searchPersonalKgCandidates keeps single-term queries as phrase search and preserves type filters', async () => {
        await service.searchPersonalKgCandidates({
            query: '判断',
            cognitiveTypes: ['claim', 'insight'],
            limit: 3
        });

        const searchCall = pool.query.mock.calls.find(
            (call) => typeof call[0] === 'string' && call[0].includes('SELECT id, cognitive_type, body')
        );

        expect(searchCall).toBeTruthy();
        expect(searchCall[0]).toContain("body ILIKE $2 ESCAPE '\\'");
        expect(searchCall[0]).not.toContain('OR (');
        expect(searchCall[0]).toContain('cognitive_type = ANY($3::text[])');
        expect(searchCall[0]).toContain('LIMIT $4');
        expect(searchCall[1]).toEqual([
            'sato_keigo',
            '%判断%',
            ['claim', 'insight'],
            3
        ]);
    });

    it('recordEpisode accepts session_log and codex_session_log sources', async () => {
        const sessionResult = await service.recordEpisode({
            source_type: 'session_log',
            outcome: 'partial',
            summary: 'Claude local log から学習を抽出',
            promotion_hint: 'wiki'
        });
        const codexResult = await service.recordEpisode({
            source_type: 'codex_session_log',
            outcome: 'success',
            summary: 'Codex session log から学習を抽出',
            promotion_hint: 'skill'
        });

        expect(sessionResult.source_type).toBe('session_log');
        expect(codexResult.source_type).toBe('codex_session_log');
    });

    it('ensureSchema includes legacy learning data normalization before constraints', async () => {
        await service.ensureSchema();

        const schemaSql = pool.query.mock.calls[0]?.[0] || '';
        expect(schemaSql).toContain("WHERE status = 'filtered'");
        expect(schemaSql).toContain("SET status = 'rejected'");
        expect(schemaSql).toContain("claude_session_log");
        expect(schemaSql).toContain("promotion_hint IN ('rule', 'wiki-only')");
    });

    it('proposePromotions defaults to manual candidates', async () => {
        selectQueue.push([
            {
                id: 'lep_1',
                source_type: 'review',
                project_id: 'brainbase',
                session_id: 'sess_1',
                task_id: 'task_1',
                skill_refs: ['.claude/skills/recovery/SKILL.md'],
                wiki_refs: [],
                outcome: 'failure',
                summary: '障害回避の手順と原則を標準化する',
                promotion_hint: 'both',
                evidence: {
                    proposed_rule: '再接続条件を固定する',
                    proposed_steps: '再接続後に fit を同期する'
                }
            }
        ]);
        selectQueue.push([]);
        selectQueue.push([]);

        const result = await service.proposePromotions();

        expect(result).toHaveLength(2);
        expect(result.every((candidate) => candidate.status === 'evaluated')).toBe(true);
        expect(result.every((candidate) => candidate.apply_mode === 'manual')).toBe(true);
        expect(result.some((candidate) => candidate.pillar === 'document' && candidate.doc_type === 'architecture')).toBe(true);
        expect(result.some((candidate) => candidate.pillar === 'skill')).toBe(true);
        expect(wikiService.savePage).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(repoRoot, '.claude/skills/recovery/SKILL.md'))).toBe(false);
    });

    it('keeps document candidates manual while auto-applying eligible skill candidates', async () => {
        selectQueue.push([
            {
                id: 'lep_auto',
                source_type: 'review',
                project_id: 'brainbase',
                session_id: 'sess_auto',
                task_id: 'task_auto',
                skill_refs: ['.claude/skills/recovery/SKILL.md'],
                wiki_refs: [],
                outcome: 'failure',
                summary: '障害回避の手順と原則を標準化する',
                promotion_hint: 'both',
                evidence: {
                    proposed_rule: '再接続条件を固定する',
                    proposed_steps: '再接続後に fit を同期する'
                }
            }
        ]);
        selectQueue.push([]);
        selectQueue.push([]);

        const result = await service.proposePromotions({ applyMode: 'auto' });

        expect(result).toHaveLength(2);
        expect(result.find((candidate) => candidate.pillar === 'skill')?.status).toBe('applied');
        expect(result.find((candidate) => candidate.pillar === 'document')).toMatchObject({
            status: 'evaluated',
            apply_mode: 'manual'
        });
        expect(wikiService.savePage).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(repoRoot, '.claude/skills/recovery/SKILL.md'))).toBe(true);
    });

    it('wiki_refs がある episode は canonical path を patch target にする', async () => {
        selectQueue.push([
            {
                id: 'lep_2',
                source_type: 'review',
                project_id: 'brainbase',
                session_id: 'sess_2',
                task_id: 'task_2',
                skill_refs: [],
                wiki_refs: ['specs/mobile-input-keyboard-gap'],
                outcome: 'partial',
                summary: 'キーボードギャップ仕様を更新する',
                promotion_hint: 'wiki',
                evidence: {
                    proposed_rule: 'iPhone Safari の gap 補正を固定する'
                }
            }
        ]);
        selectQueue.push([]);

        const result = await service.proposePromotions();

        expect(result).toHaveLength(1);
        expect(result[0].target_ref).toBe('specs/mobile-input-keyboard-gap');
    });

    it('explicit conflict がある skill candidate は manual fallback に落とす', async () => {
        selectQueue.push([
            {
                id: 'lep_3',
                source_type: 'explicit_learn',
                project_id: 'brainbase',
                session_id: 'sess_3',
                task_id: 'task_3',
                skill_refs: ['.claude/skills/recovery/SKILL.md'],
                wiki_refs: [],
                outcome: 'failure',
                summary: '既存手順と矛盾する修正',
                promotion_hint: 'skill',
                evidence: {
                    proposed_steps: '違う再起動手順に置き換える',
                    conflicts_with_existing: true
                }
            }
        ]);
        selectQueue.push([]);
        selectQueue.push([]);

        const result = await service.proposePromotions();
        const skillCandidate = result.find((candidate) => candidate.pillar === 'skill');

        expect(skillCandidate.apply_mode).toBe('manual');
        expect(skillCandidate.status).toBe('evaluated');
    });

    it('semantic duplicate な wiki candidate は既存 candidate に統合する', async () => {
        selectQueue.push([
            {
                id: 'lep_sem_1',
                source_type: 'review',
                project_id: 'brainbase',
                session_id: 'sess_sem_1',
                task_id: 'task_sem_1',
                skill_refs: [],
                wiki_refs: [],
                outcome: 'failure',
                summary: 'symlink を必ず解決してから比較する',
                promotion_hint: 'wiki',
                evidence: {
                    proposed_rule: 'symlink を必ず解決してから比較する'
                }
            }
        ]);
        selectQueue.push([]);
        selectQueue.push([
            {
                id: 'prm_existing',
                pillar: 'wiki',
                target_ref: 'architecture/existing-rule',
                status: 'evaluated',
                canonical_summary: 'symlink を必ず解決してから比較する',
                semantic_scope: 'wiki:architecture:brainbase',
                merged_episode_count: 1,
                source_episode_ids: ['lep_existing'],
                linked_wiki_candidate_id: null,
                linked_candidate_ids: [],
                proposed_content: '# existing-rule',
                evaluation_summary: {},
                risk_level: 'low',
                doc_type: 'architecture',
                target_project_id: 'brainbase',
                apply_mode: 'manual',
                apply_error: null,
                materialized_ref: null
            }
        ]);

        const result = await service.proposePromotions();

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('prm_existing');
        expect(result[0].merged_episode_count).toBe(2);
        expect(pool.query.mock.calls.some(([sql]) => sql.includes('UPDATE promotion_candidates'))).toBe(true);
    });

    it('recordEpisode dedupes artifact ingestions by adapter/source/fingerprint', async () => {
        selectQueue.push([
            {
                id: 'lep_existing',
                source_type: 'review',
                project_id: 'brainbase',
                session_id: null,
                task_id: 'bug-1',
                skill_refs: [],
                wiki_refs: [],
                outcome: 'failure',
                summary: '既存 episode',
                evidence: {},
                promotion_hint: 'auto'
            }
        ]);

        const result = await service.recordEpisode({
            source_type: 'review',
            outcome: 'failure',
            summary: 'duplicate',
            ingestion: {
                adapter_name: 'verify-first',
                source_path: '/tmp/verify-first-bugs/bug-1/review_report.json',
                fingerprint: 'abc123'
            }
        });

        expect(result.id).toBe('lep_existing');
        expect(result.deduped).toBe(true);
    });

    it('can fetch and reject a promotion candidate', async () => {
        selectQueue.push([
            {
                id: 'prm_1',
                pillar: 'wiki',
                target_ref: 'architecture/test',
                status: 'evaluated',
                source_episode_ids: ['lep_1'],
                linked_wiki_candidate_id: null,
                linked_candidate_ids: [],
                proposed_content: '# test',
                evaluation_summary: { wiki_first_passed: true },
                risk_level: 'low',
                doc_type: 'architecture',
                target_project_id: 'brainbase',
                apply_mode: 'manual',
                apply_error: null,
                materialized_ref: null
            }
        ]);

        const candidate = await service.getPromotion('prm_1');
        expect(candidate.id).toBe('prm_1');

        const result = await service.markPromotionRejected('prm_1', 'not needed');
        expect(result.success).toBe(true);
    });

    it('dedupeExistingPromotions merges semantically similar pending candidates', async () => {
        selectQueue.push([
            {
                id: 'prm_keep',
                pillar: 'wiki',
                target_ref: 'architecture/symlink-check',
                status: 'evaluated',
                canonical_summary: 'symlink を必ず解決してから比較する',
                semantic_scope: 'wiki:architecture:brainbase',
                merged_episode_count: 1,
                source_episode_ids: ['lep_1'],
                linked_wiki_candidate_id: null,
                linked_candidate_ids: [],
                proposed_content: '# symlink-check',
                evaluation_summary: {},
                risk_level: 'low',
                doc_type: 'architecture',
                target_project_id: 'brainbase',
                apply_mode: 'manual',
                apply_error: null,
                materialized_ref: null,
                created_at: '2026-03-30T00:00:00.000Z',
                updated_at: '2026-03-30T00:00:00.000Z'
            },
            {
                id: 'prm_merge',
                pillar: 'wiki',
                target_ref: 'architecture/symlink-compare',
                status: 'evaluated',
                canonical_summary: 'symlink を必ず解決してから比較する',
                semantic_scope: 'wiki:architecture:brainbase',
                merged_episode_count: 1,
                source_episode_ids: ['lep_2'],
                linked_wiki_candidate_id: null,
                linked_candidate_ids: [],
                proposed_content: '# symlink-compare',
                evaluation_summary: {},
                risk_level: 'medium',
                doc_type: 'architecture',
                target_project_id: 'brainbase',
                apply_mode: 'manual',
                apply_error: null,
                materialized_ref: null,
                created_at: '2026-03-30T00:01:00.000Z',
                updated_at: '2026-03-30T00:01:00.000Z'
            }
        ]);

        const result = await service.dedupeExistingPromotions();

        expect(result.merged).toBe(1);
        expect(pool.query.mock.calls.some(([sql, values]) =>
            sql.includes('UPDATE promotion_candidates')
            && Array.isArray(values)
            && values.some((value) => value === 'merged')
        )).toBe(true);
    });

    it('getPromotion enriches candidate with preview metadata', async () => {
        selectQueue.push([
            {
                id: 'prm_meta',
                pillar: 'skill',
                target_ref: '.claude/skills/recovery/SKILL.md',
                status: 'evaluated',
                source_episode_ids: ['lep_meta'],
                linked_wiki_candidate_id: null,
                linked_candidate_ids: [],
                proposed_content: `---\nname: recovery\n---\n\n# recovery\n`,
                evaluation_summary: { wiki_first_passed: true },
                risk_level: 'low',
                doc_type: 'procedure',
                target_project_id: 'brainbase',
                apply_mode: 'manual',
                apply_error: null,
                materialized_ref: null
            }
        ]);
        selectQueue.push([
            {
                id: 'lep_meta',
                source_type: 'explicit_learn',
                project_id: 'brainbase',
                session_id: null,
                task_id: null,
                skill_refs: [],
                wiki_refs: [],
                outcome: 'success',
                summary: 'UI learning candidate smoke test',
                evidence: {},
                promotion_hint: 'both'
            }
        ]);

        const candidate = await service.getPromotion('prm_meta');

        expect(candidate.title).toBe('recovery');
        expect(candidate.source_preview).toBe('UI learning candidate smoke test');
        expect(candidate.source_type).toBe('explicit_learn');
        expect(candidate.outcome).toBe('success');
    });

    it('applyPromotion preserves Wiki candidates without writing retired storage', async () => {
        selectQueue.push([
            {
                id: 'prm_apply',
                pillar: 'wiki',
                target_ref: 'architecture/test-rule',
                status: 'evaluated',
                source_episode_ids: ['lep_apply'],
                linked_wiki_candidate_id: null,
                linked_candidate_ids: [],
                proposed_content: '# test-rule',
                evaluation_summary: {},
                risk_level: 'low',
                doc_type: 'architecture',
                target_project_id: 'brainbase',
                apply_mode: 'manual',
                apply_error: null,
                materialized_ref: null
            }
        ]);
        selectQueue.push([
            {
                id: 'lep_apply',
                source_type: 'review',
                project_id: 'brainbase',
                session_id: null,
                task_id: null,
                skill_refs: [],
                wiki_refs: [],
                outcome: 'failure',
                summary: 'rule',
                evidence: {},
                promotion_hint: 'wiki'
            }
        ]);

        const result = await service.applyPromotion('prm_apply');

        expect(result).toMatchObject({
            success: false,
            retired: true,
            candidate: {
                status: 'evaluated',
                apply_mode: 'manual'
            }
        });
        expect(wikiService.savePage).not.toHaveBeenCalled();
    });

    it('recordSkillUsage呼び出し時_skill_usage_logs に INSERT される', async () => {
        const result = await service.recordSkillUsage({
            skill_name: 'commit',
            session_id: 'sess_1',
            turn_id: 'claude-1',
            duration_ms: 250
        });

        expect(result.id).toMatch(/^sul_/);
        expect(result.outcome).toBe('completed');
        expect(result.duration_ms).toBe(250);

        const insertCall = pool.query.mock.calls.find(
            (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO skill_usage_logs')
        );
        expect(insertCall).toBeTruthy();
        expect(insertCall[1][1]).toBe('commit');
    });

    it('recordSkillUsage呼び出し時_skill_name 未指定でエラー', async () => {
        await expect(service.recordSkillUsage({})).rejects.toThrow('skill_name is required');
    });

    it('recordSkillUsage呼び出し時_invalid outcome でエラー', async () => {
        await expect(
            service.recordSkillUsage({ skill_name: 'commit', outcome: 'bogus' })
        ).rejects.toThrow('outcome must be');
    });

    it('listStaleSkills呼び出し時_閾値日数以前の skill のみ返る', async () => {
        selectQueue.push([
            { skill_name: 'old-skill', last_used_at: new Date('2025-01-01'), uses: '3' }
        ]);

        const result = await service.listStaleSkills({ days: 90 });

        expect(result).toHaveLength(1);
        expect(result[0].skill_name).toBe('old-skill');
        expect(result[0].uses).toBe(3);
        expect(result[0].stale_threshold_days).toBe(90);
    });

    it('promoteMemoryCandidateToGraphは全mapped typeを分類しguard付きで返し未知型を拒否する', async () => {
        const ontologyFixture = createProposedOntologyFixture(process.cwd());
        ontologyFixtures.push(ontologyFixture);
        service.ontologyRegistry = new OntologyRegistry({ rootDir: ontologyFixture.rootDir });
        vi.spyOn(service, 'ensureSchema').mockResolvedValue();
        vi.spyOn(service, '_transitionMemoryCandidate').mockResolvedValue({ success: true });
        const getMemoryCandidate = vi.spyOn(service, 'getMemoryCandidate');
        const mappedTypes = ['person', 'project', 'org', 'customer', 'decision', 'raci_assignment', 'philosophy', 'glossary_term'];
        for (const subjectType of mappedTypes) {
            getMemoryCandidate.mockResolvedValueOnce({
                id: `candidate_${subjectType}`,
                subject_type: subjectType,
                recommended_subject_id: `${subjectType}_stable_1`,
                promotion_status: 'approved',
                redaction_status: 'none',
                role_min: 'member',
                sensitivity: 'internal',
                source_event_ids: [],
                evidence_ids: [],
                permission_snapshot: {},
                owner_person_id: 'person_owner',
                memory: { summary: subjectType }
            });
            const result = await service.promoteMemoryCandidateToGraph(`candidate_${subjectType}`, {
                actor_person_id: 'person_owner',
                access: { role: 'member', projectCodes: [] }
            });
            expect(result).toMatchObject({
                success: true,
                guard_status: 'inactive_no_current',
                ontology_version: null,
                graph_entity: {
                    id: `${subjectType}_stable_1`,
                    entity_type: subjectType
                }
            });
        }
        getMemoryCandidate.mockResolvedValueOnce({
            id: 'candidate_unknown',
            subject_type: 'unregistered_type',
            recommended_subject_id: 'unknown_stable_1',
            promotion_status: 'approved',
            redaction_status: 'none',
            owner_person_id: 'person_owner'
        });
        await expect(service.promoteMemoryCandidateToGraph('candidate_unknown', {
            actor_person_id: 'person_owner',
            access: { role: 'member', projectCodes: [] }
        }))
            .rejects.toThrow('cannot be promoted to graph');
    });

    it('promoteMemoryCandidateToGraphはactive Ontology違反をGraph永続化前に拒否する', async () => {
        const ontologyFixture = createSignedActiveOntologyFixture(process.cwd());
        ontologyFixtures.push(ontologyFixture);
        service.ontologyRegistry = new OntologyRegistry({
            rootDir: ontologyFixture.rootDir,
            publicKeyPem: ontologyFixture.publicKeyPem
        });
        vi.spyOn(service, 'ensureSchema').mockResolvedValue();
        vi.spyOn(service, 'getMemoryCandidate').mockResolvedValue({
            id: 'candidate_active_decision_without_authority',
            subject_type: 'decision',
            recommended_subject_id: 'decision_without_authority_stable_1',
            promotion_status: 'approved',
            redaction_status: 'none',
            role_min: 'member',
            sensitivity: 'internal',
            source_event_ids: [],
            evidence_ids: [],
            permission_snapshot: {},
            owner_person_id: 'person_owner',
            memory: {
                title: 'authorityを欠くactive decision',
                status: 'active'
            }
        });
        const transition = vi.spyOn(service, '_transitionMemoryCandidate');

        await expect(service.promoteMemoryCandidateToGraph('candidate_active_decision_without_authority', {
            actor_person_id: 'person_owner',
            access: { role: 'member', projectCodes: [] }
        }))
            .rejects.toMatchObject({
                code: 'ONTOLOGY_VALIDATION_FAILED',
                details: {
                    ontology_version: '1.0.0',
                    violations: expect.arrayContaining([
                        expect.objectContaining({ rule_id: 'CON-DECISION-DECIDER-001' }),
                        expect.objectContaining({ rule_id: 'CON-DECISION-SCOPE-001' })
                    ])
                }
            });
        expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO projects'))).toBe(false);
        expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO graph_entities'))).toBe(false);
        expect(transition).not.toHaveBeenCalled();
    });

    it('promoteMemoryCandidateToGraphはactive Ontologyに適合するentityを昇格する', async () => {
        const ontologyFixture = createSignedActiveOntologyFixture(process.cwd());
        ontologyFixtures.push(ontologyFixture);
        service.ontologyRegistry = new OntologyRegistry({
            rootDir: ontologyFixture.rootDir,
            publicKeyPem: ontologyFixture.publicKeyPem
        });
        vi.spyOn(service, 'ensureSchema').mockResolvedValue();
        vi.spyOn(service, 'getMemoryCandidate').mockResolvedValue({
            id: 'candidate_valid_person',
            subject_type: 'person',
            recommended_subject_id: 'person_valid_stable_1',
            promotion_status: 'approved',
            redaction_status: 'none',
            role_min: 'member',
            sensitivity: 'internal',
            source_event_ids: [],
            evidence_ids: [],
            permission_snapshot: {},
            owner_person_id: 'person_owner',
            memory: { name: 'Ontology適合人物' }
        });
        vi.spyOn(service, '_transitionMemoryCandidate').mockResolvedValue({ success: true });

        await expect(service.promoteMemoryCandidateToGraph('candidate_valid_person', {
            actor_person_id: 'person_owner',
            access: { role: 'member', projectCodes: [] }
        }))
            .resolves.toMatchObject({
                success: true,
                guard_status: 'active_current',
                ontology_version: '1.0.0',
                graph_entity: {
                    id: 'person_valid_stable_1',
                    entity_type: 'person',
                    payload: { name: 'Ontology適合人物' }
                }
            });
        expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO graph_entities'))).toBe(true);
    });

    it('promoteMemoryCandidateToGraphはproject外またはowner権限外のcallerを拒否する', async () => {
        vi.spyOn(service, 'ensureSchema').mockResolvedValue();
        vi.spyOn(service, 'getMemoryCandidate').mockResolvedValue({
            id: 'candidate_scoped',
            subject_type: 'person',
            promotion_status: 'approved',
            redaction_status: 'none',
            project_code: 'brainbase',
            owner_person_id: 'person_owner',
            role_min: 'member',
            sensitivity: 'internal',
            source_event_ids: [],
            evidence_ids: [],
            permission_snapshot: {},
            memory: { name: 'Scoped' }
        });

        await expect(service.promoteMemoryCandidateToGraph('candidate_scoped', {
            actor_person_id: 'person_owner',
            access: { role: 'member', projectCodes: ['other'] }
        })).rejects.toThrow('promotion project access denied');
        await expect(service.promoteMemoryCandidateToGraph('candidate_scoped', {
            actor_person_id: 'person_other',
            access: { role: 'member', projectCodes: ['brainbase'] }
        })).rejects.toThrow('promotion owner authority denied');
        expect(pool.connect).not.toHaveBeenCalled();
    });

    it('promoteMemoryCandidateToGraphはaudit失敗時にGraph writeもrollbackする', async () => {
        vi.spyOn(service, 'ensureSchema').mockResolvedValue();
        vi.spyOn(service, 'getMemoryCandidate').mockResolvedValue({
            id: 'candidate_atomic',
            subject_type: 'person',
            recommended_subject_id: 'person_atomic_stable_1',
            promotion_status: 'approved',
            redaction_status: 'none',
            project_code: 'brainbase',
            owner_person_id: 'person_owner',
            recommended_owner_person_id: 'person_decider',
            role_min: 'member',
            sensitivity: 'internal',
            source_event_ids: [],
            evidence_ids: [],
            permission_snapshot: {},
            memory: { name: 'Atomic' }
        });
        const query = vi.fn(async (sql, params) => {
            if (sql.includes('INSERT INTO promotion_audit_events')) throw new Error('audit unavailable');
            if (sql.includes('SELECT * FROM memory_candidates')) {
                return {
                    rows: [{
                        id: 'candidate_atomic',
                        promotion_status: 'approved',
                        owner_person_id: 'person_owner',
                        actor_person_id: 'person_owner',
                        evidence_ids: []
                    }],
                    rowCount: 1
                };
            }
            if (sql.includes('UPDATE memory_candidates')) {
                return {
                    rows: [{
                        id: 'candidate_atomic',
                        promotion_status: 'promoted_to_graph',
                        owner_person_id: 'person_owner',
                        actor_person_id: 'person_owner',
                        evidence_ids: []
                    }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 1, params };
        });
        const release = vi.fn();
        pool.connect.mockResolvedValueOnce({ query, release });

        await expect(service.promoteMemoryCandidateToGraph('candidate_atomic', {
            actor_person_id: 'person_operator',
            access: { role: 'gm', projectCodes: ['brainbase'] },
            decision_owner_person_id: 'spoofed_owner'
        })).rejects.toThrow('audit unavailable');
        const graphInsert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO graph_entities'));
        expect(graphInsert).toBeTruthy();
        expect(graphInsert[1][0]).toBe('person_atomic_stable_1');
        expect(query).toHaveBeenCalledWith('ROLLBACK');
        expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
        const auditCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO promotion_audit_events'));
        expect(auditCall[1][2]).toBe('person_decider');
        expect(release).toHaveBeenCalledOnce();
    });
});
