# AC-05 consumer-side verification (PR #841)

## Acceptance criterion (source: `docs/stories/story-judgment-harness-common-contracts-v1.md`)

> AC-05: `npm pack` したtarballを新しいconsumerへ組み込み、Hostと4つの共通契約をsubpath importし、queue/readback smokeを通す。

## Consumer scope

| Consumer | Result | Notes |
| --- | --- | --- |
| Isolated fresh npm consumer (`scripts/judgment-harness-consumer-smoke.mjs`) | **pass** | Spec-aligned tarball install; subpath imports + outbox queue/readback |
| `Unson-LLC/brainbase-unson` | **not run** | Repository not accessible from this agent principal (private) |
| `Unson-LLC/brainbase-organization` | **not run** | Repository not accessible from this agent principal (private) |

`docs/specs/judgment-harness-common-contracts-v1.md` defines consumer verification as local tarball install (not registry publish). External overlay/org repos remain separate integration PRs; this run satisfies the OSS pack smoke in AC-05.

## Environment

- brainbase git HEAD: `231d059a61c98c3bfcdfa66fa76aa04e610eb724` (pre-commit; evidence recorded at same tree)
- `@unson/brainbase-mcp` version in pack: `0.44.1`
- Node: `node -v` → v22.14.0 (smoke subprocess) / v22.23.3 (npm install)
- vibepro: `0.2.0-beta.34`

## Commands executed

```bash
npm run build
npx vitest run tests/judgment-harness-consumer-smoke.integration.test.ts
node scripts/judgment-harness-consumer-smoke.mjs <createReleaseArtifact tarball>
```

`createReleaseArtifact` uses the same staging path as `npm run release:validate` (not a hand-rolled `npm pack` on the repo root).

## Results

- **build**: pass (`vibepro verify run --kind build`)
- **integration (AC-05)**: pass — vitest `tests/judgment-harness-consumer-smoke.integration.test.ts` (1/1)
- **CLI smoke JSON**: `.vibepro/pr/story-judgment-harness-common-contracts-v1/ac-05-consumer-smoke-cli.json`
  - Subpaths resolved under `dist/`: `judgment-host`, `judgment-execution-outcome`, `judgment-node-evidence`, `judgment-event-adapter`, `judgment-event-outbox`
  - Outbox: enqueue `queued` → deliver `delivered: 1`, queue drained after confirmed readback

## VibePro evidence paths

- `.vibepro/pr/story-judgment-harness-common-contracts-v1/verification-evidence.json`
- `.vibepro/pr/story-judgment-harness-common-contracts-v1/verification-runs/integration.json`
- `.vibepro/pr/story-judgment-harness-common-contracts-v1/verification-runs/build.json`
