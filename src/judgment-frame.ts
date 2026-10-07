import { createHash } from 'node:crypto';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Judgment frame (brainbase-project ADR-014).
 *
 * A judgment-bearing turn selects the philosophy, objectives, and world models
 * that bear on the decision from a compact catalog, and records how each
 * selected reference was used for each option. The catalog is small enough to
 * show in full; the record is checked structurally, never for semantic quality.
 *
 * Status is a label, not a gate: draft objectives and unverified models stay
 * usable. Only superseded or inactive records are excluded from the catalog.
 */
export const JUDGMENT_FRAME_CATALOG_VERSION = 'judgment-frame-catalog.v1' as const;
export const JUDGMENT_FRAME_RECORD_VERSION = 'judgment-frame-record.v1' as const;

export type JudgmentFrameKind = 'philosophy' | 'objective' | 'model';
export type JudgmentFrameStatus = 'active' | 'draft' | 'adopted_unverified' | 'verified';
export type JudgmentFrameRole = 'constraint' | 'criterion' | 'prediction';
export type JudgmentFrameConstraintVerdict = 'satisfied' | 'violated' | 'tension';

/** Each kind is used in exactly one way inside an option evaluation. */
export const JUDGMENT_FRAME_ROLE_BY_KIND: Readonly<Record<JudgmentFrameKind, JudgmentFrameRole>> = Object.freeze({
  philosophy: 'constraint',
  objective: 'criterion',
  model: 'prediction',
});

const KINDS: readonly JudgmentFrameKind[] = ['philosophy', 'objective', 'model'];
const MAX_TEXT = 400;
const MAX_APPLIES_WHEN = 160;
const MAX_NOTE = 2_000;
const MAX_SELECTIONS = 24;
const MAX_OPTIONS = 8;
const MAX_USES = 32;

export interface JudgmentFrameSourceRecord {
  readonly id: string;
  readonly entity_type: string;
  readonly version?: number | string;
  readonly lifecycle_status?: string;
  readonly payload?: Record<string, unknown>;
}

export interface JudgmentFrameCatalogItem {
  readonly id: string;
  readonly kind: JudgmentFrameKind;
  readonly revision: string;
  readonly status: JudgmentFrameStatus;
  readonly text: string;
  readonly applies_when?: string;
}

export interface JudgmentFrameCatalog {
  readonly catalog_version: typeof JUDGMENT_FRAME_CATALOG_VERSION;
  readonly digest: `sha256:${string}`;
  readonly items: readonly JudgmentFrameCatalogItem[];
}

export interface JudgmentFrameExclusion {
  readonly id: string;
  readonly reason: 'inactive' | 'superseded' | 'restates_source_philosophy' | 'missing_text' | 'unsupported_type';
}

export interface JudgmentFrameCatalogBuild {
  readonly catalog: JudgmentFrameCatalog;
  readonly excluded: readonly JudgmentFrameExclusion[];
}

export interface JudgmentFrameSelection {
  readonly ref: string;
  readonly kind: JudgmentFrameKind;
  readonly why: string;
}

export interface JudgmentFrameUse {
  readonly ref: string;
  readonly role: JudgmentFrameRole;
  readonly note: string;
  /** Required for constraint uses: how the option stands against the philosophy. */
  readonly verdict?: JudgmentFrameConstraintVerdict;
}

export interface JudgmentFrameOption {
  readonly label: string;
  readonly uses: readonly JudgmentFrameUse[];
}

export interface JudgmentFrameRecord {
  readonly record_version: typeof JUDGMENT_FRAME_RECORD_VERSION;
  readonly catalog_digest: string;
  readonly selections: readonly JudgmentFrameSelection[];
  /** Why no reference of a kind applies. Required for each kind without a selection. */
  readonly none?: Partial<Record<JudgmentFrameKind, string>>;
  readonly options: readonly JudgmentFrameOption[];
  readonly chosen_option: string;
}

export type JudgmentFrameIssueCode =
  | 'frame_record_invalid'
  | 'frame_catalog_mismatch'
  | 'frame_ref_unknown'
  | 'frame_kind_mismatch'
  | 'frame_selection_duplicate'
  | 'frame_kind_unaddressed'
  | 'frame_kind_contradiction'
  | 'frame_use_unselected'
  | 'frame_role_mismatch'
  | 'frame_verdict_missing'
  | 'frame_selection_unused'
  | 'frame_chosen_unknown';

export interface JudgmentFrameIssue {
  readonly code: JudgmentFrameIssueCode;
  readonly path: string;
  readonly message: string;
}

