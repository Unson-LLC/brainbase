import type {
  ConstraintDefinition,
  FoundationAcl,
  FoundationDefinition,
  FoundationRelationEndpoint,
  FoundationRelationId,
  FoundationRelationReference,
  ModelDefinition,
  ObjectiveDefinition,
} from './ontology-foundation.js';
import type { FoundationCatalog, FoundationCatalogRecord } from './types.js';
import type { JudgmentProblemReferenceKind, JudgmentProblemSnapshot } from './judgment-problem-snapshot.js';
import type {
  ImpactReviewAccessContext,
  ImpactReviewAffectedPlan,
  ImpactReviewChange,
  ImpactReviewIndexPort,
  ImpactReviewPlan,
  ImpactReviewPlanMatch,
  ImpactReviewReference,
  ImpactReviewRelationDomain,
  ImpactReviewRelationKind,
} from './company-os-impact-review.js';

/**
 * Deterministic reverse-dependency indexer for Brainbase world models.
 *
 * Traverses `FoundationCatalog` definitions and relations (`uses_as_input`,
 * `predicts`, `evaluated_by`, `used_as_basis`, `applies_to`, `contributes_to`,
 * `execution_depends_on`, `time_condition`), `JudgmentProblemSnapshot` bundles,
 * and active `ImpactReviewPlan` entries to enumerate models, objectives,
 * snapshots, and plans that need review when a variable, model, objective,
 * constraint, or method changes or is refuted.
 *
 * World models are allowed to contain feedback cycles; traversal tracks active
 * path ancestry and visited nodes so cyclic graphs always terminate cleanly
 * with deterministic shortest dependency paths.
 */
export const WORLD_MODEL_IMPACT_INDEX_VERSION = 'world-model-impact-index.v1' as const;

const DEFAULT_MAX_DEPTH = 64;

export type WorldModelImpactNodeKind =
  | FoundationRelationEndpoint
  | 'method'
  | 'dag'
  | 'plan';

export interface WorldModelImpactRef {
  readonly kind: WorldModelImpactNodeKind;
  readonly id: string;
  readonly revision?: string;
}

export type WorldModelDependencyRelation =
  | FoundationRelationId
  | 'adopted'
  | 'selected_method'
  | 'snapshot_reference'
  | 'plan_reference';

export interface WorldModelDependencyStep {
  readonly from: WorldModelImpactRef;
  readonly to: WorldModelImpactRef;
  readonly relation: WorldModelDependencyRelation;
  readonly domain: ImpactReviewRelationDomain;
}

export interface WorldModelAffectedItem {
  readonly status: 'needs_review';
  readonly affectedRef: WorldModelImpactRef;
  readonly sourceRef: WorldModelImpactRef;
  readonly dependencyPath: readonly WorldModelDependencyStep[];
  readonly depth: number;
  readonly reason: string;
}

export interface WorldModelImpactQueryInput {
  readonly catalog?: FoundationCatalog;
  readonly relations?: readonly FoundationRelationReference[];
  readonly snapshots?: readonly JudgmentProblemSnapshot[];
  readonly plans?: readonly ImpactReviewPlan[];
  readonly changedRefs: readonly WorldModelImpactRef[];
  readonly maxDepth?: number;
}

export interface WorldModelImpactAnalysis {
  readonly version: typeof WORLD_MODEL_IMPACT_INDEX_VERSION;
  readonly changedRefs: readonly WorldModelImpactRef[];
  readonly affectedItems: readonly WorldModelAffectedItem[];
  readonly affectedModels: readonly WorldModelAffectedItem[];
  readonly affectedObjectives: readonly WorldModelAffectedItem[];
  readonly affectedSnapshots: readonly WorldModelAffectedItem[];
  readonly affectedPlans: readonly WorldModelAffectedItem[];
  readonly cyclesDetected: number;
}

export interface WorldModelImpactIndexSource {
  readonly catalog?: FoundationCatalog;
  readonly relations?: readonly FoundationRelationReference[];
  readonly snapshots?: readonly JudgmentProblemSnapshot[];
  readonly plans: readonly ImpactReviewPlan[];
}

