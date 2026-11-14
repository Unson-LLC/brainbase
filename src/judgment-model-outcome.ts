import { createHash } from 'node:crypto';

import type { JudgmentFrameCatalog } from './judgment-frame.js';

/**
 * Judgment outcome feedback for world models (brainbase-project ADR-014 F6).
 *
 * After a judgment that used a world model as a prediction, the observed
 * result is appended as a separate record bound to the model's id and
 * revision. The model itself (revision, validationState, adoptionState) is
 * never changed here: adoption and promotion stay human decisions.
 *
 * Records are checked structurally against the current catalog. Whether a
 * verdict is semantically right is not judged. A refutation must explain why
 * measurement error, execution difference, and external change were ruled
 * out, so a prediction gap alone is never recorded as a refutation.
 */
export const JUDGMENT_MODEL_OUTCOME_RECORD_VERSION = 'judgment-model-outcome.v1' as const;

export type JudgmentModelOutcomeVerdict = 'supports' | 'refutes' | 'inconclusive';
export type JudgmentModelOutcomeEvidenceKind = 'artifact' | 'query' | 'document' | 'judgment';
export const JUDGMENT_MODEL_OUTCOME_ALTERNATIVES = ['measurement_error', 'execution_difference', 'external_change'] as const;
export type JudgmentModelOutcomeAlternative = typeof JUDGMENT_MODEL_OUTCOME_ALTERNATIVES[number];

const VERDICTS: readonly JudgmentModelOutcomeVerdict[] = ['supports', 'refutes', 'inconclusive'];
const EVIDENCE_KINDS: readonly JudgmentModelOutcomeEvidenceKind[] = ['artifact', 'query', 'document', 'judgment'];
const MAX_STATEMENT = 2_000;
const MAX_RULED_OUT = 1_000;
const MAX_EVIDENCE = 12;
const MAX_EVIDENCE_REF = 800;
const MAX_EVIDENCE_LABEL = 200;
const MAX_REFUTED_WHEN = 3;
const MAX_REFUTED_WHEN_TEXT = 120;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

export interface JudgmentModelOutcomeEvidenceRef {
  readonly kind: JudgmentModelOutcomeEvidenceKind;
  readonly ref: string;
  readonly label: string;
}

export interface JudgmentModelOutcome {
  readonly record_version: typeof JUDGMENT_MODEL_OUTCOME_RECORD_VERSION;
  readonly model: { readonly id: string; readonly revision: string };
  readonly verdict: JudgmentModelOutcomeVerdict;
  /** What the judgment predicted from this model for this case. */
  readonly prediction: string;
  /** What was actually observed. */
  readonly observed: string;
  /** Facility, period, and state under which the result holds. */
  readonly conditions: string;
  readonly evidence_refs: readonly JudgmentModelOutcomeEvidenceRef[];
  /** Required only for refutes: why each alternative explanation was ruled out. */
  readonly ruled_out?: Readonly<Record<JudgmentModelOutcomeAlternative, string>>;
  readonly judgment_ref?: { readonly frame_digest: `sha256:${string}` };
}

/** A record as the host stored it: the outcome plus host-owned id, time, and content digest. */
export interface JudgmentModelOutcomeStoredRecord extends JudgmentModelOutcome {
  readonly id: string;
  readonly recorded_at: string;
  readonly digest: `sha256:${string}`;
}

export interface JudgmentModelOutcomeSummary {
  readonly supports: number;
  readonly refutes: number;
  readonly inconclusive: number;
  /** Conditions of the most recent refutations, newest first. */
  readonly refuted_when: readonly string[];
}

export type JudgmentModelOutcomeIssueCode =
  | 'outcome_record_invalid'
  | 'outcome_catalog_mismatch'
  | 'outcome_model_unknown'
  | 'outcome_not_model'
  | 'outcome_revision_mismatch'
  | 'outcome_ruled_out_missing'
  | 'outcome_ruled_out_unexpected'
  | 'outcome_evidence_missing'
  | 'outcome_text_unsafe';

export interface JudgmentModelOutcomeIssue {
  readonly code: JudgmentModelOutcomeIssueCode;
  readonly path: string;
  readonly message: string;
}

export type JudgmentModelOutcomeValidation =
  | { readonly valid: true; readonly issues: readonly []; readonly outcome: JudgmentModelOutcome }
  | { readonly valid: false; readonly issues: readonly JudgmentModelOutcomeIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`;
}

/** Digest of the outcome content. Host-owned id and time are not part of it. */
export function judgmentModelOutcomeDigest(outcome: JudgmentModelOutcome): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(outcomeContent(outcome)), 'utf8').digest('hex')}`;
}