/** Exceptions that ADR-014 F5 returns to a human. The host decides when they block. */
export type JudgmentFrameEscalationCode =
  | 'objective_unanchored'
  | 'chosen_violates_philosophy'
  | 'chosen_philosophy_tension';

export interface JudgmentFrameEscalation {
  readonly code: JudgmentFrameEscalationCode;
  readonly refs: readonly string[];
}

export interface JudgmentFrameValidation {
  readonly valid: boolean;
  readonly issues: readonly JudgmentFrameIssue[];
  readonly escalations: readonly JudgmentFrameEscalation[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const nonEmpty = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function itemText(kind: JudgmentFrameKind, payload: Record<string, unknown>): string | undefined {
  const foundation = isRecord(payload.foundation) ? payload.foundation : {};
  if (kind === 'philosophy') {
    const statement = text(payload.statement) ?? text(foundation.meaning);
    const name = text(payload.display_name) ?? text(payload.title);
    if (!statement) return undefined;
    return name && name !== statement ? `${name}：${statement}` : statement;
  }
  if (kind === 'objective') return text(foundation.desiredState) ?? text(foundation.meaning) ?? text(payload.statement);
  return text(foundation.meaning) ?? text(payload.statement) ?? text(payload.title);
}

function itemStatus(kind: JudgmentFrameKind, payload: Record<string, unknown>): JudgmentFrameStatus {
  const foundation = isRecord(payload.foundation) ? payload.foundation : {};
  if (kind === 'model') {
    if (foundation.validationState === 'verified') return 'verified';
    if (foundation.adoptionState === 'approved') return 'adopted_unverified';
    return 'draft';
  }
  const state = text(foundation.adoptionState) ?? text(payload.status);
  return state === 'active' || state === 'approved' ? 'active' : 'draft';
}

function isSuperseded(payload: Record<string, unknown>): boolean {
  const foundation = isRecord(payload.foundation) ? payload.foundation : {};
  return [payload.status, foundation.adoptionState, foundation.lifecycle]
    .some((value) => typeof value === 'string' && /^(superseded|retired|rejected)/.test(value));
}

/**
 * Build the compact catalog shown to the model on a judgment-bearing turn.
 * Excluded records are returned with a reason so a shrinking catalog is visible.
 */
export function buildJudgmentFrameCatalog(records: readonly JudgmentFrameSourceRecord[]): JudgmentFrameCatalogBuild {
  const philosophyIds = new Set(records.filter((record) => record.entity_type === 'philosophy').map((record) => record.id));
  const items: JudgmentFrameCatalogItem[] = [];
  const excluded: JudgmentFrameExclusion[] = [];
  for (const record of records) {
    const kind = KINDS.find((candidate) => candidate === record.entity_type);
    if (!kind) {
      excluded.push({ id: record.id, reason: 'unsupported_type' });
      continue;
    }
    const payload = isRecord(record.payload) ? record.payload : {};
    if (record.lifecycle_status !== undefined && record.lifecycle_status !== 'active') {
      excluded.push({ id: record.id, reason: 'inactive' });
      continue;
    }
    if (isSuperseded(payload)) {
      excluded.push({ id: record.id, reason: 'superseded' });
      continue;
    }
    const decomposition = isRecord(payload.decomposition) ? payload.decomposition : {};
    const sourcePin = isRecord(decomposition.sourcePin) ? decomposition.sourcePin : {};
    if (kind === 'philosophy' && typeof sourcePin.id === 'string' && sourcePin.id !== record.id && philosophyIds.has(sourcePin.id)) {
      excluded.push({ id: record.id, reason: 'restates_source_philosophy' });
      continue;
    }
    const body = itemText(kind, payload);
    if (!body) {
      excluded.push({ id: record.id, reason: 'missing_text' });
      continue;
    }
    const foundation = isRecord(payload.foundation) ? payload.foundation : {};
    const appliesWhen = kind === 'model' ? text(payload.applicability_text) : undefined;
    items.push({
      id: record.id,
      kind,
      revision: text(foundation.revision) ?? String(record.version ?? '1'),
      status: itemStatus(kind, payload),
      text: clip(body, MAX_TEXT),
      ...(appliesWhen ? { applies_when: clip(appliesWhen, MAX_APPLIES_WHEN) } : {}),
    });
  }
  items.sort((left, right) => KINDS.indexOf(left.kind) - KINDS.indexOf(right.kind) || left.id.localeCompare(right.id));
  const digest = `sha256:${createHash('sha256').update(canonicalJson(items)).digest('hex')}` as const;
  return { catalog: { catalog_version: JUDGMENT_FRAME_CATALOG_VERSION, digest, items }, excluded };
}

const KIND_HEADINGS: Readonly<Record<JudgmentFrameKind, string>> = {
  philosophy: '哲学（constraintとして使う。verdictを付ける）',
  objective: '目的（criterionとして使う）',
  model: '世界モデル（predictionとして使う。仮説であり、検証済みとは限らない）',
};

/** One line per item, grouped by kind, for the model-facing prompt. */
export function renderJudgmentFrameCatalog(catalog: JudgmentFrameCatalog): string {
  const lines = [`judgment frame catalog ${catalog.digest}`];
  for (const kind of KINDS) {
    lines.push('', `## ${KIND_HEADINGS[kind]}`);
    for (const item of catalog.items.filter((candidate) => candidate.kind === kind)) {
      lines.push(`- ${item.id} [${item.status}] ${item.text}${item.applies_when ? `（適用：${item.applies_when}）` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * Check that a frame record only uses catalog references and that every
 * selection is used in at least one option with the role of its kind.
 */
export function validateJudgmentFrameRecord(value: unknown, catalog: JudgmentFrameCatalog): JudgmentFrameValidation {
  const issues: JudgmentFrameIssue[] = [];
  const issue = (code: JudgmentFrameIssueCode, path: string, message: string) => issues.push({ code, path, message });
  if (!isRecord(value) || value.record_version !== JUDGMENT_FRAME_RECORD_VERSION) {
    issue('frame_record_invalid', '$', `record_version must be ${JUDGMENT_FRAME_RECORD_VERSION}`);
    return { valid: false, issues, escalations: [] };
  }
  if (value.catalog_digest !== catalog.digest) {
    issue('frame_catalog_mismatch', 'catalog_digest', 'catalog_digest does not match the catalog shown on this turn');
  }
  const byId = new Map(catalog.items.map((item) => [item.id, item]));

  const selections = Array.isArray(value.selections) ? value.selections : null;
  if (!selections || selections.length > MAX_SELECTIONS) {
    issue('frame_record_invalid', 'selections', `selections must be a list of at most ${MAX_SELECTIONS}`);
  }
  const selected = new Map<string, JudgmentFrameKind>();
  (selections ?? []).forEach((selection, index) => {
    const path = `selections[${index}]`;
    if (!isRecord(selection) || !nonEmpty(selection.ref, 1_000) || !nonEmpty(selection.why, MAX_NOTE)
      || !KINDS.includes(selection.kind as JudgmentFrameKind)) {
      issue('frame_record_invalid', path, 'selection needs ref, kind, and why');
      return;
    }
    const item = byId.get(selection.ref);
    if (!item) {
      issue('frame_ref_unknown', `${path}.ref`, `${selection.ref} is not in the catalog`);
      return;
    }
    if (item.kind !== selection.kind) {
      issue('frame_kind_mismatch', `${path}.kind`, `${selection.ref} is a ${item.kind}, not a ${String(selection.kind)}`);
      return;
    }
    if (selected.has(selection.ref)) {
      issue('frame_selection_duplicate', `${path}.ref`, `${selection.ref} is selected twice`);
      return;
    }
    selected.set(selection.ref, item.kind);
  });

  const none = isRecord(value.none) ? value.none : {};
  for (const kind of KINDS) {
    const hasSelection = [...selected.values()].includes(kind);
    const reason = none[kind];
    if (hasSelection && reason !== undefined) {
      issue('frame_kind_contradiction', `none.${kind}`, `${kind} has both a selection and a none reason`);
    } else if (!hasSelection && !nonEmpty(reason, MAX_NOTE)) {
      issue('frame_kind_unaddressed', `none.${kind}`, `select a ${kind} or give the reason none applies`);
    }
  }

  const options = Array.isArray(value.options) ? value.options : null;
  if (!options || options.length === 0 || options.length > MAX_OPTIONS) {
    issue('frame_record_invalid', 'options', `options must list 1 to ${MAX_OPTIONS} evaluated options`);
  }
  const used = new Set<string>();
  const labels = new Set<string>();
  (options ?? []).forEach((option, optionIndex) => {
    const path = `options[${optionIndex}]`;
    if (!isRecord(option) || !nonEmpty(option.label, 400) || !Array.isArray(option.uses) || option.uses.length > MAX_USES) {
      issue('frame_record_invalid', path, `option needs a label and at most ${MAX_USES} uses`);
      return;
    }
    labels.add(option.label);
    option.uses.forEach((use, useIndex) => {
      const usePath = `${path}.uses[${useIndex}]`;
      if (!isRecord(use) || !nonEmpty(use.ref, 1_000) || !nonEmpty(use.note, MAX_NOTE)) {
        issue('frame_record_invalid', usePath, 'use needs ref, role, and note');
        return;
      }
      const kind = selected.get(use.ref);
      if (!kind) {
        issue('frame_use_unselected', `${usePath}.ref`, `${use.ref} is used but not selected`);
        return;
      }
      if (use.role !== JUDGMENT_FRAME_ROLE_BY_KIND[kind]) {
        issue('frame_role_mismatch', `${usePath}.role`, `a ${kind} is used as ${JUDGMENT_FRAME_ROLE_BY_KIND[kind]}`);
        return;
      }
      if (use.role === 'constraint' && !['satisfied', 'violated', 'tension'].includes(use.verdict as string)) {
        issue('frame_verdict_missing', `${usePath}.verdict`, 'a constraint use needs verdict satisfied, violated, or tension');
        return;
      }
      used.add(use.ref);
    });
  });
  for (const ref of selected.keys()) {
    if (!used.has(ref)) issue('frame_selection_unused', 'selections', `${ref} is selected but not used for any option`);
  }

  const chosen = (options ?? []).find((option) => isRecord(option) && option.label === value.chosen_option);
  if (!nonEmpty(value.chosen_option, 400) || !labels.has(value.chosen_option)) {
    issue('frame_chosen_unknown', 'chosen_option', 'chosen_option must name one of the option labels');
  }

  const escalations: JudgmentFrameEscalation[] = [];
  if (![...selected.values()].includes('objective') && nonEmpty(none.objective, MAX_NOTE)) {
    escalations.push({ code: 'objective_unanchored', refs: [] });
  }
  const chosenUses: unknown[] = isRecord(chosen) && Array.isArray(chosen.uses) ? chosen.uses : [];
  if (chosenUses.length > 0) {
    const verdictRefs = (verdict: JudgmentFrameConstraintVerdict) => chosenUses
      .filter((use): use is Record<string, unknown> => isRecord(use) && use.role === 'constraint' && use.verdict === verdict)
      .map((use) => String(use.ref));
    const violated = verdictRefs('violated');
    const tension = verdictRefs('tension');
    if (violated.length > 0) escalations.push({ code: 'chosen_violates_philosophy', refs: violated });
    if (tension.length > 0) escalations.push({ code: 'chosen_philosophy_tension', refs: tension });
  }
  return { valid: issues.length === 0, issues, escalations };
}

// ---------------------------------------------------------------------------
// MCP tools. The host injects how Graph records are read; these definitions
// and the validation stay shared so every host enforces the same contract.

const FRAME_PAGE_LIMIT = 500;

const frameUseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', minLength: 1, maxLength: 1_000 },
    role: { type: 'string', enum: ['constraint', 'criterion', 'prediction'] },
    note: { type: 'string', minLength: 1, maxLength: MAX_NOTE },
    verdict: { type: 'string', enum: ['satisfied', 'violated', 'tension'], description: 'Required when role is constraint.' },
  },
  required: ['ref', 'role', 'note'],
};

export const judgmentFrameTools: Tool[] = [{
  name: 'brainbase_judgment_frame_catalog',
  description: 'On a judgment-bearing turn, read the catalog of philosophy, objectives, and world models visible to you. Select only what bears on this decision. Status is a label (draft objectives and adopted_unverified models are still usable as hypotheses); it is not a reason to skip them. Then call brainbase_judgment_frame_record with the returned catalog_digest.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, {
  name: 'brainbase_judgment_frame_record',
  description: 'Record the judgment frame: which catalog references you selected and why, and for each evaluated option how each selected reference was used. Philosophy is a constraint (give verdict satisfied, violated, or tension), an objective is a criterion, a world model is a prediction. Every selection must be used by at least one option. For a kind with no applicable reference, give the reason in none instead of selecting. Name the option you chose. The tool rejects references outside the catalog; it does not judge semantic quality. If escalations are returned, ask the human before acting on the chosen option.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      record_version: { type: 'string', const: JUDGMENT_FRAME_RECORD_VERSION },
      catalog_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      selections: {
        type: 'array',
        maxItems: MAX_SELECTIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ref: { type: 'string', minLength: 1, maxLength: 1_000 },
            kind: { type: 'string', enum: [...KINDS] },
            why: { type: 'string', minLength: 1, maxLength: MAX_NOTE },
          },
          required: ['ref', 'kind', 'why'],
        },
      },
      none: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(KINDS.map((kind) => [kind, { type: 'string', minLength: 1, maxLength: MAX_NOTE }])),
      },
      options: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_OPTIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 400 },
            uses: { type: 'array', maxItems: MAX_USES, items: frameUseSchema },
          },
          required: ['label', 'uses'],
        },
      },
      chosen_option: { type: 'string', minLength: 1, maxLength: 400 },
    },
    required: ['record_version', 'catalog_digest', 'selections', 'options', 'chosen_option'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
}];

export type JudgmentFrameRecordsPage =
  | { readonly status: 'ok'; readonly records: readonly JudgmentFrameSourceRecord[] }
  | { readonly status: 'unavailable' | 'error'; readonly code: string; readonly message: string };

export interface JudgmentFrameToolDependencies {
  /** Read every record of one kind visible to the caller, at most `limit`. */
  readonly loadRecords: (kind: JudgmentFrameKind, limit: number) => Promise<JudgmentFrameRecordsPage>;
}

export type JudgmentFrameToolResult =
  | { readonly status: 'ok'; readonly data: Record<string, unknown> }
  | { readonly status: 'unavailable' | 'error'; readonly error: { code: string; message: string; details?: unknown } };

const toolError = (status: 'unavailable' | 'error', code: string, message: string, details?: unknown): JudgmentFrameToolResult => ({
  status, error: { code, message, ...(details === undefined ? {} : { details }) },
});

async function loadFrameCatalog(dependencies: JudgmentFrameToolDependencies): Promise<JudgmentFrameCatalogBuild | JudgmentFrameToolResult> {
  const records: JudgmentFrameSourceRecord[] = [];
  for (const kind of KINDS) {
    let page: JudgmentFrameRecordsPage;
    try {
      page = await dependencies.loadRecords(kind, FRAME_PAGE_LIMIT);
    } catch (error) {
      return toolError('unavailable', 'judgment_frame_catalog_unavailable', `Graph ${kind} records could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (page.status !== 'ok') return toolError(page.status, page.code, page.message);
    // A full page may be truncated; a silently shorter catalog would hide references.
    if (page.records.length >= FRAME_PAGE_LIMIT) {
      return toolError('error', 'judgment_frame_catalog_truncated', `Graph returned ${page.records.length} ${kind} records; the catalog may be incomplete`);
    }
    records.push(...page.records);
  }
  return buildJudgmentFrameCatalog(records);
}

export async function handleJudgmentFrameToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: JudgmentFrameToolDependencies,
): Promise<JudgmentFrameToolResult | null> {
  if (name !== 'brainbase_judgment_frame_catalog' && name !== 'brainbase_judgment_frame_record') return null;
  if (name === 'brainbase_judgment_frame_catalog' && Object.keys(args).length > 0) {
    return toolError('error', 'judgment_frame_catalog_input_invalid', 'brainbase_judgment_frame_catalog takes no arguments');
  }
  const loaded = await loadFrameCatalog(dependencies);
  if ('status' in loaded) return loaded;
  const { catalog, excluded } = loaded;
  if (name === 'brainbase_judgment_frame_catalog') {
    return {
      status: 'ok',
      data: {
        schema_version: 'brainbase-judgment-frame-catalog-v1',
        catalog_digest: catalog.digest,
        counts: Object.fromEntries(KINDS.map((kind) => [kind, catalog.items.filter((item) => item.kind === kind).length])),
        excluded_count: excluded.length,
        catalog: renderJudgmentFrameCatalog(catalog),
      },
    };
  }
  const validation = validateJudgmentFrameRecord(args, catalog);
  if (!validation.valid) {
    return toolError('error', 'judgment_frame_invalid', 'The judgment frame does not match the catalog contract', {
      issues: validation.issues,
      current_catalog_digest: catalog.digest,
    });
  }
  return {
    status: 'ok',
    data: {
      schema_version: 'brainbase-judgment-frame-v1',
      catalog_digest: catalog.digest,
      selections: (args.selections as Array<{ ref: string; kind: string }>).map(({ ref, kind }) => ({ ref, kind })),
      option_count: (args.options as unknown[]).length,
      chosen_option: args.chosen_option,
      escalations: validation.escalations,
    },
  };
}

export {
  judgmentFrameReadTools,
  handleJudgmentFrameReadToolCall,
} from './judgment-frame-read.js';
export type {
  JudgmentFrameReadDependencies,
  JudgmentFrameReadRecord,
} from './judgment-frame-read.js';
