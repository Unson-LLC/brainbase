# Session Runtime Stability Baseline (2026-04-02)

## Summary

2026-04-02 時点で、session/runtime 系の複数修正を rollback した状態が明確に安定した。

今回の安定化では、`workspace/var` を runtime 正本に固定した変更は残し、それ以外の
`tmux` binding 主体の recovery 判定、snapshot-first の再設計、snapshot/runtime cache、
xterm 切替最適化を戻している。

## Stable Baseline

残した変更:

- `adeb1e5c` `fix(runtime): make workspace var authoritative`

rollback した変更:

- `11a26299` Revert `7ec36990` `perf(ui): parallelize xterm session switch API calls`
- `f65d99d6` Revert `7246b98c` `fix(ui): speed up session switch snapshots`
- `f0f186f9` Revert `7efad799` `fix(ui): restore snapshot-first session switching`
- `c993a206` Revert `b423ae3a` `fix(session): make runtime recovery binding-authoritative`
- `96db5cc2` Revert `1db73aad` `fix(session): require explicit recovery for missing runtimes`

## What Regressed

不安定化の中心は以下だった。

- `tmux` runtime metadata を session の正当性判定に使い始めたこと
- `recoverable` / `broken` の導入で、既存の runtime attach 経路に recovery 分岐が混入したこと
- snapshot 表示と xterm 接続の順序変更
- snapshot cache / runtime cache の追加
- xterm 切替時の並列化

この結果、以下が相互干渉した。

- セッション切替
- snapshot 表示
- xterm 表示
- reconnect 挙動
- tmux attach / recreate の境界

## Operational Rule

当面の運用ルール:

- session identity は `tmux` binding 主体に再設計しない
- reconnect から recovery を自動実行しない
- snapshot 表示最適化は runtime 正当性判定と同時に触らない
- UI 表示改善と session correctness 変更は別 PR / 別コミットで入れる

## Reintroduction Strategy

再導入する場合は必ず 1 変更ずつ行う。

1. 表示のみ
   - snapshot paint 改善
   - xterm 表示改善
   - reconnect 表示改善

2. runtime path / state persistence
   - `workspace/var` 正本のような保存先固定

3. session correctness
   - recovery 判定
   - binding 検証
   - explicit recover

禁止事項:

- session correctness と UI switching 最適化を同一バッチで入れない
- `tmux exists` / `binding valid` / `snapshot cache` / `xterm connect` を同時に変更しない

## Verification Checklist

再度 session/runtime 系を触る前に最低限これを確認する。

- セッション切替で iframe / xterm / snapshot が安定して切り替わる
- reconnect で background AI turn を止めない
- active session を開いても fresh Claude/Codex に化けない
- `workspace/var/state.json` が唯一の runtime ledger として維持される
- `/api/sessions/:id/runtime` と `/api/sessions/:id/terminal/snapshot` の体感速度改善が、表示の安定性を壊していない

