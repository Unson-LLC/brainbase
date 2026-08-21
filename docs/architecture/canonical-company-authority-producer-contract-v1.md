---
architecture_id: canonical-company-authority-producer-contract-v1
status: accepted_for_a0_contract_preparation
related_adr: docs/architecture/ADR-023-brainbase-owned-company-authority.md
related_milestone: docs/management/milestones/M0-company-authority-and-personal-boundary.md
---

# Canonical company authority producer contract v1

## Decision

Brainbase is the only producer of company authority. The producer accepts an `ObservedExecutionRequestV1`, resolves canonical person/membership/organization/project/resource/RACI/policy/Personal owner, and returns a signed `CanonicalExecutionContextV1`. Mana and other runtimes do not send or author canonical authority claims.

This document fixes the A0 preparation boundary. It does not implement the resolver or change runtime behavior.

## Request and response wire

The request body is validated by `contracts/mana-brainbase-company-authority/v1/schema/observed-execution-request.schema.json`. It contains provider identity, requested action, optional delivery metadata, and `correlation_id`. `desired_effect` is required and is never inferred from a capability name. `project_hint` is a routing hint, not an authority claim.

The response is validated by `schema/company-authority-resolution-response.schema.json`:

```text
response.schema_version
response.contract_id
response.correlation_id
`$.context`: CanonicalExecutionContextV1 | null
`$.error`: CanonicalAuthorityError | null
```

The response envelope is the JSONPath `$` root. The success context is exactly `$.context`. Its required capability is exactly `$.context.tenant_context.authorization.capability_ids[] == "company_authority_v1"`. The error location is exactly `$.error`; an error always has `business_effect: false`.

## CanonicalExecutionContextV1

The context contains the existing `TenantContextEnvelopeV1` plus Brainbase-resolved authority claims:

```text
schema_version: "1.0"
tenant_context: TenantContextEnvelopeV1
actor: external_subject_id, canonical_person_id, membership_id, membership_revision
scope: organization_id, project_id, resource_ref, owner_person_id, placement_id
authority: decision, capability_id, RACI people, policy/raci/resource revisions,
          allowed_effects, stop_conditions
evidence: identity_resolution_receipt_id, authority_resolution_receipt_id
issued_at, expires_at, integrity
```

`authority.decision` is one of `auto`, `approval`, `human_action`, or `deny`. `authority.capability_id` is `company_authority_v1`. The context is bound to the request by the same correlation ID, capability ID, requested effect, and resource reference. Unknown, ambiguous, inactive, cross-organization, out-of-scope, or stale claims never become a default claim.

## Canonical JSON and signature

The unsigned payload is the context object with its `integrity` member removed. Its bytes are RFC 8785 JSON Canonicalization Scheme (JCS), UTF-8 encoded. The detached signature uses Ed25519 with JWS `alg=EdDSA`:

```text
protected = JCS({alg: "EdDSA", b64: false, crit: ["b64"], kid, typ:
  "application/mana-brainbase-company-authority+jws"})
signing_input = ASCII(base64url(protected) + ".") || UTF8(JCS(unsigned_context))
compact = base64url(protected) + ".." + base64url(signature)
```

The profile is compatible with the existing tenant-context detached-JWS convention while using a distinct media type. Maximum context TTL is 300 seconds and accepted clock skew is 30 seconds. Audience must include `mana-runtime`; issuer is `brainbase`. The synthetic key under `fixtures/test-key.json` is conformance-only and is not a deployment secret.

Trusted `kid`-to-key resolution, key rotation, and key revocation are runtime non-goals for A0. The reference validator supplies conformance evidence only and is not an authority or trust store. Production cutover is blocked until runtime trust-store resolution, rotation/revocation policy, and downstream signature verification are separately implemented and verified.

## Decision and error contract

The four decisions are not inferred by the consumer:

| Decision | Producer meaning | Protected effect condition |
|---|---|---|
| `auto` | signed requested effect is allowed | only after boundary revision revalidation |
| `approval` | named approver must decide | no protected effect before the exact approver |
| `human_action` | named responsible person must act | notification is not completion |
| `deny` | authority rejected the request | no business, model, credential, Personal, Graph, or external effect |

The canonical error set is declared in `producer.contract.json` and is fixed at 17 codes:

```text
DESIRED_EFFECT_REQUIRED, COMPANY_AUTHORITY_REQUIRED,
COMPANY_AUTHORITY_EFFECT_MISMATCH, COMPANY_AUTHORITY_DENIED,
PERSON_UNKNOWN, PERSON_AMBIGUOUS, AUTHORITY_CROSS_ORG,
AUTHORITY_SCOPE_MISMATCH, AUTHORITY_CONTEXT_STALE, APPROVER_MISMATCH,
AUTHORITY_UNAVAILABLE, MEMBERSHIP_INACTIVE, PERSONAL_OWNER_REQUIRED,
PERSONAL_SCOPE_MISMATCH, AUTHORITY_CONTEXT_INVALID_SIGNATURE,
AUTHORITY_CONTEXT_EXPIRED, AUTHORITY_REPLAY_CONFLICT
```

## Conformance payload and lock

`fixtures/cases.json` contains deterministic synthetic payloads: four tenant/person combinations, nine positive cases, and 28 negative mutations. The negative cases cover missing desired effect/capability, unknown/ambiguous identity, four cross-org combinations, project and Personal scope, inactive membership, tenant/connection/membership/resource/RACI/policy revisions, wrong approver, authority unavailable, invalid signature, expiry, and replay conflict. Every negative expected result has business/model/credential/external effect false.

`fixtures/manifest.json` identifies the payload set. Its digest is calculated over the listed files using `sha256(relative_path + NUL + file_bytes)`; the manifest itself is excluded. `source-lock.json` records only the contract version, manifest version, fixture files, and fixture-set digest. It deliberately has no producer commit, branch head, or merge SHA. The downstream consumer records the merged SHA after the producer is merged.

## Boundaries and non-goals

- No runtime, route, database, migration, deployment, secret, customer-data, or Mana worktree change is part of A0.
- The contract does not make a production authority claim or authorize a business action.
- Trusted `kid`-to-key resolution, key rotation, and key revocation remain runtime non-goals; the reference validator is non-authoritative conformance evidence only.
- Production cutover is blocked until runtime trust-store resolution, rotation/revocation policy, and downstream verification are implemented and verified.
- Authority-unavailable is only diagnostically reportable for health, protocol negotiation, provisioning, connection diagnosis, and tenant-isolation tests; company data, Personal KG, credentials, model calls, and external side effects remain denied.
- Personal scope requires a non-null owner from the signed context and rejects cross-person requests without fallback.