export interface WorldModelImpactIndexOptions {
  /** Static dataset or dynamic loader evaluated on each lookup. */
  readonly source:
    | WorldModelImpactIndexSource
    | (() => WorldModelImpactIndexSource | Promise<WorldModelImpactIndexSource>);
  /** Optional plan authorization predicate. Defaults to FoundationAcl read access. */
  readonly canReadPlan?: (
    plan: ImpactReviewPlan,
    access: ImpactReviewAccessContext,
    snapshot?: JudgmentProblemSnapshot,
  ) => boolean;
  readonly maxDepth?: number;
}

interface ImpactEdge {
  readonly from: WorldModelImpactRef;
  readonly to: WorldModelImpactRef;
  readonly relation: WorldModelDependencyRelation;
  readonly domain: ImpactReviewRelationDomain;
}

const SNAPSHOT_INDEXABLE_KINDS: ReadonlySet<JudgmentProblemReferenceKind> = new Set([
  'objective',
  'variable',
  'model',
  'constraint',
  'dag',
]);

/**
 * Formats a dependency path into a deterministic, human-readable trail suitable
 * for review reasons and `ImpactReviewPlanMatch.evidence`.
 */
export function formatWorldModelDependencyPath(path: readonly WorldModelDependencyStep[]): string {
  if (path.length === 0) return '';
  const parts: string[] = [formatRef(path[0]!.from)];
  for (const step of path) {
    parts.push(`--[${step.relation}]-->`, formatRef(step.to));
  }
  return parts.join(' ');
}

/**
 * Pure deterministic reverse-impact traversal over foundation definitions,
 * explicit foundation relations, judgment problem snapshots, and plans.
 */
export function analyzeWorldModelImpact(input: WorldModelImpactQueryInput): WorldModelImpactAnalysis {
  const maxDepth = normalizeMaxDepth(input.maxDepth);
  const changedRefs = normalizeChangedRefs(input.changedRefs);
  if (changedRefs.length === 0) {
    return {
      version: WORLD_MODEL_IMPACT_INDEX_VERSION,
      changedRefs: [],
      affectedItems: [],
      affectedModels: [],
      affectedObjectives: [],
      affectedSnapshots: [],
      affectedPlans: [],
      cyclesDetected: 0,
    };
  }

  const { adjacency, knownRevisions } = buildImpactGraph(input);
  const affectedItems: WorldModelAffectedItem[] = [];
  let cyclesDetected = 0;

  for (const seed of changedRefs) {
    const seedKey = nodeKey(seed.kind, seed.id);
    const seedRef = enrichRef(seed, knownRevisions);
    const visited = new Set<string>([seedKey]);
    const queue: Array<{
      readonly key: string;
      readonly path: readonly WorldModelDependencyStep[];
      readonly pathKeys: ReadonlySet<string>;
    }> = [{ key: seedKey, path: [], pathKeys: new Set([seedKey]) }];

    let head = 0;
    while (head < queue.length) {
      const current = queue[head]!;
      head += 1;
      if (current.path.length >= maxDepth) continue;

      const outgoing = adjacency.get(current.key);
      if (!outgoing || outgoing.length === 0) continue;

      for (const edge of outgoing) {
        const nextKey = nodeKey(edge.to.kind, edge.to.id);
        if (current.pathKeys.has(nextKey)) {
          cyclesDetected += 1;
          continue;
        }
        if (visited.has(nextKey)) {
          continue;
        }
        visited.add(nextKey);

        const step: WorldModelDependencyStep = {
          from: current.path.length === 0 ? seedRef : enrichRef(edge.from, knownRevisions),
          to: enrichRef(edge.to, knownRevisions),
          relation: edge.relation,
          domain: edge.domain,
        };
        const nextPath: readonly WorldModelDependencyStep[] = [...current.path, step];
        const affectedRef = step.to;
        affectedItems.push({
          status: 'needs_review',
          affectedRef,
          sourceRef: seedRef,
          dependencyPath: nextPath,
          depth: nextPath.length,
          reason: `needs_review: ${formatWorldModelDependencyPath(nextPath)}`,
        });

        const nextPathKeys = new Set(current.pathKeys);
        nextPathKeys.add(nextKey);
        queue.push({ key: nextKey, path: nextPath, pathKeys: nextPathKeys });
      }
    }
  }

  affectedItems.sort(compareAffectedItems);

  return {
    version: WORLD_MODEL_IMPACT_INDEX_VERSION,
    changedRefs,
    affectedItems,
    affectedModels: affectedItems.filter((item) => item.affectedRef.kind === 'model'),
    affectedObjectives: affectedItems.filter((item) => item.affectedRef.kind === 'objective'),
    affectedSnapshots: affectedItems.filter((item) => item.affectedRef.kind === 'judgment_problem'),
    affectedPlans: affectedItems.filter((item) => item.affectedRef.kind === 'plan'),
    cyclesDetected,
  };
}

