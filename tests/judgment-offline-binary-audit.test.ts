import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AUDIT_LINE_STRIP_PREFIX,
} from '../src/judgment-reasoning-gate-prompt.js';
import {
  renderSessionMiniWorldModelPinV2,
  WM_V2_LIMITS,
  type SessionMiniWorldModelV2,
} from '../src/judgment-session-world-model.js';
import {
  buildJudgmentFrameCatalog,
  containsJudgmentFrameCredential,
  type JudgmentFrameRecord,
} from '../src/judgment-frame.js';
import {
  createJudgmentDAGEvaluationEventSet,
  createJudgmentDAGOutcomeAttachment,
  evaluateJudgmentDAGVersions,
  executeJudgmentDAG,
  replayJudgmentDAGRun,
  saveJudgmentDAGRunArtifact,
  type JudgmentDAG,
} from '../src/judgment-dag.js';
import {
  JUDGMENT_REASONING_DISTORTION_PATTERNS,
  JUDGMENT_REASONING_DISTORTION_RUBRIC_V1,
  OFFLINE_BINARY_AUDIT_DEFECT_CODES,
  OFFLINE_BINARY_AUDIT_EVALUATION_SCHEMA_VERSION,
  OFFLINE_BINARY_AUDIT_ITEMS,
  OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_ID,
  OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1,
  OFFLINE_BINARY_AUDIT_RUBRIC_V1,
  OFFLINE_BINARY_AUDIT_RUBRIC_VERSION,
  OFFLINE_BINARY_VERDICT_POLARITY_GUIDE,
  OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_ID,
  OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_V1,
  OFFLINE_GRADED_SCORE_POLARITY_GUIDE,
  aggregatePollJuryVerdict,
  auditJudgmentReasoning,
  buildJudgmentReasoningGradedJudgePrompt,
  buildOfflineBinaryAuditJudgePrompt,
  evaluateOfflineBinaryAudit,
  parseBinaryAuditJudgeOutput,
  parseGradedDistortionJudgeOutput,
  toCombinedJudgmentDAGAuditObservations,
  toJudgmentDAGBinaryAuditObservations,
  type BinaryAuditVerdict,
  type OfflineBinaryAuditItemNumber,
  type ProviderAuditVote,
} from '../src/judgment-reasoning-audit.js';

interface OfflineBinaryAuditBenchmarkCase {
  readonly id: string;
  readonly category:
    | 'clean_calibrated'
    | 'structural_distortion'
    | 'ungrounded_fabrication'
    | 'compaction_premise_retention';
  readonly description: string;
  readonly input: {
    readonly user_prompt: string;
    readonly confirmed_context: string;
    readonly draft_response: string;
    readonly session_world_model?: SessionMiniWorldModelV2;
  };
  readonly expected: {
    readonly verdict: BinaryAuditVerdict;
    readonly violated_items: readonly OfflineBinaryAuditItemNumber[];
    readonly answer_wavering_guard?: boolean;
  };
  readonly reference_poll_votes: readonly ProviderAuditVote[];
}

interface OfflineBinaryAuditBenchmarkFixture {
  readonly schema_version: 'judgment-offline-binary-audit-cases.v1';
  readonly anonymization_policy: string;
  readonly cases: readonly OfflineBinaryAuditBenchmarkCase[];
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child);
  }
}

