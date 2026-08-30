import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalJson,
  knowledgeEventToolDefinition,
  readBrainbaseKnowledgeEventRecord,
  recordBrainbaseKnowledgeEvent,
  sha256,
  type VibeProKnowledgeEvent
} from '../src/knowledge-event.js';

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-knowledge-event-'));
  dirs.push(dir);
  return dir;
}

function buildEvent(options: { summary?: string; projectCode?: string } = {}): VibeProKnowledgeEvent {
  const headSha = 'a'.repeat(40);
  const storyId = 'story-vibepro-runtime-handoff';
  const sourceRef = `github://Unson-LLC/vibepro@${headSha}#${storyId}`;
  const subjectId = `vibepro:${storyId}:${headSha}`;
  const parentEpisodeId = 'episode-runtime-handoff-1';
  const payload = {
    schema_version: 'vibepro-development-learning.v1' as const,
    story_id: storyId,
    summary: options.summary ?? 'Computed verification showed that the runtime handoff remains bound to the current Git state.',
    context_digest: 'b'.repeat(64),
    verification_evidence: {
      artifact_digest: 'c'.repeat(64),
      head_sha: headSha,
      passing_kinds: ['integration', 'unit'],
      evidence_sources: ['runner_direct'] as const
    },
    knowledge_reference_count: 3
  };
  const bodyHash = sha256(canonicalJson(payload));
  const eventId = `kev_${sha256(canonicalJson([
    payload.schema_version,
    sourceRef,
    subjectId,
    parentEpisodeId,
    bodyHash
  ]))}`;
  return {
    schema_version: 'knowledge_event.v1',
    event_id: eventId,
    occurred_at: '2026-08-30T12:00:00.000Z',
    captured_at: '2026-08-30T12:00:01.000Z',
    source: { type: 'vibepro', ref: sourceRef },
    subject: { type: 'development_learning', id: subjectId },
    decision_authority: {
      kind: 'development_learning_candidate',
      authorized: false,
      graph_promotion_allowed: false
    },
    applicability_scope: {
      scope: 'project',
      project_code: options.projectCode ?? 'vibepro'
    },
    permission_snapshot: {
      knowledge_registration: true,
      external_action: false,
      graph_promotion: false,
      visibility: 'team',
      sensitivity: 'internal'
    },
    source_pointer: {
      uri: `vibepro://Unson-LLC/vibepro/${encodeURIComponent(storyId)}?sha=${headSha}`
    },
    body_hash: bodyHash,
    parent_episode_id: parentEpisodeId,
    payload
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('VibePro Knowledge Event recording', () => {
  it('records a verified candidate without changing Graph or executing an external action', async () => {
    const dir = await fixtureDir();
    const graphPath = join(dir, 'graph.json');
    const graphBytes = '{"version":2,"entities":[],"edges":[]}\n';
    await writeFile(graphPath, graphBytes, 'utf8');
    const event = buildEvent();

    const receipt = await recordBrainbaseKnowledgeEvent(
      { dataDir: dir, event },
      { now: () => new Date('2026-08-30T12:00:02.000Z') }
    );

    expect(receipt).toMatchObject({
      schema_version: 'brainbase-knowledge-event-record-receipt.v1',
      status: 'recorded',
      event_id: event.event_id,
      project_code: 'vibepro',
      story_id: event.payload.story_id,
      candidate_state: 'pending_review',
      graph_promoted: false,
      external_action_executed: false,
      record_ref: `brainbase://knowledge-events/v1/${event.event_id}`
    });
    const stored = await readBrainbaseKnowledgeEventRecord(dir, event.event_id);
    expect(stored).toMatchObject({
      schema_version: 'brainbase-knowledge-event-record.v1',
      event_digest: receipt.event_digest,
      storage: {
        authority: 'brainbase_local_candidate_store',
        candidate_only: true,
        graph_promoted: false,
        external_action_executed: false
      },
      event: { event_id: event.event_id }
    });
    expect(await readFile(graphPath, 'utf8')).toBe(graphBytes);
  });

  it('is idempotent under concurrent retries and keeps one append-only record', async () => {
    const dir = await fixtureDir();
    const event = buildEvent();
    const results = await Promise.all([
      recordBrainbaseKnowledgeEvent({ dataDir: dir, event }, { now: () => new Date('2026-08-30T12:00:02.000Z') }),
      recordBrainbaseKnowledgeEvent({ dataDir: dir, event }, { now: () => new Date('2026-08-30T12:00:03.000Z') })
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['already_recorded', 'recorded']);
    expect(new Set(results.map((result) => result.event_digest)).size).toBe(1);
    const files = await readdir(join(dir, 'runtime', 'knowledge-events', 'v1'));
    expect(files).toEqual([`${event.event_id}.json`]);
  });

  it('fails closed on tampered hashes, authority expansion, and sensitive summaries', async () => {
    const dir = await fixtureDir();
    const event = buildEvent();
    await expect(recordBrainbaseKnowledgeEvent({
      dataDir: dir,
      event: { ...event, body_hash: 'd'.repeat(64) }
    })).rejects.toThrow(/knowledge_event_body_hash_mismatch/);

    await expect(recordBrainbaseKnowledgeEvent({
      dataDir: dir,
      event: {
        ...event,
        permission_snapshot: { ...event.permission_snapshot, external_action: true }
      }
    })).rejects.toThrow();

    await expect(recordBrainbaseKnowledgeEvent({
      dataDir: dir,
      event: buildEvent({ summary: 'api_key=secret-value-123' })
    })).rejects.toThrow(/knowledge_event_summary_contains_sensitive_content/);
  });

  it('fails closed when an existing event id points to a corrupt record', async () => {
    const dir = await fixtureDir();
    const event = buildEvent();
    const recordDir = join(dir, 'runtime', 'knowledge-events', 'v1');
    await mkdir(recordDir, { recursive: true });
    await writeFile(join(recordDir, `${event.event_id}.json`), '{"broken":true}\n', 'utf8');

    await expect(recordBrainbaseKnowledgeEvent({ dataDir: dir, event }))
      .rejects.toThrow();
  });

  it('publishes a strict MCP schema with candidate-only authority boundaries', () => {
    expect(knowledgeEventToolDefinition).toMatchObject({
      name: 'brainbase_knowledge_event_record',
      inputSchema: {
        required: ['event'],
        additionalProperties: false,
        properties: {
          event: {
            additionalProperties: false,
            properties: {
              decision_authority: {
                properties: {
                  authorized: { const: false },
                  graph_promotion_allowed: { const: false }
                }
              },
              permission_snapshot: {
                properties: {
                  external_action: { const: false },
                  graph_promotion: { const: false }
                }
              }
            }
          }
        }
      }
    });
  });
});
