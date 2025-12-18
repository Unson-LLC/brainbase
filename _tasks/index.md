# 日次ルーティン

## 受託開発アクション（毎日1回）

**目的**: 受託開発案件のパイプラインを継続的に構築する

**トリガー**: 朝のSlack確認後（9:00目安）

**選択肢（1つ以上実行）**:
- [ ] 声かけ: 既存ネットワーク1人にDM/連絡（5分）
- [ ] 紹介依頼: 過去クライアント/パートナーに「困ってる人いない？」（5分）
- [ ] フォローアップ: 商談中の案件に進捗確認連絡（10分）
- [ ] 提案作成: 見積もり/提案書を1件進める（30分）
- [ ] SNS発信: X/LinkedInで実績・事例を1投稿（15分）
- [ ] BAAO活用: 受講生/卒業生に案件ヒアリング（10分）
- [ ] TK既存顧客: 過去取引先に追加ニーズ確認（10分）

**記録**:
| 日付 | アクション | 対象 | 結果 |
|------|-----------|------|------|
| 2025-12-19 | - | - | - |

**週次KPI**: 5回/週 達成で継続、未達なら振り返りレポート

---

# 🔥 最優先タスク（12/19-20対応）

---
task_id: T-2512-040
title: ステージング環境の全シークレット・環境変数のローテーション
project_id: proj_dialogai
status: todo
owner: k.​sato
priority: high
due: 2025-12-20
tags: [security, secrets, rotation]
links: ["/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md"]
source: security-audit
created_at: "2025-12-19T09:00:00.000Z"
requester: k.​sato
---

- 2025-12-19 セキュリティ調査で発見: 複数のシークレットがローテーション未実施
- 対象:
  - ✅ /dialogai-staging/staging/DATABASE_URL（2025-12-19完了）
  - /dialogai-staging/staging/NEXTAUTH_SECRET
  - /dialogai-staging/staging/COGNITO_WEBHOOK_SECRET
  - /dialogai-staging/staging/AWS_ACCESS_KEY_ID
  - /dialogai-staging/staging/AWS_SECRET_ACCESS_KEY
- 関連レポート: `/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md`

---

# 📋 完了済みタスク

---
task_id: T-2512-038
title: 【緊急】PostgreSQL 5432ポートの即座閉鎖とパスワード変更
project_id: proj_dialogai
status: done
owner: k.​sato
priority: critical
due: 2025-12-19
tags: [security, critical, postgresql]
links: ["/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md", "/Users/ksato/workspace/ncom-catalyst/security/meetingAI_emergency_response_2025-12-19.md"]
source: security-audit
created_at: "2025-12-19T09:00:00.000Z"
requester: k.​sato
---

- 2025-12-19 セキュリティ調査で発見: PostgreSQLが0.0.0.0/0に公開されている
- 2025-12-19 完了: Phase 1緊急対応実施
  1. ✅ セキュリティグループ sg-056a0eabbd5070ff6 から 5432 の 0.0.0.0/0 ルールを削除
  2. ✅ pg_hba.conf を VPC内部（172.31.0.0/16）のみに制限
  3. ✅ PostgreSQLパスワードを32文字ランダム文字列に変更
  4. ✅ DATABASE_URL を Parameter Store で更新（Version 23）
- 関連レポート:
  - `/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md`
  - `/Users/ksato/workspace/ncom-catalyst/security/meetingAI_emergency_response_2025-12-19.md`

---
---
task_id: T-2512-039
title: 【緊急】SSH (22) ポートのアクセス制限
project_id: proj_dialogai
status: done
owner: k.​sato
priority: critical
due: 2025-12-19
tags: [security, critical, ssh]
links: ["/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md", "/Users/ksato/workspace/ncom-catalyst/security/meetingAI_emergency_response_2025-12-19.md"]
source: security-audit
created_at: "2025-12-19T09:00:00.000Z"
requester: k.​sato
---

- 2025-12-19 セキュリティ調査で発見: SSHが0.0.0.0/0に公開されている
- 2025-12-19 完了: Phase 1緊急対応実施
  - ✅ セキュリティグループ sg-056a0eabbd5070ff6 から 22 の 0.0.0.0/0 ルールを削除
  - ✅ SSM Session Manager経由のみでアクセス可能に変更
- 関連レポート:
  - `/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md`
  - `/Users/ksato/workspace/ncom-catalyst/security/meetingAI_emergency_response_2025-12-19.md`

---
---
task_id: T-2512-021
source_id: SLACK-2025-12-16-MJ8JU2HC
title: ステージング環境のセキュリティ調査と環境変数ローテーション
project_id: proj_dialogai
status: done
owner: k.​sato
priority: highest
due: 2025-12-19
tags: [slack, auto-import, security]
links: ["/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md"]
source: slack
channel_id: C08A6ETSSR2
thread_ts: "1765887507.889679"
created_at: "2025-12-16T12:18:39.504Z"
owner_slack_id: U0971EHBDHB
requester: k.​sato
---

- 2025-12-16 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: ステージング環境のセキュリティ調査を実施し、環境変数のローテーションを今週中に完了する
- Slack: https://unson.slack.com/archives/C08A6ETSSR2/p1765887507889679?thread_ts=1765887000.649509&cid=C08A6ETSSR2
- 2025-12-19 完了: セキュリティ調査完了、レポート作成済み
  - 極めて深刻な脆弱性を複数発見（PostgreSQL 0.0.0.0/0 公開、SSH 0.0.0.0/0 公開等）
  - 緊急対応タスク (T-2512-038, T-2512-039) と環境変数ローテーション (T-2512-040) を新規作成
  - レポート: `/Users/ksato/workspace/ncom-catalyst/security/meetingAI_security_audit_2025-12-19.md`

---
task_id: T-2512-026
title: 佐藤のスケジュールをNコムに共有
project_id: ncom-catalyst
status: done
owner: 佐藤圭吾
priority: highest
due: 2025-12-16
tags: [ncom, schedule, urgent]
links: []
source: manual
created_at: "2025-12-16T09:00:00.000Z"
requester: 佐藤圭吾
---

- 2025-12-16 手動登録: Nコムに自分のスケジュールを共有する
- 2025-12-16 完了: 共有完了

---
---
task_id: T-2512-025
title: Zscalerの接続元情報をNコムに共有
project_id: ncom-catalyst
status: done
owner: 佐藤圭吾
priority: highest
due: 2025-12-16
tags: [ncom, security, zscaler, urgent]
links: []
source: manual
created_at: "2025-12-16T09:00:00.000Z"
requester: 佐藤圭吾
---

- 2025-12-16 手動登録: Zscalerの接続元情報をNコムに共有する
- 2025-12-16 完了: 共有完了

---
---
task_id: T-2512-022
source_id: SLACK-2025-12-16-MJ8JU357
title: Next.jsの最新パッチ適用
project_id: proj_dialogai
status: done
owner: k.​sato
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08A6ETSSR2
thread_ts: "1765887507.889679"
created_at: "2025-12-16T12:18:40.363Z"
owner_slack_id: U0971EHBDHB
requester: k.​sato
---

- 2025-12-16 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: Next.jsの最新セキュリティパッチを適用する
- 2025-12-18 完了: パッチ適用完了（議事録より）
- Slack: https://unson.slack.com/archives/C08A6ETSSR2/p1765887507889679?thread_ts=1765887000.649509&cid=C08A6ETSSR2

---
---
task_id: T-2512-020
source_id: SLACK-2025-12-16-MJ8JU1L3
title: 環境変数とシークレット情報のローテーション実施
project_id: proj_dialogai
status: done
owner: k.​sato
priority: high
due: 2025-12-16
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08A6ETSSR2
thread_ts: "1765887507.889679"
created_at: "2025-12-16T12:18:38.343Z"
owner_slack_id: U0971EHBDHB
requester: k.​sato
---

- 2025-12-16 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: Anthropic APIキーを含む環境変数とシークレット情報のローテーションを最優先で実施する
- 2025-12-18 完了: 短期対応として環境変数・シークレットのローテーション完了（議事録より）
- Slack: https://unson.slack.com/archives/C08A6ETSSR2/p1765887507889679?thread_ts=1765887000.649509&cid=C08A6ETSSR2

