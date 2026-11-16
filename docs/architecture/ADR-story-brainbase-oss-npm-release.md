---
story_id: story-brainbase-oss-npm-release
status: accepted
date: 2026-08-04
owners:
  - brainbase-maintainers
supersedes: []
---

# ADR: npm publication is bound to reviewed default-branch history

## Context

Brainbase OSS needs a repeatable first publication and recovery path for
`@unson/brainbase-mcp`. npm versions are immutable, and the publication token
can modify a public package. A maintainer-selected ref must therefore not be
allowed to supply unreviewed lifecycle or release scripts to a credentialed
workflow.

## Decision

The release CLI is the single publication boundary and is split into two
phases. Credential-free `release:validate` requires the fixed package identity,
exact version and clean HEAD, proves that HEAD is reachable from an explicitly
supplied trusted default-branch ref, and runs build, the complete Vitest suite
with a `--maxWorkers=2` ceiling to avoid shared self-hosted runner saturation,
production dependency audit, and
creates the real tarball outside the repository. The worker ceiling changes only
Vitest concurrency; test selection, timeout, skip, and pass/fail rules remain
the same as `npm test`. Before hashing it,
the CLI stamps the final tarball manifest with the exact reviewed commit as
`gitHead`. It writes a proof binding the tarball SHA-256, npm-compatible
SHA-512 integrity, package identity, and commit.
`release:publish` accepts only a matching proof and repeats identity, HEAD,
ancestry, cleanliness, and tarball digest checks before publishing that same
tarball with package lifecycle scripts disabled. Registry `dist.integrity` must
then equal the validated artifact integrity before any dist-tag reconciliation.
The publish command additionally requires the upstream repository's GitHub
Actions run context and an explicit serialization marker; direct local publish
is rejected so every supported registry mutation shares one package queue.

GitHub Actions puts validation in a read-only job without OIDC or npm
credentials. The immutable tarball and proof cross into a separate publication
job through a one-day Actions artifact; only that job has `id-token: write`.
The publish job runs on a GitHub-hosted runner and authenticates to npm only
through npm Trusted Publishing: the npm CLI (pinned to 11.21.1, the first line
that supports OIDC dist-tag operations) exchanges the job's GitHub Actions OIDC
token for a short-lived publish token. No long-lived npm token exists in the
workflow. The same `id-token: write` serves the pre-publish OIDC guard
(`assertSerializedPublicationContext()`) and npm provenance (`--provenance`).
The manual recovery path resolves an immutable SHA and rejects it unless it is
reachable from `origin/develop`. It also fixes the package identity to
`@unson/brainbase-mcp`. The npm package's Trusted Publisher entry binds
publication to `Unson-LLC/brainbase` and `npm-publish.yml`, and must allow
`npm publish` and npm dist-tag.

`release:verify` is a separate read-only operation. Publication may reconcile a
dist-tag forward to the greatest compatible version, while verification only
reports a mismatch and exits nonzero.

## Consequences

- First publication and recovery remain available through manual dispatch.
- Arbitrary branches and unreviewed commits cannot execute with the npm token.
- Local plan, validation, and verification remain available, while publication
  and recovery are dispatched from `gh` into the serialized Actions workflow.
- Immutable version collisions fail without attempting an overwrite.
- Verification can be used safely in audits because it does not mutate npm.
- The publish CLI requests a GitHub-issued OIDC token from the runner endpoint
  and checks its repository, run, audience, workflow ref, and ref claims. The
  workflow and ref must exactly identify the reviewed `develop` definition;
  caller-set markers or the same workflow path on another ref have no authority.

## Rejected alternatives

- Allow any manual ref because dispatch is maintainer-only: a mistaken or
  compromised ref could still execute package lifecycle scripts with the token.
- Allow direct local publication after validation: it would bypass the package
  queue and reopen a dist-tag time-of-check/time-of-use rollback window.
- Let verify repair tags: a command described as verification would have an
  unexpected public side effect.
