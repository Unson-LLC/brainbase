# 判断段階の証拠と再評価

## 設計判断

独立した判定サービスや新たなワークフローは作らない。既存TurnContractの対象nodeにexecution_contractを追加し、MCPで短い判断結果を記録する。Hostは実イベントとの対応と順序を検証する。意味の妥当性はモデルの責務であり、成功したtool呼び出しだけで真実・研究の十分性を保証しない。

## 契約

対象段階はproblem-frame → observe → falsify → decide。各段階を前段の実record tool_use_idに束縛する。記録はnode_id、status (supported/insufficient)、finding、evidence_fit、unknowns、evidence_tool_use_ids、previous_result_tool_use_id、next_actionを含む。observeでは必要知識と現在の根拠が問題に合うかを明示する。外部知識不足を宣言した場合は調査実行後に再評価し、未実行のままsupportedに変えない。

Hostは記録した時点より前の、このepisode内の成功した業務toolイベントのみ証拠として認める。control/route/recordは根拠にしない。observe/falsify/decideのsupportedには根拠が必要。前段の差し替えは後段を無効にする。insufficientから同じ段階を再評価する場合は新しい実行根拠を要求する。

不足が残る場合はStopで既存の有界repairを使い、最初の未検証段階と具体的なnext_actionを返す。上限後は未検証と表示・保存し、completeにしない。human approvalを自動発生させない。既存権限判定が優先する。

新execution_contractを持たない旧receiptとdirect DAGは互換動作。自由な内部思考全文・生の取得本文・秘密情報は保存しない。

## 検証

- 記録なし、架空/他turn/失敗/controlの根拠、順序違反を拒否。
- 古い前段を引用した後段、insufficient後の証拠使い回しを拒否。
- 不足 → 新しい取得 → observe以降の再評価で復帰。
- 検索は成功してもevidence_fitが不足なら未検証。
- Hostの実PostToolUse/Stop経路で継続要求と有界縮退を検証。
- 旧receipt/directの挙動、既存権限境界、MCP入力検証を回帰試験。

## 運用

PR/CIで統合し、稼働runtimeへの反映と新規turnでの実証は別に報告する。

## CodexネイティブMCP証拠の昇格

`functions.exec` などのオーケストレータ内で実行されたMCPは、外側のtool responseだけで意味を再構成しない。Hostは許可済みtranscript root内のCodex所有JSONLを読み、現在のsessionとroot turnに一致する `event_msg.item_completed` の `McpToolCall` を照合する。

`status=completed`、構造化arguments、エラーでないresultを満たす呼び出しを、元の `server`・`tool`・`id` のまま通常イベントへ昇格する。既存イベントとの同一ID再生は冪等、内容競合はfail closedとする。組織Brainbase serverは既存PostToolUseとの二重記録を避け、オーケストレータで可視性が失われる別serverの成功呼び出しを対象にする。

昇格したイベントが判断根拠として適格なら、既存のPostToolUse `systemMessage` と同じ形式で不透明な参照IDを返す。本文やsecretは通知せず、適合性評価は引き続きモデルとnode evaluatorが担う。

## 実装検証結果（2026-09-19）

- Node 22.23.2と作業領域専用の依存関係で `npm run test:judgment-resolution` が成功。判断系644件、MCP373件、root/MCPの型検査が通過。レビューで管理系イベントの除外と不足時の追加実行チェックを修正し、全件を再検証済み。開始失敗からの復旧32件も成功。
- Hostの実PostToolUse/Stopテストで、参照IDの通知、入力と応答の一致、架空/失敗/control根拠の拒否、不足後の追加取得と復帰、修復上限、人間承認の優先を確認。
- Graphifyの影響確認はpartial、freshness/impactはunknown。新規ファイルは未収録のため、直接の呼び出し関係と上記回帰試験で補った。無影響とは扱わない。
- 意味の妥当性や、人間行動の予測精度が改善したという実証ではない。稼働中runtimeの反映と、新規turnで適切な先行研究へ自律的に戻れるかは別の検証を要する。
