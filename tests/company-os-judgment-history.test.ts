import { describe, expect, it, vi } from 'vitest';
import {
  COMPANY_OS_JUDGMENT_HISTORY_SPEC_REFERENCE,
  companyOsJudgmentHistoryRecordId,
  createCompanyOsJudgmentHistorySource,
  createCompanyOsJudgmentHistoryAdapter,
  type CompanyOsJudgmentHistoryListRunPort,
  type CompanyOsJudgmentHistorySourceRun,
} from '../src/company-os-judgment-history.js';
import { createJudgmentHistoryReader } from '../src/judgment-history.js';
import type { JudgmentViewAccessContext, JudgmentViewDocument } from '../src/judgment-view.js';

const access: JudgmentViewAccessContext = {
  tenantId: 'tenant-a',
  principal: 'principal-a',
  scopeId: 'project-a',
};

function view(overrides: Partial<JudgmentViewDocument> = {}): JudgmentViewDocument {
  return {
    contract_version: 'judgment-view.v1',
    mode: 'historical',
    status: 'resolved',
    run: {
      status: 'resolved',
      value: {
        runId: 'composition-run-1',
        status: 'completed',
        question: 'どの方式を採用するか',
        composition: { id: 'composition', version: '2' },
        parentDag: { id: 'parent-dag', version: '3' },
        problemSnapshot: { snapshot_id: 'snapshot-1', problem_id: 'problem-1', revision: '4' },
      },
    },
    conclusion: {
      status: 'resolved',
      value: {
        source: 'parent-run-artifact',
        runId: 'composition-run-1',
        dag: { id: 'parent-dag', version: '3' },
        value: { answer: '採用' },
      },
    },
    problem: {
      status: 'resolved',
      value: {
        snapshotId: 'snapshot-1',
        problemId: 'problem-1',
        revision: '4',
        question: 'どの方式を採用するか',
        references: [{ kind: 'objective', id: 'objective-1', revision: '2', digest: 'old-digest' }],
      },
    },
    objective: { status: 'unknown', reason: 'not loaded' },
    evidence: { status: 'resolved', items: [], absence_confirmed: true },
    childRuns: { status: 'resolved', items: [], absence_confirmed: true },
    resultEvaluation: {
      status: 'resolved',
      value: { achievement: 'achieved' },
    },
    judgmentValidity: { status: 'unknown', reason: 'not loaded' },
    ...overrides,
  } as JudgmentViewDocument;
}

function sourceRun(overrides: Partial<CompanyOsJudgmentHistorySourceRun> = {}): CompanyOsJudgmentHistorySourceRun {
  return {
    source_id: 'composition-run-1',
    recorded_at: '2026-10-07T01:02:03.000Z',
    project_code: 'project-a',
    turn_ref: 'turn-1',
    owner: access,
    view: view(),
    public_judgment: {
      status: 'resolved',
      summary: '保存済みの公開要約',
      reason: '保存済みの理由',
      selected_references: [{
        ref: 'objective-1',
        kind: 'objective',
        version: '2',
        digest: 'old-digest',
        why: '当時の選択',
        usage: 'selection',
        availability: 'recorded',
      }],
      alternatives: [{ label: '保留案', evaluation: '適合しない', adopted: false }],
    },
    public_execution: {
      status: 'completed',
      result_summary: '実行結果の保存済み要約',
      outcome_status: 'unconfirmed',
    },
    ...overrides,
  };
}

function port(result: unknown, requests: unknown[] = []): CompanyOsJudgmentHistoryListRunPort {
  return {
    listRun: vi.fn(async (request) => {
      requests.push(request);
      return result as never;
    }),
  };
}