---
task_id: T-2512-020
title: DNS設定の教科書作成
project_id: general
status: todo
owner: 佐藤圭吾
priority: medium
due: null
tags: [infrastructure, documentation, dns]
links: []
source: manual
created_at: "2025-12-16T00:00:00.000Z"
requester: 佐藤圭吾
---

- 2025-12-16 手動登録: DNS設定のための教科書を作成
- 担当: 佐藤圭吾
- 目的: DNS設定（ドメイン管理、レコード設定、トラブルシューティング等）に関する体系的なナレッジを整備
- 成果物: `_codex/` 配下にDNS設定ガイドを作成

---
---
task_id: T-2512-019
source_id: SLACK-2025-12-16-MJ8027SP
title: Instantlyのメール設定方法を確認
project_id: general
status: todo
owner: 佐藤圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765854298.989249"
created_at: "2025-12-16T03:05:07.321Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-16 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: Instantlyのメール設定方法について参考にできそうなやり方があるか確認する。既に一度タスク登録されているが、再度登録を依頼されたもの。
- Slack: https://salestailor.slack.com/archives/C08SX913NER/p1765854298989249?thread_ts=1765849247.232309&cid=C08SX913NER

---
task_id: T-2512-018
source_id: SLACK-2025-12-16-MJ7YPEST
title: Instantlyのメール設定方法を確認
project_id: general
status: todo
owner: 佐藤圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765852022.342579"
created_at: "2025-12-16T02:27:10.253Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-16 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: Instantlyのメール設定方法について、参考にできそうなやり方があるか確認する。スレッドで共有された設定方法の情報を確認し、活用可能性を判断する。
- Slack: https://salestailor.slack.com/archives/C08SX913NER/p1765852022342579?thread_ts=1765849247.232309&cid=C08SX913NER

---
task_id: T-2512-017
source_id: SLACK-2025-12-16-MJ7UJZWH
title: 採用のメール返信
project_id: general
status: todo
owner: k.​sato
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C0971UHK4KA
thread_ts: "1765845053.468639"
created_at: "2025-12-16T00:30:59.201Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-16 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: 採用関連のメールに返信する。承認を得て対応可能となった。
- Slack: https://unson.slack.com/archives/C0971UHK4KA/p1765845053468639?thread_ts=1765837823.387609&cid=C0971UHK4KA

---
task_id: T-2512-017
source_id: EMAIL-2025-12-06-KOBAYASHI
title: エンジニア候補者（小林尚司氏）の評価・面接検討
project_id: unson
status: todo
owner: 佐藤圭吾
priority: high
due: 2025-12-17
tags: [recruitment, cxo-meeting, engineer-hiring]
links: []
source: email
created_at: "2025-12-16T00:00:00.000Z"
requester: 佐藤圭吾
---

**CxO会議議題: エンジニア採用候補者の評価**

## 候補者サマリー
- **氏名**: 小林尚司（こばやし・しょうじ）
- **年齢**: 41歳
- **居住地**: 京都府
- **経歴**: 18年（うちフリーランス10年）
- **紹介者**: 川原貴大（Planna）← 山本力哉経由

## 技術評価
**技術スキル**: ★★★★★
- Rails: 10年（SalesTailor完全一致）
- React: 8年
- Vue: 2年
- TypeScript: 5年
- OpenAI API: 実務経験あり

**自律性・タスク完遂力**: ★★★★☆
- フリーランス10年の実績
- 複数の長期プロジェクト経験
- 小松原タイプ（実装特化型）の可能性高

## 採用要件との整合性
✅ 技術スタック: SalesTailorに完全一致（Rails+React+OpenAI）
✅ リモート対応: フリーランス経験から問題なし
⚠️ 安定稼働: **要確認**（週何時間確保できるか）
⚠️ 見積もり能力: **要確認**（タスク見積もり精度）

## 面接で確認すべき事項
1. **週次の稼働可能時間**（最重要）
   - 現在の他案件との兼ね合い
   - 安定的に確保できる時間帯・曜日
2. **報酬期待値**
   - 時給/月額の希望額
   - 予算との整合性確認
3. **働き方の志向**
   - PM型 vs 実装型（小松原タイプ）の確認
   - タスク管理・見積もりの経験とスタンス
4. **プロジェクト選好**
   - SalesTailor / UNSON / Tech Knight のどれに興味があるか

## 次ステップ提案
1. 面接日程調整（1週間以内）
2. 上記確認事項のヒアリング実施
3. トライアル案件の設定（1-2週間程度）
4. 本格稼働の判断

## 関連資料
- 職務経歴書: `/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/unson/採用/職務経歴書_小林尚司.pdf`
- スキルシート: `/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/unson/採用/スキルシート_小林尚司.pdf`
- 初回メール: 2025-12-06 k.sato@unson.jp宛

---
task_id: T-2512-016
source_id: SLACK-2025-12-15-MJ6NDRZ5
title: 資料を送付
project_id: general
status: done
owner: 佐藤圭吾
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C0A3AGMS68M
thread_ts: "1765772537.261089"
created_at: "2025-12-15T04:22:25.505Z"
owner_slack_id: U07B19N048G
requester: 佐藤圭吾
---

- 2025-12-15 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: hp営業チャンネルで資料送付を依頼されている。まだ未対応のため早急に対応が必要。
- Slack: https://tech-knight.slack.com/archives/C0A3AGMS68M/p1765772537261089?thread_ts=1765760058.108799&cid=C0A3AGMS68M

---
task_id: T-2512-015
source_id: SLACK-2025-12-15-MJ6K4HS4
title: 橋本さんの振り込み確認
project_id: general
status: todo
owner: 梅田-遼/haruka umeda
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08Q5V2S2AW
thread_ts: "1765767065.773469"
created_at: "2025-12-15T02:51:13.540Z"
owner_slack_id: U090R3E72UA
requester: 梅田-遼/haruka-umeda
---

- 2025-12-15 Slackから自動取り込み: 梅田 遼/Haruka Umedaから依頼
- 担当: 梅田 遼/Haruka Umeda
- 背景: 弁護士の橋本さんへの支払いについて、請求書が届いているか確認し、届いていれば支払い対象に入れる。11月5日に139,706円の支払い実績あり。無期限タスクとして設定。
- Slack: https://unson.slack.com/archives/C08Q5V2S2AW/p1765767065773469?thread_ts=1764317299.053109&cid=C08Q5V2S2AW

---
task_id: T-2512-014
source_id: SLACK-2025-12-15-MJ6K3LO4
title: Google Workspace移行検証
project_id: salestailor
status: todo
owner: 梅田-遼/haruka umeda
priority: high
due: 2025-12-31
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08Q5V2S2AW
thread_ts: "1765767021.370319"
created_at: "2025-12-15T02:50:31.924Z"
owner_slack_id: U090R3E72UA
requester: 梅田-遼/haruka-umeda
---

- 2025-12-15 Slackから自動取り込み: 梅田 遼/Haruka Umedaから依頼
- 担当: 梅田 遼/Haruka Umeda
- 背景: @sales-tailor.jpのドメインをムームードメインからnamecheapへ移管する際のGoogle Workspace移行検証。サポートから提案されたダミードメイン経由での移行方法（セカンダリドメイン→プライマリ変更→ドメイン名復元）の実現可能性を検証する。また、MBOXファイルからのGmailデータ復元についてはThunderbirdとImportExportTools NGを使用したIMAP経由のアップロード方法で対応可能。Googleカレンダー、メール、サービスログイン系への影響確認が必要。
- Slack: https://unson.slack.com/archives/C08Q5V2S2AW/p1765767021370319?thread_ts=1754023574.589339&cid=C08Q5V2S2AW

---
task_id: T-2512-013
source_id: SLACK-2025-12-15-MJ6K18D9
title: 雲孫会の日程調整
project_id: general
status: todo
owner: 梅田-遼/haruka umeda
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08Q5V2S2AW
thread_ts: "1765766914.927549"
created_at: "2025-12-15T02:48:41.373Z"
owner_slack_id: U090R3E72UA
requester: 梅田-遼/haruka-umeda
---

