---
spec_id: spec-company-os-ontology-v1
story_id: story-company-os-ontology-v1
status: accepted
---

# Accepted Spec: Company OS ontology foundation v1

## Contract

The shared ontology extension registers `objective`, `variable`, `model`, and
`constraint` as versioned semantic definitions. It registers typed relations
for contribution, evaluation, model input/output, constraint applicability,
and historical decision basis. The extension is read-compatible with the
historical ontology releases `1.0.0` and `2.0.0`; it is an extension manifest
only and does not activate new production Graph types or implement CRUD.

Definitions retain meaning, scope, ACL, provenance, storage, adoption state,
and epistemic state as separate fields. `model.epistemicState` is required;
the other definitions may remain incomplete drafts. Formal registration in
`storage: ontology` does not assert truth. Adoption/use authorization does not
replace epistemic evidence, and an explicit owner plus reader/writer ACL is
required.

Draft validation may retain incomplete definitions. Judgment, evaluation, and
execution validation fail closed for missing fields and unauthorized retired or
refuted definitions. Objective criteria reference a versioned Variable and a
threshold operator (`at_least`, `at_most`, or `equals`) with a scalar target;
relative operators are deferred until a versioned baseline contract exists.
Evaluation descriptors must match Variable revision, unit, aggregation,
granularity, scope, and period. Constraint `adoptionBasis` is a list of
versioned Decision references bounded by the Constraint scope and validity;
each exception carries its own decision-backed scope.

Relations do not imply achievement, causality, accuracy, truth, or current
validity. World-model cycles are allowed as semantic relationships; execution
DAG cycle rejection remains the responsibility of the execution contract.
Runtime validators accept unknown input and reject unknown types/enums,
malformed arrays, invalid dates/references/provenance, and self-declared use
of retired or refuted definitions.

## Acceptance/test references

| ID | Requirement | Test/source reference |
|---|---|---|
| AC-001 | Four versioned types, typed relations, extension manifest, historical compatibility | `src/ontology-foundation.ts`, `src/ontology.ts`, `tests/ontology-foundation.test.ts` |
| AC-002 | Draft retention and fail-closed judgment/evaluation compatibility validation | `validateFoundationDefinition`, `validateEvaluationCompatibility`, `tests/ontology-foundation.test.ts` |
| AC-003 | Forbidden inference metadata and world-model cycle policy | `judgmentFoundationRelations`, `inferFoundationConclusions`, `tests/ontology-foundation.test.ts` |
| AC-004 | Independent epistemic/adoption/ACL/storage/provenance axes and malformed runtime rejection | `FoundationDefinitionBase`, runtime validators, `tests/ontology-foundation.test.ts` |
| AC-005 | Public package subpath consumer import and PR CI verification | `package.json`, `scripts/npm-consumer-smoke.mjs`, `tests/npm-consumer-smoke.integration.test.ts`, `.github/workflows/test.yml` |

## Explicit non-goals

This slice does not activate the four types in the production Graph, add
canonical-store CRUD, implement the judgment runtime, or change the historical
ontology release objects. Canonical-store adoption is a later Story and must
reuse this shared contract rather than fork it.

## Verification boundary

The focused ontology tests, TypeScript build, and isolated npm consumer smoke
are local evidence. The full local suite has two known timeout failures in
existing SSOT cleanup/concurrent-writer and full-suite consumer-smoke paths;
those results are recorded as unresolved environment/fixture evidence and are
left to PR CI. They are not treated as feature success or as zero failures.