/**
 * Concrete OSS implementation of `ImpactReviewIndexPort` backed by the
 * deterministic world-model reverse-dependency graph.
 */
export class WorldModelImpactIndex implements ImpactReviewIndexPort {
  private readonly loadSource: () => WorldModelImpactIndexSource | Promise<WorldModelImpactIndexSource>;
  private readonly canReadPlan: (
    plan: ImpactReviewPlan,
    access: ImpactReviewAccessContext,
    snapshot?: JudgmentProblemSnapshot,
  ) => boolean;
  private readonly maxDepth: number;

  constructor(options: WorldModelImpactIndexOptions) {
    if (!options || !options.source) {
      throw new TypeError('WorldModelImpactIndex requires a source');
    }
    const sourceOption = options.source;
    this.loadSource = typeof sourceOption === 'function' ? sourceOption : () => sourceOption;
    this.canReadPlan = options.canReadPlan ?? defaultCanReadPlan;
    this.maxDepth = normalizeMaxDepth(options.maxDepth);
  }

  async analyze(changedRefs: readonly WorldModelImpactRef[]): Promise<WorldModelImpactAnalysis> {
    const source = await this.loadSource();
    return analyzeWorldModelImpact({
      catalog: source.catalog,
      relations: source.relations,
      snapshots: source.snapshots,
      plans: source.plans,
      changedRefs,
      maxDepth: this.maxDepth,
    });
  }

  async findAffectedPlans(input: {
    readonly changes: readonly ImpactReviewChange[];
    readonly current_references: readonly ImpactReviewReference[];
    readonly access: ImpactReviewAccessContext;
  }): Promise<readonly ImpactReviewAffectedPlan[]> {
    const source = await this.loadSource();
    const snapshots = source.snapshots ?? [];
    const snapshotByKey = new Map<string, JudgmentProblemSnapshot>();
    for (const snapshot of snapshots) {
      snapshotByKey.set(snapshotRevisionKey(snapshot.problem_id, snapshot.revision), snapshot);
    }

    const authorizedPlans = source.plans.filter((plan) => {
      const snapshot = snapshotByKey.get(
        snapshotRevisionKey(plan.problem_snapshot.problem_id, plan.problem_snapshot.revision),
      );
      return this.canReadPlan(plan, input.access, snapshot);
    });
    if (authorizedPlans.length === 0 || input.changes.length === 0) {
      return [];
    }

    const authorizedSnapshots = snapshots.filter((snapshot) =>
      canReadAcl(snapshot.read_policy, input.access.principal),
    );
    const planById = new Map(authorizedPlans.map((plan) => [plan.plan_id, plan]));
    const matchesByPlan = new Map<string, ImpactReviewPlanMatch[]>();

    for (const change of input.changes) {
      const analysis = analyzeWorldModelImpact({
        catalog: source.catalog,
        relations: source.relations,
        snapshots: authorizedSnapshots,
        plans: authorizedPlans,
        changedRefs: [{
          kind: change.current.kind,
          id: change.current.id,
          revision: change.current.revision,
        }],
        maxDepth: this.maxDepth,
      });

      for (const item of analysis.affectedPlans) {
        const plan = planById.get(item.affectedRef.id);
        if (!plan) continue;
        const { domain, relation } = classifyPlanMatch(item.dependencyPath);
        const match: ImpactReviewPlanMatch = {
          change_id: change.change_id,
          relation,
          domain,
          evidence: formatWorldModelDependencyPath(item.dependencyPath),
        };
        const existing = matchesByPlan.get(plan.plan_id);
        if (existing) existing.push(match);
        else matchesByPlan.set(plan.plan_id, [match]);
      }
    }

    const results: ImpactReviewAffectedPlan[] = [];
    for (const [planId, matches] of matchesByPlan) {
      const plan = planById.get(planId);
      if (!plan) continue;
      results.push({
        plan: cloneJson(plan),
        matches: deduplicateMatches(matches),
      });
    }

    return results.sort((left, right) => left.plan.plan_id.localeCompare(right.plan.plan_id, 'en'));
  }
}

