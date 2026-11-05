export const BODY_EVIDENCE_FIELDS = ['content', 'statement', 'decision', 'rationale', 'body',
  'markdown', 'body_summary', 'summary', 'description', 'notes'] as const;
export type BodyEvidenceField = (typeof BODY_EVIDENCE_FIELDS)[number];
const EVIDENCE_FIELDS = [...BODY_EVIDENCE_FIELDS, 'source_pointer', 'provenance'] as const;
export type RetrievalEvidence = Partial<Record<(typeof EVIDENCE_FIELDS)[number], unknown>>;

export function hasSubstantiveValue(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => hasSubstantiveValue(item, seen));
}

export function extractEvidence(payload: Record<string, unknown>): RetrievalEvidence {
  return Object.fromEntries(EVIDENCE_FIELDS.filter((field) => Object.hasOwn(payload, field)
    && payload[field] !== undefined).map((field) => [field, payload[field]]));
}

export function bodyEvidenceFields(evidence: RetrievalEvidence): BodyEvidenceField[] {
  return BODY_EVIDENCE_FIELDS.filter((field) => hasSubstantiveValue(evidence[field]));
}
