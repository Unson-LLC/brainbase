# npm 公開後の readback が「did not converge」で落ちないようにする

## Problem Frame

run 38726775296（2026-10-15 20:21 JST、runner nucbox-evo-x2-wsl-linux-2）は `npm publish` を 20:24:00 頃に実行したあと、`scripts/npm-release.mjs` の readback が 20:25:34 に `npm registry did not converge after 8 attempts` で失敗した。registry の `time` では 0.41.6 は 20:25:36 に現れており、公開自体は成功していた（直後の run 38727647494 が既存版として検証し success）。

原因は2つ:
1. 待ち時間が短い。8 回・backoff 1/2/4/8/16/30/30 s で合計 91 s しか待たない。今回は publish から可視化まで約 96 s かかった。
2. publish 前の `npm view <pkg>@<ver>` が、新しい版を含まない packument をローカルの npm cache に残す。registry は packument を `Cache-Control: public, max-age=300` で返すため、npm は最大 300 s その cache を使い、readback が「No match found for version」(E404) を繰り返しうる。

## Constraints

- 既存の validation proof、immutable gitHead/integrity 検査、dist-tag 調整、staging tag 掃除は変えない。
- runner は self-hosted のまま。`ubuntu-latest` は使わない。`--provenance` は付けない。
- publish ジョブの `timeout-minutes: 15` に収まる待ち時間にする。
- npm publish は一度だけ。readback の失敗で再 publish しない。

## Options

1. **採用:** registry を読む `npm view` すべてに `--prefer-online` を付ける。readback の 2 回目以降は使い捨ての `--cache` ディレクトリで cache を完全に迂回する。試行を 24 回（待ち 23 回 = 1+2+4+8+16 s のあと 30 s×18、合計 571 s）にする。15 回・301 sで終了した run 39350202761 では、公開自体は成功したがregistry readbackが収束前に期限切れになったため、15分のpublish job内で許容される範囲へ待機窓を延長する。
2. `npm cache clean --force` を publish 後に実行する。runner 共有 cache を消す副作用があるので採らない。
3. `--prefer-online` だけにする。npm が revalidate を省いた場合に cache の 404 が残りうるので、cache 迂回も併用する。

## Acceptance Criteria

- AC-1: `readNpmMetadata` と versions/dist-tags の `npm view` が `--prefer-online` を付ける。
- AC-2: 収束待ちの合計が 300 s を超え、10 分以内（テストで固定）。
- AC-3: 2 回目以降の readback は `bypassCache` で使い捨て cache を使い、終了後に削除する。cache に残った publish 前の 404 を越えて収束する。
