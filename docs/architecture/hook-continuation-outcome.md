# Stop継続の有限再試行と証跡境界

関連Story: [Stop差し戻しを安全な残作業の実行へつなぐ](../user_stories/active/story-hook-continuation-outcome.md)

## 判断

既存のHost journalとepisode transactionを使い、継続要求を最大3回に制限する。
初回 `.continuation.json` は変更せず、追加要求を `.continuation-retry-2.json`、
`.continuation-retry-3.json` に保存する。各ファイルは直前の要求を引き継ぐ完全な
マーカーで、最新の存在する要求を読む。モデルに回数の管理を任せない。

初めて実作業を継続要求する時点のイベント連番を `event_sequence_boundary` として
固定する。`execution_event_count` はその境界より後の成功した作業toolの観測数であり、
判断・状態・価値証明の登録は除く。成果の意味的な完了判定とは分離する。

再開を要求したことと完了を区別する。新しい表示契約は完了を先取りしない。
正当な人間確認は `waiting_human`、上限到達時の不足は `unresolved` として記録する。
過去のマーカーに連番がなければ、要求日時以後のイベントのみを観測する。

## 不変条件と戻し方

- 判断契約による権限・確認理由は変更しない。Stopは新たな外部操作の許可ではない。
- 監査だけの修復は従来の本文保存を維持する。
- 既存finalと初回マーカーは上書きしない。
- 配備は標準runtime更新手順で検証済みコミットへ限定する。稼働中コードやhook設定・信頼情報を直接書き換えない。反映後の `/hooks` 再承認を利用者が行い、戻す場合も検証済みコミットへの標準runtime更新と再承認を使う。共有本番の変更を含めない。