- 2025-12-15 Slackから自動取り込み: 梅田 遼/Haruka Umedaから依頼
- 担当: 梅田 遼/Haruka Umeda
- 背景: 木曜日に実施する月1の飲み会「雲孫会」の日程を調整さんで調整する。10月開催予定だったが、現在無期限タスクとして管理。
- Slack: https://unson.slack.com/archives/C08Q5V2S2AW/p1765766914927549?thread_ts=1757945410.173519&cid=C08Q5V2S2AW

---
task_id: T-2512-012
source_id: SLACK-2025-12-14-MJ5BVM2G
title: β版リリースに向けたタスクの整理
project_id: zeims
status: done
owner: k.​sato
priority: high
due: 2025-12-20
tags: [slack, auto-import]
links: []
source: slack
channel_id: C07QX6DN9M0
thread_ts: "1765692744.121419"
created_at: "2025-12-14T06:12:36.088Z"
owner_slack_id: U07Q7CUC60J
requester: k.​sato
---

- 2025-12-14 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: Zeimsプロジェクトのβ版リリース（12月末目標）に向けたタスク整理が必要。現在M2マイルストーンは40%進捗で、決済機能実装（#151）が主なブロッカーとなっている。次週の重点タスクとして、決済機能の実装完了、hono-apiリファクタリング着手、βリリースに向けた機能統合が挙げられている。決済機能については、太田さんがStripe決済フロー実装、プラン選択UI、サブスクリプション管理画面、請求書発行を年内に完了できる見込み。
- Slack: https://unson.slack.com/archives/C07QX6DN9M0/p1765692744121419?thread_ts=1765690385.108219&cid=C07QX6DN9M0

---
task_id: T-2512-018
source_id: MILESTONE-M2-KR1
title: 【M2】決済機能実装完了（Stripe決済フロー稼働）
project_id: zeims
status: in_progress
owner: 川合秀明
priority: high
due: 2025-12-25
tags: [milestone, m2, payment, critical]
links: []
source: milestone
created_at: "2025-12-16T07:30:00.000Z"
requester: 佐藤圭吾
progress: 40
---

**M2マイルストーン Key Result #1**

## 目標
決済フロー（Stripe連携）を完全稼働させ、β版で有料化を可能にする

## 実装スコープ
- [ ] Stripe決済フロー実装
- [ ] プラン選択UI
- [ ] サブスクリプション管理画面
- [ ] 請求書発行機能

## 完了条件
- 実際にテスト決済が通る
- 月額3,000円 + オートチャージ方式が稼働
- サブスクリプション管理画面で契約状況が確認できる

## 参照
- milestone_spf_pmf.md:115-126
- 進捗: 40% → 100%（期限: 12/25）

---
task_id: T-2512-019
source_id: MILESTONE-M2-KR2
title: 【M2】ChatGPT-5.1切り替え実装
project_id: zeims
status: todo
owner: 太田葉音
priority: high
due: 2025-12-27
tags: [milestone, m2, llm, model-upgrade]
links: []
source: milestone
created_at: "2025-12-16T07:30:00.000Z"
requester: 佐藤圭吾
---

**M2マイルストーン Key Result #2**

## 目標
ChatGPT-5.1（または最新モデル）への切り替えを完了

## 実装スコープ
- [ ] モデルバージョンの更新
- [ ] 既存プロンプトの互換性確認
- [ ] レスポンス品質の検証
- [ ] コスト影響の確認

## 完了条件
- 本番環境でChatGPT-5.1が稼働
- 既存機能（チャット/ディープリサーチ/事務所ルール）が正常動作
- 回答品質が劣化していないことを確認

## 参照
- milestone_spf_pmf.md:122

---
task_id: T-2512-020
source_id: MILESTONE-M2-KR3
title: 【M2】LP正式公開（ロゴ掲載4件）
project_id: zeims
status: todo
owner: 川合秀明
priority: high
due: 2025-12-30
tags: [milestone, m2, marketing, landing-page]
links: []
source: milestone
created_at: "2025-12-16T07:30:00.000Z"
requester: 佐藤圭吾
---

**M2マイルストーン Key Result #3**

## 目標
LP（service.zeims.ai）を正式公開し、βパートナーのロゴ掲載を完了

## 実装スコープ
- [ ] βパートナー4社のロゴ掲載許可取得
- [ ] LP デザイン最終調整
- [ ] 価格ページの公開
- [ ] FAQ / 利用規約の整備

## 完了条件
- service.zeims.ai が正式公開状態
- βパートナーロゴが4件以上掲載
- 価格ページ・利用規約がアクセス可能

## 参照
- milestone_spf_pmf.md:123

---
task_id: T-2512-021
source_id: MILESTONE-M2-FINAL
title: 【M2】β版リリース最終チェックリスト
project_id: zeims
status: todo
owner: 川合秀明
priority: high
due: 2025-12-31
tags: [milestone, m2, release, checklist]
links: []
source: milestone
created_at: "2025-12-16T07:30:00.000Z"
requester: 佐藤圭吾
---

**M2マイルストーン 最終リリースチェック**

## GTMチェックリスト

### 機能確認
- [ ] 決済機能が正常稼働（T-2512-018）
- [ ] ChatGPT-5.1が稼働（T-2512-019）
- [ ] LP正式公開完了（T-2512-020）
- [ ] 全主要機能の動作確認（チャット/ディープリサーチ/事務所ルール）

### ドキュメント
- [ ] 利用規約の最終レビュー
- [ ] プライバシーポリシー確認
- [ ] FAQ整備
- [ ] オンボーディング資料（M3へ繰越可）

### 運用準備
- [ ] βパートナー23社への告知準備
- [ ] CS体制の確認（問い合わせ対応フロー）
- [ ] 監視体制（エラー監視・アラート設定）

### リリース判定
- [ ] 川合GM最終承認
- [ ] 佐藤CTO技術承認
- [ ] 重大バグゼロ確認

## 完了条件
全チェック項目がクリアされ、2025/12/31にβ版（M2）が一般公開される

## 参照
- milestone_spf_pmf.md:115-128
- zeims_task_plan.csv:91（GTMチェックリスト）

---
task_id: T-2512-011
source_id: SLACK-2025-12-13-MJ4WDN2U
title: mana機能テストのレポートをまとめる
project_id: general
status: todo
owner: k.​sato
priority: medium
due: 2025-12-20
tags: [slack, auto-import]
links: []
source: slack
channel_id: C0A2L9FEKEJ
thread_ts: "1765666717.074099"
created_at: "2025-12-13T22:58:43.350Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-13 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: 機能テスト5: mana機能テストのレポートをまとめる作業。12/20が期限。
- Slack: https://unson.slack.com/archives/C0A2L9FEKEJ/p1765666717074099?thread_ts=1765666717.074099&cid=C0A2L9FEKEJ

---
task_id: T-2512-010
source_id: SLACK-2025-12-13-MJ4UYMVN
title: テスト用ダミータスクを登録
project_id: general
status: todo
owner: k.​sato
priority: low
due: 2025-12-20
tags: [slack, auto-import]
links: []
source: slack
channel_id: C0A2L9FEKEJ
thread_ts: "1765664338.746509"
created_at: "2025-12-13T22:19:03.635Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-13 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: 機能テスト4: テスト用ダミータスクを登録（12/20まで）
- Slack: https://unson.slack.com/archives/C0A2L9FEKEJ/p1765664338746509?thread_ts=1765664338.746509&cid=C0A2L9FEKEJ

---
task_id: T-2512-009
source_id: SLACK-2025-12-13-MJ3TUPSX
title: Airtableコメント通知機能を設定
project_id: general
status: in-progress
owner: 佐藤圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765602006.481219"
created_at: "2025-12-13T05:00:15.009Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-13 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: Airtableのタスクにコメントが書き込まれた際にSlackへ通知する機能を設定する。Airtable Automationsを使用する方法が推奨されている（When record is updated → コメントフィールド変更 → Slack通知）。佐藤圭吾が「いけそうですね 設定しときます」と対応を表明。
- Slack: https://salestailor.slack.com/archives/C08SX913NER/p1765602006481219?thread_ts=1765599329.019109&cid=C08SX913NER

