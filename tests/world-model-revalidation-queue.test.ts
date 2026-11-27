import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { analyzeWorldModelImpact } from '../src/world-model-impact-index.js';
import {
  buildRevalidationQueue,
  classifyAndScoreModel,
  detectTelemetrySources,
  downstreamImpactCountFromAnalysis,
  MAX_DOWNSTREAM_IMPACT_BONUS,
  parseCatalogModelsPayload,
  renderRevalidationQueueText,
  WORLD_MODEL_REVALIDATION_QUEUE_SCHEMA_VERSION,
  type CatalogModelRecord,
  type WorldModelRevalidationQueue,
} from '../src/world-model-revalidation-queue.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-wm-revalidation-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function make151ModelCatalog(): CatalogModelRecord[] {
  const models: CatalogModelRecord[] = [];
  // 36 T1 auto-telemetry models
  const t1Texts = [
    'コード・Knowledge Skills・設定を他案件に再利用すると開発時間を短縮し、粗利率を向上できる。',
    '全事業で「立ち位置→決裁→担当」を共通化し、非同期文書とRACIに従うと、属人化を排除できる。',
    '単発ツールとしてのAI運用では、職責・証跡・承認・継続改善への接続が不足する。',
    '既存基準・文脈・権限で代理判断し、NG理由と修正条件をAIへ返すことで、人間の認知負荷と承認待ちを減らせる。',
  ];
  for (let i = 0; i < 36; i += 1) {
    const isUnson = i < 3;
    const isPhi = i >= 3 && i < 16;
    models.push({
      id: `fnd_model_t1_${String(i + 1).padStart(3, '0')}_v1`,
      status: isUnson || isPhi ? 'draft' : 'adopted_unverified',
      prefix: isUnson ? 'fnd_unson_model' : isPhi ? 'fnd_model_phi' : 'sato_wm_20260928',
      text: t1Texts[i % t1Texts.length]!,
      hasApply: i % 2 === 0,
      hasExclude: i % 3 === 0,
      hasNumber: i % 5 === 0,
      hasCausal: i % 2 === 0,
      outcomeCount: 0,
    });
  }
  // 24 T2 case-telemetry models
  const t2Texts = [
    '受託で作ったモジュールを汎用化し、複数顧客に販売すると限界費用を下げられる。',
    '関係性重視の営業では、信頼が切れた既存顧客を修復すると成果が出やすい。',
  ];
  for (let i = 0; i < 24; i += 1) {
    const isUnson = i === 0;
    models.push({
      id: `fnd_model_t2_${String(i + 1).padStart(3, '0')}_v1`,
      status: isUnson ? 'draft' : 'adopted_unverified',
      prefix: isUnson ? 'fnd_unson_model' : 'sato_wm_20260928',
      text: t2Texts[i % t2Texts.length]!,
      hasApply: true,
      hasExclude: !isUnson,
      hasNumber: i % 4 === 0,
      hasCausal: true,
      outcomeCount: 0,
    });
  }
  // 91 T3 qualitative-only models
  for (let i = 0; i < 91; i += 1) {
    models.push({
      id: `fnd_model_t3_${String(i + 1).padStart(3, '0')}_v1`,
      status: 'adopted_unverified',
      prefix: 'sato_wm_20260928',
      text: `抽象的な定性一般則 #${i + 1}: 誠実に向き合う姿勢が長期的な成長につながる。`,
      hasApply: i % 3 === 0,
      hasExclude: false,
      hasNumber: false,
      hasCausal: i % 4 === 0,
      outcomeCount: 0,
    });
  }
  return models;
}

