import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LearningService,
    buildSkillCandidateContent,
    classifyWikiDocumentType,
    deriveCanonicalWikiTargetRef,
    deriveSkillTargetRef,
    shouldCreateSkillCandidate,
    shouldCreateWikiCandidate
} from '../../../server/services/learning-service.js';

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

    it('二本柱の必要性を独立判定する', () => {
        const episode = {
            summary: '障害回避の手順と原則を標準化する',
            evidence: {
                proposed_rule: '再接続条件を固定する',
                proposed_steps: 'xtermを再fitする'
            }
        };

        expect(shouldCreateWikiCandidate(episode)).toBe(true);
        expect(shouldCreateSkillCandidate(episode)).toBe(true);
    });

    it('wiki/skill target ref を新ルールで導出する', () => {
        expect(deriveCanonicalWikiTargetRef({
            summary: '標準化ルールの整理',
            evidence: {}
        })).toContain('architecture/');

        expect(deriveSkillTargetRef({
            project_id: 'brainbase',
            summary: '障害回避手順の更新'
        })).toContain('.claude/skills/brainbase-');
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
});

describe('LearningService', () => {
    let pool;
    let service;
    let selectQueue;
    let wikiService;
    let repoRoot;

    beforeEach(() => {
        selectQueue = [];
        wikiService = {
            savePage: vi.fn(async () => ({ success: true })),
            setPageAccess: vi.fn(async () => ({ success: true }))
        };
        repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-learning-service-'));
        pool = {
            query: vi.fn(async (sql) => {
                if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE') || sql.includes('CREATE INDEX')) {
                    return { rows: [], rowCount: 0 };
                }
                if (sql.includes('SELECT id, source_type')) return { rows: selectQueue.shift() || [] };
                if (sql.includes('SELECT id, pillar')) return { rows: selectQueue.shift() || [] };
                return { rows: [], rowCount: 1 };
            })
        };
        service = new LearningService({ pool, wikiService, repoRoot });
    });

    afterEach(() => {
        if (repoRoot && fs.existsSync(repoRoot)) {
            fs.rmSync(repoRoot, { recursive: true, force: true });
        }
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

    it('proposePromotions creates wiki and linked skill candidates and auto-applies both', async () => {
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
        expect(result.every((candidate) => candidate.status === 'applied')).toBe(true);
        expect(result.some((candidate) => candidate.pillar === 'wiki' && candidate.doc_type === 'architecture')).toBe(true);
        expect(result.some((candidate) => candidate.pillar === 'skill')).toBe(true);
        expect(wikiService.savePage).toHaveBeenCalled();
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
});