---
task_id: T-2512-008
source_id: SLACK-2025-12-13-MJ3RNYP5
title: ZeimsリポジトリにGemini GitHub連携を設定
project_id: zeims
status: todo
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C07QX6DN9M0
thread_ts: "1765598332.139369"
created_at: "2025-12-13T03:59:00.713Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-13 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: Gemini GitHubをzeimsで使えるように設定する。info@unson.jpのアカウントを使用。GitHubリポジトリのオーナー権限が必要なため佐藤が対応。太田より使い勝手が良いとのフィードバックあり。
- Slack: https://unson.slack.com/archives/C07QX6DN9M0/p1765598332139369?thread_ts=1765582766.259189&cid=C07QX6DN9M0

---
task_id: T-2512-007
source_id: SLACK-2025-12-13-MJ3RNXF2
title: ZeimsリポジトリにGemini GitHub連携を設定
project_id: zeims
status: todo
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C07QX6DN9M0
thread_ts: "1765598332.139369"
created_at: "2025-12-13T03:58:59.054Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-13 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: Gemini Code Assist (https://github.com/apps/gemini-code-assist) をZeimsで使えるように設定する。info@unson.jpのGoogleアカウントを使用。GitHubリポジトリのオーナー権限が必要なため佐藤が対応。参考資料: https://qiita.com/nero-15/items/6657f6308bb47f2e3e48
- Slack: https://unson.slack.com/archives/C07QX6DN9M0/p1765598332139369?thread_ts=1765582766.259189&cid=C07QX6DN9M0

---
task_id: T-2512-006
source_id: SLACK-2025-12-11-MJ181TOH
title: notion完成→Wordに転記
project_id: ncom
status: done
owner: k.​sato
priority: high
due: 2025-12-12
tags: [slack, auto-import]
links: []
source: slack
channel_id: C091KFKE3RS
thread_ts: "1765444456.994779"
created_at: "2025-12-11T09:14:22.721Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-11 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: 明日までにnotionを完成させてWordに転記。特に以下を対応：(1)記載重複している部分の修正、(2)RDBに格納されているデータは○○、個人情報・機密情報ではない旨を明記（申請内容と合わせる）
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1765444456994779

---
task_id: T-2512-005
source_id: SLACK-2025-12-11-MJ180SCG
title: notion完成⇒Wordに転記
project_id: ncom
status: done
owner: k.​sato
priority: high
due: 2025-12-12
tags: [slack, auto-import]
links: []
source: slack
channel_id: C091KFKE3RS
thread_ts: "1765444406.078259"
created_at: "2025-12-11T09:13:34.336Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-11 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: notionを完成させWordに転記する。記載重複部分の修正、RDBに格納されているデータの明記（個人情報・機密情報ではない旨を申請内容と合わせて記載）を実施。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1765444406078259

---
task_id: T-2512-004
source_id: SLACK-2025-12-11-MJ112XUS
title: Stripeアカウントの設定情報を埋める
project_id: zeims
status: todo
owner: k.​sato
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C07QX6DN9M0
thread_ts: "1765432748.808099"
created_at: "2025-12-11T05:59:17.476Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-11 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: Stripeアカウントで一部設定が足りていない警告が出ているため、ログインして設定情報を埋める必要がある。太田さんからの依頼。
- Slack: https://unson-inc.slack.com/archives/C07QX6DN9M0/p1765432748808099

---
task_id: T-2512-003
source_id: SLACK-2025-12-10-MJ0IREQ3
title: デモ動画の構成をまとめて仕上げる
project_id: general
status: todo
owner: k.​sato
priority: medium
due: 2025-12-12
tags: [slack, auto-import]
links: []
source: slack
channel_id: C0A2L9FEKEJ
thread_ts: "1765401980.665769"
created_at: "2025-12-10T21:26:26.379Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: タスク追加テスト。デモ動画の構成をまとめて金曜日までに仕上げる
- Slack: https://unson-inc.slack.com/archives/C0A2L9FEKEJ/p1765401980665769

---
id: SLACK-2025-12-10-MJ0GZJAI
title: 展示会用デモ動画を金曜日までに仕上げる
project_id: mktg
status: todo
owner: 佐藤圭吾
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08G8C5TYQ2
thread_ts: "1765398998.628039"
created_at: "2025-12-10T20:36:46.314Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-10 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 展示会まであと1週間。セキュリティインシデント対応により当初予定より遅れているが、金曜日までに動画を完成させる。
- Slack: https://unson-inc.slack.com/archives/C08G8C5TYQ2/p1765398998628039

---
id: SLACK-2025-12-10-MJ0GZIYJ
title: 展示会用デモ動画の構成を文章ベースでまとめる
project_id: mktg
status: todo
owner: 佐藤圭吾
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08G8C5TYQ2
thread_ts: "1765398998.628039"
created_at: "2025-12-10T20:36:45.883Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-10 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 展示会まであと1週間。木曜mtgで確認予定だったが、セキュリティインシデント対応により遅延。動画の構成を文章ベースでまとめて金曜日に仕上げる予定。
- Slack: https://unson-inc.slack.com/archives/C08G8C5TYQ2/p1765398998628039

---
id: ZEIMS-2025-12-11-CODEX-SYNC
title: zeims-project _codex自動同期の仕組み構築
project_id: zeims
status: todo
owner: k.sato
priority: medium
due: null
tags: [milestone, automation]
links: []
source: manual
created_at: "2025-12-11T04:35:00.000Z"
---

- 2025-12-11 手動追加
- 担当: k.sato
- 背景: brainbase `_codex/projects/zeims/` を正本とし、zeims-projectにコピー運用中。将来的にGitHub ActionsまたはHookで自動同期を構築する。
- 現状: 手動コピー運用（同期コマンドは `zeims-project/_codex/README.md` に記載）
- 同期対象: project.md, history.md, brand.md, org.md, glossary.md, decisions/

---
task_id: T-2512-002
source_id: SLACK-2025-12-10-MJ0F13FI
title: Airtable同期テスト2回目
project_id: general
status: todo
owner: k.​sato
priority: medium
due: 2024-12-15
tags: [slack, auto-import]
links: []
source: slack
channel_id: C0A2L9FEKEJ
thread_ts: "1765395711.472989"
created_at: "2025-12-10T19:41:59.838Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: Airtable同期テストの2回目実施。優先度medium、期限は12/15。
- Slack: https://unson-inc.slack.com/archives/C0A2L9FEKEJ/p1765395711472989

---
task_id: T-2512-001
source_id: SLACK-2025-12-10-MJ0EZATP
title: Airtable同期機能のE2Eテスト
project_id: general
status: done
owner: k.​sato
priority: high
due: 2024-12-13
tags: [slack, auto-import]
links: []
source: slack
channel_id: C0A2L9FEKEJ
thread_ts: "1765395630.417559"
created_at: "2025-12-10T19:40:36.109Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: Airtable同期機能のE2Eテストを実施する。優先度高で12/13期限。
- Slack: https://unson-inc.slack.com/archives/C0A2L9FEKEJ/p1765395630417559

---
id: SLACK-2025-12-10-MIZZANSG
title: 小川とのタスク分担および進捗管理体制の確立
project_id: general
status: done
owner: k.​sato
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C09AEA6DBA7
thread_ts: "1765369281.002249"
created_at: "2025-12-10T12:21:32.272Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: 小川とのタスク分担および進捗管理体制の確立と運用を開始する。まなちゃんを活用し、タスク管理と進捗報告を自動化する仕組みを構築中。
- Slack: https://unson-inc.slack.com/archives/C09AEA6DBA7/p1765369281002249

---
id: SLACK-2025-12-10-MIZZANAO
title: GitHubおよびGoogleドライブのドキュメント管理体制展開
project_id: general
status: todo
owner: k.​sato
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C09AEA6DBA7
thread_ts: "1765369281.002249"
created_at: "2025-12-10T12:21:31.632Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: GitHubおよびGoogleドライブ上のドキュメント管理体制を全関係者に展開し共有開始する。議事録・ドキュメント管理の仕組みを構築し、AIによる会議内容の自動処理と検索性向上を推進。
- Slack: https://unson-inc.slack.com/archives/C09AEA6DBA7/p1765369281002249

