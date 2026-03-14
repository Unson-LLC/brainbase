# アーキテクチャ: UnsonOS 用語ルール

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: 用語ルール
- 親文書: [UnsonOS 実行基盤と UI](../frames/unson-os-runtime-ui-frame.md)
- 派生元: [UnsonOS UI コンセプト](./unson-os-ui-concept.md)
- 関連文書: [UnsonOS 文書トレーサビリティ](./unson-os-document-traceability.md), [UnsonOS 文書索引](../unson-os-index.md)
- 置換: なし

## 位置づけ

この文書は、UnsonOS 系文書で使う表示名と内部識別子の対応を固定する。  
原則は次の 2 つ。

1. **画面に出す名前は日本語**
2. **コード・DB・外部連携のキーだけ英語維持**

## 役割名

| 内部識別子 | 画面表示 | 補足 |
|---|---|---|
| `CEO`, `Executive` | 経営者 | UI ではこれで十分 |
| `GM` | 事業責任者 | 会社や事業の運営責任者 |
| `Lead` | 現場責任者 | 区画・進行・承認の現場責任者 |
| `Worker` | 作業者 | 人間作業者と AI 作業者を含めてよい |
| `Operator` | 実務担当 | Brainbase 側の作業文脈で使う |
| `Manager` | 管理者 | 抽象語として使うときだけ |

## 世界観と階層

| 内部識別子 | 画面表示 | 補足 |
|---|---|---|
| `Holding Region` | 事業圏 | `Portfolio` の見え方 |
| `Portfolio` | 事業群 | 経営者が見る最上位単位 |
| `Business` | 事業 | 会社単位・事業単位の両方に寄せやすい |
| `Company City / Campus` | 事業都市 / 事業拠点 | 世界観として使う語 |
| `Bet` | 注力テーマ | どこに張るかの判断単位 |
| `Initiative` | 施策 | 実務ではこれが一番分かりやすい |
| `District` | 区画 | 世界観側の表示名 |
| `Flow` | 進行 | 進行線、進行状況のように使う |
| `Lane` | レーン | カタカナで十分通じる |
| `Checkpoint` | チェックポイント | そのままで可 |
| `Audit` | 監査・証跡 | 文脈に応じて使い分ける |
| `Detail` | 詳細 | これで十分 |
| `Workbench` | 作業台 | Brainbase 文脈に合う |
| `Console` | 操作台 | 開発者向けならコンソールでも可 |

## 画面名・レイヤ名

| 内部識別子 | 画面表示 | 補足 |
|---|---|---|
| `World Layer` | 全体俯瞰面 | 経営者の主画面に近い |
| `Mission Layer` | 経営判断面 | 主戦場 |
| `Flow Layer` | 進行管理面 | 現場責任者と事業責任者の実務面 |
| `Audit Layer` | 監査面 | 証跡・履歴・承認理由を見る |
| `Detail Layer` | 詳細作業面 | Brainbase 側に寄せる |
| `Bet / Initiative Board` | 注力テーマ・施策一覧 | 一覧で十分 |
| `Priority / Allocation Board` | 優先順位・配分表 | 表形式に寄せる |
| `Decision Queue` | 判断待ち一覧 | `queue` より分かりやすい |
| `Blocked List` | 停滞一覧 | 停滞の裁定面 |
| `Evidence Gap List` | 証跡不足一覧 | 不足証跡の裁定面 |
| `Approval History List` | 承認履歴一覧 | 承認と差戻しの履歴 |
| `Flow Lane` | 進行レーン | そのまま使える |
| `Live Ops Panel` | 稼働状況パネル | 分かりやすい |
| `Workbench Drawer` | 作業台 | `Drawer` は実装語なので画面名に出さない |
| `Table Viewer` | 表ビューア | 裁くための表を扱う専用面 |

## 対話 UI

| 内部識別子 | 画面表示 | 補足 |
|---|---|---|
| `Ops Dock` | 即応パネル | 短時間の壁打ち用 |
| `Briefing Room` | 論点整理室 | 深掘り壁打ち用 |
| `Quick wall-bat` | 即応壁打ち | 説明文で使う |
| `Deep wall-bat` | 深掘り壁打ち | 同上 |
| `Ops Brief` | 状況要約 | 一番よく使う入口 |
| `Routing Assist` | 割り振り支援 | reroute や再配置の相談 |
| `Risk Review` | リスク確認 | 承認・境界・危険度の確認 |
| `Evidence Check` | 証跡確認 | 足りない成果物や根拠の確認 |
| `Prepare GM Brief` | 上申整理 | 事業責任者へ上げる前の整理 |
| `Decision Memo` | 判断メモ | 人が決めたことを残す |
| `Escalation Packet` | 上申資料 | `packet` より自然 |
| `Rationale` | 判断理由 | 分かりやすい |
| `Discretion Candidate` | 裁量昇格候補 | 条件付きの事前許可候補 |
| `Pre-approved Candidate` | 事前許可候補 | 昇格前の候補表現 |

