---
story_id: story-graph-data-ssot-normalization
title: Graphデータ正本の重複・欠落を可逆的に正規化する
source_requirement:
  source: Codex task 019f64a6-8bde-7f33-bef9-21e3769c32e0
  approved_at: 2026-07-18
architecture_docs: []
architecture_reason: 既存Graph entity/edge・role_min/sensitivity・InfoSSOTService・Graph API・MCP・transaction/backup契約の範囲内で完結し、新規runtime境界・schema・外部APIを導入しないため
related_tasks:
  - task_source: VibePro
    task_ids: []
status: implemented
created_at: 2026-07-18
updated_at: 2026-07-18
---

# Graphデータ正本の重複・欠落を可逆的に正規化する

## 背景

ライブGraphでは、BAAOと雲孫の組織レコードがcanonical IDと旧IDで物理的に併存し、BAAO projectの表示名が空、BAAO固有のcore Philosophyが未設定になっている。佐藤圭吾のpersonも旧IDとcanonical IDが併存し、認可・RACI参照が分散している。

加えて、CI `graph.decision.vibepro_metrics_ssot` が要求するdecision `dec_vibepro_ai_self_evaluation_metrics_japanese_ssot` がREST/MCPから取得できない。直接DB監査では2026-04-25作成の同一ID・正本payloadが残っていたが、`role_min=gm`のため現在のCI tokenとMCPから不可視だった。監査/event/historyテーブルに意図的廃止を示す証跡はなく、2026-04-26の出荷証跡、Graph SSOT assessment、現行spec、現行CI契約はいずれも同IDを正本として参照している。そのためpayloadは上書きせず、正本の可視性driftだけを修復する。将来レコード自体が欠落した場合のみ、過去証跡とlive frame・用語レコードを突き合わせて同一IDで復元する。

## 正本境界

| 対象 | 正本 | このStoryで行うこと |
|---|---|---|
| 組織・人物・project・decision・Philosophy・edge・RACI・認可参照 | ライブGraph/PostgreSQL | transaction内で正規化し、REST/MCPからreadbackする |
| Graphの期待契約と運用証跡 | brainbase repo | Story、CI check、テスト、監査結果を保持する |
| BAAO事業文書 | BAAO project repo | 参照はrepo相対パスのみ。本文や採用状態は変更しない |
| 秘密・銀行口座 | Graphのfinance権限領域 | 平文をStory、ログ、PR、一般権限payloadへ出さない |

個人の絶対パスをGraphへ保存しない。Graphデータの変更前に対象行の暗号化済み接続先内バックアップを権限`0600`で作り、バックアップ内容は標準出力へ出さない。

## 対象レコード

### BAAO

- canonical org `baao`
- legacy duplicate `org_baao`
- project `prj_01KGCS8BC76XRHFCHRRQ8G25MY` (`code=baao`)
- `org_baao`を参照する`has_raci` / `describes_org` edgeとpayload参照
- BAAO固有のactive/core Philosophy

### 雲孫

- canonical org `unson`
- legacy duplicate `org_unson`
- `org_unson`を参照する`brand_of` / `role_at` edgeとrole payload参照
- legacy payload内のfinance情報のアクセス境界

### 人物・認可

- canonical person `per_01KGYC7NNS0VXADK7NP48W4VR5`
- legacy person `per_01KGYC7NNPNVRG527BGTFH5SGH`
- legacy personを参照する`auth_grants` 1件、`raci_assignments` 8件
- `users`とGraph person entityのcanonical ID一貫性
- 旧IDの`auth_audit_logs`は正規化のwrite-setに含めない。適用前監査で14件、適用後transaction readbackと冪等dry-runでも14件であることを確認する

### VibePro

- decision `dec_vibepro_ai_self_evaluation_metrics_japanese_ssot`
- live frame `frm_vibepro`
- 現行CIが要求する日本語自己評価指標8語

## 変更方針

