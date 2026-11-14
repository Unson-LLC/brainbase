# CIのLinuxジョブを共通の目印で自前ランナー全体に載せる

## Problem Frame

2026-11-13、organization の verify-skill の5秒の job が EVO-X2 の待ち行列（46件）の後ろに並び、status が付くまで10分以上かかった。Linux の job は `[self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` で EVO-X2 の1台だけを指しているため、Beelink（Windows 端末2台の WSL、各2ランナー）を足しても拾われない。

## Constraints

- 佐藤さんの方針: まず自前ランナー（EVO-X2・Beelink 2台）を使い、それでも詰まるときだけ GitHub-hosted に逃がす。逃がし方は変数 `CI_RUNNER_BACKUP` の手動切り替えのまま（自動化は別の作業）。
- 目印は workflow で使う前にランナー側へ付ける。2026-11-13 に EVO-X2 の Linux ランナー12本（`nucbox-evo-x2-wsl-linux`〜`-12`）へ `unson-ci-linux` を付けた。`nucbox-evo-x2-wsl-automerge` には付けない。
- npm 公開の publish job と verify-skill は GitHub-hosted のまま。

## Acceptance Criteria

- AC-1: Linux の自前 job の `runs-on` が `["self-hosted","Linux","X64","unson-ci-linux"]` で、`CI_RUNNER_BACKUP == 'on'` のとき `ubuntu-latest` に逃がす式が残る。
- AC-2: 運用手引きが `unson-ci-linux` の意味と「目印は先にランナーへ付ける」順序を書く。
- AC-3: `tests/github-actions-runner-policy.test.ts` と `tests/npm-release-workflow.test.ts` が通り、この PR の CI が EVO-X2 上で通る。