## 連絡と判断記録

| 内部識別子 | 画面表示 | 補足 |
|---|---|---|
| `Communication Surface` | 連絡面 | 役割横断の共通面 |
| `Communication Ledger` | 連絡台帳 | 連絡の正本 |
| `Decision Record` | 決定記録 | 判断メモ、上申資料、判断理由を含む |
| `Inbox` | 受信箱 | 判断依頼、承認依頼、証跡要求、上申を集める |
| `Activity Feed` | 稼働通知 | AI や外部ツールから来た変化の要約 |
| `Decision History` | 判断履歴 | 過去の裁定と理由 |
| `Instruction` | 指示 | 何をするかを明示する連絡 |
| `Report` | 報告 | 状況や結果を伝える連絡 |
| `Consultation` | 相談 | 迷いごとや論点の整理依頼 |
| `Decision Request` | 判断依頼 | 人間または上位者の裁定を求める連絡 |
| `Approval Request` | 承認依頼 | 通す・止めるの判定依頼 |
| `Evidence Request` | 証跡要求 | 不足証跡や成果物を求める連絡 |
| `Send Back` | 差戻し | 修正して戻す指示 |
| `Escalation` | 上申 | 上位判断を仰ぐ連絡 |

## 管理 AI の役割名

| 内部識別子 | 画面表示 | 補足 |
|---|---|---|
| `Floor Manager` | 現場統括AI | 現場状況の要約担当 |
| `Dispatcher` | 割り振りAI | 再配置・経路変更担当 |
| `Gatekeeper` | 統制確認AI | 承認・境界・危険度担当 |
| `Archivist` | 証跡整理AI | 成果物・履歴・過去事例担当 |

frontstage では役割名を前に出しすぎず、  
`状況要約 / 割り振り支援 / リスク確認 / 証跡確認` を主に出す。

## 状態・運用ラベル

| 内部識別子 | 画面表示 | 補足 |
|---|---|---|
| `blocked` | 停滞中 | 自然 |
| `approval pending` | 承認待ち | そのまま |
| `run failed` | 実行失敗 | そのまま |
| `artifact missing` | 成果物不足 | 分かりやすい |
| `objective` | 目標 | そのまま |
| `queue` | 待ち列 / 一覧 | 文脈で使い分ける |
| `evidence` | 証跡 | 監査とつながる |
| `artifact` | 成果物 | 実務で分かりやすい |
| `run` | 実行 | 技術者にも通じる |
| `session` | セッション | カタカナでよい |
| `reroute` | 経路変更 / 再割り振り | 文脈で使い分ける |
| `allocation` | 配分 | そのまま |
| `discretion profile` | 裁量プロファイル | 役割や区画ごとの裁量条件 |
| `precedent` | 判断前例 | 過去の裁定の再利用単位 |
| `discretion candidate` | 裁量昇格候補 | 事前許可への昇格候補 |
| `pre-approved` | 事前許可 | 承認済みの裁量条件 |
| `escalation` | 上申 / 上位判断依頼 | 実務ではこちらが伝わる |
| `approval` | 承認 | そのまま |
| `audit trail` | 監査履歴 | そのまま |
| `raw log` | 生ログ | そのまま |
| `decision record` | 決定記録 | 判断の正本 |
| `communication` | 連絡 | 連絡 object 全般 |
| `delivery target` | 配信先 | Slack、メール、GitHub コメントなど |

## 英語を残してよいもの

- `UnsonOS`, `Brainbase`, `OpenGoat`, `Paperclip`
- `AI`
- `API`, `ID`, `URL`
- `terminal`, `log`
- `session` の内部識別子

## 命名ルール

1. 画面名は日本語にする
2. 状態名も日本語にする
3. コード・DB・外部連携だけ英語を残す
4. 世界観語は見出しや投影名に使い、表の列名や判断項目は実務語で書く
