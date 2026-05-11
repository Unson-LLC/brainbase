---
spec_id: SPEC-personal-kg-sns-seed-mvp
title: Personal KG to SNS Seed MVP Specification
status: implemented
date: 2026-05-12
story_id: str.brainbase.personal-kg-sns-seed-mvp
related_specs:
  - SPEC-candidate-store-mvp
  - SPEC-sns-readonly-curator
implementation_files:
  - server/services/sns/personal-knowledge-graph-reader.js
  - server/services/sns/sns-readonly-curator.js
test_files:
  - tests/sns/personal-kg/**/*.test.js
  - tests/sns/curator/**/*.test.js
---

# SPEC: Personal KG to SNS Seed MVP

## Purpose

Expose owner-visible personal cognitive memory as SNS curation source entities. This lets the read-only curator create SNS draft candidates from the founder's accumulated proof, philosophy, preferences, and insights.

## Invariants

- **INV-1**: The personal KG reader is read-only and has no candidate mutation, Graph mutation, or posting method.
- **INV-2**: Source entities come from candidate-store ACL-filtered `listCandidates`.
- **INV-3**: MVP source scope is personal only: `owner_person_id=viewer.sub` and `visibility=owner`.
- **INV-4**: `agency_level=none`, `redaction_status!=none`, `promotion_status in rejected/expired`, and candidates created by `sns-curator` are excluded.
- **INV-5**: Source entities preserve provenance fields from the source candidate.
- **INV-6**: SNS curator can generate and save Persona Brain draft candidates from these source entities without posting.

## Contract

```ts
class PersonalKnowledgeGraphReader {
  async listRecentEntities(options: { since: string, viewer: JWT }): Promise<Array<SourceEntity>>
}

type SourceEntity = {
  id: string;
  source_candidate_id: string;
  cognitive_type: string;
  body: string;
  derived_from: string[];
  evidence_ids: Array<any>;
  agency_level: string;
  sensitivity: string;
  owner_person_id: string;
  visibility: 'owner';
  created_at: string;
}
```

## Scenarios

### S-1: personal memory becomes KG source

- given: an owner-visible `insight` candidate
- when: `listRecentEntities`
- then: the reader returns a source entity with candidate provenance

### S-2: unsafe or non-personal memory is excluded

- given: other-owner, redacted, rejected, expired, and `agency_level=none` candidates
- when: `listRecentEntities`
- then: none of them are returned

### S-3: personal KG drives SNS draft creation

- given: a highlighted thought becomes a personal candidate through Raw Ledger and Dreaming
- when: the personal KG reader is passed to `SnsReadonlyCurator`
- then: the curator generates a Persona Brain draft and saves it as an owner-visible claim candidate

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜6, S-1〜3 | tests/sns/personal-kg/personal-knowledge-graph-reader.test.js | ✅ |
| SNS curator regression | tests/sns/curator/**/*.test.js | ✅ |
| candidate-store regression | tests/candidate-store/**/*.test.js | ✅ |

## Non-goals

- Production Graph writes.
- Posting execution or scheduling.
- External X API calls.
