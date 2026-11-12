// Frame evidence a Host keeps for one turn. It persists references and
// digests, never Graph bodies, option labels, or the reasons the model wrote.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type JudgmentFrameEvidenceKind = 'philosophy' | 'objective' | 'model';
export type JudgmentFrameEvidenceRole = 'constraint' | 'criterion' | 'prediction';

export interface JudgmentFrameReadEvidence {
  catalog_digest: string;
  records: Array<{
    kind: JudgmentFrameEvidenceKind;
    ref: string;
    body_digest: string;
    version: string;
    version_source: string;
    applicability_scope_source: string;
  }>;
}

export interface JudgmentFrameApplicationEvidence {
  selections: Array<{ kind: unknown; ref: unknown }>;
  chosen_option_digest: string | null;
  applications: Array<{
    kind: JudgmentFrameEvidenceKind;
    ref: string;
    role: JudgmentFrameEvidenceRole;
    note_digest: string;
    verdict?: string;
  }>;
  non_applicability: Array<{ kind: JudgmentFrameEvidenceKind; reason_digest: string }>;
  application_complete: boolean;
}

/** The fields of a Host event this module reads. Other fields are ignored. */
export interface JudgmentFrameEvidenceEvent {
  event_kind?: unknown;
  success?: unknown;
  safe_metadata?: unknown;
}

// Tool inputs and outputs arrive from the model and the server untyped; every
// field is checked before it is trusted.
type Loose = any;

const roles: Record<JudgmentFrameEvidenceKind, JudgmentFrameEvidenceRole> = {
  philosophy: 'constraint', objective: 'criterion', model: 'prediction',
};
const kinds = Object.keys(roles) as JudgmentFrameEvidenceKind[];
const verdicts = ['satisfied', 'violated', 'tension'];
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const validDigest = (value: unknown): value is string => /^sha256:[a-f0-9]{64}$/u.test(String(value));
const key = (item: Loose) => `${item?.kind}:${item?.ref}`;
const lastIndexOf = (events: readonly Loose[], kind: string) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.success && events[index].event_kind === kind) return index;
  }
  return -1;
};

/** Digest-only evidence of a frame_read result, or null when the result does not answer the request. */
export function frameReadMetadata(value: unknown, input: unknown): JudgmentFrameReadEvidence | null {
  const result = value as Loose;
  const request = input as Loose;
  if (result?.schema_version !== 'brainbase-judgment-frame-read-v1'
    || !validDigest(result.catalog_digest) || result.catalog_digest !== request?.catalog_digest
    || !Array.isArray(result.records) || !Array.isArray(request?.selections)
    || result.records.length === 0 || result.records.length !== request.selections.length
    || result.records.length > 24) return null;
  const requested = new Set<string>(request.selections.map(key));
  if (requested.size !== request.selections.length) return null;
  const records: JudgmentFrameReadEvidence['records'] = [];
  for (const item of result.records as Loose[]) {
    if (!Object.hasOwn(roles, item?.kind) || !text(item.ref) || !requested.delete(key(item))
      || !text(item.body) || item.body_digest !== digest(item.body)
      || !text(item.version) || !text(item.applicability_scope)
      || !['graph', 'body_digest'].includes(item.version_source)
      || !['graph', 'unspecified'].includes(item.applicability_scope_source)
      || (item.version_source === 'body_digest' && item.version !== item.body_digest)) return null;
    records.push({
      kind: item.kind, ref: item.ref, body_digest: item.body_digest,
      version: item.version, version_source: item.version_source,
      applicability_scope_source: item.applicability_scope_source,
    });
  }
  return { catalog_digest: result.catalog_digest, records };
}