---
id: SLACK-2025-12-10-MIZZAMVP
title: 戦略レポート作成とサンキョウ向け提案資料準備
project_id: general
status: todo
owner: k.​sato
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C09AEA6DBA7
thread_ts: "1765369281.002249"
created_at: "2025-12-10T12:21:31.093Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: Senriganのヒアリング内容をもとに戦略レポートを作成し、サンキョウ向け提案資料を準備する。事業構造・ICP・提供価値を整理した上で三共向け提案資料として展開する方針。
- Slack: https://unson-inc.slack.com/archives/C09AEA6DBA7/p1765369281002249

---
id: SLACK-2025-12-10-MIZZ6FRY
title: Zeims DriveからZeims Projectリポジトリへ移行
project_id: zeims
status: done
owner: k.​sato
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C09V8RW3THS
thread_ts: "1765369085.338919"
created_at: "2025-12-10T12:18:15.262Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: プロジェクト管理体制の見直しに伴い、Zeims DriveをZeims Projectリポジトリに統合・最新化する。AIエージェント（mana）が全プロジェクトの情報を横断的に管理できる体制を構築。
- Slack: https://unson-inc.slack.com/archives/C09V8RW3THS/p1765369085338919

---
id: SLACK-2025-12-10-MIZZ6FCW
title: PL表を月次単位に修正し共有
project_id: zeims
status: todo
owner: k.​sato
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C09V8RW3THS
thread_ts: "1765369085.338919"
created_at: "2025-12-10T12:18:14.720Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: 現在クォーター単位で作成されているPL表を月次ベースに修正する。月次でないと「どの月がヤバいか」「いつ黒字化するか」が見えないため、必ず月次で管理する必要がある。
- Slack: https://unson-inc.slack.com/archives/C09V8RW3THS/p1765369085338919

---
id: SLACK-2025-12-10-MIZZ5FOY
title: 12月21日定例の別日程調整
project_id: ncom
status: todo
owner: k.​sato
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08A6ETSSR2
thread_ts: "1765369041.829949"
created_at: "2025-12-10T12:17:28.498Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-10 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: 12月21日の定例MTGについて、金田が他の用事で参加不可のため、別日程への調整が必要。会議要約のアクションアイテムとして佐藤が今週中に調整することになっている。
- Slack: https://unson-inc.slack.com/archives/C08A6ETSSR2/p1765369041829949

---
id: SLACK-2025-12-09-MIYQQWXZ
title: リード用語の削除・具体的指標名への変更
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: low
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765294451.986849"
created_at: "2025-12-09T15:34:27.911Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 「リード」の定義が曖昧なため、デフォルト表示から削除し「返信数」「返信率」など具体的な指標名に変更。優先度見直し後に対応予定。
- Slack: https://unson-inc.slack.com/archives/C08SX913NER/p1765294451986849

---
id: SLACK-2025-12-09-MIYQQWFV
title: 商談化率表示の改善（薄暗い表示を目立たせる）
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: low
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765294451.986849"
created_at: "2025-12-09T15:34:27.259Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 商談化率の表示が薄暗くて見づらいため、もっと目立たせる改善を実施。優先度見直し後に対応予定。
- Slack: https://unson-inc.slack.com/archives/C08SX913NER/p1765294451986849

---
id: SLACK-2025-12-09-MIYQQVZF
title: 本番環境エラーについて渡辺氏に確認
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765294451.986849"
created_at: "2025-12-09T15:34:26.667Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 「渡辺レター品質テスト4.5」プロジェクトで本番環境のみ「データ取得に失敗しました」エラーが発生。ステージング環境では正常表示。また本番環境とステージング環境で色が異なる現象も確認。
- Slack: https://unson-inc.slack.com/archives/C08SX913NER/p1765294451986849

---
id: SLACK-2025-12-09-MIYQQVFF
title: ステージング環境の複数バージョンについて渡辺氏に確認
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765294451.986849"
created_at: "2025-12-09T15:34:25.947Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 親ステージングと子ステージングが存在し、どちらで確認依頼をしていたか不明。渡辺氏復帰後に確認が必要。
- Slack: https://unson-inc.slack.com/archives/C08SX913NER/p1765294451986849

---
id: SLACK-2025-12-09-MIYQQV0Z
title: 「要対応」「未入力」の定義を渡辺氏に確認
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765294451.986849"
created_at: "2025-12-09T15:34:25.427Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 分析画面のKPIサマリーにおける「要対応系ペア」「未入力系ペア」の定義が不明確。渡辺氏との議論時に決められた内容のため、復帰後に確認が必要。
- Slack: https://unson-inc.slack.com/archives/C08SX913NER/p1765294451986849

---
id: SLACK-2025-12-09-MIYQQUJ3
title: ステージング環境のURL・ID・パスを藤井に共有
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: high
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08SX913NER
thread_ts: "1765294451.986849"
created_at: "2025-12-09T15:34:24.783Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: ドッグフィーディング実施のため、藤井志穂にステージング環境の接続情報を共有する。今週中の対応が必要。
- Slack: https://unson-inc.slack.com/archives/C08SX913NER/p1765294451986849

---
id: SLACK-2025-12-09-MIYQPGPD
title: 中長期開発計画（4月以降）の策定
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: medium
due: 2025-01-31
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08U2EX2NEA
thread_ts: "1765294371.536769"
created_at: "2025-12-09T15:33:20.209Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 1月役員会で提示予定の中長期開発計画を策定。4月以降の開発ロードマップを明確化する。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765294371536769

---
id: SLACK-2025-12-09-MIYQPG57
title: 短期開発計画（1-3月）のマイルストーン再設定
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: medium
due: 2025-01-15
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08U2EX2NEA
thread_ts: "1765294371.536769"
created_at: "2025-12-09T15:33:19.483Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 当初の「分析改善機能2月末」「ダッシュボード2月末」などの計画を、開発完了基準明確化の議論を踏まえて再設定。来月の役員会までにマイルストーンを提示。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765294371536769

---
id: SLACK-2025-12-09-MIYQPFOZ
title: 返信追跡機能・方式1（OAuth連携）の実現可能性再検討
project_id: salestailor
status: todo
owner: 佐藤圭吾
priority: medium
due: 2024-12-13
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08U2EX2NEA
thread_ts: "1765294371.536769"
created_at: "2025-12-09T15:33:18.899Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 返信・再返信まで追跡可能な方式1（OAuth連携）について、メール委任設定を含めた実現可能性を再検討。堀CEOの要件（返信・再返信追跡、フォーム送信での専用アドレス必須）を満たす技術的検討。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765294371536769

---
id: SLACK-2025-12-09-MIYQPF7E
title: LLM as Judgeプロトタイプの完成と渡辺氏への引き渡し
project_id: salestailor
status: done
owner: 佐藤圭吾
priority: medium
due: 2024-12-14
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08U2EX2NEA
thread_ts: "1765294371.536769"
created_at: "2025-12-09T15:33:18.266Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: レター品質を自動評価する仕組みの設計完了。Tier 0/1/2/3の3段階構造に再設計済み。プロトタイプを今週末までに渡辺氏に引き渡し、Slackに品質スコア通知が届く体制を構築。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765294371536769

---
id: SLACK-2025-12-09-MIYQPEQ9
title: 顧客KPI（お試しプラン含む）の正確な把握と定義
project_id: salestailor
status: in-progress
owner: 佐藤圭吾
priority: high
due: 2024-12-16
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08U2EX2NEA
thread_ts: "1765294371.536769"
created_at: "2025-12-09T15:33:17.649Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: CS目標の具体化のため、現在動いている案件の顧客KPIを正確に把握する。お試しプランを含めるか、どの数値を目標とするか、初回商談化率1%以上などの定義を明確化。来週の会議で協議予定。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765294371536769

