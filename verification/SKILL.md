---
name: verify-member-invitation
description: Verify the organization member invitation kernel, HTTP contract and packed npm exports. Use for changes to these server contracts; does not verify production identity providers or email delivery.
---

# Member invitation verification

Run from the repository root. Read `docs/specs/organization-member-invite-v1.md`, the PR diff, and the invitation kernel and HTTP handler before interpreting results.

1. Record `git rev-parse HEAD`, Node/npm versions and the PR head. Verify the tested commit equals the reported PR head; recheck before reporting. Record this skill as `verification/SKILL.md@<tested SHA>`.
2. Install locked dependencies with `npm ci --ignore-scripts` if absent. Run `npm run build`.
3. Run `npx --no-install vitest run tests/organization-member-invite.test.ts tests/organization-connection.test.ts tests/npm-consumer-smoke.integration.test.ts --maxWorkers=2`. The consumer test packs the built artifact and imports the public exports from a separate consumer; a source import alone is insufficient.
4. Inspect the tests and implementation against the spec: tenant isolation; trusted HTTP identity and origin; verified email matching; token hashing and redacted readback; HTTPS fragment-only accept URLs validated before persistence; duplicate policy and locking; reservation recovery and replay; revoke/reissue; stable delivery errors without secret leakage. Report uncovered guarantees explicitly, including host persistence, OAuth and real mail delivery, which these fixtures cannot prove.
5. Report each executed command, exit status and test counts, plus any failures and limitations in durable PR evidence. Missing prerequisites or skipped required checks are FAIL, not PASS. PASS requires build and all selected tests to pass, with no unresolved violation of the contract found in inspection. CI success alone is not skill execution.

When authorized to publish verification, link the evidence in a separate machine record:
`RUNNER_VERIFY repository=<owner/repo> pr=<number> head=<tested SHA> skill=verification/SKILL.md@<tested SHA> result=<PASS|FAIL> evidence=<comment URL>`.
Do not publish a result for an untested or changed head. This workflow does not authorize npm publication, deployment, marking a draft ready or merging.