1. canonical orgへ非秘密の最新属性を統合する。
2. 旧org IDは物理削除せず、`canonical_entity_id`を持つretired aliasへ変更する。
3. business edgeとpayload参照はcanonical IDへ付け替え、旧orgからcanonical orgへの`alias_of` edgeを残す。
4. 雲孫のfinance情報は一般org payloadから分離し、`ceo`かつ`finance` clearanceでのみ読めるレコードに保持する。
5. BAAO projectのGraph payloadへ表示名`BAAO`を設定する。
6. BAAOの既存mission/valueを根拠に固有のcore Philosophyを登録する。Operation Handbook v3の正式採用decisionは作らない。
7. legacy personは物理削除せずmerged状態にし、認可・RACIの現行参照だけcanonical personへ移す。監査ログは履歴のIDを保持する。
8. VibePro decisionが存在する場合はpayloadを保持し、CI/MCP契約に必要な`member`可視性だけを修復する。欠落時のみ、過去証跡、live frame、live glossary terms、現行CI契約に一致する最小payloadで同一ID復元する。

## スコープ外

- Operation Handbook v3の正式採用、旧制度凍結、制度分離に関するdecision登録
- BAAO制度の承認者、各Owner、台帳保存先、法務・会計判断の代行
- 今回確認した佐藤圭吾以外のperson重複の一括整理
- Graph外の事業文書本文、契約書、フォームの変更
- 物理DELETE、監査ログの書き換え、秘密値のrepo保存
- CI契約からVibePro decision要件を外す変更

## Engineering judgment

### 現状と意図

センターピンは、重複IDを削除することではなく、現行参照を一つのcanonical IDへ寄せながら旧IDを監査可能なaliasとして残すことである。before監査では旧IDを指すbusiness edge、認可、RACIが存在し、BAAO project名・固有Philosophy・CIから見えるVibePro decisionが欠けていた。after監査は[機械可読な本番証跡](../evidence/graph-data-ssot-normalization-20260718.json)に固定する。

### 不変条件と失敗時挙動

- 物理削除、監査ログの書換え、decision payload/created_atの上書き、秘密値のrepo出力をしない。
- apply前検証、対象限定backup、advisory lock、単一transaction、apply後assertの順で進み、途中失敗はcommit前にrollbackする。
- commit後の復旧はbackupに列挙されたIDだけを復元する。rollback replayと障害注入をunit testし、広域DELETEがないことを検証する。
- financeは一般org payloadから除外し、Graph entityの`role_min=ceo`と`sensitivity=finance`を同時に満たす既存DB検索契約で保護する。
- rollback backupはtransaction開始前にJSON/schema/対象ID整合性を検証する。malformed JSON、schema不正、対象外ID、DB認証拒否、transaction内永続化失敗はいずれもcommitせず失敗する。

### 公開契約と互換性

- canonical entity IDとproject codeは変更しない。`type=org|person`の一覧はcanonicalだけを一度返し、旧org/person IDを指定したtyped getはcanonical entityへ解決する。`org_alias` / `person_alias`型のraw行は監査用にread可能なまま残す。
- MCPはraw alias行をentity一覧へ混ぜず、canonical entityのalias索引へ旧IDを統合する。
- VibePro decisionは既存payloadと`created_at=2026-04-25`を保持し、CI/MCP正本契約に必要なvisibilityだけ`gm`から`member`へ修復する。
- CLIは`dry-run`をdefaultとし、`apply`と`rollback <backup>`だけを明示的に受け付ける。出力はID・件数・状態に限定し、秘密payloadを返さない。

### レビュー境界

このPRは、Story（対象と不変条件）、実行スクリプト（可逆transaction）、テスト（dry-run/backup/rollback/認可境界）、本番監査証跡の一つの復旧単位である。文書laneと実行laneを分離すると、実装だけでは正本判断を、文書だけでは再現・復旧をレビューできないため分割しない。各ファイルの責務をこの4点に限定し、BAAO制度採用などの業務decisionは含めない。

## 受け入れ基準