---
id: SLACK-2025-12-09-MIYQPEC6
title: 標準フロー・異常フローの定義（たたき台作成）
project_id: salestailor
status: done
owner: 佐藤圭吾
priority: high
due: 2024-12-16
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08U2EX2NEA
thread_ts: "1765294371.536769"
created_at: "2025-12-09T15:33:17.142Z"
owner_slack_id: U08FB9S7HUL
requester: 佐藤圭吾
---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 開発完了基準の明確化のため、標準フローと異常フローのたたき台を作成し、来週の会議で協議する。12月29日の堀氏による実使用テストに向けた準備。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765294371536769

---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: She Nei MTGの議事録から佐藤圭吾氏に割り当てられたタスクを抽出し、_taskチャンネルに登録する作業。スレッド内で既に1件のタスクが登録済みであることが確認されている。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765293057720219

---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 佐藤圭吾さんのタスクを全て_taskシステムに登録する作業。具体的なタスク内容の詳細は別途確認が必要。
- Slack: https://unson-inc.slack.com/archives/C08U2EX2NEA/p1765292737545469

---

- 2025-12-09 Slackから自動取り込み: 佐藤圭吾から依頼
- 担当: 佐藤圭吾
- 背景: 佐藤圭吾さんの宿題を_taskに登録する作業
- Slack: https://unson-inc.slack.com/archives/C08SX913NER/p1765274673574629

---
id: SLACK-2025-12-09-MIY31F81
title: サブ口座を確認する
project_id: general
status: todo
owner: k.​sato
priority: low
due: null
tags: [slack, auto-import]
links: []
source: slack
channel_id: C08Q5V2S2AW
thread_ts: "1765254639.381049"
created_at: "2025-12-09T04:30:47.377Z"
owner_slack_id: U07LNUP582X
requester: k.​sato
---

- 2025-12-09 Slackから自動取り込み: k.​satoから依頼
- 担当: k.​sato
- 背景: バックオフィス業務として、サブ口座の確認が必要。
- Slack: https://unson-inc.slack.com/archives/C08Q5V2S2AW/p1765254639381049

# Tasks Index

<!-- AI PMによるSlackからのタスク自動取り込み用 -->
<!-- フォーマット: YAML front matter + Markdown -->

---

- 2025-12-07 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 今日の板橋区の天気を確認する
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765110271070309

---

- 2025-12-07 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 今日の板橋区の天気情報を確認する
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765109483854439

---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: AIが持っている知識の範囲について質問。どこまでの知識を持っているかの確認を求められている。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765032958470889

---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: AIが保持している知識の範囲について質問。どこまでの知識を持っているか確認したい。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765032958470889

---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: AIが持っている知識の範囲について質問。どこまでの知識を持っているかの確認依頼。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765032958470889

---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: AIが持っている知識や情報の範囲について確認したい。どこまでの知識を保持しているかを知りたい。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765032958470889

---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 送信者から「あなたの知ってることを教えて」という情報共有の依頼。具体的な内容や範囲は明示されていないため、詳細の確認が必要。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765029242037789

---
id: SLACK-2025-12-06-MIUCVS2B
title: 知識・情報の共有依頼
project_id: general
status: done
owner: 佐藤-圭吾
priority: low
due: null
tags: [slack, auto-import]
links: []
---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 送信者から「あなたの知ってることを教えて」という情報提供の依頼。具体的なテーマや範囲は指定されていないため、詳細の確認が必要。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765029242037789

---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: k.satoから「あなたの知ってることを教えて」という情報提供の依頼。具体的なトピックや範囲は指定されていないため、追加の確認が必要。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765029242037789

---

- 2025-12-06 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: k.satoからの質問依頼。相手が知っている情報や知識の共有を求められている。
- Slack: https://unson-inc.slack.com/archives/C0971UHK4KA/p1765029242037789

---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 不明点があれば来週MTGを再設定し、開発項目の最終精査を行う。担当は畑貴之。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS88CVN
title: 同時接続数拡張の妥当性を数学的に計算
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-09
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 利用者数と被り確率を用いて同時接続数拡張の妥当性を数学的に計算し、70名対応の要否を再判断する。来週が期限。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS88CEH
title: SS運用範囲・体制・マニュアル内容の畑氏への共有
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-06
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: ソリューションサービス部の運用範囲・体制・マニュアル内容を畑氏へ共有する。担当は今村。今週中が期限。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS88BZT
title: 保守契約の考え方整理資料作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-12-05
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 前回契約と今回契約の違い、算定根拠、ホワイトボード図を含めた保守契約の考え方を整理した資料を作成する。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS88BJ6
title: ポンチ絵形式の説明資料作成と見積もり再提出
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-05
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発項目ごとのビフォーアフター、アンケート起因/自発的改善の区別を明示したポンチ絵形式の説明資料を作成し、見積もりを再提出する。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS873DN
title: RA Gateway申請に必要な情報準備と申請書作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-01-XX
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: RA Gateway申請のための準備作業。接続元情報、プロトコル設定、特権ID情報を準備し、マイハブで申請書を作成。今日中に完了が必要。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS872VL
title: 開発提案書をユーザー視点で再構成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-01-XX
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発提案書の再構成作業。ファシリテーション強化・UI/UX改善の2軸で整理し、金額表記に変更。同時接続数を「30名安定稼働/理論値50～60」に修正。利用者の声と開発側要望を表で区分け。見積もり提出期限に合わせて今日中に完了が必要。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS85P1M
title: ネクストアクションのタスクを追加
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 0120-ncomチャンネルにて、ネクストアクションに関するタスクの追加依頼。具体的な内容は要確認。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900070201049

---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 不明点があれば来週MTGを再設定し、開発項目の最終精査を行う。担当は畑貴之氏、来週が期限。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS81UF1
title: 同時接続数拡張の妥当性を数学的に計算
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-13
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 利用者数と被り確率から同時接続数拡張の妥当性を数学的に計算し、70名対応の要否を再判断する。来週が期限。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS81TZE
title: SSの運用範囲・体制・マニュアル内容を畑氏へ共有
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-06
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: ソリューションサービス部の運用範囲・体制・マニュアル内容を畑氏へ共有する。担当は今村氏、今週中が期限。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS81TKC
title: 保守契約の考え方を整理した資料を作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-12-05
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 前回契約と今回契約の違い、算定根拠、ホワイトボード図を含めた保守契約の考え方を整理した資料を作成する。今日中（12/5）が期限。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発項目ごとのビフォーアフター、アンケート起因/自発的改善の区別を明示したポンチ絵形式の説明資料を作成し、見積もりを再提出する。今日中（12/5）が期限。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80LV8
title: RA Gateway申請書作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-01-XX
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: RA Gateway申請に必要な接続元情報・プロトコル設定・特権ID情報を準備し、マイハブで申請書を作成する。今日中に完了させる必要がある。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS80LFG
title: 開発提案書をユーザー視点で再構成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-01-XX
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発提案書をユーザー視点で再構成する。ファシリテーション強化・UI/UX改善の2軸で整理し、金額表記に変更。同時接続数を「30名安定稼働/理論値50～60」に修正。利用者の声と開発側要望を表で区分け。見積もり提出期限に合わせて今日中に完了させる必要がある。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 不明点があれば来週MTGを再設定し、開発項目の最終精査を行う。担当は畑貴之。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80IK9
title: 同時接続数拡張の妥当性を数学的に計算
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-09
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 利用者数と被り確率を用いて同時接続数拡張の妥当性を数学的に計算し、70名対応の要否を再判断する。来週対応予定。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80I3M
title: SS運用範囲・体制・マニュアル内容の共有
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-06
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: ソリューションサービス部の運用範囲・体制・マニュアル内容を畑氏へ共有する。担当は今村。今週中に完了予定。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80HP7
title: 保守契約の考え方を整理した資料作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-12-05
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 前回契約と今回契約の違い、算定根拠、ホワイトボード図を含めた保守契約の考え方を整理した資料を作成する。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80GTZ
title: ポンチ絵形式の説明資料作成と見積もり再提出
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-12-05
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発項目ごとのビフォーアフターを示し、アンケート起因か自発的改善かの区別を明示したポンチ絵形式の説明資料を作成し、見積もりを再提出する。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 不明点があれば来週MTGを再設定し、開発項目の最終精査を行う。担当は畑貴之氏。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80F7M
title: 同時接続数拡張の妥当性を数学的に計算
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-09
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 利用者数と被り確率を用いて同時接続数拡張の妥当性を数学的に計算し、70名対応の要否を再判断する。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80ERG
title: SS運用範囲・体制・マニュアル内容の共有
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-06
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: ソリューションサービス部の運用範囲・体制・マニュアル内容を畑氏へ共有する。担当は今村氏。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80EAS
title: 保守契約の考え方整理資料作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-12-05
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 前回契約と今回契約の違い、算定根拠、ホワイトボード図を含む保守契約の考え方を整理した資料を作成する。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS80DU7
title: ポンチ絵形式の説明資料作成と見積もり再提出
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-12-05
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発項目ごとのビフォーアフター、アンケート起因/自発的改善の区別を明示したポンチ絵形式の説明資料を作成し、見積もりを再提出する。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900191166319

