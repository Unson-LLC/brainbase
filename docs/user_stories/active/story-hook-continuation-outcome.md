---
story_id: story-hook-continuation-outcome
title: Stop差し戻しを安全な残作業の実行へつなぐ
status: active
created_at: 2026-09-05
---

# Stop差し戻しを安全な残作業の実行へつなぐ

利用者として、承認済み範囲の残作業がある場合は、状態登録や回答の書き直しだけで終わらず実行を再開してほしい。

## 受入条件

1. pending状態の再Stopも有限回再開を要求する。上限は3回とし、未解決を完了と記録しない。
2. 継続要求後の実行証跡を分離する。継続前の作業、判断・状態・価値証明の登録だけでは継続後の実行と数えない。
3. 継続プロンプトは安全な次の作業・検証を先に実行させ、状態記録はその後にする。監査行は作業完了を先取りしない。
4. 正当な人間確認・権限境界を維持する。状態登録の欠落だけで未実行とは決めつけない。
5. 監査表示だけの修復は本文を保存する。既存journalは書き換えない。

## 最小Spec

- 対象: `scripts/codex-hooks/judgment-resolver-host.mjs`。
- 継続マーカーにイベント連番の境界を保存。安全な残作業の継続完了には境界以後の成功した実行証跡と未完了でない状態を要求する。これは実行の観測であり成果の意味的な完了証明ではない。
- 追加差し戻しはepisode transaction内の追記専用マーカーで保存し、再起動しても上限を維持する。
- 継続が未解決なら既存の縮退終了に理由を残し、`autonomy_continuation.status=unresolved` とする。
- 新しい監査契約の継続行は「再開要求を記録」とし、実作業完了とは表示しない。過去の契約は改変しない。
- 回帰: pending再Stop、状態だけのcompleted、実行後completed、許可されたwaiting_human、欠落stateの修復、監査のみの修復、上限後の再読込。
- 検証: Host単体・entrypoint統合テスト。共有本番への配備は対象外。

## 診断根拠

初回差し戻し後は不足が残っても `stop_hook_active=true` により縮退終了し、継続マーカーは無条件にcompletedとなっていた。成功証跡もepisode全体で数えており、継続前の実行と継続後の実行が分離されていなかった。

## 検証結果（2026-09-05）

- 修正前: pending状態の2回目Stopで `decision:block` が返らないことを回帰テストで再現。
- 修正後: 関連8ファイル、213テストが成功。Host単体、継続専用6ケース、entrypoint別プロセスでの再試行、監査表示、value proof、publication、Knowledge Event、readiness、autonomyを確認。
- 実行環境: Node.js 22.22.3 arm64。構文検査と `git diff --check` も成功。
- 実行証跡は作業toolの成功の観測であり、成果の意味的な正しさは引き続き `content_verification_status=not_evaluated` として区別する。
- Codexの正規契約に従い、再試行の加算は `stop_hook_active=true` の再Stopが対象。非準拠callerへの追加防御は今回の対象外。
- 独立レビュー2観点: 条件・権限境界はPASS。永続化レビューの旧監査契約の遡及変更を修正し、route解決eventがある旧episodeも回帰対象に追加。運用手順書も更新。
- レビューの追加防御提案は別途扱う。`stop_hook_active=false` の同一入力再送は既存の冪等契約を維持する。外部操作でのretryファイル削除・余分なファイル作成へのchain完全性検査は今回未実装（通常writerは同一transaction内で順に追記する）。

## 反映境界

稼働中runtimeとグローバルhooks設定・信頼情報は変更しない。
マージ後に標準手順でruntimeを対象コミットへ更新し、利用者が `/hooks` で再承認した後、新しいタスクで実ログと実作業の継続を照合する。テスト成功だけで稼働中の効果確認済みとは扱わない。