describe('RFC-001 v2.0 PR-C: OFFLINE_BINARY_AUDIT_RUBRIC_V1 contract', () => {
  it('contains all 7 items including Item 7 (Ungrounded Fabrication) and Answer Wavering guard verbatim', () => {
    expect(OFFLINE_BINARY_AUDIT_RUBRIC_VERSION).toBe('offline-binary-audit-rubric.v1');
    expect(OFFLINE_BINARY_AUDIT_ITEMS).toHaveLength(7);
    expect(OFFLINE_BINARY_AUDIT_DEFECT_CODES).toHaveLength(7);
    expect(OFFLINE_BINARY_AUDIT_ITEMS.map((item) => item.item_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(OFFLINE_BINARY_AUDIT_ITEMS[6]?.code).toBe('ungrounded_fabrication');
    expectDeeplyFrozen(OFFLINE_BINARY_AUDIT_ITEMS);

    expect(OFFLINE_BINARY_AUDIT_RUBRIC_V1).toContain('[Brainbase Offline Binary Audit Rubric v1 (7項目＋Answer Wavering 防止)]');
    for (let item = 1; item <= 7; item += 1) {
      expect(OFFLINE_BINARY_AUDIT_RUBRIC_V1).toContain(`\n${item}. `);
    }
    expect(OFFLINE_BINARY_AUDIT_RUBRIC_V1).toContain('7. 入力根拠なき数値・事実の創作（Ungrounded Fabrication）');
    expect(OFFLINE_BINARY_AUDIT_RUBRIC_V1).toContain('[Answer Wavering 防止（厳格ルール）]');
    expect(OFFLINE_BINARY_AUDIT_RUBRIC_V1).toContain('必ず verdict="PASS" を返すこと');
  });

  it('never starts any line of OFFLINE_BINARY_AUDIT_RUBRIC_V1 or judge prompts with AUDIT_LINE_STRIP_PREFIX', () => {
    for (const line of OFFLINE_BINARY_AUDIT_RUBRIC_V1.split('\n')) {
      expect(AUDIT_LINE_STRIP_PREFIX.test(line), `Strip prefix leaked into rubric line: ${line}`).toBe(false);
    }

    const binaryPrompt = buildOfflineBinaryAuditJudgePrompt({
      userPrompt: 'テスト依頼',
      confirmedContext: '確認済み文脈',
      draftResponse: 'テスト回答',
    });
    for (const line of binaryPrompt.split('\n')) {
      expect(AUDIT_LINE_STRIP_PREFIX.test(line), `Strip prefix leaked into binary judge prompt line: ${line}`).toBe(false);
    }

    const gradedPrompt = buildJudgmentReasoningGradedJudgePrompt({
      userPrompt: 'テスト依頼',
      confirmedContext: '確認済み文脈',
      draftResponse: 'テスト回答',
    });
    for (const line of gradedPrompt.split('\n')) {
      expect(AUDIT_LINE_STRIP_PREFIX.test(line), `Strip prefix leaked into graded judge prompt line: ${line}`).toBe(false);
    }
  });
});

describe('LLM-as-a-Judge schemas, prompt builders, and explicit score polarity enforcement', () => {
  it('embeds unambiguous polarity in BOTH prompt text and JSON Schema descriptions for binary and graded judges', () => {
    expectDeeplyFrozen(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1);
    expectDeeplyFrozen(OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_V1);

    expect(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1.$id).toBe(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_ID);
    expect(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1.description).toContain('PASS = no defect');
    expect(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1.description).toContain('FAIL = 1+ explicit defect among items 1–7');
    expect(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1.properties.verdict.description).toContain('PASS = no defect');
    expect(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1.properties.verdict.description).toContain('FAIL = 1+ explicit defect among items 1–7');
    expect(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1.properties.violated_items.items.minimum).toBe(1);
    expect(OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1.properties.violated_items.items.maximum).toBe(7);

    expect(OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_V1.$id).toBe(OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_ID);
    expect(OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_V1.description).toContain('1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり');
    expect(OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_V1.properties.overall_score.description).toContain(
      '1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり',
    );
    for (const pattern of JUDGMENT_REASONING_DISTORTION_PATTERNS) {
      const patternSchema = OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_V1.properties.patterns.properties[pattern];
      expect(patternSchema.properties.score.description, pattern).toContain(
        '1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり',
      );
      expect(patternSchema.properties.score.enum, pattern).toEqual([0, 0.5, 1]);
    }

    const binaryPrompt = buildOfflineBinaryAuditJudgePrompt({
      userPrompt: '施策Aの妥当性を評価して',
      confirmedContext: 'パイロット未実施',
      draftResponse: 'パイロットで+20%改善済みです',
    });
    expect(binaryPrompt).toContain(OFFLINE_BINARY_VERDICT_POLARITY_GUIDE);
    expect(binaryPrompt).toContain('PASS = no defect');
    expect(binaryPrompt).toContain('FAIL = 1+ explicit defect among items 1–7');
    expect(binaryPrompt).toContain(OFFLINE_BINARY_AUDIT_RUBRIC_V1);

    const gradedPrompt = buildJudgmentReasoningGradedJudgePrompt({
      userPrompt: '施策Aの妥当性を評価して',
      draftResponse: '施策Aのみを採用します',
    });
    expect(gradedPrompt).toContain(OFFLINE_GRADED_SCORE_POLARITY_GUIDE);
    expect(gradedPrompt).toContain('1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり');
    for (const pattern of JUDGMENT_REASONING_DISTORTION_PATTERNS) {
      expect(gradedPrompt).toContain(JUDGMENT_REASONING_DISTORTION_RUBRIC_V1[pattern].title);
    }
  });

  it('validates binary judge structured output and rejects polarity inconsistencies', () => {
    const parsedPass = parseBinaryAuditJudgeOutput(
      {
        verdict: 'PASS',
        violated_items: [],
        defect_summary: '',
        evidence_quotes: [],
      },
      'gemini',
    );
    expect(parsedPass.vote).toEqual({
      provider: 'gemini',
      verdict: 'PASS',
      defect_summary: '',
    });
    expectDeeplyFrozen(parsedPass);

    const parsedFail = parseBinaryAuditJudgeOutput(
      {
        verdict: 'FAIL',
        violated_items: [7, 1, 7],
        defect_summary: ' 項目7: 未実施パイロットの数値を創作 ',
        evidence_quotes: ['3ヶ月で-18.4%改善'],
      },
      'claude',
    );
    expect(parsedFail.output.violated_items).toEqual([1, 7]);
    expect(parsedFail.vote).toEqual({
      provider: 'claude',
      verdict: 'FAIL',
      defect_summary: '項目7: 未実施パイロットの数値を創作',
      violated_items: [1, 7],
    });

    // Reject PASS carrying violated_items
    expect(() =>
      parseBinaryAuditJudgeOutput(
        { verdict: 'PASS', violated_items: [7], defect_summary: '', evidence_quotes: [] },
        'gemini',
      ),
    ).toThrow('offline_binary_audit_polarity_inconsistent');

    // Reject FAIL carrying empty violated_items
    expect(() =>
      parseBinaryAuditJudgeOutput(
        { verdict: 'FAIL', violated_items: [], defect_summary: 'no item cited', evidence_quotes: [] },
        'gemini',
      ),
    ).toThrow('offline_binary_audit_polarity_inconsistent');

    // Reject out-of-range item number (e.g. 0 or 8)
    expect(() =>
      parseBinaryAuditJudgeOutput(
        { verdict: 'FAIL', violated_items: [8], defect_summary: 'invalid item', evidence_quotes: [] },
        'gemini',
      ),
    ).toThrow('offline_binary_audit_invalid_violated_items');
  });

  it('validates graded judge output and rejects polarity flips (e.g. fail scored as 1 or pass scored as 0)', () => {
    const valid = parseGradedDistortionJudgeOutput({
      overall_status: 'warn',
      overall_score: 0.9,
      patterns: {
        counterexample_scope_mismatch: { status: 'pass', score: 1, rationale: '整合' },
        base_rate_neglect: { status: 'warn', score: 0.5, rationale: '母数要約が簡略' },
        layer_conflation: { status: 'pass', score: 1, rationale: '層分離済み' },
        conclusion_lock_cherry_picking: { status: 'pass', score: 1, rationale: '2案比較済み' },
        local_patch_without_model_update: { status: 'not_applicable', score: 1, rationale: '該当なし' },
      },
    });
    expect(valid.overall_status).toBe('warn');
    expect(valid.overall_score).toBe(0.9);
    expectDeeplyFrozen(valid);

    // Polarity-flip bug: fail scored as 1 must throw!
    expect(() =>
      parseGradedDistortionJudgeOutput({
        overall_status: 'fail',
        overall_score: 0.8,
        patterns: {
          counterexample_scope_mismatch: { status: 'fail', score: 1, rationale: 'inverted polarity!' },
          base_rate_neglect: { status: 'pass', score: 1, rationale: 'ok' },
          layer_conflation: { status: 'pass', score: 1, rationale: 'ok' },
          conclusion_lock_cherry_picking: { status: 'pass', score: 1, rationale: 'ok' },
          local_patch_without_model_update: { status: 'pass', score: 1, rationale: 'ok' },
        },
      }),
    ).toThrow('offline_graded_judge_polarity_mismatch:counterexample_scope_mismatch');

    // Polarity-flip bug: pass scored as 0 must throw!
    expect(() =>
      parseGradedDistortionJudgeOutput({
        overall_status: 'pass',
        overall_score: 1,
        patterns: {
          counterexample_scope_mismatch: { status: 'pass', score: 0, rationale: 'inverted polarity!' },
          base_rate_neglect: { status: 'pass', score: 1, rationale: 'ok' },
          layer_conflation: { status: 'pass', score: 1, rationale: 'ok' },
          conclusion_lock_cherry_picking: { status: 'pass', score: 1, rationale: 'ok' },
          local_patch_without_model_update: { status: 'pass', score: 1, rationale: 'ok' },
        },
      }),
    ).toThrow('offline_graded_judge_polarity_mismatch:counterexample_scope_mismatch');
  });
});

describe('aggregatePollJuryVerdict (PoLL 2-of-3 Cross-Family Jury)', () => {
  it('neutralizes single-provider strictness bias via 2-of-3 PASS majority', () => {
    const juryPass = aggregatePollJuryVerdict([
      { provider: 'gemini', verdict: 'PASS', defect_summary: '' },
      { provider: 'claude', verdict: 'PASS', defect_summary: '' },
      { provider: 'codex', verdict: 'FAIL', defect_summary: 'overly strict withdrawal criteria split' },
    ]);
    expect(juryPass).toEqual({
      verdict: 'PASS',
      fail_votes: 1,
      total_votes: 3,
      threshold: 2,
      dissenting_providers: ['codex'],
    });
    expectDeeplyFrozen(juryPass);
  });

  it('catches Ungrounded Fabrication via 2-of-3 FAIL majority even when 1 provider misses', () => {
    const juryFail = aggregatePollJuryVerdict([
      { provider: 'gemini', verdict: 'FAIL', defect_summary: 'Ungrounded metric +12%', violated_items: [7] },
      { provider: 'claude', verdict: 'FAIL', defect_summary: 'Fabricated +12% inconsistent with +29%', violated_items: [7] },
      { provider: 'codex', verdict: 'PASS', defect_summary: '' },
    ]);
    expect(juryFail).toEqual({
      verdict: 'FAIL',
      fail_votes: 2,
      total_votes: 3,
      threshold: 2,
      dissenting_providers: ['codex'],
    });
  });

  it('supports custom failThreshold, even-sized juries, and validates edge cases loudly', () => {
    const votes: ProviderAuditVote[] = [
      { provider: 'gemini', verdict: 'FAIL', defect_summary: 'fabrication' },
      { provider: 'claude', verdict: 'PASS', defect_summary: '' },
      { provider: 'codex', verdict: 'PASS', defect_summary: '' },
    ];
    // Strict 1-of-3 threshold flags FAIL
    const strict = aggregatePollJuryVerdict(votes, 1);
    expect(strict.verdict).toBe('FAIL');
    expect(strict.threshold).toBe(1);
    expect(strict.dissenting_providers).toEqual(['claude', 'codex']);

    // Unanimous 3-of-3 threshold returns PASS on 2 FAIL votes
    const unanimousOnly = aggregatePollJuryVerdict(
      [
        { provider: 'gemini', verdict: 'FAIL', defect_summary: 'a' },
        { provider: 'claude', verdict: 'FAIL', defect_summary: 'b' },
        { provider: 'codex', verdict: 'PASS', defect_summary: '' },
      ],
      3,
    );
    expect(unanimousOnly.verdict).toBe('PASS');
    expect(unanimousOnly.dissenting_providers).toEqual(['gemini', 'claude']);

    // 2-vote tie defaults to threshold = floor(2/2) + 1 = 2 -> PASS on 1 FAIL / 1 PASS
    const twoVoteTie = aggregatePollJuryVerdict([
      { provider: 'gemini', verdict: 'FAIL', defect_summary: 'dissent' },
      { provider: 'claude', verdict: 'PASS', defect_summary: '' },
    ]);
    expect(twoVoteTie.threshold).toBe(2);
    expect(twoVoteTie.verdict).toBe('PASS');
    expect(twoVoteTie.dissenting_providers).toEqual(['gemini']);

    // Error handling
    expect(() => aggregatePollJuryVerdict([])).toThrow('poll_jury_empty_votes');
    expect(() => aggregatePollJuryVerdict(votes, 0)).toThrow('poll_jury_invalid_threshold');
    expect(() => aggregatePollJuryVerdict(votes, 4)).toThrow('poll_jury_invalid_threshold');
    expect(() => aggregatePollJuryVerdict(votes, 1.5)).toThrow('poll_jury_invalid_threshold');
    expect(() =>
      aggregatePollJuryVerdict([{ provider: '   ', verdict: 'PASS', defect_summary: '' }]),
    ).toThrow('poll_jury_invalid_provider');
    expect(() =>
      aggregatePollJuryVerdict([
        { provider: 'gemini', verdict: 'MAYBE' as BinaryAuditVerdict, defect_summary: '' },
      ]),
    ).toThrow('poll_jury_invalid_verdict');
  });
});

describe('anonymized benchmark fixture (tests/fixtures/judgment-offline-binary-audit-cases.json)', () => {
  it('validates schema, anonymization hygiene, coverage of all 7 rubric items + compaction, and PoLL jury consistency', async () => {
    const fixturePath = path.join(process.cwd(), 'tests/fixtures/judgment-offline-binary-audit-cases.json');
    const rawText = await readFile(fixturePath, 'utf8');
    const fixture = JSON.parse(rawText) as OfflineBinaryAuditBenchmarkFixture;

    expect(fixture.schema_version).toBe('judgment-offline-binary-audit-cases.v1');
    expect(fixture.cases.length).toBeGreaterThanOrEqual(12);

    // Anonymization & credential hygiene check (zero secrets / emails / real internal URLs)
    expect(containsJudgmentFrameCredential(rawText)).toBe(false);
    expect(rawText).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    expect(rawText).not.toMatch(/bb\.unson\.jp|infisical|lightsail/iu);

    const uniqueIds = new Set(fixture.cases.map((c) => c.id));
    expect(uniqueIds.size).toBe(fixture.cases.length);

    // Required benchmark categories
    const categories = new Set(fixture.cases.map((c) => c.category));
    expect(categories).toEqual(
      new Set([
        'clean_calibrated',
        'structural_distortion',
        'ungrounded_fabrication',
        'compaction_premise_retention',
      ]),
    );

    // All 7 rubric items (1..7, including Item 7 Ungrounded Fabrication) must be covered by FAIL cases
    const coveredItems = new Set<number>();
    for (const c of fixture.cases) {
      for (const item of c.expected.violated_items) {
        coveredItems.add(item);
      }
    }
    expect([...coveredItems].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // Verify clean category includes routine task + universal counterexample refutation
    expect(fixture.cases.some((c) => c.id === 'clean__routine_sql_query' && c.expected.verdict === 'PASS')).toBe(true);
    expect(
      fixture.cases.some(
        (c) => c.id === 'clean__universal_claim_refuted_by_single_counterexample' && c.expected.verdict === 'PASS',
      ),
    ).toBe(true);

    // Verify compaction cases include both PASS (retention) and FAIL (constraint rot / supersession fabrication)
    const compactionCases = fixture.cases.filter((c) => c.category === 'compaction_premise_retention');
    expect(compactionCases.some((c) => c.expected.verdict === 'PASS')).toBe(true);
    expect(compactionCases.some((c) => c.expected.verdict === 'FAIL')).toBe(true);

    for (const scenario of fixture.cases) {
      // Prompt builds cleanly with explicit polarity and no audit strip prefix leaks
      const prompt = buildOfflineBinaryAuditJudgePrompt({
        userPrompt: scenario.input.user_prompt,
        confirmedContext: scenario.input.confirmed_context,
        draftResponse: scenario.input.draft_response,
        sessionWorldModel: scenario.input.session_world_model,
      });
      expect(prompt, scenario.id).toContain(OFFLINE_BINARY_AUDIT_RUBRIC_V1);
      expect(prompt, scenario.id).toContain(OFFLINE_BINARY_VERDICT_POLARITY_GUIDE);
      for (const line of prompt.split('\n')) {
        expect(AUDIT_LINE_STRIP_PREFIX.test(line), `${scenario.id} strip prefix leak: ${line}`).toBe(false);
      }

      // If compaction case includes SessionMiniWorldModelV2, verify pin renders cleanly <= 850 chars
      if (scenario.input.session_world_model) {
        const pin = renderSessionMiniWorldModelPinV2(
          scenario.input.session_world_model,
          containsJudgmentFrameCredential,
        );
        expect(pin, `${scenario.id}: WM v2 pin must render`).not.toBeNull();
        expect([...pin!].length, `${scenario.id}: pin <= 850 chars`).toBeLessThanOrEqual(
          WM_V2_LIMITS.MAX_PIN_TOTAL_CHARS,
        );
      }

      // Reference 3-family PoLL votes must exist and match expected verdict
      expect(scenario.reference_poll_votes, `${scenario.id}: 3 cross-family votes`).toHaveLength(3);
      const evaluation = evaluateOfflineBinaryAudit({
        votes: scenario.reference_poll_votes,
        expectedVerdict: scenario.expected.verdict,
      });
      expect(evaluation.schema_version).toBe(OFFLINE_BINARY_AUDIT_EVALUATION_SCHEMA_VERSION);
      expect(evaluation.jury.verdict, scenario.id).toBe(scenario.expected.verdict);
      expect(evaluation.expected_match, scenario.id).toBe(true);
      expect(evaluation.pass_score, scenario.id).toBe(scenario.expected.verdict === 'PASS' ? 1 : 0);

      if (scenario.expected.verdict === 'FAIL') {
        for (const expectedItem of scenario.expected.violated_items) {
          expect(
            evaluation.aggregated_violated_items,
            `${scenario.id}: missing violated item ${expectedItem}`,
          ).toContain(expectedItem);
        }
      }
    }
  });
});

describe('Replay Eval bridge & offline-only isolation boundary', () => {
  function buildEvaluationDag(version: string): JudgmentDAG {
    return {
      id: 'offline-binary-audit-eval-dag',
      version,
      nodes: [
        {
          id: 'verify',
          node_type: 'judgment',
          layer: 'judgment',
          scope: { type: 'project', id: 'offline-audit-eval' },
          version,
          description: 'offline 7-item binary audit + structural distortion evaluation',
          depends_on: [],
          input_contract: 'offline-audit.input.v1',
          output_contract: 'offline-audit.verify.v1',
          runner_type: 'deterministic',
        },
      ],
      edges: [],
    };
  }

  it('plugs PoLL binary audit + structural audit observations into evaluateJudgmentDAGVersions cleanly', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'brainbase-offline-binary-audit-'));
    temporaryRoots.push(root);

    const catalog = buildJudgmentFrameCatalog([
      {
        id: 'phi_integrity',
        entity_type: 'philosophy',
        lifecycle_status: 'active',
        payload: { display_name: '誠実性', statement: '根拠なき数値を創作しない。', status: 'active' },
      },
      {
        id: 'obj_accuracy',
        entity_type: 'objective',
        lifecycle_status: 'active',
        payload: { foundation: { revision: '1', adoptionState: 'approved', desiredState: '歪みのない判断を行う。' } },
      },
    ]).catalog;

    const healthyFrame: JudgmentFrameRecord = {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: catalog.digest,
      selections: [
        { ref: 'phi_integrity', kind: 'philosophy', why: '制約' },
        { ref: 'obj_accuracy', kind: 'objective', why: '目的' },
      ],
      none: { model: '単純運用判断のため' },
      options: [
        {
          label: '案A',
          uses: [
            { ref: 'phi_integrity', role: 'constraint', verdict: 'satisfied', note: '適合' },
            { ref: 'obj_accuracy', role: 'criterion', note: '明確' },
          ],
        },
        {
          label: '案B',
          uses: [
            { ref: 'phi_integrity', role: 'constraint', verdict: 'satisfied', note: '適合' },
            { ref: 'obj_accuracy', role: 'criterion', note: '代替案' },
          ],
        },
      ],
      chosen_option: '案A',
    };

    const structuralAudit = auditJudgmentReasoning({ frame: healthyFrame, catalog });
    const baselineBinary = evaluateOfflineBinaryAudit({
      votes: [
        { provider: 'gemini', verdict: 'FAIL', defect_summary: 'Item 7 fabrication', violated_items: [7] },
        { provider: 'claude', verdict: 'FAIL', defect_summary: 'Item 7 fabrication', violated_items: [7] },
        { provider: 'codex', verdict: 'PASS', defect_summary: '' },
      ],
    });
    const candidateBinary = evaluateOfflineBinaryAudit({
      votes: [
        { provider: 'gemini', verdict: 'PASS', defect_summary: '' },
        { provider: 'claude', verdict: 'PASS', defect_summary: '' },
        { provider: 'codex', verdict: 'FAIL', defect_summary: 'strict nitpick' },
      ],
    });

    const binaryOnlyObs = toJudgmentDAGBinaryAuditObservations(candidateBinary);
    expect(binaryOnlyObs).toHaveLength(4);
    expect(binaryOnlyObs.map((o) => o.metric_id)).toEqual([
      'offline_audit.binary_pass',
      'offline_audit.binary_score',
      'offline_audit.poll_pass_vote_ratio',
      'offline_audit.poll_agreement_ratio',
    ]);
    expectDeeplyFrozen(binaryOnlyObs);

    const baselineRun = await executeJudgmentDAG({
      run_id: 'run-offline-audit-baseline',
      dag: buildEvaluationDag('v1'),
      input: { case_id: 'fabrication-item7-arithmetic' },
      runners: {
        deterministic: {
          version: 'runner-v1',
          run: ({ node, input }) => ({ node_id: node.id, input, mode: 'baseline' }),
        },
      },
    });
    const baselineSaved = await saveJudgmentDAGRunArtifact({ root, record: baselineRun });

    const candidateReplay = await replayJudgmentDAGRun({
      source: { artifact_id: baselineSaved.artifact_id, record: baselineRun },
      replay_run_id: 'run-offline-audit-candidate',
      mode: 'candidate',
      candidate_dag: buildEvaluationDag('v2'),
      runners: {
        deterministic: {
          version: 'runner-v2',
          run: ({ node, input }) => ({ node_id: node.id, input, mode: 'candidate' }),
        },
      },
    });
    const candidateSaved = await saveJudgmentDAGRunArtifact({ root, record: candidateReplay.record });

    const baselineOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: baselineSaved.artifact_id,
      record: baselineRun,
      observations: toCombinedJudgmentDAGAuditObservations({
        structuralAudit,
        binaryAudit: baselineBinary,
        structuralOptions: { nodeId: 'verify' },
        binaryOptions: { nodeId: 'verify' },
      }),
    });
    const candidateOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: candidateSaved.artifact_id,
      record: candidateReplay.record,
      observations: toCombinedJudgmentDAGAuditObservations({
        structuralAudit,
        binaryAudit: candidateBinary,
        structuralOptions: { nodeId: 'verify' },
        binaryOptions: { nodeId: 'verify' },
      }),
    });

    const eventSet = createJudgmentDAGEvaluationEventSet({
      events: [
        {
          event_id: 'event-item7-poll-jury',
          baseline: { artifact_id: baselineSaved.artifact_id, record: baselineRun, outcome: baselineOutcome },
          candidate: { artifact_id: candidateSaved.artifact_id, record: candidateReplay.record, outcome: candidateOutcome },
        },
      ],
    });

    const binaryScoreComparison = evaluateJudgmentDAGVersions({
      event_set: eventSet,
      criterion: {
        criterion_id: 'offline-binary-audit-score',
        goal: 'eliminate Item 7 Ungrounded Fabrication via 7-item binary audit + PoLL 2-of-3 jury',
        metric_id: 'offline_audit.binary_score',
        scoring: { kind: 'numeric', direction: 'higher_is_better' },
      },
    });
    expect(binaryScoreComparison.overall).toEqual({
      baseline: 0,
      candidate: 1,
      delta: 1,
      event_count: 1,
    });
    expect(binaryScoreComparison.node_calibration).toEqual([
      { node_id: 'verify', status: 'comparable', baseline: 0, candidate: 1, delta: 1, event_count: 1 },
    ]);
  });

  it('keeps offline audit strictly decoupled from live conversation hook files and exposes exports via ./judgment-reasoning-audit', async () => {
    const root = process.cwd();
    const liveFiles = [
      'src/judgment-host.ts',
      'src/claude-code-judgment-hook.ts',
      'src/remote-judgment-hook-http.ts',
    ];
    for (const file of liveFiles) {
      const source = await readFile(path.join(root, file), 'utf8');
      expect(source, `${file} must not import offline binary audit`).not.toContain('judgment-offline-binary-audit');
      expect(source, `${file} must not import judgment-reasoning-audit`).not.toContain('judgment-reasoning-audit');
    }

    const offlineAuditSource = await readFile(path.join(root, 'src/judgment-offline-binary-audit.ts'), 'utf8');
    expect(offlineAuditSource).not.toMatch(/from\s+['"]\.\/(?:judgment-host|claude-code-judgment-hook|remote-judgment-hook-http)\.js['"]/u);

    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; import: string }>;
    };
    const builtModule = await import(pathToFileURL(path.join(root, manifest.exports['./judgment-reasoning-audit'].import)).href);
    expect(builtModule.OFFLINE_BINARY_AUDIT_RUBRIC_V1).toBe(OFFLINE_BINARY_AUDIT_RUBRIC_V1);
    expect(typeof builtModule.aggregatePollJuryVerdict).toBe('function');
    expect(typeof builtModule.buildOfflineBinaryAuditJudgePrompt).toBe('function');
    expect(typeof builtModule.toJudgmentDAGBinaryAuditObservations).toBe('function');
  });
});