export function createWorldModelImpactIndex(options: WorldModelImpactIndexOptions): WorldModelImpactIndex {
  return new WorldModelImpactIndex(options);
}

function defaultCanReadPlan(
  plan: ImpactReviewPlan,
  access: ImpactReviewAccessContext,
  snapshot?: JudgmentProblemSnapshot,
): boolean {
  if (!canReadAcl(plan.read_policy, access.principal)) return false;
  if (snapshot && !canReadAcl(snapshot.read_policy, access.principal)) return false;
  return true;
}

function canReadAcl(acl: FoundationAcl, principal: string): boolean {
  return acl.visibility === 'public'
    || acl.ownerId === principal
    || acl.readerIds.includes(principal)
    || acl.writerIds.includes(principal);
}

function buildImpactGraph(input: WorldModelImpactQueryInput): {
  readonly adjacency: ReadonlyMap<string, readonly ImpactEdge[]>;
  readonly knownRevisions: ReadonlyMap<string, string>;
} {
  const edgeMap = new Map<string, ImpactEdge>();
  const knownRevisions = new Map<string, string>();

  const recordRevision = (ref: WorldModelImpactRef): void => {
    if (!ref.revision) return;
    const key = nodeKey(ref.kind, ref.id);
    const existing = knownRevisions.get(key);
    if (!existing || compareRevisionStrings(ref.revision, existing) > 0) {
      knownRevisions.set(key, ref.revision);
    }
  };

  const addEdge = (edge: ImpactEdge): void => {
    recordRevision(edge.from);
    recordRevision(edge.to);
    const dedupeKey = [
      nodeKey(edge.from.kind, edge.from.id),
      nodeKey(edge.to.kind, edge.to.id),
      edge.relation,
      edge.domain,
    ].join('\u0000');
    if (!edgeMap.has(dedupeKey)) {
      edgeMap.set(dedupeKey, edge);
    }
  };

  const snapshots = input.snapshots ?? [];
  const plans = input.plans ?? [];
  const pinnedRecordKeys = collectPinnedFoundationKeys(snapshots, plans);
  const catalog = input.catalog;
  const latestRecordsByLogical = new Map<string, FoundationCatalogRecord>();
  const definitionsById = new Map<string, FoundationDefinition[]>();

  if (catalog) {
    for (const record of catalog.records) {
      const def = record.definition;
      recordRevision({ kind: def.type, id: def.id, revision: def.revision });
      const logical = nodeKey(def.type, def.id);
      const previous = latestRecordsByLogical.get(logical);
      if (!previous || compareRevisionStrings(def.revision, previous.definition.revision) > 0) {
        latestRecordsByLogical.set(logical, record);
      }
      const list = definitionsById.get(def.id);
      if (list) list.push(def);
      else definitionsById.set(def.id, [def]);
    }

    const activeRecords = selectActiveCatalogRecords(catalog, latestRecordsByLogical, pinnedRecordKeys);
    const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.problem_id));
    const planIds = new Set(plans.map((plan) => plan.plan_id));

    for (const record of activeRecords) {
      const def = record.definition;
      if (def.type === 'model') {
        addModelDefinitionEdges(def, addEdge);
      } else if (def.type === 'objective') {
        addObjectiveDefinitionEdges(def, addEdge);
      } else if (def.type === 'constraint') {
        addConstraintDefinitionEdges(def, latestRecordsByLogical, snapshotIds, planIds, addEdge);
      }
    }
  }

  const allRelations: FoundationRelationReference[] = [
    ...(catalog?.relations ?? []),
    ...(input.relations ?? []),
  ];
  for (const relation of allRelations) {
    const edge = foundationRelationToImpactEdge(relation);
    if (edge) addEdge(edge);
  }

  for (const snapshot of snapshots) {
    const snapshotRef: WorldModelImpactRef = {
      kind: 'judgment_problem',
      id: snapshot.problem_id,
      revision: snapshot.revision,
    };
    recordRevision(snapshotRef);
    for (const ref of snapshot.references) {
      if (!SNAPSHOT_INDEXABLE_KINDS.has(ref.kind)) continue;
      addEdge({
        from: {
          kind: ref.kind as WorldModelImpactNodeKind,
          id: ref.id,
          revision: ref.revision,
        },
        to: snapshotRef,
        relation: 'snapshot_reference',
        domain: 'world_model',
      });
    }
  }

  for (const plan of plans) {
    const planRef: WorldModelImpactRef = { kind: 'plan', id: plan.plan_id };
    addEdge({
      from: {
        kind: 'judgment_problem',
        id: plan.problem_snapshot.problem_id,
        revision: plan.problem_snapshot.revision,
      },
      to: planRef,
      relation: 'plan_reference',
      domain: 'world_model',
    });

    if (plan.references) {
      for (const ref of plan.references) {
        const isMethod = ref.kind === 'method';
        addEdge({
          from: { kind: ref.kind, id: ref.id, revision: ref.revision },
          to: planRef,
          relation: isMethod ? 'selected_method' : 'adopted',
          domain: isMethod ? 'execution' : 'world_model',
        });
      }
    }
  }

  const adjacency = new Map<string, ImpactEdge[]>();
  for (const edge of edgeMap.values()) {
    const fromKey = nodeKey(edge.from.kind, edge.from.id);
    const list = adjacency.get(fromKey);
    if (list) list.push(edge);
    else adjacency.set(fromKey, [edge]);
  }
  for (const list of adjacency.values()) {
    list.sort(compareEdges);
  }

  return { adjacency, knownRevisions };
}

