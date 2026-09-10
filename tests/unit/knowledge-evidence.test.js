import { describe, it, expect } from 'vitest';
import { evaluateKnowledgeEvidence, normalizeRetrievalEvidence } from '../../scripts/codex-hooks/knowledge-evidence.mjs';
const route = { event_kind: 'route', success: true, safe_metadata: { source_class: 'graph' } };
const retrieval = (present = true, success = true) => ({ tool_name: 'mcp__brainbase__get_entity', success,
  safe_metadata: { retrieval_evidence: { status: 'retrieved', coverage: 'complete', sufficiency: 'needs_model_verification', absence_confirmed: false,
    references: [{ id: 'dec-1', entity_type: 'decision', evidence_status: present ? 'present' : 'missing', evidence_fields: present ? ['statement'] : [] }] } } });
const assessment = (status = 'sufficient', ids = ['dec-1']) => ({ event_kind: 'evidence', success: true,
  safe_metadata: { evidence_assessment: { schema_version: 'brainbase-knowledge-evidence-assessment-v1', status, reference_ids: ids, reason: '質問に対応する決定本文を確認した' } } });
describe('Graph evidence completion contract', () => {
  it('does not accept routing or assessment without retrieval', () => {
    expect(evaluateKnowledgeEvidence([route], true).ready).toBe(false);
    expect(evaluateKnowledgeEvidence([route, assessment()], true).ready).toBe(false);
  });
  it('binds sufficient assessment to real body references after this route', () => {
    expect(evaluateKnowledgeEvidence([route, retrieval(), assessment()], true)).toMatchObject({ ready: true, status: 'model_assessed_with_retrieval', absence_confirmed: false });
    for (const events of [[retrieval(), route, assessment()], [route, retrieval(), assessment('sufficient', ['other'])], [route, retrieval(false), assessment()], [route, retrieval(true, false), assessment()]]) {
      expect(evaluateKnowledgeEvidence(events, true).ready).toBe(false);
    }
  });
  it('requires reassessment after a later retrieval, including failure', () => {
    expect(evaluateKnowledgeEvidence([route, retrieval(), assessment(), retrieval(true, false)], true).ready).toBe(false);
  });
  it('permits an honest insufficient result after a failed attempt without asserting absence', () => {
    expect(evaluateKnowledgeEvidence([route, retrieval(false, false), assessment('insufficient', [])], true)).toMatchObject({ ready: true, status: 'insufficient', absence_confirmed: false });
  });
  it('does not impose Graph rules on unrelated work', () => {
    expect(evaluateKnowledgeEvidence([], false).required).toBe(false);
  });
  it('rejects a retrieval claiming confirmed absence', () => {
    expect(normalizeRetrievalEvidence({ ...retrieval().safe_metadata.retrieval_evidence, absence_confirmed: true })).toBe(null);
  });
});
