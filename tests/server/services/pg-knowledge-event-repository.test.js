import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { PgCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import { PgKnowledgeEventRepository } from '../../../server/services/knowledge-event/pg-knowledge-event-repository.js';

function knowledgeEvent(overrides = {}) {
    return {
        schema_version: 'knowledge_event.v1',
        event_id: 'kev_pg_1',
        occurred_at: '2026-08-13T01:00:00.000Z',
        captured_at: '2026-08-13T01:01:00.000Z',
        source: { type: 'meeting_review_package', id: 'meeting_pack_1' },
        subject: { type: 'decision', id: 'decision_pricing_2026' },
        decision_authority: { authorized: true, decider_id: 'person_ceo' },
        applicability_scope: { project_code: 'brainbase', scope: 'organization' },
        permission_snapshot: { visibility: 'org', contains_pii: false },
        source_pointer: { type: 'meeting_minutes', uri: 'drive://meeting_1#decision-1' },
        body_hash: 'sha256:knowledge-event-pg-1',
        parent_episode_id: 'episode_meeting_pack_1',
        ...overrides
    };
}

function candidateInput(overrides = {}) {
    return {
        id: 'cand_event_pg_1',
        cognitive_type: 'claim',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        source_system: 'knowledge_event',
        source_event_ids: ['kev_pg_1'],
        project_code: 'brainbase',
        org_ids: ['unson'],
        visibility: 'org',
        sensitivity: 'internal',
        body: '法人プランの価格を決定した',
        recommended_subject_type: 'decision',
        recommended_subject_id: 'decision_pricing_2026',
        target_tier: 'graph',
        ...overrides
    };
}

function rowForEvent(overrides = {}) {
    return {
        ...knowledgeEvent(),
        source: knowledgeEvent().source,
        subject: knowledgeEvent().subject,
        decision_authority: knowledgeEvent().decision_authority,
        applicability_scope: knowledgeEvent().applicability_scope,
        permission_snapshot: knowledgeEvent().permission_snapshot,
        source_pointer: knowledgeEvent().source_pointer,
        stage_history: [],
        ...overrides
    };
}

function scriptedClient(handler = async () => ({ rows: [], rowCount: 0 })) {
    return {
        query: vi.fn(handler),
        release: vi.fn()
    };
}

describe('PgKnowledgeEventRepository', () => {
    it('Episode圧縮は同一transactionで読取りと状態更新を完了した時だけconfirmedにする', async () => {
        const client = scriptedClient(async (sql) => {
            if (String(sql).includes('FROM knowledge_events') && !String(sql).includes('episode_compaction')) {
                return {
                    rows: [{
                        parent_episode_id: 'episode-1',
                        event_id: 'kev-1',
                        subject: { type: 'decision', id: 'decision-1' },
                        payload: { decision: { statement: '価格を10万円に決定' } },
                        semantic_state: 'active',
                        result: { outcome: 'approved', unresolved_items: ['公開日'] }
                    }],
                    rowCount: 1
                };
            }
            if (/UPDATE\s+knowledge_events/i.test(String(sql))) return { rows: [], rowCount: 1 };
            if (String(sql).includes('episode_compaction')) {
                return {
                    rows: [{ parent_episode_id: 'episode-1', event_id: 'kev-1', compaction_matches: true }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        });
        const pool = { connect: vi.fn(async () => client), query: vi.fn() };
        const repository = new PgKnowledgeEventRepository({ pool });

        const result = await repository.compressRoutineEpisodes({
            project_id: 'brainbase',
            episode_ids: ['episode-1']
        }, {
            access: { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] }
        });

        const transactionSql = client.query.mock.calls.map(([sql]) => String(sql).trim());
        expect(transactionSql[0]).toBe('BEGIN');
        expect(transactionSql.at(-1)).toBe('COMMIT');
        expect(transactionSql.some((sql) => /(?:UPDATE\s+knowledge_events|INSERT\s+INTO\s+knowledge_event_stage_history)/i.test(sql)))
            .toBe(true);
        const sourceSelect = transactionSql.find((sql) => /SELECT[\s\S]+FROM knowledge_events/i.test(sql));
        expect(sourceSelect).toMatch(/subject/i);
        expect(sourceSelect).toMatch(/payload/i);
        expect(sourceSelect).toMatch(/semantic_state/i);
        expect(sourceSelect).toMatch(/result/i);
        expect(client.query.mock.calls.filter(([sql]) => /episode_compaction/i.test(String(sql)))).toHaveLength(2);
        expect(result).toMatchObject({ episode_ids: ['episode-1'], confirmed: true });
    });

    it('Episode圧縮はepisode_compaction.v1 artifactの必須状態を同一transactionで永続化する', async () => {
        const client = scriptedClient(async (sql) => {
            if (String(sql).includes('FROM knowledge_events')) {
                return {
                    rows: [
                        { parent_episode_id: 'episode-1', event_id: 'kev-1' },
                        { parent_episode_id: 'episode-1', event_id: 'kev-2' }
                    ],
                    rowCount: 2
                };
            }
            return { rows: [], rowCount: 2 };
        });
        const repository = new PgKnowledgeEventRepository({
            pool: { connect: vi.fn(async () => client), query: vi.fn() }
        });

        await repository.compressRoutineEpisodes({
            project_id: 'brainbase',
            episode_ids: ['episode-1']
        }, { access: { role: 'member', projectCodes: ['brainbase'] } });

        const persistedSql = client.query.mock.calls.map(([sql]) => String(sql)).join('\n');
        for (const field of [
            'episode_compaction.v1',
            'episode_id',
            'source_event_ids',
            'version',
            'hash',
            'compacted_at'
        ]) {
            expect(persistedSql).toContain(field);
        }
        expect(persistedSql).toMatch(/(?:summary|source_pointer)/i);
        const updateCall = client.query.mock.calls.find(([sql]) => /UPDATE\s+knowledge_events/i.test(String(sql)));
        const summary = JSON.parse(updateCall?.[1]?.[6] || '{}');
        expect(summary).toMatchObject({
            decisions: expect.any(Array),
            outcomes: expect.any(Array),
            unresolved_items: expect.any(Array)
        });
        expect(summary).not.toEqual({ source_event_count: 2 });
        expect(client.query.mock.calls.map(([sql]) => String(sql).trim()).at(-1)).toBe('COMMIT');
    });

    it.each([
        ['UPDATEが0件', 0, true],
        ['readback不一致', 1, false]
    ])('Episode圧縮は%sならconfirmed:falseにする', async (_case, updateRowCount, readbackMatches) => {
        const client = scriptedClient(async (sql) => {
            const text = String(sql);
            if (text.includes('FROM knowledge_events') && !text.includes('episode_compaction')) {
                return {
                    rows: [{
                        parent_episode_id: 'episode-1',
                        event_id: 'kev-1',
                        subject: { type: 'decision', id: 'decision-1' },
                        payload: { summary: '決定内容' },
                        semantic_state: 'active',
                        result: { outcome: 'done' }
                    }],
                    rowCount: 1
                };
            }
            if (/UPDATE\s+knowledge_events/i.test(text)) return { rows: [], rowCount: updateRowCount };
            if (text.includes('episode_compaction')) {
                return {
                    rows: [{ parent_episode_id: 'episode-1', compaction_matches: readbackMatches }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        });
        const repository = new PgKnowledgeEventRepository({
            pool: { connect: vi.fn(async () => client), query: vi.fn() }
        });

        await expect(repository.compressRoutineEpisodes({
            project_id: 'brainbase',
            episode_ids: ['episode-1']
        }, { access: { role: 'member', projectCodes: ['brainbase'] } })).resolves.toMatchObject({
            confirmed: false
        });
    });

    it('Episode圧縮は要求した全Episodeのartifact保存を確認できた時だけconfirmedにする', async () => {
        const client = scriptedClient(async (sql) => String(sql).includes('FROM knowledge_events')
            ? { rows: [{ parent_episode_id: 'episode-1', event_id: 'kev-1' }], rowCount: 1 }
            : { rows: [], rowCount: 1 });
        const repository = new PgKnowledgeEventRepository({
            pool: { connect: vi.fn(async () => client), query: vi.fn() }
        });

        await expect(repository.compressRoutineEpisodes({
            project_id: 'brainbase',
            episode_ids: ['episode-1', 'episode-2']
        }, { access: { role: 'member', projectCodes: ['brainbase'] } })).resolves.toMatchObject({
            episode_ids: ['episode-1'],
            confirmed: false,
            missing_episode_ids: ['episode-2']
        });
    });

    it('retro集計SQLはeventをoccurred_at、feedbackをcreated_atの独立した期間で測る', async () => {
        const client = scriptedClient(async (sql) => String(sql).includes('WITH latest_stage')
            ? { rows: [{}], rowCount: 1 }
            : { rows: [], rowCount: 0 });
        const repository = new PgKnowledgeEventRepository({
            pool: { connect: vi.fn(async () => client), query: vi.fn() }
        });

        await repository.summarizeRoutineState({
            project_id: 'brainbase',
            since: '2026-08-06T12:00:00.000Z',
            until: '2026-08-13T12:00:00.000Z'
        });

        const aggregateCall = client.query.mock.calls.find(([sql]) => String(sql).includes('WITH latest_stage'));
        expect(aggregateCall?.[1]).toEqual([
            'brainbase',
            '2026-08-06T12:00:00.000Z',
            '2026-08-13T12:00:00.000Z'
        ]);
        const aggregateSql = String(aggregateCall?.[0]);
        const feedbackCte = aggregateSql.match(/feedback_counts AS \(([\s\S]*?)\), event_stats AS/i)?.[1] || '';
        const eventCte = aggregateSql.match(/event_stats AS \(([\s\S]*?)\)\s*SELECT/i)?.[1] || '';
        expect(feedbackCte).toMatch(/feedback\.created_at\s*>=\s*\$2::timestamptz/i);
        expect(feedbackCte).toMatch(/feedback\.created_at\s*<\s*\$3::timestamptz/i);
        expect(feedbackCte).not.toMatch(/event\.occurred_at\s*[<>]=?/i);
        expect(eventCte).toMatch(/event\.occurred_at\s*>=\s*\$2::timestamptz/i);
        expect(eventCte).toMatch(/event\.occurred_at\s*<\s*\$3::timestamptz/i);
    });

    it('open_contradictionsはquarantined全件ではなく未解決conflict理由だけを集計する', async () => {
        const client = scriptedClient(async (sql) => String(sql).includes('WITH latest_stage')
            ? { rows: [{}], rowCount: 1 }
            : { rows: [], rowCount: 0 });
        const pool = { connect: vi.fn(async () => client), query: vi.fn() };
        const repository = new PgKnowledgeEventRepository({ pool });

        await repository.summarizeRoutineState({ project_id: 'brainbase' });

        const aggregateSql = client.query.mock.calls
            .map(([sql]) => String(sql))
            .find((sql) => sql.includes('AS open_contradictions'));
        expect(aggregateSql).toContain('unresolved_conflict');
        expect(aggregateSql).not.toMatch(/semantic_state\s+IN\s*\(\s*'contradicted'\s*,\s*'quarantined'\s*\)/i);
    });

    it('正式migrationがevent・stage・feedbackだけを所有しreceipt正本テーブルを作らない', async () => {
        const schemaPath = path.resolve(process.cwd(), 'server/sql/knowledge-event-schema.sql');
        const schemaText = (await readFile(schemaPath, 'utf8')).toLowerCase();

        expect(schemaText).toMatch(/create table if not exists\s+knowledge_events/);
        expect(schemaText).toMatch(/create table if not exists\s+knowledge_event_stage_history/);
        expect(schemaText).toMatch(/create table if not exists\s+knowledge_feedback/);
        expect(schemaText).toMatch(/project_code\s+text(?:\s+generated always as \([^)]*\) stored)?\s+not null/);
        expect(schemaText).toMatch(/semantic_state\s+text[^,;]*check\s*\(\s*semantic_state\s+in\s*\(/);
        expect(schemaText).toMatch(/stage\s+text[^,;]*check\s*\(\s*stage\s+in\s*\(/);
        expect(schemaText).toMatch(/action\s+text[^,;]*check\s*\(\s*action\s+in\s*\(/);
        expect(schemaText).toMatch(/feedback_id\s+text\s+not null\s+unique/);
        expect(schemaText).toMatch(/references\s+knowledge_events\s*\(event_id\)\s+on delete (?:restrict|cascade)/);
        expect(schemaText).not.toMatch(/create table[^;]*knowledge_cycle_receipts/);
    });

    it('正式migrationがevent/project・project/semantic・event/time索引を定義する', async () => {
        const schemaText = (await readFile(path.resolve(process.cwd(), 'server/sql/knowledge-event-schema.sql'), 'utf8')).toLowerCase();

        expect(schemaText).toMatch(/create index[^;]+on\s+knowledge_events\s*\(\s*project_code\s*,/);
        expect(schemaText).toMatch(/create index[^;]+on\s+knowledge_events\s*\(\s*project_code\s*,\s*semantic_state\s*,?[^)]*\)/);
        expect(schemaText).toMatch(/create index[^;]+on\s+knowledge_event_stage_history\s*\(\s*event_id\s*,\s*occurred_at\s*\)/);
        expect(schemaText).toMatch(/create index[^;]+on\s+knowledge_feedback\s*\(\s*event_id\s*,\s*created_at\s*\)/);
    });

    it('正式migrationが全knowledge tableでRLSをENABLE/FORCEしUSING/WITH CHECKを定義する', async () => {
        const schemaText = (await readFile(path.resolve(process.cwd(), 'server/sql/knowledge-event-schema.sql'), 'utf8')).toLowerCase();

        for (const table of ['knowledge_events', 'knowledge_event_stage_history', 'knowledge_feedback']) {
            expect(schemaText).toMatch(new RegExp(`alter table\\s+${table}\\s+enable row level security`));
            expect(schemaText).toMatch(new RegExp(`alter table\\s+${table}\\s+force row level security`));
            expect(schemaText).toMatch(new RegExp(`create policy[^;]+on\\s+${table}[^;]+using\\s*\\(`));
            expect(schemaText).toMatch(new RegExp(`create policy[^;]+on\\s+${table}[^;]+with check\\s*\\(`));
        }
    });

    it('ensureSchemaはruntimeでDDLを実行しない', async () => {
        const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
        const repository = new PgKnowledgeEventRepository({ pool });

        await repository.ensureSchema();

        const schemaText = pool.query.mock.calls.map(([sql]) => String(sql)).join('\n').toLowerCase();
        expect(schemaText).not.toMatch(/\b(create|alter|drop)\s+(table|index|type)\b/);
    });

    it('knowledge event repositoryはevent/stageだけを扱いmemory_candidatesを直接参照しない', async () => {
        const pool = { query: vi.fn(() => { throw new Error('pool must not be used'); }) };
        const client = scriptedClient(async (sql) => {
            const text = String(sql);
            if (text.includes('INSERT INTO knowledge_events')) return { rows: [rowForEvent()], rowCount: 1 };
            if (text.includes('INSERT INTO knowledge_event_stage_history')) {
                return { rows: [{ event_id: 'kev_pg_1', stage: 'received', occurred_at: new Date('2026-08-13T01:01:00.000Z') }], rowCount: 1 };
            }
            if (text.includes('FROM knowledge_events')) return { rows: [rowForEvent()], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });
        const repository = new PgKnowledgeEventRepository({ pool });

        await repository.findById('kev_pg_1', { client });
        await repository.create(knowledgeEvent(), { client });
        await repository.appendStage('kev_pg_1', {
            stage: 'received',
            occurred_at: '2026-08-13T01:01:00.000Z'
        }, { client });

        expect(repository.findCandidateByEventId).toBeUndefined();
        expect(pool.query).not.toHaveBeenCalled();
        expect(client.query).toHaveBeenCalledTimes(3);
        expect(client.query.mock.calls.map(([sql]) => String(sql))).toEqual(expect.arrayContaining([
            expect.stringContaining('FROM knowledge_events'),
            expect.stringContaining('INSERT INTO knowledge_events'),
            expect.stringContaining('INSERT INTO knowledge_event_stage_history')
        ]));
        expect(client.query.mock.calls.every(([sql]) => !String(sql).includes('memory_candidates'))).toBe(true);
    });

    it('findByIdはresult JSONのCandidateとGraph識別子をtop-levelに復元する', async () => {
        const pool = {
            query: vi.fn(async () => ({
                rows: [rowForEvent({
                    result: {
                        candidate_id: 'cand_event_pg_1',
                        graph_entity_id: 'decision_pricing_2026',
                        processing_stage: 'retrievable'
                    }
                })],
                rowCount: 1
            }))
        };
        const repository = new PgKnowledgeEventRepository({ pool });

        const event = await repository.findById('kev_pg_1');

        expect(event).toMatchObject({
            event_id: 'kev_pg_1',
            candidate_id: 'cand_event_pg_1',
            graph_entity_id: 'decision_pricing_2026',
            result: expect.objectContaining({ processing_stage: 'retrievable' })
        });
    });

    it('CandidateRepository.findByEventIdがsource_event_id検索とexternal client境界を所有する', async () => {
        const pool = { query: vi.fn(() => { throw new Error('pool must not be used'); }) };
        const client = scriptedClient(async (sql) => String(sql).includes('FROM memory_candidates')
            ? { rows: [{ id: 'cand_event_pg_1', source_event_ids: ['kev_pg_1'] }], rowCount: 1 }
            : { rows: [], rowCount: 0 });
        const repository = new PgCandidateRepository({ pool });

        expect(typeof repository.findByEventId).toBe('function');
        const result = await repository.findByEventId('kev_pg_1', { client });

        expect(result).toMatchObject({ id: 'cand_event_pg_1', source_event_ids: ['kev_pg_1'] });
        expect(pool.query).not.toHaveBeenCalled();
        expect(client.query).toHaveBeenCalledWith(
            expect.stringContaining('FROM memory_candidates'),
            [expect.stringContaining('kev_pg_1')]
        );
    });

    it('transaction内の全repository操作を一つのclientでcommitする', async () => {
        const client = scriptedClient(async (sql) => {
            if (String(sql).includes('INSERT INTO knowledge_events')) return { rows: [rowForEvent()], rowCount: 1 };
            if (String(sql).includes('INSERT INTO knowledge_event_stage_history')) {
                return { rows: [{ event_id: 'kev_pg_1', stage: 'received' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        });
        const pool = {
            query: vi.fn(() => { throw new Error('pool must not be used in transaction'); }),
            connect: vi.fn(async () => client)
        };
        const repository = new PgKnowledgeEventRepository({ pool });

        await repository.transaction(async (tx) => {
            await tx.create(knowledgeEvent());
            await tx.appendStage('kev_pg_1', { stage: 'received' });
        });

        expect(pool.connect).toHaveBeenCalledOnce();
        expect(client.query.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
            'BEGIN',
            expect.stringContaining('INSERT INTO knowledge_events'),
            expect.stringContaining('INSERT INTO knowledge_event_stage_history'),
            'COMMIT'
        ]);
        expect(client.release).toHaveBeenCalledOnce();
    });

    it('transactionは同じclientへaccess project contextを設定してからrepository操作を許可する', async () => {
        const client = scriptedClient();
        const pool = { connect: vi.fn(async () => client), query: vi.fn() };
        const repository = new PgKnowledgeEventRepository({ pool });
        const access = {
            role: 'member',
            projectCodes: ['brainbase'],
            clearance: ['internal']
        };
        let operationStarted = false;

        await repository.transaction(async () => {
            operationStarted = true;
            const configKeys = client.query.mock.calls.map(([, params]) => params?.[0]);
            expect(configKeys).toEqual(expect.arrayContaining(['app.role', 'app.project_codes', 'app.clearance']));
        }, { access });

        expect(operationStarted).toBe(true);
        expect(client.query.mock.calls[0][0]).toBe('BEGIN');
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.role', 'member']);
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.project_codes', 'brainbase']);
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.clearance', 'internal']);
        expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    });

    it('CandidateRepository.create(input, { client })もpoolへ逸脱しない', async () => {
        const pool = { query: vi.fn(() => { throw new Error('pool must not be used'); }) };
        const candidateRow = {
            ...candidateInput(),
            source_event_ids: ['kev_pg_1'],
            project_ids: [],
            evidence_ids: [],
            role_min: 'member',
            agency_level: 'synthesize',
            processing_stage: 'received',
            semantic_state: 'active',
            promotion_status: 'candidate',
            requires_approval: false,
            redaction_status: 'none',
            created_at: new Date('2026-08-13T01:01:00.000Z'),
            updated_at: new Date('2026-08-13T01:01:00.000Z')
        };
        const client = scriptedClient(async (sql) => String(sql).includes('INSERT INTO memory_candidates')
            ? { rows: [candidateRow], rowCount: 1 }
            : { rows: [], rowCount: 0 });
        const repository = new PgCandidateRepository({ pool });

        const result = await repository.create(candidateInput(), { client });

        expect(result.id).toBe('cand_event_pg_1');
        expect(pool.query).not.toHaveBeenCalled();
        expect(client.query).toHaveBeenCalledTimes(2);
        expect(client.query.mock.calls[1][0]).toContain('INSERT INTO memory_candidates');
    });
});