function outcomeContent(value: JudgmentModelOutcome): JudgmentModelOutcome {
  return {
    record_version: value.record_version,
    model: { id: value.model.id, revision: value.model.revision },
    verdict: value.verdict,
    prediction: value.prediction,
    observed: value.observed,
    conditions: value.conditions,
    evidence_refs: value.evidence_refs.map(({ kind, ref, label }) => ({ kind, ref, label })),
    ...(value.ruled_out === undefined ? {} : {
      ruled_out: Object.fromEntries(JUDGMENT_MODEL_OUTCOME_ALTERNATIVES.map((key) => [key, value.ruled_out![key]])) as Record<JudgmentModelOutcomeAlternative, string>,
    }),
    ...(value.judgment_ref === undefined ? {} : { judgment_ref: { frame_digest: value.judgment_ref.frame_digest } }),
  };
}

type IssueSink = (code: JudgmentModelOutcomeIssueCode, path: string, message: string) => void;

function checkText(value: unknown, path: string, max: number, issue: IssueSink, unsafe: (text: string) => boolean): value is string {
  if (!nonEmpty(value, max)) {
    issue('outcome_record_invalid', path, `${path} must be a non-empty string of at most ${max} characters`);
    return false;
  }
  if (CONTROL_CHARACTERS.test(value)) {
    issue('outcome_text_unsafe', path, `${path} contains control characters`);
    return false;
  }
  if (unsafe(value)) {
    issue('outcome_text_unsafe', path, `${path} contains a credential-like value`);
    return false;
  }
  return true;
}

/** Structural checks shared by new input and stored records. Catalog checks are separate. */
function checkOutcomeShape(value: Record<string, unknown>, issue: IssueSink, unsafe: (text: string) => boolean): void {
  if (value.record_version !== JUDGMENT_MODEL_OUTCOME_RECORD_VERSION) {
    issue('outcome_record_invalid', 'record_version', `record_version must be ${JUDGMENT_MODEL_OUTCOME_RECORD_VERSION}`);
  }
  const model = isRecord(value.model) ? value.model : null;
  if (!model || !nonEmpty(model.id, 1_000) || !nonEmpty(model.revision, 64)) {
    issue('outcome_record_invalid', 'model', 'model needs id and revision');
  }
  if (!VERDICTS.includes(value.verdict as JudgmentModelOutcomeVerdict)) {
    issue('outcome_record_invalid', 'verdict', 'verdict must be supports, refutes, or inconclusive');
  }
  checkText(value.prediction, 'prediction', MAX_STATEMENT, issue, unsafe);
  checkText(value.observed, 'observed', MAX_STATEMENT, issue, unsafe);
  checkText(value.conditions, 'conditions', MAX_STATEMENT, issue, unsafe);

  const evidence = Array.isArray(value.evidence_refs) ? value.evidence_refs : null;
  if (!evidence || evidence.length === 0) {
    issue('outcome_evidence_missing', 'evidence_refs', 'an outcome needs at least one evidence reference');
  } else if (evidence.length > MAX_EVIDENCE) {
    issue('outcome_record_invalid', 'evidence_refs', `evidence_refs allows at most ${MAX_EVIDENCE} entries`);
  } else {
    evidence.forEach((entry, index) => {
      const path = `evidence_refs[${index}]`;
      if (!isRecord(entry) || !EVIDENCE_KINDS.includes(entry.kind as JudgmentModelOutcomeEvidenceKind)) {
        issue('outcome_record_invalid', `${path}.kind`, 'evidence kind must be artifact, query, document, or judgment');
        return;
      }
      checkText(entry.ref, `${path}.ref`, MAX_EVIDENCE_REF, issue, unsafe);
      checkText(entry.label, `${path}.label`, MAX_EVIDENCE_LABEL, issue, unsafe);
    });
  }

  if (value.verdict === 'refutes') {
    const ruledOut = isRecord(value.ruled_out) ? value.ruled_out : null;
    for (const key of JUDGMENT_MODEL_OUTCOME_ALTERNATIVES) {
      if (!ruledOut || ruledOut[key] === undefined) {
        issue('outcome_ruled_out_missing', `ruled_out.${key}`, `a refutation must say why ${key} does not explain the gap`);
      } else {
        checkText(ruledOut[key], `ruled_out.${key}`, MAX_RULED_OUT, issue, unsafe);
      }
    }
    for (const key of Object.keys(ruledOut ?? {})) {
      if (!JUDGMENT_MODEL_OUTCOME_ALTERNATIVES.includes(key as JudgmentModelOutcomeAlternative)) {
        issue('outcome_record_invalid', `ruled_out.${key}`, 'ruled_out contains an unknown field');
      }
    }
  } else if (value.ruled_out !== undefined) {
    issue('outcome_ruled_out_unexpected', 'ruled_out', 'ruled_out is only for refutes');
  }

  if (value.judgment_ref !== undefined) {
    const ref = isRecord(value.judgment_ref) ? value.judgment_ref : null;
    if (!ref || typeof ref.frame_digest !== 'string' || !DIGEST_PATTERN.test(ref.frame_digest) || Object.keys(ref).length !== 1) {
      issue('outcome_record_invalid', 'judgment_ref', 'judgment_ref needs only frame_digest as sha256');
    }
  }
}

