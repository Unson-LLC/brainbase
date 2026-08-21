---
spec_id: canonical-company-authority-producer-contract-v1
story_id: story-canonical-company-authority-producer-contract-v1
status: accepted_for_a0_contract_preparation
---

# Canonical company authority producer contract v1 specification

## Contract identity

| Field | Fixed value |
|---|---|
| `contract_id` | `mana-brainbase-company-authority/v1` |
| `contract_version` | `1.0.0` |
| schema version | `1.0` |
| protocol capability marker | `company_authority_v1` |
| requested operation capability | `$.context.authority.capability_id` (equals `$.requested_action.capability_id`) |
| success wire | `$.context` |
| protocol marker path | `$.context.tenant_context.authorization.capability_ids` |
| error correlation path | `$.error.correlation_id` (equals root `correlation_id`) |
| producer status | `contract_ready` |

The machine source of truth is `contracts/mana-brainbase-company-authority/v1/producer.contract.json` and the three payload schemas (ObservedExecutionRequestV1, CanonicalExecutionContextV1, and the response envelope). The contract package is preparation-only and does not change server/runtime behavior.

## Request schema and wire rules

`ObservedExecutionRequestV1` accepts only observed Slack provider identity, a requested operation capability, optional delivery metadata, and correlation. v1 provider scope is `slack` because the nested `TenantContextEnvelopeV1` is Slack-backed; `codex`, `claude_code`, and `service` are rejected until a provider-specific nested envelope is contractual. `requested_action.desired_effect` is required and has no implicit default. Its allowed values are `read`, `write`, and `external_side_effect`. `company_authority_v1` is not a requested operation capability; it is the protocol marker required in nested authorization. Missing desired effect returns `DESIRED_EFFECT_REQUIRED`; missing company capability marker returns `COMPANY_AUTHORITY_REQUIRED`.

The request must not carry resolved authority fields such as canonical person, organization, project, owner, responsible/accountable/approver person, RACI, decision, policy revision, or credential. Each forbidden field is rejected by the request schema and reference validator. A project hint is advisory only.

## Context schema and bindings

`CanonicalExecutionContextV1` must contain the embedded tenant context, Brainbase-resolved actor, scope, authority, evidence receipts, time window, and detached integrity. The following bindings are mandatory before a protected effect:

- request correlation equals `tenant_context.correlation_id`;
- requested operation capability equals `authority.capability_id`;
- nested authorization capability list contains `company_authority_v1` as a protocol marker, independent of the requested operation capability;
- requested effect is a member of `authority.allowed_effects`;
- requested resource equals `scope.resource_ref`;
- request authenticated subject equals `actor.external_subject_id`;
- outer actor subject and canonical person equal nested actor subject and principal;
- outer organization and project are contained in nested authorization lists;
- outer `scope.placement_id` equals nested `placement.deployment_id`;
- request Slack `workspace_id`, `app_id`, and `enterprise_id` equal nested workspace/Slack identity;
- request delivery `channel_id`, `thread_ts`, and `event_id` equal nested Slack delivery identity;
- tenant, workspace connection, membership, resource, RACI, and policy revisions are current;
- outer and nested detached JWS signatures are valid with trusted keys; nested freshness uses the same caller evaluation time, expected audience, and expected deployment;
- timestamp strings are UTC `Z` form only, TTL is at most 300 seconds, and audience includes `mana-runtime`;
- Personal scope has a non-null `scope.owner_person_id` equal to the resolved target person.

The tenant context remains the existing v1 envelope. The producer does not discard its tenant, connection, credential, placement, idempotency, or capability fields; it adds the exact `company_authority_v1` protocol marker to `authorization.capability_ids` while preserving the requested operation capability separately in `authority.capability_id`.

## Canonical JSON/signature profile

1. Remove `integrity` from the payload.
2. Serialize the remaining object using RFC 8785 JCS, UTF-8.
3. Construct the protected header with `alg=EdDSA`, `b64=false`, `crit=["b64"]`, `kid=integrity.key_id`, and `typ=application/mana-brainbase-company-authority+jws`.
4. Sign `ASCII(base64url(protected_header) + ".") || UTF8(JCS(unsigned_payload))` with Ed25519.
5. Emit detached compact JWS `protected64..signature64`.

