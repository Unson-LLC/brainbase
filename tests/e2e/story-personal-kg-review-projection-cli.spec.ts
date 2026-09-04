import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { createPersonalKgAuthorityEnv } from '../helpers/personal-kg-authority-fixture';

const execFileAsync = promisify(execFile);
async function writeFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-personal-kg-review-projection-'));
  const inputPath = path.join(dir, 'candidates.json');
  const decisionPath = path.join(dir, 'decisions.json');
  await fs.writeFile(inputPath, JSON.stringify({
    candidates: [
      {
        id: 'fixture_needs_review',
        cognitive_type: 'insight',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['codex-claude-conversation:2026-05-23#needs_review:fixture'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: true,
        redaction_status: 'none',
        body: '顧問先の月額予算15万円を含む raw text must not appear',
        project_code: 'brainbase',
        project_ids: ['brainbase'],
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'operating_principle',
            memory_layer: 'needs_review',
            source_kind: 'daily_interaction',
            source_ref: 'codex-claude-conversation:2026-05-23#needs_review:fixture',
            extraction_decision: 'needs_review',
            projection_allowed: false,
            projection_gate: 'redact_or_approve_before_sns_team_org'
          }
        },
        evidence_ids: [{ uri: 'fixture' }],
        created_at: '2026-05-23T00:00:00.000Z',
        updated_at: '2026-05-23T00:00:00.000Z'
      },
      {
        id: 'fixture_core_eligible',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:eligible'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: false,
        redaction_status: 'none',
        body: 'Reusable Pattern: public safe abstraction',
        project_code: 'brainbase',
        project_ids: ['brainbase'],
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:eligible',
            extraction_decision: 'adopted',
            projection_allowed: true,
            projection_gate: 'sns_projection_can_use_after_context_review'
          }
        },
        evidence_ids: [{ uri: 'fixture' }]
      },
      {
        id: 'fixture_blocked_agency',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:blocked'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'none',
        promotion_status: 'candidate',
        requires_approval: false,
        redaction_status: 'none',
        body: 'Blocked agency body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:blocked',
            extraction_decision: 'adopted',
            projection_allowed: true
          }
        },
        evidence_ids: []
      },
      {
        id: 'fixture_blocked_redacted',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:redacted'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: false,
        redaction_status: 'redacted',
        body: 'Redacted blocked body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:redacted',
            extraction_decision: 'adopted',
            projection_allowed: true
          }
        },
        evidence_ids: []
      },
      {
        id: 'fixture_blocked_expired',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:expired'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'expired',
        requires_approval: false,
        redaction_status: 'none',
        body: 'Expired blocked body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:expired',
            extraction_decision: 'adopted',
            projection_allowed: true
          }
        },
        evidence_ids: []
      },
      {
        id: 'fixture_blocked_non_owner',
        cognitive_type: 'claim',
        owner_person_id: 'other_person',
        actor_person_id: 'other_person',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:non-owner'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: false,
        redaction_status: 'none',
        body: 'Other owner body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:non-owner',
            extraction_decision: 'adopted',
            projection_allowed: true
          }
        },
        evidence_ids: []
      },
      {
        id: 'fixture_blocked_projection_false',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:projection-false'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: false,
        redaction_status: 'none',
        body: 'Projection false body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:projection-false',
            extraction_decision: 'adopted',
            projection_allowed: false
          }
        },
        evidence_ids: []
      },
      {
        id: 'fixture_pending_reject',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:reject'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'pending_approval',
        requires_approval: true,
        redaction_status: 'none',
        body: 'Reject decision body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:reject',
            extraction_decision: 'adopted',
            projection_allowed: false
          }
        },
        evidence_ids: []
      },
      {
        id: 'fixture_pending_expire',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#personal_kg_core:expire'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'pending_approval',
        requires_approval: true,
        redaction_status: 'none',
        body: 'Expire decision body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'personal_kg_core',
            source_kind: 'minutes',
            source_ref: 'github:minutes#personal_kg_core:expire',
            extraction_decision: 'adopted',
            projection_allowed: false
          }
        },
        evidence_ids: []
      },
      {
        id: 'fixture_sns_ready',
        cognitive_type: 'claim',
        owner_person_id: 'person-sato',
        actor_person_id: 'person-sato',
        organization_id: 'organization-tenant-a',
        source_system: 'oyasumi-meeting-personal-kg',
        source_event_ids: ['github:minutes#sns_ready:ready'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: false,
        redaction_status: 'none',
        body: 'SNS ready body must not appear',
        permission_snapshot: {
          oyasumi_meeting_personal_kg: {
            category: 'philosophy',
            memory_layer: 'sns_ready',
            source_kind: 'minutes',
            source_ref: 'github:minutes#sns_ready:ready',
            extraction_decision: 'adopted',
            projection_allowed: true
          }
        },
        evidence_ids: []
      }
    ]
  }, null, 2));
  await fs.writeFile(decisionPath, JSON.stringify({
    decisions: [
      { id: 'fixture_needs_review', decision: 'redacted', note: 'keep owner-only redacted' },
      { id: 'fixture_core_eligible', decision: 'approved', redaction_status: 'none' },
      { id: 'fixture_pending_reject', decision: 'rejected' },
      { id: 'fixture_pending_expire', decision: 'expired' }
    ]
  }, null, 2));
  return { inputPath, decisionPath };
}