- [x] `baao`と`unson`がcanonical orgとして取得でき、旧IDはretired aliasとしてcanonical IDを指す。
- [x] 旧orgを指すbusiness edge/payload参照が0件で、`alias_of`だけが旧IDからcanonical IDを指す。
- [x] BAAO projectのGraph表示名が`BAAO`である。
- [x] BAAO Philosophy ContextがBAAO固有のactive/core Philosophyを返す。
- [x] 雲孫のfinance情報が一般org payloadから除外され、`ceo` + `finance`境界に隔離される。
- [x] `auth_grants`、`raci_assignments`、`users`の現行人物参照がcanonical person IDへ統一される。
- [x] 適用前監査で旧personを参照する`auth_audit_logs`が14件と記録され、適用後transaction readbackと冪等dry-runでも14件である。正規化スクリプトの直接write-setに`auth_audit_logs`を含めず、旧person自体はmerged/retiredとして残る。適用前の行ID/hash/timestamp集合は保存されていないため、行内容の完全不変性までは主張しない。
- [x] member/internalのservice readbackではfinance entityがID・型の双方で0件、ceo/financeのpositive controlでは1件である。
- [x] 旧org/person IDのtyped REST/service取得とMCP alias索引がcanonicalへ解決し、型付き一覧にalias重複を出さない。
- [x] malformed backup JSON、schema-invalid backup、対象外backup ID、DB auth denied、persistence failureの否定系テストが成功する。
- [x] exact decision IDがライブRESTとMCPの両方で取得できる。
- [x] `node scripts/vibepro-graph-ssot-check.mjs`がライブGraphに対して成功する。
- [x] Graph関連の対象テストが成功する。
- [x] Graph書き込み前後の件数・ID・edge/readbackを秘密値なしの監査結果として記録できる。

## ロールバックと監査

- 書き込み直前に対象entity、edge、project、people、auth_grants、raci_assignmentsの完全なJSONバックアップを本番ホスト内に作り、所有者以外が読めない`0600`にする。
- 変更は1 transactionで実行し、受け入れ基準に反する場合はcommitせずrollbackする。
- commit後の巻き戻しは、同じ対象IDだけをバックアップ値へupsert/updateする専用rollback処理で行う。広域DELETEやDB全体restoreは行わない。
- 監査ログの過去person IDは履歴として保持し、現在参照と履歴参照を区別する。
- 適用後の監査行は秘密値を出さず、ID集合・timestamp集合・内容のSHA-256だけを記録する。適用前hashは取得されていないため比較証拠として扱わない。
- 実行結果には変更したID、変更しなかった対象、検証結果、未解決だけを残し、秘密payloadは残さない。

## 実装タスク

- [x] Storyをコミットし、VibePro Story/Taskへ接続する。
- [x] GraphifyでGraph/API/認可/CIの影響面を記録する。
- [x] targeted backup・transaction・rollback対応の正規化スクリプトを用意する。
- [x] dry-runで変更予定と不変条件を確認する。
- [x] 本番Graphへtransactionを書き込む。
- [x] REST/MCP/Philosophy Context/人物認証IDをreadbackする。
- [x] CI checkと関連テストを実行する。
- [ ] VibePro gate、PR、merge、本番反映を完了する。

## 実行証跡

- apply: 2026-07-19 00:20 JST、単一transaction、物理削除0件
- rollback point: `2026-07-18T152024997Z.json`（本番ホスト内、mode `0600`）
- 冪等readback: legacy business edge 0件、legacy payload参照0件、legacy auth grant 0件、legacy RACI 0件
- 人物参照: canonical personにauth grant 1件、RACI 10件、users 3件。旧IDのauth audit logは適用前14件、適用後transaction readback 14件、冪等dry-run 14件。正規化write-setには含めない
- 監査hash: 適用後のID集合・timestamp集合・内容hashを`audit-post-apply-hash-readback.json`へ保存。適用前hashは証跡がなく、完全不変性は非主張
- finance否定系: member/internalではID・型取得とも0件、ceo/finance positive controlは1件
- alias互換: typed getは旧IDからcanonicalへ解決し、一覧はcanonicalのみ。MCPはalias索引へ統合
- VibePro decision: payload・created_atを保持し、`role_min`だけ`gm`から`member`へ修復
- MCP: ブリッジ再起動後、exact decisionとBAAO Philosophy Contextを取得
- REST/CI: `node scripts/vibepro-graph-ssot-check.mjs`の4 checksがすべてpassed
- tests: rollback rehearsal、malformed/schema-invalid backup、DB auth denied、persistence failure、finance否定系、REST aliasを含むtargeted Vitest 50件が成功。MCP alias対象test 8件も成功。MCP全件実行の既知依存欠落は対象test単体実行で切り分ける
- machine-readable evidence: `docs/management/evidence/graph-data-ssot-normalization-20260718.json`