function collectPinnedFoundationKeys(
  snapshots: readonly JudgmentProblemSnapshot[],
  plans: readonly ImpactReviewPlan[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const snapshot of snapshots) {
    for (const ref of snapshot.references) {
      if (ref.kind === 'objective' || ref.kind === 'variable' || ref.kind === 'model' || ref.kind === 'constraint') {
        keys.add(`${nodeKey(ref.kind, ref.id)}@${ref.revision}`);
      }
    }
  }
  for (const plan of plans) {
    for (const ref of plan.references ?? []) {
      if (ref.kind === 'objective' || ref.kind === 'model' || ref.kind === 'constraint') {
        keys.add(`${nodeKey(ref.kind, ref.id)}@${ref.revision}`);
      }
    }
  }
  return keys;
}

function selectActiveCatalogRecords(
  catalog: FoundationCatalog,
  latestByLogical: ReadonlyMap<string, FoundationCatalogRecord>,
  pinnedRecordKeys: ReadonlySet<string>,
): readonly FoundationCatalogRecord[] {
  const selected = new Map<string, FoundationCatalogRecord>();
  for (const record of latestByLogical.values()) {
    const key = `${nodeKey(record.definition.type, record.definition.id)}@${record.definition.revision}`;
    selected.set(key, record);
  }
  for (const record of catalog.records) {
    const key = `${nodeKey(record.definition.type, record.definition.id)}@${record.definition.revision}`;
    if (pinnedRecordKeys.has(key)) {
      selected.set(key, record);
    }
  }
  return [...selected.values()];
}

function addModelDefinitionEdges(model: ModelDefinition, addEdge: (edge: ImpactEdge) => void): void {
  const modelRef: WorldModelImpactRef = { kind: 'model', id: model.id, revision: model.revision };
  for (const inputVar of model.inputVariableRefs) {
    addEdge({
      from: { kind: 'variable', id: inputVar.id, revision: inputVar.revision },
      to: modelRef,
      relation: 'uses_as_input',
      domain: 'world_model',
    });
  }
  for (const outputVar of model.outputVariableRefs) {
    addEdge({
      from: modelRef,
      to: { kind: 'variable', id: outputVar.id, revision: outputVar.revision },
      relation: 'predicts',
      domain: 'world_model',
    });
  }
}

