# npm公開をprovenanceなしでself-hosted runnerから行う

## Problem Frame

0.41.5 の npm 公開（run 38713407935）は、publish ジョブが self-hosted runner（EVO-X2）で動いているため、`npm publish --provenance` が npm registry に 422（`Unsupported GitHub Actions runner environment: "self-hosted"`）で拒否されて止まった。npm の provenance は GitHub-hosted runner でしか使えない。直さないと、以後の公開もすべて同じ理由で止まる。

## Constraints

- 佐藤さんの判断（2026-10-15 19:31、DevDirector のチャット）:「provenance を外して self-hosted のまま公開していい」。Worker のチャットでの本人承認（2026-10-15 19:34）:「進めていい」。
- CI は self-hosted runner だけで動かす。`ubuntu-latest` などの GitHub-hosted ラベルは置かない（story-public-ci-self-hosted-runners）。
- immutable commit、validation proof、artifact の受け渡し、npm/GitHub Release の readback は変えない。
- publish ジョブは pull request の head を読まない。

## Options

1. publish ジョブだけ GitHub-hosted に戻し provenance を残す（#791）。self-hosted だけで動かす方針と合わず、採らない。
2. **採用:** publish workflow から `--provenance` と `id-token: write` を外し、runner は self-hosted のままにする。テストは「provenance なし・id-token なし・self-hosted で動く」を検査し、GitHub-hosted ラベルの禁止は残す。
3. 公開を止めたままにする。今後の公開がすべて止まるので採らない。

## Acceptance Criteria

- AC-1: `npm-publish.yml` に `--provenance` と `id-token: write` がない。
- AC-2: validate と publish の両ジョブが `[self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` で動き、`ubuntu-latest` がない。
- AC-3: `tests/npm-release-workflow.test.ts` と `tests/github-actions-runner-policy.test.ts` が通る。
