import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bodyEvidenceFields, extractEvidence } from '../../src/retrieval/evidence.js';
import { handleKnowledgeEvidenceToolCall } from '../../src/tools/knowledge-evidence-tools.js';
import { buildKnowledgeOwnerAudit } from '../../src/tools/knowledge-owner-audit.js';

describe('retrieved evidence contract', () => {
  it('preserves decision bodies and provenance but does not count metadata as body', () => {
    const evidence = extractEvidence({ statement: 'Use Graph as SSOT', rationale: 'Keep relationships', source_pointer: 'https://example.test/decision', title: 'Policy' });
    assert.deepEqual(bodyEvidenceFields(evidence), ['statement', 'rationale']);
    assert.equal(evidence.source_pointer, 'https://example.test/decision');
    for (const content of ['', '  ', {}, [], { nested: [] }, { flag: false }, 123]) assert.deepEqual(bodyEvidenceFields({ content }), []);
  });
  it('keeps unknown search shape distinct from an empty result', () => {
    assert.equal(buildKnowledgeOwnerAudit('search', { query: 'decision' }, 'legacy text')?.retrieval?.status, 'unknown');
    const empty = buildKnowledgeOwnerAudit('search', {}, JSON.stringify({ status: 'ok', data: { candidates: [], coverage: 'partial' } }))?.retrieval;
    assert.equal(empty?.status, 'empty'); assert.equal(empty?.coverage, 'partial'); assert.equal(empty?.absence_confirmed, false);
  });
  it('reports actual body fields for both search and get_entity', () => {
    const candidate = { id: 'dec-1', entity_type: 'decision', evidence: { decision: 'Keep Graph', rationale: 'Connected facts' } };
    const search = buildKnowledgeOwnerAudit('search', {}, JSON.stringify({ status: 'ok', data: { candidates: [candidate], coverage: 'partial' } }))?.retrieval;
    const get = buildKnowledgeOwnerAudit('get_entity', { id: 'dec-1' }, 'rendered', { id: 'dec-1', type: 'decision', retrieval_evidence: candidate.evidence })?.retrieval;
    assert.deepEqual(search?.references, get?.references);
    assert.deepEqual(get?.references[0].evidence_fields, ['decision', 'rationale']);
  });
  it('validates assessment without claiming that the tool verified truth', async () => {
    const args = { status: 'sufficient', reference_ids: ['dec-1'], reason: '本文が質問の方針を説明している' };
    assert.equal((await handleKnowledgeEvidenceToolCall('brainbase_knowledge_evidence_record', args))?.status, 'ok');
    for (const invalid of [{ ...args, reference_ids: [] }, { ...args, reference_ids: ['dec-1', 'dec-1'] }, { ...args, reason: ' ' }, { ...args, extra: true }]) {
      assert.equal((await handleKnowledgeEvidenceToolCall('brainbase_knowledge_evidence_record', invalid))?.status, 'error');
    }
  });
});