/** Digest-only evidence of a frame_record call: which references the adopted option used, and how. */
export function frameApplicationMetadata(frame: unknown, input: unknown): JudgmentFrameApplicationEvidence {
  const recorded = frame as Loose;
  const request = input as Loose;
  const selections: Loose[] = Array.isArray(request?.selections) ? request.selections : [];
  const chosen = Array.isArray(request?.options)
    ? request.options.find((option: Loose) => option?.label === request.chosen_option) : null;
  const returned = new Set((Array.isArray(recorded?.selections) ? recorded.selections : []).map(key));
  const selected = new Set(selections.map(key));
  const validSelections = Array.isArray(request?.selections) && selections.length <= 24
    && selected.size === selections.length && returned.size === selections.length
    && selections.every((item) => Object.hasOwn(roles, item?.kind) && text(item.ref)
      && text(item.why) && returned.has(key(item)));
  const kindsAddressed = kinds.every((kind) => selections.some((item) => item?.kind === kind)
    ? !text(request?.none?.[kind]) : text(request?.none?.[kind]));
  const usedBy = (item: Loose) => (use: Loose) => use?.ref === item?.ref
    && use?.role === roles[item?.kind as JudgmentFrameEvidenceKind] && text(use?.note)
    && (item.kind !== 'philosophy' || verdicts.includes(use.verdict));
  const applied = validSelections && Array.isArray(chosen?.uses)
    && selections.every((item) => chosen.uses.some(usedBy(item)));
  return {
    selections: selections.map((item) => ({ kind: item?.kind, ref: item?.ref })),
    chosen_option_digest: text(request?.chosen_option) ? digest(request.chosen_option) : null,
    applications: validSelections && applied ? selections.map((item) => {
      const use = chosen.uses.find(usedBy(item));
      return {
        kind: item.kind, ref: item.ref, role: use.role, note_digest: digest(use.note),
        ...(item.kind === 'philosophy' ? { verdict: use.verdict } : {}),
      };
    }) : [],
    non_applicability: kinds.filter((kind) => !selections.some((item) => item?.kind === kind)
      && text(request?.none?.[kind])).map((kind) => ({ kind, reason_digest: digest(request.none[kind]) })),
    application_complete: Boolean(validSelections && kindsAddressed && applied
      && text(request?.chosen_option) && recorded?.chosen_option === request.chosen_option),
  };
}

/**
 * Whether this turn's events hold a complete frame: a catalog, a body read of
 * every selected reference, then a record that applies them, in that order.
 *
 * The catalog is tens of thousands of characters and rarely changes inside one
 * conversation. frame_read and frame_record rebuild the current catalog on the
 * server and reject a stale digest, so a successful read and record with a
 * digest this conversation has already been shown prove the same list is still
 * current. `sessionCatalogDigests` names those digests; with them, a turn that
 * did not read the catalog again is still complete.
 */
export function hasCompleteJudgmentFrame(
  events: readonly JudgmentFrameEvidenceEvent[],
  { sessionCatalogDigests = [] }: { sessionCatalogDigests?: readonly string[] } = {},
): boolean {
  const list = events as readonly Loose[];
  const catalogIndex = lastIndexOf(list, 'frame_catalog');
  const frameIndex = lastIndexOf(list, 'frame');
  if (frameIndex < 0 || frameIndex <= catalogIndex) return false;
  const frame = list[frameIndex].safe_metadata?.judgment_frame;
  if (!validDigest(frame?.catalog_digest) || frame.application_complete !== true) return false;
  // A catalog read on this turn is the one the record must match. Without
  // one, only a digest read earlier in the same conversation is accepted.
  const catalogDigest = catalogIndex >= 0
    ? list[catalogIndex].safe_metadata?.judgment_frame_catalog?.catalog_digest
    : sessionCatalogDigests.includes(frame.catalog_digest) ? frame.catalog_digest : null;
  if (!validDigest(catalogDigest) || frame.catalog_digest !== catalogDigest) return false;
  const reads = new Set(list.slice(catalogIndex + 1, frameIndex)
    .filter((event) => event.success && event.event_kind === 'frame_read'
      && event.safe_metadata?.judgment_frame_read?.catalog_digest === catalogDigest)
    .flatMap((event) => Array.isArray(event.safe_metadata.judgment_frame_read?.records)
      ? event.safe_metadata.judgment_frame_read.records.map(key) : []));
  return Array.isArray(frame.selections) && frame.selections.every((item: Loose) => reads.has(key(item)));
}

/**
 * Digests of the catalogs the other turns of one conversation read
 * successfully. The Host passes the directory that holds one `<turn>.events`
 * directory per turn and the current turn's own events directory, which is
 * skipped. An unreadable file or directory contributes nothing.
 */
export function sessionFrameCatalogDigests(sessionDirectory: string, currentEventsDirectory: string): string[] {
  const digests = new Set<string>();
  let turns: string[];
  try {
    turns = readdirSync(sessionDirectory).filter((name) => name.endsWith('.events')).sort();
  } catch {
    return [];
  }
  for (const turn of turns) {
    const directory = join(sessionDirectory, turn);
    if (resolve(directory) === resolve(currentEventsDirectory)) continue;
    let names: string[];
    try {
      names = readdirSync(directory).filter((name) => name.endsWith('.json'));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const event = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Loose;
        const value = event?.safe_metadata?.judgment_frame_catalog?.catalog_digest;
        if (event?.success === true && event.event_kind === 'frame_catalog' && validDigest(value)) digests.add(value);
      } catch {
        // Not a readable event.
      }
    }
  }
  return [...digests].sort();
}