/**
 * Validate a new outcome against the catalog shown on this turn. The model
 * must be a world model in the catalog, at its current revision.
 */
export function validateJudgmentModelOutcome(
  value: unknown,
  catalog: JudgmentFrameCatalog,
  unsafe: (text: string) => boolean = () => false,
): JudgmentModelOutcomeValidation {
  const issues: JudgmentModelOutcomeIssue[] = [];
  const issue: IssueSink = (code, path, message) => issues.push({ code, path, message });
  if (!isRecord(value)) {
    issue('outcome_record_invalid', '$', 'outcome must be an object');
    return { valid: false, issues };
  }
  if (value.catalog_digest !== catalog.digest) {
    issue('outcome_catalog_mismatch', 'catalog_digest', 'catalog_digest does not match the current catalog');
  }
  checkOutcomeShape(value, issue, unsafe);
  const model = isRecord(value.model) ? value.model : {};
  if (typeof model.id === 'string') {
    const item = catalog.items.find((candidate) => candidate.id === model.id);
    if (!item) {
      issue('outcome_model_unknown', 'model.id', `${model.id} is not in the catalog`);
    } else if (item.kind !== 'model') {
      issue('outcome_not_model', 'model.id', `${model.id} is a ${item.kind}; outcomes are recorded only for world models`);
    } else if (model.revision !== item.revision) {
      issue('outcome_revision_mismatch', 'model.revision', `${model.id} is at revision ${item.revision}, not ${String(model.revision)}`);
    }
  }
  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, issues: [], outcome: outcomeContent(value as unknown as JudgmentModelOutcome) };
}

/**
 * Parse records returned by the host store. A malformed record or a content
 * digest mismatch is an error, never skipped silently.
 */
export function parseJudgmentModelOutcomeRecords(
  values: readonly unknown[],
): { readonly ok: true; readonly records: readonly JudgmentModelOutcomeStoredRecord[] } | { readonly ok: false; readonly index: number; readonly message: string } {
  const records: JudgmentModelOutcomeStoredRecord[] = [];
  for (const [index, value] of values.entries()) {
    if (!isRecord(value) || !nonEmpty(value.id, 200) || !nonEmpty(value.recorded_at, 64)
      || Number.isNaN(Date.parse(value.recorded_at)) || typeof value.digest !== 'string' || !DIGEST_PATTERN.test(value.digest)) {
      return { ok: false, index, message: 'stored outcome needs id, recorded_at, and digest' };
    }
    const issues: JudgmentModelOutcomeIssue[] = [];
    checkOutcomeShape(value, (code, path, message) => issues.push({ code, path, message }), () => false);
    if (issues.length > 0) return { ok: false, index, message: `${issues[0].path}: ${issues[0].message}` };
    const content = outcomeContent(value as unknown as JudgmentModelOutcome);
    if (judgmentModelOutcomeDigest(content) !== value.digest) {
      return { ok: false, index, message: 'stored outcome digest does not match its content' };
    }
    records.push({ ...content, id: value.id, recorded_at: value.recorded_at, digest: value.digest as `sha256:${string}` });
  }
  return { ok: true, records };
}

/**
 * Count outcomes per world model at its current catalog revision. Outcomes
 * recorded against an older revision are not counted: whether a refutation
 * still holds after a revision is a separate judgment.
 */
export function summarizeJudgmentModelOutcomes(
  records: readonly JudgmentModelOutcomeStoredRecord[],
  catalog: JudgmentFrameCatalog,
): ReadonlyMap<string, JudgmentModelOutcomeSummary> {
  const current = new Map(catalog.items.filter((item) => item.kind === 'model').map((item) => [item.id, item.revision]));
  const grouped = new Map<string, JudgmentModelOutcomeStoredRecord[]>();
  for (const record of records) {
    if (current.get(record.model.id) !== record.model.revision) continue;
    grouped.set(record.model.id, [...(grouped.get(record.model.id) ?? []), record]);
  }
  const summaries = new Map<string, JudgmentModelOutcomeSummary>();
  for (const [id, group] of grouped) {
    const refutations = group
      .filter((record) => record.verdict === 'refutes')
      .sort((left, right) => Date.parse(right.recorded_at) - Date.parse(left.recorded_at) || right.id.localeCompare(left.id));
    summaries.set(id, {
      supports: group.filter((record) => record.verdict === 'supports').length,
      refutes: refutations.length,
      inconclusive: group.filter((record) => record.verdict === 'inconclusive').length,
      refuted_when: refutations.slice(0, MAX_REFUTED_WHEN).map((record) => clip(record.conditions, MAX_REFUTED_WHEN_TEXT)),
    });
  }
  return summaries;
}