---
id: SLACK-2025-12-05-MIS7Z9C1
title: RA Gateway申請書作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2025-01-XX
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: RA Gateway申請に必要な接続元情報・プロトコル設定・特権ID情報を準備し、マイハブで申請書を作成する。今日中に完了。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS7Z8WZ
title: 開発提案書をユーザー視点で再構成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2025-01-XX
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発提案書をユーザー視点で再構成する。ファシリテーション強化・UI/UX改善の2軸で整理。金額表記に変更し、同時接続数を「30名安定稼働/理論値50～60」に修正。利用者の声と開発側要望を表で区分け。見積もり提出期限に合わせて今日中に完了。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS7Z86P
title: undefined
project_id: general
status: done
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: undefinedから依頼
- 担当: 佐藤 圭吾

- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS7Z7N7
title: RA Gateway申請書作成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: today
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: RA Gateway申請に必要な接続元情報・プロトコル設定・特権ID情報を準備し、マイハブで申請書を作成する。今日中に完了。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS7Z74N
title: 開発提案書をユーザー視点で再構成
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: today
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 開発提案書をユーザー視点で再構成する。具体的には、ファシリテーション強化・UI/UX改善の2軸で整理、金額表記に変更、同時接続数を「30名安定稼働/理論値50～60」に修正、利用者の声と開発側要望を表で区分け。見積もり提出期限に合わせて今日中に完了。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900136838159

---
id: SLACK-2025-12-05-MIS7Z6FW
title: ネクストアクションのタスクを追加
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: ネクストアクションのタスクを追加する必要がある。0120-ncomチャンネルでの依頼。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900070201049

---
id: SLACK-2025-12-05-MIS7XVH3
title: ネクストアクションのタスクを追加
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 0120-ncomチャンネルにて、k.satoよりネクストアクションに関するタスクの追加依頼。具体的な内容については追加の確認が必要。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900070201049

---
id: SLACK-2025-12-05-MIS7XRIL
title: ネクストアクションのタスクを追加
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.satoから依頼
- 担当: 佐藤 圭吾
- 背景: 会議（12-05 Hui Yi Kai Fa）のネクストアクションに関するタスクの追加依頼。会議要約と詳細議事録が共有されており、そこから抽出されたアクションアイテムをタスクとして登録する必要がある。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900070201049

---
id: SLACK-2025-12-05-MIS7XQ92
title: ネクストアクションのタスクを追加
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: null
tags: [slack, auto-import]
links: []
---

- 2025-12-05 Slackから自動取り込み: k.​satoから依頼
- 担当: 佐藤 圭吾
- 背景: 0120-ncomチャンネルにて、ネクストアクションに関するタスクの追加依頼。具体的な内容や詳細は未指定のため、追加のヒアリングが必要。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764900070201049

---
id: SLACK-2025-12-04-MIQSKX3L
title: セキュリティ通知対応フロー整備
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: medium
due: 2024-12-27
tags: [slack, auto-import]
links: []
---

- 2025-12-04 Slackから自動取り込み: k.satoから依頼
- 担当: 佐藤 圭吾
- 背景: セキュリティ通知対応のフローを整備し、最適なフォーマットを作成する。ISMP通知の項目精査と完了基準の定義を含む。来週までに対応。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764813440375719

---
id: SLACK-2025-12-04-MIQSKWND
title: IDCジャパンAIブリーフィング事前質問共有
project_id: ncom
status: todo
owner: 佐藤-圭吾
priority: low
due: 2024-12-27
tags: [slack, auto-import]
links: []
---

- 2025-12-04 Slackから自動取り込み: k.satoから依頼
- 担当: 佐藤 圭吾
- 背景: IDCジャパンのAIブリーフィングに向けて、気になる質問や確認事項があれば事前に共有する。来週までに対応。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764813440375719

---
id: SLACK-2025-12-04-MIQSKW6F
title: RAゲートウェイ導入対応スケジュール確認と回答
project_id: ncom
status: done
owner: 佐藤-圭吾
priority: high
due: 2024-12-19
tags: [slack, auto-import]
links: []
---

- 2025-12-04 Slackから自動取り込み: k.satoから依頼
- 担当: 佐藤 圭吾
- 背景: RAゲートウェイ導入の対応スケジュールを確認し、12月19日までの完了可否を事務局に回答する。今週中に対応が必要。
- Slack: https://unson-inc.slack.com/archives/C091KFKE3RS/p1764813440375719

---
id: FREEE-MCP-2025-12-04
title: freee MCP連携ツール開発
project_id: brainbase
status: todo
owner: 佐藤-圭吾
priority: low
due: null
tags: [mcp, freee, integration, development]
links: []
---

## 概要
freee会計APIとClaude MCPを連携するツールの開発。取引作成・口座確認・証憑アップロードなどをClaude経由で実行可能にする。

## 実装手順

