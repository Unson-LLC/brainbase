---
story_id: story-guided-first-run-onboarding
title: Brainbase初回オンボーディングを日本語ガイドで一括開始する
source:
  type: conversation
  origin: user_request
  date: 2026-06-06
spec_docs:
  - path: docs/specs/guided-first-run-onboarding.md
architecture_docs:
  - path: docs/architecture/guided-first-run-onboarding.md
    status: not_required
    reason: 既存のCLI/onboarding helper境界内に日本語ガイド入口を追加するだけで、MCP server、SSOT schema、外部provider接続、hosted backend境界は変えない
status: in_progress
---

# Brainbase初回オンボーディングを日本語ガイドで一括開始する

## Background

Brainbase Personal Onboarding Kit already has low-level onboarding commands for agent interview, source diagnosis, project registration, candidates, install, and doctor. A first-time adopter still has to read several sections and manually compose the right sequence.

Codex / Claude Code / CodeCode should be able to start the user's onboarding by asking questions in Japanese, then showing command-ready next steps without writing unreviewed canonical memory.

## User Story

As a first-time Brainbase personal MCP adopter, I want to run one first-run onboarding command from Codex or Claude Code, so that the agent can ask what context I do not want to explain repeatedly, get approval for the smallest local facts, run a first value demo, and only then ask about mail, calendar, drive, tasks, and source boundaries.

## Scope

- Add `brainbase onboard:start`.
- Generate a Japanese guided interview for value target, self/work context, project, approval, first value demo, and optional post-demo sources.
- Initialize the Personal OS directory if missing.
- Surface first value demo, source readiness, and next commands using existing local-first onboarding commands.
- Keep project registration dry-run before `--write`.

## Acceptance Criteria

- [x] `onboard:start` initializes the local Personal OS directory when needed.
- [x] `onboard:start` does not write canonical self, project, relationship, Personal KG, or decision facts by itself.
- [x] Output includes Japanese interview sections for value target, self/work context, project, approval, first value demo, and optional post-demo sources.
- [x] Output accepts known answers for target agent, self, project, goal, status, role, email, calendar, drive, allowlists, local folders, and tasks.
- [x] Output reports source readiness in Japanese while preserving concrete setup commands.
- [x] Output includes copyable next commands for seed, first value demo, project dry-run, project write after approval, source diagnosis, candidate review, MCP install, and doctor.
- [x] Output lists first value demo before source diagnosis or candidate review.
- [x] OAuth tokens, passwords, API keys, and refresh tokens are not requested through chat.
- [x] Drive and local file collection remain allowlist-first.

## Out Of Scope

- UI, launchd runtime, xterm, workflow mission control, or internal Brainbase operations.
- Hosted backend, Infisical, Unson API, Lightsail, or bb.unson.jp sync.
- Direct provider API integration inside Brainbase.
- Automatic promotion from `sources/` or `candidates/` into canonical SSOT.

## Verification

- `npm run build`
- `npm test`
- `npm pack --dry-run`
- VibePro Spec drift for `story-guided-first-run-onboarding`
