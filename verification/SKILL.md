---
name: verify-oss-package
description: Verify a change to the Brainbase OSS package - build, the full test suite, the packed npm exports, and the PR's own Story and Spec. Does not verify production identity providers, hosts or email delivery.
---

# OSS package verification

Run from the repository root. Read the PR diff and the Story and Spec it names before interpreting results.

1. Record `git rev-parse HEAD`, Node/npm versions and the PR head. Verify the tested commit equals the reported PR head; recheck before reporting. Record this skill as `verification/SKILL.md@<tested SHA>`.
2. Install locked dependencies with `npm ci --ignore-scripts` if absent. Run `npm run build`.
3. Run `npm test`. Also run `npx --no-install vitest run tests/npm-consumer-smoke.integration.test.ts --maxWorkers=2`; the consumer test packs the built artifact and imports the public exports from a separate consumer, so a source import alone is insufficient. When the PR names focused checks, run them as well.
4. Inspect the change against its Story and Spec: each acceptance criterion the PR claims, removed or changed public exports (they must be recorded as breaking in `docs/releases/`), and anything the tests cannot prove. Report uncovered guarantees explicitly.
5. Report each executed command, exit status and test counts, plus any failures and limitations in durable PR evidence. Missing prerequisites or skipped required checks are FAIL, not PASS. PASS requires build and all selected tests to pass, with no unresolved violation of the Story or Spec found in inspection. CI success alone is not skill execution.

When authorized to publish verification, link the evidence in a separate machine record:
`RUNNER_VERIFY repository=<owner/repo> pr=<number> head=<tested SHA> skill=verification/SKILL.md@<tested SHA> result=<PASS|FAIL> evidence=<comment URL>`.
Do not publish a result for an untested or changed head. This workflow does not authorize npm publication, deployment, marking a draft ready or merging.