`AUTHORITY_CONTEXT_INVALID_SIGNATURE` covers malformed/canonicality/signature errors. `AUTHORITY_CONTEXT_EXPIRED` covers an expired but otherwise time-valid context. Replay with a conflicting context is `AUTHORITY_REPLAY_CONFLICT`.

Trusted `kid`-to-key resolution, key rotation, and key revocation are runtime non-goals for A0. The reference validator is non-authoritative conformance evidence only. Production cutover remains blocked until runtime trust-store resolution, rotation/revocation policy, and downstream signature verification are separately implemented and verified.

## Decision behavior

- `auto`: permit only the requested effect in the signed resource scope after revalidation.
- `approval`: expose a packet for exactly `authority.approver_person_id`; a different approver returns `APPROVER_MISMATCH` and has no effect.
- `human_action`: request `authority.responsible_person_id`; the machine outcome is `{ "kind": "human_action", "notification_required": true, "completion_required": true, "completion_status": "pending_human_action" }`, so notification is not completion.
- `deny`: return `COMPANY_AUTHORITY_DENIED` and keep business/model/credential/Personal/Graph/external effect counters at zero.
- A signed `deny` context is not a successful consumer response; the consumer returns `COMPANY_AUTHORITY_DENIED`.

When authority is unavailable, only health, protocol negotiation, provisioning, connection diagnosis, and tenant-isolation tests may report that condition. No default tenant, person, placement, owner, project, connection, or credential is selected.

## Required conformance matrix

The deterministic manifest has nine positive fixtures and 46 negative mutations over two tenants and two synthetic people (`tenant-a`/`tenant-b` × `person-sato`/`person-umeda`). The matrix must include:

- missing desired effect, missing `company_authority_v1` protocol marker, and operation capability/marker separation;
- all four decision modes and a Personal owner success;
- unknown and ambiguous person, inactive membership, and four cross-organization attempts;
- stale membership/resource/RACI/policy/tenant/connection revisions and out-of-scope project;
- wrong approver, authority unavailable, and diagnostic allowlist;
- Personal owner missing, cross-person access, and no fallback;
- one independent request-injection negative for each forbidden authority field: canonical person, organization, project, owner, responsible/accountable/approver person, decision, policy revision, RACI revision, and credential;
- request subject↔outer actor↔nested actor, outer organization/project↔nested authorization, and outer placement↔nested placement mismatch negatives;
- a non-Slack provider negative proving the v1 provider boundary;
- request-to-nested Slack workspace/app/enterprise and delivery channel/thread/event binding negatives;
- invalid signature, expired context, replay conflict, and queue redelivery idempotency.

Every negative case asserts the exact canonical code and:

```json
{
  "business_api_called": false,
  "llm_called": false,
  "credential_lease_issued": false,
  "external_side_effect": false
}
```

## Lock and evidence boundary

The fixture digest is `sha256(relative_path + NUL + file_bytes)` over the manifest-listed fixture files; the manifest itself is excluded. `source-lock.json` records contract version, manifest version, fixture files, and digest. It intentionally contains no producer commit, branch head, or merge SHA. The downstream consumer records its merged SHA only after the producer contract is merged.

The source lock also records the A0 trust boundary: trusted `kid`-to-key resolution, key rotation, and key revocation are runtime non-goals; the reference validator cannot act as the authority. Production cutover is blocked pending separately verified runtime trust-store and consumer enforcement.

Targeted tests: `tests/conformance/brainbase-company-authority-producer-contract.test.js` and `tests/conformance/brainbase-company-authority-consumer-boundary.test.js`. Initial implementation以前のhistorical REDは`not_collected`（schema/reference実装前の実行・記録なし）であり、今回のA0 consumer boundaryの実装前REDは実行・記録済みである。観測済みのGREENはproducer conformance 63件とA0 consumer boundary 21件（nested TenantContext signature、same-caller-now、audience/deployment、error correlation、deny rejectionを含む）であり、既存shared tenant-context conformance 25件はregression-onlyでA0 consumer evidenceではない。A successful targeted test proves contract conformance only, not production deployment or real authority resolution. Graph SSOTの実データ、live connection、runtime trust store、いずれのdeployment modeの稼働も検証済みとは扱わない。