function addObjectiveDefinitionEdges(objective: ObjectiveDefinition, addEdge: (edge: ImpactEdge) => void): void {
  const objectiveRef: WorldModelImpactRef = { kind: 'objective', id: objective.id, revision: objective.revision };
  for (const criterion of objective.criteria) {
    addEdge({
      from: { kind: 'variable', id: criterion.variableRef.id, revision: criterion.variableRef.revision },
      to: objectiveRef,
      relation: 'evaluated_by',
      domain: 'world_model',
    });
  }
}

function addConstraintDefinitionEdges(
  constraint: ConstraintDefinition,
  latestByLogical: ReadonlyMap<string, FoundationCatalogRecord>,
  snapshotIds: ReadonlySet<string>,
  planIds: ReadonlySet<string>,
  addEdge: (edge: ImpactEdge) => void,
): void {
  const constraintRef: WorldModelImpactRef = { kind: 'constraint', id: constraint.id, revision: constraint.revision };
  for (const targetId of constraint.appliesTo) {
    for (const record of latestByLogical.values()) {
      if (record.definition.id === targetId && record.definition.id !== constraint.id) {
        addEdge({
          from: constraintRef,
          to: { kind: record.definition.type, id: record.definition.id, revision: record.definition.revision },
          relation: 'applies_to',
          domain: 'world_model',
        });
      }
    }
    if (snapshotIds.has(targetId)) {
      addEdge({
        from: constraintRef,
        to: { kind: 'judgment_problem', id: targetId },
        relation: 'applies_to',
        domain: 'world_model',
      });
    }
    if (planIds.has(targetId)) {
      addEdge({
        from: constraintRef,
        to: { kind: 'plan', id: targetId },
        relation: 'applies_to',
        domain: 'world_model',
      });
    }
  }
}

function foundationRelationToImpactEdge(relation: FoundationRelationReference): ImpactEdge | null {
  const source: WorldModelImpactRef = {
    kind: relation.source.type,
    id: relation.source.id,
    ...(relation.source.revision ? { revision: relation.source.revision } : {}),
  };
  const target: WorldModelImpactRef = {
    kind: relation.target.type,
    id: relation.target.id,
    ...(relation.target.revision ? { revision: relation.target.revision } : {}),
  };

  switch (relation.relation) {
    // Model uses Variable as input => Variable change impacts Model.
    case 'uses_as_input':
      return { from: target, to: source, relation: 'uses_as_input', domain: 'world_model' };
    // Model predicts Variable => Model change/refutation impacts predicted Variable.
    case 'predicts':
      return { from: source, to: target, relation: 'predicts', domain: 'world_model' };
    // Objective is evaluated by Variable => Variable change impacts Objective.
    case 'evaluated_by':
      return { from: target, to: source, relation: 'evaluated_by', domain: 'world_model' };
    // Constraint applies to Target => Constraint change impacts Target.
    case 'applies_to':
      return { from: source, to: target, relation: 'applies_to', domain: 'world_model' };
    // Decision / JudgmentProblem used Target as basis => Target change impacts Decision / JudgmentProblem.
    case 'used_as_basis':
      return { from: target, to: source, relation: 'used_as_basis', domain: 'world_model' };
    // Story / Objective contributes to Objective => Objective change impacts contributing Story / Objective.
    case 'contributes_to':
      return { from: target, to: source, relation: 'contributes_to', domain: 'world_model' };
    // Story execution depends on Story / Objective => Target change impacts Story.
    case 'execution_depends_on':
      return { from: target, to: source, relation: 'execution_depends_on', domain: 'execution' };
    // Story time condition tied to Objective => Objective change impacts Story schedule.
    case 'time_condition':
      return { from: target, to: source, relation: 'time_condition', domain: 'execution' };
    default:
      return null;
  }
}

