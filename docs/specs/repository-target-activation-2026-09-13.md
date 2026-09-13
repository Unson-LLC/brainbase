# 稼働環境への反映記録

2026-09-13 JST。利用者による稼働版固定・共通ランチャー更新の承認範囲で実施。

## 反映先

- 稼働checkout: `/Users/ksato/workspace/repos/.runtime/brainbase-31013`
- 変更前HEAD: `7c92fb98ad7a7f8eb9982cc7f1c1aab3ef6d15bc`、変更前clean。
- 共通ランチャーは開始時点ですでにbeta.23。今回symlinkは変更していない。
- contract、`.husky/pre-push`、`scripts/repository-target-handoff.mjs`だけを反映。未コミットの稼働差分。
- 正本候補の実装・テストはこのworktreeに保存。PR・マージは未実施。

## 確認結果

- runtime version: `0.2.0-beta.23`
- source commit: `80e0b5cf1ae133be802c88344cf7cf35abd1b597`
- manifest valid / integrity trusted / published / dirty false。
- Nodeテスト10件、Vitest contractテスト7件成功。
- 有効な`.husky/_/pre-push`を直接起動し、変更先とURL一致で終了0、不一致・変更先未指定で終了1。
- 上記は`BRAINBASE_ALLOW_PUSH_WITHOUT_GATE=1`でも送信先照合を回避できないことを確認するもの。PR prepare全体や実ネットワークpushのE2Eではない。
- 外部push、Growin配布、サービス再起動は実施していない。

## 切戻し

- beta.22実体 `/Users/ksato/.local/share/vibepro-runtime/0.2.0-beta.22` は保持され、trusted確認済み。
- 稼働の変更前2ファイルは上記HEADに保存されている。切戻し時は現在差分と所有者を再確認し、今回の差分のみ逆適用する。新規handoffファイルも今回追加分だけを対象にする。
- ランチャーをbeta.22へ戻す場合はcontract固定も同時に戻す必要がある。他作業によるbeta.23切替なので、共通symlinkを独断で戻さない。
- `/Users/ksato/workspace/repos/brainbase`のbeta.10固定は今回変更していない。全checkoutへの展開完了ではない。
