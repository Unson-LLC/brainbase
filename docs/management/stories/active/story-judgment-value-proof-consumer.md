# Story: 判断価値証跡をCodex完了応答へ接続する

## 利用者価値

Brainbase利用者として、AIが自分へ確認せずに進めた判断、または人間へ戻した判断を、実際の成果と境界が分かるレシートとして完了直後に確認したい。これにより、Brainbaseが仕事を前へ進めた事実を成果物単位で判断できる。

## 背景

公開Coreの`brainbase-judgment-value-proof-v1`はPR #497でマージ済みだが、consumerのJudgment Resolver HostとMCPへ接続されていない。既存の未PRブランチには統合作業がある一方、無関係なVibePro証跡の大量削除と自己更新CIが混入しており、そのまま本線へ載せられない。この変更は既存の単一利用者向けローカルCLI journal内だけを扱う。

## 受け入れ基準

- [x] AC-001: `@unson/brainbase-mcp`をCore PR #497のmerge SHAへ固定し、公開`judgment-value-proof` subpathをconsumerから利用する。
- [x] AC-002: MCP toolは代理判断、人間判断、実行、結果、根拠、証拠参照を構造化入力として受け付け、秘密情報や未検証結果を成功へ変換しない。
- [x] AC-003: Judgment Resolver Hostは同一turnのTool Event、Stop状態、Outcome証拠を`intent_id`と`decision_attempt_id`へ投影する。
- [x] AC-004: 代理判断または人間判断が実際に記録された場合だけ、Codexの完了時にCore Rendererの判断レシートを表示する。
- [x] AC-005: 各成果物が同一turnの実行eventと、その後の結果あり読み戻しeventの両方へ束縛されない`outcome_verified`は`unconfirmed`へ落とし、不明値を0へ変換しない。
- [x] AC-006: `human_required`は通常続行と分離し、理由、選択肢、影響を表示する。
- [x] AC-007: Core SchemaやRendererを`brainbase-unson`へ複製しない。
- [x] AC-008: 既存VibePro証跡の削除やブランチ自己更新CIを変更へ含めない。
- [x] AC-009: 「確認を省略した」という表示は、Hostが同一turnで実際に差し戻した質問と一致する場合だけ生成する。
- [x] AC-010: `human_required`は、同一turnの`waiting_human`状態と最終回答に表示した質問が一致する場合だけ生成する。
- [x] AC-011: 本番展開は既定OFFとし、明示的な全体有効化またはproject allowlistによるcanaryだけで表示する。

## 対象外

- Slack、Mana、Web画面の専用カード
- 週次配信ジョブ
- 人間の訂正を学習候補へ昇格する処理
- 本番Hookが新しいレシートを表示したというfresh-task実証（このPRは既定OFF）