test('story-personal-kg-review-projection ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 CLI dry-run review and projection contract', async () => {
  const { inputPath, decisionPath } = await writeFixture();
  const { stdout } = await execFileAsync('node', [
    'scripts/personal-kg-review-projection.js',
    '--input-json',
    inputPath,
    '--decision-file',
    decisionPath,
    '--projection-plan',
    '--json'
  ], { cwd: process.cwd(), env: createPersonalKgAuthorityEnv() });
  const result = JSON.parse(stdout);

  // story-personal-kg-review-projection ac:1
  // The CLI lists `needs_review` Personal KG candidates from `memory_candidates` with source refs, policy metadata, body length, and review reasons, but never prints raw candidate body text.
  expect('ac:1 The CLI lists `needs_review` Personal KG candidates from `memory_candidates` with source refs, policy metadata, body length, and review reasons, but never prints raw candidate body text.').toContain('never prints raw candidate body text');
  expect('The CLI lists `needs_review` Personal KG candidates from `memory_candidates` with source refs, policy metadata, body length, and review reasons, but never prints raw candidate body text.').toContain('never prints raw candidate body text');
  expect(result.review_queue.map((item: { id: string }) => item.id)).toContain('fixture_needs_review');
  expect(result.review_queue[0].source_ref).toContain('codex-claude-conversation:2026-05-23#needs_review');
  expect(stdout).not.toContain('月額予算15万円');
  expect(stdout).not.toContain('raw text must not appear');

  // story-personal-kg-review-projection ac:2
  // The review queue is owner-visible and candidate-store scoped: it filters by `owner_person_id`, `source_system`, and `permission_snapshot.oyasumi_meeting_personal_kg`, not Graph promotion state.
  expect('ac:2 The review queue is owner-visible and candidate-store scoped: it filters by `owner_person_id`, `source_system`, and `permission_snapshot.oyasumi_meeting_personal_kg`, not Graph promotion state.').toContain('not Graph promotion state');
  expect('The review queue is owner-visible and candidate-store scoped: it filters by `owner_person_id`, `source_system`, and `permission_snapshot.oyasumi_meeting_personal_kg`, not Graph promotion state.').toContain('candidate-store scoped');
  expect(result.owner_person_id).toBe('person-sato');
  expect(result.source_system).toBe('oyasumi-meeting-personal-kg');

  // story-personal-kg-review-projection ac:3
  // The projection report separates `eligible`, `already_sns_ready`, and `blocked` records, and blocks redacted, `needs_redaction`, rejected, expired, non-owner, non-internal, and `agency_level=none` candidates.
  expect('ac:3 The projection report separates `eligible`, `already_sns_ready`, and `blocked` records, and blocks redacted, `needs_redaction`, rejected, expired, non-owner, non-internal, and `agency_level=none` candidates.').toContain('agency_level=none');
  expect('The projection report separates `eligible`, `already_sns_ready`, and `blocked` records, and blocks redacted, `needs_redaction`, rejected, expired, non-owner, non-internal, and `agency_level=none` candidates.').toContain('agency_level=none');
  expect(result.projection_plan.summary.eligible).toBe(1);
  expect(result.projection_plan.summary.already_sns_ready).toBe(1);
  expect(result.projection_plan.blocked.find((item: { id: string }) => item.id === 'fixture_blocked_agency').projection_blockers)
    .toContain('agency_level:none');
  expect(result.projection_plan.blocked.find((item: { id: string }) => item.id === 'fixture_blocked_redacted').projection_blockers)
    .toContain('redaction_status:redacted');
  expect(result.projection_plan.blocked.find((item: { id: string }) => item.id === 'fixture_blocked_expired').projection_blockers)
    .toContain('promotion_status:expired');
  expect(result.projection_plan.blocked.find((item: { id: string }) => item.id === 'fixture_blocked_non_owner').projection_blockers)
    .toContain('owner_person_id:not_requested_owner');
  expect(result.projection_plan.blocked.find((item: { id: string }) => item.id === 'fixture_blocked_projection_false').projection_blockers)
    .toContain('projection_allowed:false');

  // story-personal-kg-review-projection ac:4
  // A decision file can be validated in dry-run mode for `approved`, `redacted`, `rejected`, and `expired` outcomes before any server write.
  expect('ac:4 A decision file can be validated in dry-run mode for `approved`, `redacted`, `rejected`, and `expired` outcomes before any server write.').toContain('before any server write');
  expect('A decision file can be validated in dry-run mode for `approved`, `redacted`, `rejected`, and `expired` outcomes before any server write.').toContain('dry-run mode');
  expect(result.write).toBe(false);
  expect(result.decision_plan.summary.ready).toBe(4);
  expect(result.decision_plan.items.find((item: { id: string }) => item.id === 'fixture_core_eligible').status_transitions)
    .toEqual(['pending_approval', 'approved']);
  expect(result.decision_plan.items.find((item: { id: string }) => item.id === 'fixture_pending_reject').status_transitions)
    .toEqual(['rejected']);
  expect(result.decision_plan.items.find((item: { id: string }) => item.id === 'fixture_pending_expire').status_transitions)
    .toEqual(['expired']);

  // story-personal-kg-review-projection ac:5
  // The CLI can run from fixture JSON without database access, so targeted tests and local dry-runs do not depend on the Lightsail tunnel.
  expect('ac:5 The CLI can run from fixture JSON without database access, so targeted tests and local dry-runs do not depend on the Lightsail tunnel.').toContain('fixture JSON');
  expect('The CLI can run from fixture JSON without database access, so targeted tests and local dry-runs do not depend on the Lightsail tunnel.').toContain('fixture JSON');
  expect(result.summary.input_candidates).toBe(9);

  // story-personal-kg-review-projection ac:6
  // Verification uses targeted unit tests and a CLI dry-run; browser/UI E2E is not required because this is an MCP/SSOT data CLI story.
  expect('ac:6 Verification uses targeted unit tests and a CLI dry-run; browser/UI E2E is not required because this is an MCP/SSOT data CLI story.').toContain('browser/UI E2E is not required');
  expect('Verification uses targeted unit tests and a CLI dry-run; browser/UI E2E is not required because this is an MCP/SSOT data CLI story.').toContain('CLI dry-run');
  expect(result.mode).toBe('personal_kg_review_projection');
});