function classifyPlanMatch(path: readonly WorldModelDependencyStep[]): {
  readonly domain: ImpactReviewRelationDomain;
  readonly relation: ImpactReviewRelationKind;
} {
  if (path.some((step) => step.relation === 'selected_method')) {
    return { domain: 'execution', relation: 'selected_method' };
  }
  if (path.some((step) => step.relation === 'execution_depends_on')) {
    return { domain: 'execution', relation: 'execution_depends_on' };
  }
  for (const step of path) {
    if (step.relation === 'predicts' || step.relation === 'uses_as_input' || step.relation === 'applies_to') {
      return { domain: 'world_model', relation: step.relation };
    }
  }
  return { domain: 'world_model', relation: 'adopted' };
}

function deduplicateMatches(matches: readonly ImpactReviewPlanMatch[]): ImpactReviewPlanMatch[] {
  const map = new Map<string, ImpactReviewPlanMatch>();
  for (const match of matches) {
    const key = `${match.change_id}\u0000${match.domain}\u0000${match.relation}\u0000${match.evidence}`;
    if (!map.has(key)) map.set(key, match);
  }
  return [...map.values()].sort((left, right) =>
    `${left.change_id}\u0000${left.domain}\u0000${left.relation}\u0000${left.evidence}`.localeCompare(
      `${right.change_id}\u0000${right.domain}\u0000${right.relation}\u0000${right.evidence}`,
      'en',
    ),
  );
}

function normalizeChangedRefs(refs: readonly WorldModelImpactRef[]): WorldModelImpactRef[] {
  const map = new Map<string, WorldModelImpactRef>();
  for (const ref of refs) {
    if (!ref || typeof ref.id !== 'string' || ref.id.trim() === '' || typeof ref.kind !== 'string' || ref.kind.trim() === '') {
      continue;
    }
    const normalized: WorldModelImpactRef = {
      kind: ref.kind,
      id: ref.id.trim(),
      ...(ref.revision && ref.revision.trim() !== '' ? { revision: ref.revision.trim() } : {}),
    };
    const key = `${nodeKey(normalized.kind, normalized.id)}@${normalized.revision ?? ''}`;
    if (!map.has(key)) map.set(key, normalized);
  }
  return [...map.values()].sort(compareRefs);
}

function normalizeMaxDepth(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError('maxDepth must be a positive integer');
  }
  return value;
}

function enrichRef(ref: WorldModelImpactRef, knownRevisions: ReadonlyMap<string, string>): WorldModelImpactRef {
  if (ref.revision) {
    return { kind: ref.kind, id: ref.id, revision: ref.revision };
  }
  const known = knownRevisions.get(nodeKey(ref.kind, ref.id));
  return known ? { kind: ref.kind, id: ref.id, revision: known } : { kind: ref.kind, id: ref.id };
}

function nodeKey(kind: string, id: string): string {
  return JSON.stringify([kind, id]);
}

function snapshotRevisionKey(problemId: string, revision: string): string {
  return JSON.stringify([problemId, revision]);
}

function formatRef(ref: WorldModelImpactRef): string {
  return ref.revision ? `${ref.kind}/${ref.id}@${ref.revision}` : `${ref.kind}/${ref.id}`;
}

function compareRefs(left: WorldModelImpactRef, right: WorldModelImpactRef): number {
  return left.kind.localeCompare(right.kind, 'en')
    || left.id.localeCompare(right.id, 'en')
    || (left.revision ?? '').localeCompare(right.revision ?? '', 'en');
}

function compareEdges(left: ImpactEdge, right: ImpactEdge): number {
  return compareRefs(left.to, right.to)
    || left.relation.localeCompare(right.relation, 'en')
    || left.domain.localeCompare(right.domain, 'en');
}

function compareAffectedItems(left: WorldModelAffectedItem, right: WorldModelAffectedItem): number {
  return compareRefs(left.affectedRef, right.affectedRef)
    || (left.depth - right.depth)
    || compareRefs(left.sourceRef, right.sourceRef)
    || left.reason.localeCompare(right.reason, 'en');
}

function compareRevisionStrings(left: string, right: string): number {
  if (/^\d+$/u.test(left) && /^\d+$/u.test(right)) {
    const l = BigInt(left);
    const r = BigInt(right);
    return l < r ? -1 : l > r ? 1 : 0;
  }
  return left.localeCompare(right, 'en');
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