describe('RFC-003 world model revalidation queue', () => {
  it('detects primary telemetry sources and falls back to none_qualitative_only', () => {
    expect(detectTelemetrySources('人間の認知負荷と承認待ちを減らせる').sources).toEqual([
      'orca_needs_you_and_stalls',
    ]);
    expect(detectTelemetrySources('正本と証跡による判断品質の学習ループ').sources).toEqual([
      'brainbase_judgment_journal',
    ]);
    expect(detectTelemetrySources('再利用で開発時間を短縮し粗利率を上げる').sources).toEqual([
      'github_pr_evals',
      'finance_margin_ledger',
    ]);
    expect(detectTelemetrySources('RACI と決裁ルールで属人化を排除する').sources).toEqual([
      'brainbase_meeting_decisions',
    ]);
    expect(detectTelemetrySources('営業の商談で顧客からの信頼を得る').sources).toEqual([
      'sales_crm_pipeline',
    ]);
    expect(detectTelemetrySources('抽象的な心構えとして前向きに臨むことが大切である。').sources).toEqual([
      'none_qualitative_only',
    ]);
  });

  it('produces deterministic T1 > T2 > T3 ordering and lexical tie-breaking', () => {
    const fixtures: CatalogModelRecord[] = [
      {
        id: 'fnd_model_sato_world_model_20260928_wm_999_v1',
        status: 'adopted_unverified',
        prefix: 'sato_wm_20260928',
        text: '抽象的な心構えとして前向きに臨むことが大切である。',
        hasApply: true,
        hasExclude: false,
        hasNumber: false,
        hasCausal: false,
        outcomeCount: 0,
      },
      {
        id: 'fnd_model_sato_world_model_20260928_wm_126_v1',
        status: 'adopted_unverified',
        prefix: 'sato_wm_20260928',
        text: '関係性重視の営業では、信頼が切れた既存顧客を修復すると、プロダクト価値を実証しやすい。（適用条件: B2B; 除外条件: 新規市場）',
        hasApply: true,
        hasExclude: true,
        hasNumber: false,
        hasCausal: true,
        outcomeCount: 0,
      },
      {
        id: 'fnd_model_phi_human_decides_ai_runs_v3_c4',
        status: 'draft',
        prefix: 'fnd_model_phi',
        text: '既存基準・文脈・権限で代理判断し、NG理由と修正条件をAIへ返すことで、人間の認知負荷と承認待ちを減らせる。',
        hasApply: false,
        hasExclude: false,
        hasNumber: false,
        hasCausal: true,
        outcomeCount: 0,
      },
      {
        id: 'fnd_model_phi_ai_as_org_unit_v1_c2',
        status: 'draft',
        prefix: 'fnd_model_phi',
        text: '単発ツールとしてのAI運用では、職責・証跡・承認・継続改善への接続が不足する。',
        hasApply: false,
        hasExclude: false,
        hasNumber: false,
        hasCausal: true,
        outcomeCount: 0,
      },
    ];

    const queue = buildRevalidationQueue(fixtures, { topK: 4 });
    expect(queue.schemaVersion).toBe(WORLD_MODEL_REVALIDATION_QUEUE_SCHEMA_VERSION);
    expect(queue.totalModels).toBe(4);
    expect(queue.verifiedWithOutcomes).toBe(0);
    expect(queue.tierCounts).toEqual({
      T1_AUTO_TELEMETRY: 2,
      T2_REVIEW_PROMISE_CASE: 1,
      T3_LAZY_ON_CITATION: 1,
    });

    // Tied T1 models (both 81) break ties lexicographically by id
    expect(queue.topQueue[0]!.id).toBe('fnd_model_phi_ai_as_org_unit_v1_c2');
    expect(queue.topQueue[1]!.id).toBe('fnd_model_phi_human_decides_ai_runs_v3_c4');
    expect(queue.topQueue[0]!.priorityScore).toBe(81);
    expect(queue.topQueue[1]!.priorityScore).toBe(81);
    expect(queue.topQueue[2]!.tier).toBe('T2_REVIEW_PROMISE_CASE');
    expect(queue.topQueue[3]!.tier).toBe('T3_LAZY_ON_CITATION');
    expect(queue.topQueue[1]!.priorityScore).toBeGreaterThan(queue.topQueue[2]!.priorityScore);
    expect(queue.topQueue[2]!.priorityScore).toBeGreaterThan(queue.topQueue[3]!.priorityScore);
  });

  it('keeps priorityScore strictly bounded within 0..100 across extreme inputs', () => {
    const maxCandidate: CatalogModelRecord = {
      id: 'fnd_unson_model_max_v1',
      status: 'draft',
      prefix: 'fnd_unson_model',
      text: '再利用で開発時間を短縮し認知負荷を減らし正本の証跡でRACIと粗利率と営業成果を高める。',
      hasApply: true,
      hasExclude: true,
      hasNumber: true,
      hasCausal: true,
      outcomeCount: 0,
      downstreamImpactCount: 999,
    };
    const minCandidate: CatalogModelRecord = {
      id: 'fnd_model_min_v1',
      status: 'retired',
      prefix: 'other',
      text: '抽象的な心構え。',
      hasApply: false,
      hasExclude: false,
      hasNumber: false,
      hasCausal: false,
      outcomeCount: 5,
      downstreamImpactCount: -10,
    };

    const maxScored = classifyAndScoreModel(maxCandidate);
    const minScored = classifyAndScoreModel(minCandidate);

    expect(maxScored.breakdown).toEqual({
      observability: 35,
      leverage: 30,
      falsifiability: 20,
      freshnessOrDraftUrgency: 15,
    });
    expect(maxScored.priorityScore).toBe(100);
    expect(minScored.priorityScore).toBeGreaterThanOrEqual(0);
    expect(minScored.priorityScore).toBeLessThanOrEqual(100);
    expect(minScored.priorityScore).toBe(19);
  });

  it('adds downstreamImpactCount priority bonus capped at +6 and integrates with world-model-impact-index', () => {
    const baseRecord: CatalogModelRecord = {
      id: 'model-impact-base',
      status: 'adopted_unverified',
      prefix: 'sato_wm_20260928',
      text: '再利用により開発時間を短縮できる。',
      hasApply: true,
      hasExclude: false,
      hasNumber: false,
      hasCausal: true,
      outcomeCount: 0,
    };

    const impact0 = classifyAndScoreModel({ ...baseRecord, downstreamImpactCount: 0 });
    const impact1 = classifyAndScoreModel({ ...baseRecord, downstreamImpactCount: 1 });
    const impact2 = classifyAndScoreModel({ ...baseRecord, downstreamImpactCount: 2 });
    const impact3 = classifyAndScoreModel({ ...baseRecord, downstreamImpactCount: 3 });
    const impact20 = classifyAndScoreModel({ ...baseRecord, downstreamImpactCount: 20 });

    expect(impact1.breakdown.leverage - impact0.breakdown.leverage).toBe(2);
    expect(impact2.breakdown.leverage - impact0.breakdown.leverage).toBe(4);
    expect(impact3.breakdown.leverage - impact0.breakdown.leverage).toBe(MAX_DOWNSTREAM_IMPACT_BONUS);
    expect(impact20.breakdown.leverage - impact0.breakdown.leverage).toBe(MAX_DOWNSTREAM_IMPACT_BONUS);
    expect(impact20.priorityScore - impact0.priorityScore).toBe(MAX_DOWNSTREAM_IMPACT_BONUS);

    // Compatible with world-model-impact-index analyzeWorldModelImpact output
    const analysis = analyzeWorldModelImpact({
      changedRefs: [{ kind: 'model', id: 'model-impact-base' }],
      relations: [
        {
          relation: 'used_as_basis',
          source: { type: 'decision', id: 'dec-1' },
          target: { type: 'model', id: 'model-impact-base' },
        },
        {
          relation: 'used_as_basis',
          source: { type: 'decision', id: 'dec-2' },
          target: { type: 'model', id: 'model-impact-base' },
        },
      ],
    });
    const downstreamCount = downstreamImpactCountFromAnalysis(analysis);
    expect(downstreamCount).toBe(2);

    const queueWithMap = buildRevalidationQueue([baseRecord], {
      downstreamImpactCounts: new Map([['model-impact-base', downstreamCount]]),
    });
    expect(queueWithMap.topQueue[0]!.priorityScore).toBe(impact2.priorityScore);
  });

  it('implements Lazy Promotion from T3_LAZY_ON_CITATION to T2_REVIEW_PROMISE_CASE when citationCount30d >= 1', () => {
    const t3Unquoted: CatalogModelRecord = {
      id: 'fnd_model_t3_unquoted',
      status: 'adopted_unverified',
      prefix: 'sato_wm_20260928',
      text: '抽象的な心構えとして前向きに臨むことが大切である。',
      hasApply: true,
      hasExclude: false,
      hasNumber: false,
      hasCausal: false,
      outcomeCount: 0,
      citationCount30d: 0,
    };
    const t3Cited: CatalogModelRecord = {
      ...t3Unquoted,
      id: 'fnd_model_t3_cited',
      citationCount30d: 1,
    };
    const t1Cited: CatalogModelRecord = {
      id: 'fnd_model_t1_cited',
      status: 'draft',
      prefix: 'fnd_model_phi',
      text: '人間の認知負荷と承認待ちを減らせる。',
      hasApply: false,
      hasExclude: false,
      hasNumber: false,
      hasCausal: true,
      outcomeCount: 0,
      citationCount30d: 3,
    };

    const unquotedScored = classifyAndScoreModel(t3Unquoted);
    const citedScored = classifyAndScoreModel(t3Cited);
    const t1Scored = classifyAndScoreModel(t1Cited);

    expect(unquotedScored.tier).toBe('T3_LAZY_ON_CITATION');
    expect(unquotedScored.lazyPromoted).toBeUndefined();

    expect(citedScored.tier).toBe('T2_REVIEW_PROMISE_CASE');
    expect(citedScored.lazyPromoted).toBe(true);

    // T1 models stay T1 and are not marked lazyPromoted
    expect(t1Scored.tier).toBe('T1_AUTO_TELEMETRY');
    expect(t1Scored.lazyPromoted).toBeUndefined();

    const queue = buildRevalidationQueue([t3Unquoted, t3Cited, t1Cited], { topK: 5 });
    expect(queue.tierCounts).toEqual({
      T1_AUTO_TELEMETRY: 1,
      T2_REVIEW_PROMISE_CASE: 1,
      T3_LAZY_ON_CITATION: 1,
    });
    expect(renderRevalidationQueueText(queue)).toContain('[lazy-promoted]');
  });

  it('is strictly idempotent across re-runs and input permutations on a 151-model catalog', () => {
    const catalog151 = make151ModelCatalog();
    expect(catalog151).toHaveLength(151);

    const run1 = buildRevalidationQueue(catalog151, { topK: 15 });
    const run2 = buildRevalidationQueue(catalog151, { topK: 15 });
    const runReversed = buildRevalidationQueue([...catalog151].reverse(), { topK: 15 });

    expect(run1).toEqual(run2);
    expect(run1).toEqual(runReversed);
    expect(run1.totalModels).toBe(151);
    expect(run1.topQueue).toHaveLength(15);
    expect(run1.allScored).toHaveLength(151);
    expect(run1.tierCounts).toEqual({
      T1_AUTO_TELEMETRY: 36,
      T2_REVIEW_PROMISE_CASE: 24,
      T3_LAZY_ON_CITATION: 91,
    });
    for (let i = 1; i < run1.allScored.length; i += 1) {
      const prev = run1.allScored[i - 1]!;
      const curr = run1.allScored[i]!;
      expect(prev.priorityScore).toBeGreaterThanOrEqual(curr.priorityScore);
      if (prev.priorityScore === curr.priorityScore) {
        expect(prev.id.localeCompare(curr.id)).toBeLessThanOrEqual(0);
      }
      expect(curr.priorityScore).toBeGreaterThanOrEqual(0);
      expect(curr.priorityScore).toBeLessThanOrEqual(100);
    }
  });

  it('runs read-only CLI in JSON and human-readable modes without side effects', async () => {
    const dir = await makeTempDir();
    const catalogPath = join(dir, 'catalog.json');
    const models = make151ModelCatalog();
    const rawContent = JSON.stringify({
      counts: { model: models.length },
      models,
    }, null, 2);
    await writeFile(catalogPath, rawContent, 'utf8');

    const jsonCapture = captureIo();
    const jsonCode = await runCli(
      ['world-model:revalidation-queue', '--catalog', catalogPath, '--top', '5', '--json'],
      jsonCapture.io,
    );
    expect(jsonCode).toBe(0);
    expect(jsonCapture.stderr()).toBe('');

    const parsed = JSON.parse(jsonCapture.stdout()) as WorldModelRevalidationQueue;
    expect(parsed.schemaVersion).toBe(WORLD_MODEL_REVALIDATION_QUEUE_SCHEMA_VERSION);
    expect(parsed.totalModels).toBe(151);
    expect(parsed.topQueue).toHaveLength(5);
    expect(parsed.tierCounts).toEqual({
      T1_AUTO_TELEMETRY: 36,
      T2_REVIEW_PROMISE_CASE: 24,
      T3_LAZY_ON_CITATION: 91,
    });

    const textCapture = captureIo();
    const textCode = await runCli(
      ['world-model:revalidation-queue', '--catalog', catalogPath, '--top', '3'],
      textCapture.io,
    );
    expect(textCode).toBe(0);
    expect(textCapture.stderr()).toBe('');
    expect(textCapture.stdout()).toContain('World Model Revalidation Queue (world_model_revalidation_queue.v1)');
    expect(textCapture.stdout()).toContain('Total models: 151 | Verified with outcomes: 0');
    expect(textCapture.stdout()).toContain('Top 3:');
    expect(textCapture.stdout()).toContain(parsed.topQueue[0]!.id);

    // Strictly read-only: no files created and input file untouched
    expect(await readdir(dir)).toEqual(['catalog.json']);
    expect(await readFile(catalogPath, 'utf8')).toBe(rawContent);
  });

  it('fails loudly with non-zero exit code on missing/invalid CLI arguments or malformed catalog files', async () => {
    const dir = await makeTempDir();
    const validCatalog = join(dir, 'valid.json');
    await writeFile(validCatalog, JSON.stringify({ models: [] }), 'utf8');
    const brokenJson = join(dir, 'broken.json');
    await writeFile(brokenJson, '{not valid json', 'utf8');
    const badSchema = join(dir, 'bad-schema.json');
    await writeFile(badSchema, JSON.stringify({ models: [{ id: 'x' }] }), 'utf8');

    const cases: Array<{ argv: string[]; expectedError: RegExp }> = [
      {
        argv: ['world-model:revalidation-queue'],
        expectedError: /requires --catalog/u,
      },
      {
        argv: ['world-model:revalidation-queue', '--catalog'],
        expectedError: /requires --catalog/u,
      },
      {
        argv: ['world-model:revalidation-queue', '--catalog', join(dir, 'missing.json')],
        expectedError: /Failed to read catalog file/u,
      },
      {
        argv: ['world-model:revalidation-queue', '--catalog', brokenJson],
        expectedError: /Invalid JSON in catalog file/u,
      },
      {
        argv: ['world-model:revalidation-queue', '--catalog', badSchema],
        expectedError: /Invalid catalog model at index 0/u,
      },
      {
        argv: ['world-model:revalidation-queue', '--catalog', validCatalog, '--top', '0'],
        expectedError: /--top must be a positive integer/u,
      },
      {
        argv: ['world-model:revalidation-queue', '--catalog', validCatalog, '--top', 'abc'],
        expectedError: /--top must be a positive integer/u,
      },
      {
        argv: ['world-model:revalidation-queue', '--catalog', validCatalog, '--top', '--json'],
        expectedError: /--top requires a positive integer/u,
      },
    ];

    for (const testCase of cases) {
      const cap = captureIo();
      const code = await runCli(testCase.argv, cap.io);
      expect(code, `expected non-zero exit for ${testCase.argv.join(' ')}`).toBe(1);
      expect(cap.stderr()).toMatch(testCase.expectedError);
      expect(cap.stdout()).toBe('');
    }

    expect(() => parseCatalogModelsPayload({ notModels: [] })).toThrow(/Catalog JSON must be/u);
  });

  it('publishes ./world-model-revalidation-queue as a package subpath export', async () => {
    const repoRoot = process.cwd();
    const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; import: string }>;
    };
    expect(manifest.exports['./world-model-revalidation-queue']).toEqual({
      types: './dist/world-model-revalidation-queue.d.ts',
      import: './dist/world-model-revalidation-queue.js',
    });
    const distUrl = pathToFileURL(join(repoRoot, manifest.exports['./world-model-revalidation-queue']!.import)).href;
    const mod = await import(distUrl);
    expect(typeof mod.detectTelemetrySources).toBe('function');
    expect(typeof mod.classifyAndScoreModel).toBe('function');
    expect(typeof mod.buildRevalidationQueue).toBe('function');
  });
});