describe('Company OS judgment history projection', () => {
  it('projects the exact historical run/view and leaves semantic outcome unconfirmed', async () => {
    const requests: unknown[] = [];
    const sourcePort = port([sourceRun()], requests);
    const source = createCompanyOsJudgmentHistorySource({ access, sourcePort });
    const snapshot = await source.read();

    expect(COMPANY_OS_JUDGMENT_HISTORY_SPEC_REFERENCE).toContain('judgment-history-end-to-end-v1.md');
    expect(requests).toEqual([{ access, period: 'all', entrypoint: 'company_os', limit: 100 }]);
    expect(snapshot.status).toBe('available');
    expect(snapshot.coverage).toMatchObject({ complete: true, storage: 'server', total: 1 });
    expect(snapshot.records).toHaveLength(1);
    const record = snapshot.records?.[0];
    expect(record).toMatchObject({
      entrypoint: 'company_os',
      recorded_at: '2026-10-07T01:02:03.000Z',
      project_code: 'project-a',
      turn_ref: 'turn-1',
      execution: { status: 'completed', result_summary: '実行結果の保存済み要約', outcome_status: 'unconfirmed' },
    });
    expect(record?.judgment.selected_references?.[0]).toMatchObject({
      ref: 'objective-1', version: '2', digest: 'old-digest',
    });
    expect(record?.judgment.alternatives?.[0]).toMatchObject({ label: '保留案', adopted: false });
    expect(record?.judgment.summary).toBe('保存済みの公開要約');
    expect(record).not.toHaveProperty('conclusion');
    expect(record?.execution.outcome_status).not.toBe('confirmed');
  });

  it('keeps the existing source identity stable across retry and never replaces its old digest', async () => {
    const first = await createCompanyOsJudgmentHistorySource({
      access,
      sourcePort: port([sourceRun()]),
    }).read();
    const second = await createCompanyOsJudgmentHistorySource({
      access,
      sourcePort: port([sourceRun({ view: view({ reason: 'later view read' }) })]),
    }).read();
    expect(first.records?.[0]?.record_id).toBe(second.records?.[0]?.record_id);
    expect(first.records?.[0]?.judgment.selected_references?.[0]?.digest).toBe('old-digest');
    expect(companyOsJudgmentHistoryRecordId(access, 'composition-run-1')).toBe(first.records?.[0]?.record_id);
  });

  it('does not leak a run when the source owner/scope does not match the trusted request', async () => {
    const snapshot = await createCompanyOsJudgmentHistorySource({
      access,
      sourcePort: port([sourceRun({ owner: { ...access, scopeId: 'other-project' } })]),
    }).read();
    expect(snapshot.status).toBe('partial');
    expect(snapshot.records).toEqual([]);
    expect(snapshot.coverage.complete).toBe(false);
    expect(snapshot.coverage.total).toBeNull();
  });

  it('reports an omitted port as unavailable instead of confirmed empty', async () => {
    const source = createCompanyOsJudgmentHistorySource({ access });
    const snapshot = await source.read();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.records).toBeNull();
    expect(snapshot.coverage.complete).toBe(false);
    expect(snapshot.coverage.reason).toBe('company_os_judgment_history_source_not_injected');
  });

  it('propagates bounded or failed source coverage and keeps resultEvaluation out of the semantic result', async () => {
    const source = createCompanyOsJudgmentHistorySource({
      access,
      sourcePort: port({
        status: 'partial',
        runs: [sourceRun({ public_judgment: undefined, public_execution: undefined })],
        complete: false,
        total: null,
        reason: 'bounded_source_scan',
      }),
    });
    const snapshot = await source.read();
    expect(snapshot.status).toBe('partial');
    expect(snapshot.coverage.complete).toBe(false);
    expect(snapshot.coverage.reason).toBe('bounded_source_scan');
    expect(snapshot.records?.[0]?.judgment.summary).toBeNull();
    expect(snapshot.records?.[0]?.execution.outcome_status).toBe('unconfirmed');
    expect(snapshot.records?.[0]?.missing_fields).toEqual(expect.arrayContaining([
      'judgment.summary', 'judgment.reason', 'judgment.alternatives', 'execution.result_summary', 'execution.outcome_status',
    ]));
  });

  it('does not treat one known empty reference section as proof that unknown sections are empty', async () => {
    const historicalView = view({
      problem: {
        status: 'resolved',
        value: {
          snapshotId: 'snapshot-1',
          problemId: 'problem-1',
          revision: '4',
          question: 'どの方式を採用するか',
          references: [],
        },
      },
      objective: { status: 'unknown', reason: 'not loaded' },
      evidence: { status: 'resolved', items: [], absence_confirmed: true },
    });
    const snapshot = await createCompanyOsJudgmentHistorySource({
      access,
      sourcePort: port([sourceRun({
        view: historicalView,
        public_judgment: {
          status: 'resolved',
          summary: '保存済みの公開要約',
          reason: '保存済みの理由',
          alternatives: [],
        },
      })]),
    }).read();

    expect(snapshot.records?.[0]?.judgment.selected_references).toBeNull();
    expect(snapshot.records?.[0]?.missing_fields).toContain('judgment.selected_references');
  });

  it('binds the common source snapshot and downgrades contradictory host coverage to partial', async () => {
    const source = createCompanyOsJudgmentHistorySource({
      access,
      sourcePort: port({
        status: 'available',
        runs: [sourceRun()],
        complete: false,
        total: null,
        snapshot_id: 'host-revision-1',
      }),
    });
    const snapshot = await source.read();
    expect(snapshot.status).toBe('partial');
    expect(snapshot.coverage.complete).toBe(false);
    expect(snapshot.coverage.total).toBeNull();
    expect(snapshot.snapshot_id).toBe('host-revision-1');
  });

  it('can be passed directly to the common reader for the same owner-bound history contract', async () => {
    const reader = createJudgmentHistoryReader({
      source: createCompanyOsJudgmentHistorySource({ access, sourcePort: port([sourceRun()]) }),
    });
    const home = await reader.home({ entrypoint: 'company_os', project: 'project-a' });
    expect(home.status).toBe('available');
    expect(home.records).toHaveLength(1);
    expect(home.coverage.total).toBe(1);
  });
});