### 1. freeeアプリ登録
- freee Developersで新規アプリを作成
- 控えるもの: CLIENT_ID, CLIENT_SECRET, REDIRECT_URI (例: http://localhost:3333/callback)
- 権限スコープ: read/write系で取引/口座/証憑をカバー
- 審査が必要なスコープは申請

### 2. リポジトリ準備
- 新フォルダ: `tools/freee-mcp/`
- `.env.example` に CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, TOKEN_ENCRYPTION_KEY を配置
- 実値は `.env` にのみ

### 3. MCP Server スケルトン作成
**技術スタック:**
- TypeScript
- Express (HTTP)
- @anthropic-ai/mcp-sdk (MCPサーバ用)
- node-fetch/axios (freee API呼び出し)
- simple-oauth2 (PKCE/refresh)
- crypto (token暗号化保存)

**主なエンドポイント:**
- `GET /auth/start`: 認可URL生成→ブラウザ起動
- `GET /callback`: code受信→token交換→暗号化保存
- `POST /refresh`: refresh tokenで再取得

**MCPツール（最小セット）:**
- `list_companies` (GET /api/1/companies)
- `list_accounts` (GET /api/1/accounts?company_id)
- `create_deal` (POST /api/1/deals)
- `upload_receipt` (POST /api/1/receipts, multipart)
- `list_walletables` (GET /api/1/walletables)

**エラーハンドリング:**
- 401: 自動refresh→再実行
- 429: 指数バックオフ

### 4. 開発用ファイル構成
```
src/
├── config.ts        # env読み込み + バリデーション
├── token-store.ts   # 暗号化保存・ロード
├── freee-client.ts  # APIクライアント（共通ヘッダ、retry）
├── tools.ts         # MCPツール実装
└── server.ts        # MCPエクスポート + OAuthエンドポイント
```
- package.json, tsconfig.json, nodemon.json
- README.md: セットアップとClaude側mcp_servers設定例

### 5. ローカル動作確認
1. `npm install`
2. `.env` 設置
3. `npm run dev` でサーバ起動（http://localhost:3333）
4. ブラウザで http://localhost:3333/auth/start → freeeログイン → token保存
5. `npm run test:ping` で list_companies 疎通確認

### 6. Claude側設定例
```json
{
  "mcp_servers": {
    "freee": {
      "transport": "http",
      "url": "http://localhost:3333"
    }
  }
}
```
ツール呼び出し例: `freee.list_companies`

### 7. セキュリティ/運用メモ
- tokenファイルは暗号化し .gitignore
- CLIENT_SECRET は .env のみ（CIに流さない）
- 本番は HTTPS + 実サーバ or localhost専用リダイレクト
- 会社IDは毎リクエスト必須

---
id: TK-2025-12-08-TOMIOKA
title: 冨岡開発 社長に電話
project_id: tech-knight
status: todo
owner: 佐藤-圭吾
priority: low
due: 2025-12-08
tags: [phone, sales]
links: []
---

- 2025-12-07 手動追加
- 担当: 佐藤 圭吾
- 背景: 冨岡開発の社長に電話連絡

---
id: ST-2025-12-08-PLG-RESEARCH
title: PLG（プロダクト主導成長）の金脈調査
project_id: salestailor
status: todo
owner: 佐藤-圭吾
priority: medium
due: 2025-12-31
tags: [plg, strategy, archetype-feedback]
links: [meetings/minutes/2025-12-08_archetype-ventures-stella-meeting.md]
---

- 2025-12-08 Archetype Ventures面談から抽出
- 担当: 佐藤 圭吾
- 背景: 福井氏より「PLGの金脈が見つかれば投資家説得が爆発的に楽になる」とのフィードバック。セールスレッド以外の「パチッとはまったら営業しなくても儲かる世界」を探る。
- 具体的アクション:
  - PLG成功事例のリサーチ（OpenAI, Notion, Figma等）
  - SalesTailorで適用可能なセルフサーブ機能の洗い出し
  - フリーミアムモデルの検討

---
id: ST-2025-12-08-GITHUB-AI-OS
title: GitHub×AI一元管理のプロダクト応用検討
project_id: salestailor
status: todo
owner: 佐藤-圭吾
priority: medium
due: 2025-12-31
tags: [plg, product, archetype-feedback, brainbase]
links: [meetings/minutes/2025-12-08_archetype-ventures-stella-meeting.md]
---

- 2025-12-08 Archetype Ventures面談から抽出
- 担当: 佐藤 圭吾
- 背景: 会議中にキング（佐藤CTO）が説明した「GitHubで議事録・文字起こし・意思決定履歴を一元管理しAIに読ませる仕組み」に福井氏が強い関心。「全国の中小事業者が欲しがっているもの」との自覚あり。
- 検討事項:
  - 現在のbrainbase運用ノウハウのプロダクト化可能性
  - 「情報一元管理×AI」のMVP設計
  - SalesTailorとの統合 or 別プロダクト化
- 福井氏コメント: 「週末その辺を整理しようと思っていた」→ 次回接点の可能性

---
id: ST-2025-11-28-FREE-DEMO-FIX
title: 【改善依頼】無料デモ - 表記・文面ルール修正
project_id: salestailor
status: todo
owner: 渡邊-博昭
priority: medium
due: null
tags: [slack, improvement, letter-quality]
links: []
---

- 2025-11-28 Slackから取り込み: 堀 汐里から依頼
- 担当: 渡邊博昭（開発）
- チャンネル: #eng
- Slack thread_ts: 1764310750.561739

## 依頼内容

### 1. 誤表記の修正
- 「CTA設定」→「無料デモ」への表記修正
- 要件一覧で「無料デモ」検索してもヒットしない状態

### 2. 文面ルールの修正（5点）
| # | 現状 | 修正後 |
|---|------|--------|
| 1 | 冒頭の名乗りが長い | 社名+名前のみに簡潔化 |
| 2 | 「承知しております」 | 「お見受けしております」 |
| 3 | 「こうした」 | 「このような」 |
| 4 | 「この」 | 「このような」 |
| 5 | CTA非連動（提案と言いつつ日程なし） | CTAを日程調整URLに |

### 3. 品質劣化の原因調査
- 上記以外はとても良い仕上がりだが、本番環境のレター品質が崩れている原因を調査

## 添付
- 画像4枚（具体例のスクリーンショット）

---
id: ST-2025-12-08-PLG-HYBRID
title: PLG×SLGハイブリッドモデルの設計
project_id: salestailor
status: todo
owner: 佐藤-圭吾
priority: medium
due: 2026-01-31
tags: [plg, slg, strategy, archetype-feedback]
links: [meetings/minutes/2025-12-08_archetype-ventures-stella-meeting.md]
---

- 2025-12-08 Archetype Ventures面談から抽出
- 担当: 佐藤 圭吾
- 背景: 福井氏より「T2D3→Q2T3時代のキープレイヤーはPLGとSLGのハイブリッド」との示唆。OpenAIは数百ドル取れており、エンタープライズも取れている。
- 検討事項:
  - セルフサーブで始めてエンタープライズに転換するフロー設計
  - 価格帯ごとの機能制限設計
  - アップセルトリガーの定義

---
id: TK-2025-12-08-CAREER-PARTNERS
title: キャリアパートナーズ 研修見積もり作成
project_id: baao
status: done
owner: 佐藤-圭吾
priority: high
due: null
tags: [sales, estimate, training]
links: [_codex/projects/baao/training/estimate_career_partners.md]
---

- 2025-12-08 手動追加
- 担当: 佐藤 圭吾
- 背景: キャリアパートナーズとの研修案件の見積もりを作成する
- 完了: 2025-12-08 見積もり書作成完了（estimate_career_partners.md）

---
id: TK-2025-12-09-HAGIWARA-PROPOSAL
title: 萩原氏への株式処遇提案（A・B・C案）スライド作成
project_id: tech-knight
status: todo
owner: 佐藤-圭吾
priority: medium
due: 2025-12-15
tags: [meeting, equity, presentation]
links: [meetings/minutes/2025-12-09_unsonos-regular-meeting.md]
---

- 2025-12-09 UnsonOS定例から抽出
- 担当: 佐藤 圭吾
- 背景: 萩原氏のA種優先株15%処遇について3案を提示する
  - A案: 即時株式譲渡＋現金報酬
  - B案: 成功報酬型（疑似Equity）
  - C案: ストックオプション（ベスティング条件付き）
- 成果物: ノートブックLM形式でスライド化

---
id: TK-2025-12-09-AI-PHONE-PROTOTYPE
title: AI電話システム プロトタイプ開発（Pipecat + Deepgram + Cartesia）
project_id: tech-knight
status: todo
owner: 佐藤-圭吾
priority: medium
due: 2025-12-16
tags: [development, naxa, ai-phone]
links: [meetings/minutes/2025-12-09_unsonos-regular-meeting.md]
---

- 2025-12-09 UnsonOS定例から抽出
- 担当: 佐藤 圭吾
- 背景: NAXA案件のレジャーホテル向けAI電話システム
- 技術スタック:
  - OSS基盤: Pipecat
  - STT: Deepgram Nova-3
  - TTS: Cartesia Sonic
- 目標: レイテンシー500ms以下、1通話あたり約15.5円

---
id: TK-2025-12-09-CARTESIA-DICTIONARY
title: Cartesia日本語カスタム辞書作成
project_id: tech-knight
status: todo
owner: 佐藤-圭吾
priority: medium
due: null
tags: [development, naxa, ai-phone, tts]
links: [meetings/minutes/2025-12-09_unsonos-regular-meeting.md]
---

- 2025-12-09 UnsonOS定例から抽出
- 担当: 佐藤 圭吾
- 背景: Cartesia Sonicの固有名詞（ホテル名・部屋タイプ）読み間違い対策
- 前提: AI電話プロトタイプ完成後に着手

---
id: TK-2025-12-09-HOTEL-LP-BACKEND
title: ホテル向けLP（無料プラン）構造設計とバックエンド整備
project_id: tech-knight
status: todo
owner: 佐藤-圭吾
priority: medium
due: 2025-12-11
tags: [development, lp, hotel]
links: [meetings/minutes/2025-12-09_unsonos-regular-meeting.md]
---

- 2025-12-09 UnsonOS定例から抽出
- 担当: 佐藤 圭吾
- 背景: 12月11日の忘年会（ホテル内覧会）までにデモサイト完成
- 分業: 佐藤がバックエンド構造整備 → 石田氏がUI実装（Bolt.new使用）
