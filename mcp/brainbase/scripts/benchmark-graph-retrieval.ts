#!/usr/bin/env npx tsx

/**
 * Run the checked-in Graph retrieval implementation against a saved snapshot.
 *
 * This is intentionally a benchmark harness, not a production command.  It
 * reads corpus/questions/plans from explicit paths (or --artifact-dir), invokes
 * retrieveGraph and embedTexts, and writes the result to explicit paths. Gold
 * labels are used only after retrieval has returned.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  embedTexts,
} from '../src/retrieval/embedding.js';
import {
  retrieveGraph,
  type GraphEdge,
  type GraphNode,
  type RetrievalCandidate,
  type RetrievalPlan,
  type RetrieveGraphResult,
} from '../src/retrieval/engine.js';

type JsonRecord = Record<string, unknown>;
type Question = {
  id: string;
  query: string;
  kind: string;
  gold: string[];
  absence_confirmed?: boolean;
};

const TOP_KS = [1, 5, 10, 20] as const;

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function readJson(path: string): Promise<{ value: any; sha256: string }> {
  const data = await readFile(path);
  return { value: JSON.parse(data.toString('utf8')), sha256: sha256(data) };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim();
}

function activeNode(node: GraphNode): boolean {
  const values = [node.lifecycle_state, node.lifecycle_status, node.semantic_state, node.payload?.lifecycle_state, node.payload?.lifecycle_status, node.payload?.status, node.payload?.state, node.payload?.semantic_state];
  return !values.some(value => typeof value === 'string' && ['retired', 'merged', 'inactive', 'superseded'].includes(value.trim().toLowerCase()));
}

function activeDecision(node: GraphNode): boolean {
  return node.entity_type === 'decision' && node.lifecycle_status === 'active' && activeNode(node);
}

function activeProject(node: GraphNode): boolean {
  return node.entity_type === 'project' && node.lifecycle_status === 'active' && activeNode(node);
}

function exactProject(scopeName: string, projects: GraphNode[]): GraphNode | undefined {
  const wanted = normalize(scopeName);
  return projects.find(project => {
    const payload = project.payload || {};
    return [payload.name, payload.code].some(value => typeof value === 'string' && normalize(value) === wanted);
  });
}

function resolvePlan(scopeName: string, projects: GraphNode[]): { plan?: RetrievalPlan; resolution: JsonRecord } {
  const exact = exactProject(scopeName, projects);
  if (exact) {
    return {
      plan: { seed_ids: [exact.id], steps: [{ relation: 'belongs_to_project', direction: 'incoming', target_type: 'decision' }] },
      resolution: { scope_name: scopeName, project_id: exact.id, method: 'exact_name_or_code', cosine: null },
    };
  }
  return { resolution: { scope_name: scopeName, project_id: null, method: 'unresolved', cosine: null } };
}

function idsAt(candidateResults: RetrievalCandidate[], k: number): string[] {
  return candidateResults.slice(0, k).map(candidate => candidate.id);
}

function metrics(candidateResults: RetrievalCandidate[], gold: string[], assessed: boolean): JsonRecord {
  if (!assessed) {
    return { assessed: false, reason: 'negative_or_unconfirmed_query; correctness and abstention are not assessed', recall_at: {}, precision_at: {} };
  }
  const goldSet = new Set(gold);
  const recallAt: JsonRecord = {};
  const precisionAt: JsonRecord = {};
  for (const k of TOP_KS) {
    const ids = idsAt(candidateResults, k);
    const hits = new Set(ids.filter(id => goldSet.has(id))).size;
    recallAt[String(k)] = goldSet.size ? hits / goldSet.size : 0;
    precisionAt[String(k)] = hits / k;
  }
  return { assessed: true, recall_at: recallAt, precision_at: precisionAt };
}

function resultEvidence(candidate: RetrievalCandidate): JsonRecord {
  const evidence = (candidate.evidence || {}) as Record<string, unknown>;
  const present = Object.keys(evidence).filter(key => evidence[key] !== undefined && evidence[key] !== null && evidence[key] !== '');
  const bodyPresent = present.filter(key => ['content', 'statement', 'decision', 'rationale', 'body'].includes(key));
  return {
    body_fields_present: bodyPresent,
    source_pointer_present: present.includes('source_pointer'),
    provenance_present: present.includes('provenance'),
  };
}

function candidateJson(candidate: RetrievalCandidate): JsonRecord {
  return {
    id: candidate.id,
    score: candidate.score,
    paths: candidate.paths,
    evidence_presence: resultEvidence(candidate),
  };
}

function relationPlanFor(question: Question, plans: JsonRecord): JsonRecord | undefined {
  const value = plans[question.id];
  return isRecord(value) ? value : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const artifactDir = argValue(args, '--artifact-dir');
  const pathArg = (flag: string, artifactName: string): string => {
    const explicit = argValue(args, flag);
    if (explicit) return resolve(explicit);
    if (artifactDir) return resolve(artifactDir, artifactName);
    throw new Error(`Missing ${flag}; provide it explicitly or provide --artifact-dir`);
  };
  const corpusPath = pathArg('--corpus', 'corpus.json');
  const questionsPath = pathArg('--questions', 'questions.json');
  const plansPath = pathArg('--plans', 'plans.json');
  const outputPath = pathArg('--output', 'implementation-results.json');
  const reportPath = pathArg('--report', 'report.md');
  const noEdgesOnly = hasFlag(args, '--no-edges-only');

  const [corpusDoc, questionsDoc, plansDoc] = await Promise.all([readJson(corpusPath), readJson(questionsPath), readJson(plansPath)]);
  const corpus = corpusDoc.value as JsonRecord;
  const questions = ((questionsDoc.value.questions || []) as Question[]).map(question => ({
    ...question,
    id: String(question.id),
    query: String(question.query),
    kind: String(question.kind),
    gold: (question.gold || []).map(String),
  }));
  const planDefinitions = (plansDoc.value || {}) as JsonRecord;
  const allNodes = (corpus.entities || []) as GraphNode[];
  const allEdges = (corpus.edges || []) as GraphEdge[];
  const decisions = allNodes.filter(activeDecision);
  const projects = allNodes.filter(activeProject);
  // The benchmark candidate population is deliberately bounded to active
  // decisions.  Active project nodes are included only so an explicit plan can
  // resolve its seed and traverse the real edge into decisions.
  const retrievalNodes = [...decisions, ...projects];
  const decisionIds = new Set(decisions.map(node => node.id));
  const graphCoverage: 'complete' | 'partial' | 'unknown' = 'partial';

  const embeddingCalls: JsonRecord[] = [];
  const embeddingCache = new Map<string, number[][]>();
  const benchmarkEmbed = async (texts: string[], kind: 'query' | 'passage'): Promise<number[][]> => {
    const key = `${kind}\n${JSON.stringify(texts)}`;
    const cached = embeddingCache.get(key);
    if (cached) {
      embeddingCalls.push({ kind, count: texts.length, cache: 'hit', elapsed_ms: 0 });
      return cached;
    }
    const started = performance.now();
    const vectors = await embedTexts(texts, kind);
    embeddingCache.set(key, vectors);
    embeddingCalls.push({ kind, count: texts.length, cache: 'miss', elapsed_ms: performance.now() - started });
    return vectors;
  };

  const methods = [
    { name: 'implementation_graph', edges: allEdges, enabled: true },
    { name: 'implementation_graph_no_edges', edges: [] as GraphEdge[], enabled: !noEdgesOnly },
  ];
  const questionResults: JsonRecord = {};
  const summaryRows: JsonRecord[] = [];

  for (const question of questions) {
    const planDefinition = relationPlanFor(question, planDefinitions);
    let plan: RetrievalPlan | undefined;
    let planResolution: JsonRecord | undefined;
    if (question.kind === 'relation_set' && planDefinition) {
      const scopeName = typeof planDefinition.scope_name === 'string' ? planDefinition.scope_name : '';
      const resolved = resolvePlan(scopeName, projects);
      plan = resolved.plan;
      planResolution = resolved.resolution;
    }

    const methodResults: JsonRecord = {};
    for (const method of methods) {
      if (!method.enabled) continue;
      const started = performance.now();
      const retrieved: RetrieveGraphResult = await retrieveGraph({
        query: question.query,
        nodes: retrievalNodes,
        edges: method.edges,
        embed: benchmarkEmbed,
        top_k: 100,
        ...(plan ? { plan } : {}),
        coverage: graphCoverage,
      });
      const elapsed = performance.now() - started;
      const candidates = retrieved.candidates.filter(candidate => decisionIds.has(candidate.id));
      const assessed = question.kind !== 'unconfirmed' && question.kind !== 'retired_control';
      const topIds: JsonRecord = {};
      for (const k of TOP_KS) topIds[`top${k}`] = idsAt(candidates, k);
      const row: JsonRecord = {
        top_ids: topIds,
        results: candidates.slice(0, Math.max(...TOP_KS)).map(candidateJson),
        metrics: metrics(candidates, question.gold, assessed),
        coverage: retrieved.coverage,
        sufficiency: retrieved.sufficiency,
        lookup_ms: elapsed,
        candidate_count_before_decision_filter: retrieved.candidates.length,
        graph_edges_used: method.edges.length,
      };
      if (planResolution) row.plan_resolution = planResolution;
      methodResults[method.name] = row;
      const recallAt = row.metrics && isRecord(row.metrics) && isRecord(row.metrics.recall_at) ? row.metrics.recall_at : {};
      summaryRows.push({ question_id: question.id, method: method.name, kind: question.kind, recall_at_1: recallAt['1'] ?? null, top1: topIds.top1, candidate_count: candidates.length, sufficiency: retrieved.sufficiency });
    }
    questionResults[question.id] = {
      query: question.query,
      kind: question.kind,
      gold: question.gold,
      absence_confirmed: question.absence_confirmed,
      plan: plan || null,
      plan_resolution: planResolution || null,
      methods: methodResults,
    };
  }

  const output: JsonRecord = {
    protocol_version: 'implementation-retrieval-2026-09-09.v1',
    generated_at: new Date().toISOString(),
    inputs: {
      corpus_path: corpusPath,
      questions_path: questionsPath,
      plans_path: plansPath,
      corpus_sha256: corpusDoc.sha256,
      questions_sha256: questionsDoc.sha256,
      plans_sha256: plansDoc.sha256,
      snapshot_id: corpus.snapshot_id || null,
      declared_hash: corpus.hash || null,
    },
    implementation: {
      retrieve_graph: 'mcp/brainbase/src/retrieval/engine.ts',
      embed_texts: 'mcp/brainbase/src/retrieval/embedding.ts',
      embedding_model_id: EMBEDDING_MODEL_ID,
      embedding_model_revision: EMBEDDING_MODEL_REVISION,
      candidate_filter: { entity_type: 'decision', lifecycle_status: 'active', count: decisions.length },
      retrieval_node_count: retrievalNodes.length,
      graph_coverage: graphCoverage,
      no_edges_ablation: true,
      embedding_calls: embeddingCalls,
    },
    counts: { corpus_entities: allNodes.length, corpus_edges: allEdges.length, active_decisions: decisions.length, active_projects: projects.length, questions: questions.length },
    questions: questionResults,
    summary_rows: summaryRows,
  };

  const reportLines = [
    '# Implementation graph retrieval benchmark',
    '',
    `- Corpus: ${allNodes.length} entities / ${allEdges.length} edges; active decisions: ${decisions.length}.`,
    `- Inputs: corpus ${corpusDoc.sha256}, questions ${questionsDoc.sha256}, plans ${plansDoc.sha256}.`,
    `- Implementation: ${EMBEDDING_MODEL_ID}@${EMBEDDING_MODEL_REVISION}; actual retrieveGraph + embedTexts.`,
    '- Candidate output is filtered to active decision nodes after retrieval; retired controls are excluded.',
    '- q13/q14 use the fixed incoming `belongs_to_project` plan. The no-edge ablation must return no relation-set members.',
    '- q15/q16 retain retrieval but correctness and abstention are not scored; q15 absence is not confirmed.',
    '- `coverage` is `partial` for this saved scoped snapshot. `sufficiency` is the engine signal, not entailment.',
    '',
    '## Top-1 and relation-set check',
    '',
    '| Question | Method | Top-1 | Recall@1 | Candidates | Sufficiency |',
    '|---|---|---|---:|---:|---|',
    ...summaryRows.map(row => `| ${row.question_id} | ${row.method} | ${(Array.isArray(row.top1) ? row.top1 : []).join(', ') || '(none)'} | ${row.recall_at_1 === null ? 'n/a' : row.recall_at_1} | ${row.candidate_count} | ${row.sufficiency} |`),
    '',
    'Evidence fields in the JSON are presence observations from the engine response. They do not establish source quality, applicability, or answer sufficiency.',
    '',
  ];
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8'),
    writeFile(reportPath, reportLines.join('\n'), 'utf8'),
  ]);
  console.log(JSON.stringify({ output: outputPath, report: reportPath, active_decisions: decisions.length, questions: questions.length }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
