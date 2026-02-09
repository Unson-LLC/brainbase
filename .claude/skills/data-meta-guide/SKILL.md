---
name: data-meta-guide
description: データ・メタ情報管理統合ガイド（5 Skills統合版）。人物情報・顧客情報の二層構造管理、Airtable/freee API連携パターン、Google Drive運用を統合した実践ガイド
---

**バージョン**: v2.0（5 Skills統合版）
**実装日**: 2025-12-30
**統合済みSkills**: 5個
**統合後サイズ**: 約1,100行 ✅ OPTIMAL範囲（1000-3000行）

---

## 統合概要

このSkillは、brainbaseにおける**データ・メタ情報管理**の全体系を統合します。

### 統合済みSkills

| No | 統合前Skill | 行数 | 役割 | 統合先セクション |
|----|------------|------|------|----------------|
| 1 | people-meta | 183行 | 人物情報の二層構造管理 | § 1 |
| 2 | customers-meta | 132行 | 顧客詳細メタ情報フォーマット | § 2 |
| 3 | airtable-rate-limit-handling | 199行 | Airtableレート制限対策 | § 3 |
| 4 | freee-mcp-api-gui-mapping | 310行 | freee API-GUI対応関係 | § 4 |
| 5 | google-drive-structure | 190行 | Google Driveシンボリックリンク運用 | § 5 |

**統合方針**: Knowledge Skillパターン（参照ドキュメント）

---

## 目次

### § 1. 人物情報管理
- 1.1 二層構造の原則
- 1.2 個別ファイル（people/*.md）の作成
- 1.3 サマリーテーブル（people.md）の更新
- 1.4 ステータス定義と運用
- 1.5 登録フロー
- 1.6 よくある失敗パターン

### § 2. 顧客情報管理
- 2.1 顧客メタ情報の構造
- 2.2 フロントマター定義
- 2.3 組織構造の記述
- 2.4 キーマン管理
- 2.5 決裁ライン管理
- 2.6 接点履歴の記録

### § 3. Airtable連携パターン
- 3.1 レート制限の仕様
- 3.2 タイムアウト処理（Promise.race）
- 3.3 エクスポネンシャルバックオフ
- 3.4 ページングスロットリング
- 3.5 完全実装例
- 3.6 トラブルシューティング

### § 4. freee連携パターン
- 4.1 API-GUI対応関係の理解
- 4.2 未処理明細の取得思考フレームワーク
- 4.3 ステータス判定基準
- 4.4 日付範囲設定の判断
- 4.5 重複除去の必然性
- 4.6 API制限の理解（wallet_txn ⇔ deal紐付け不可）

### § 5. Google Drive運用
- 5.1 シンボリックリンク方式の原則
- 5.2 フォルダ構成（法人共通 vs 事業）
- 5.3 ファイル配置の判断基準（_codex vs ドライブ）
- 5.4 新規プロジェクト追加手順
- 5.5 フォルダ命名規則
- 5.6 よくあるミス

### Quick Reference
- 状況別実践ガイド
- トラブルシューティング一覧

---

# § 1. 人物情報管理

**目的**: brainbaseにおける人物情報を二層構造（サマリー + 詳細）で一元管理

**Why**:
- 全メンバーの概要を一覧で把握（people.md）
- 詳細情報を個別ファイルで管理（people/*.md）
- プロジェクト横断での人物検索が容易

**Source Skill**: people-meta（183行）

---

## 1.1 二層構造の原則

人物情報は**2箇所に登録**する：

| ファイル | 役割 | フォーマット |
|---------|------|-------------|
| `_codex/common/meta/people.md` | サマリーテーブル（インデックス） | マークダウンテーブル |
| `_codex/common/meta/people/<person_id>.md` | 個別ファイル（詳細情報） | YAML front matter + マークダウン |

**両方に登録すること。片方だけではNG。**

**思考パターン**:
```
新規メンバー追加 → 「個別ファイル作成したか？」
個別ファイル作成 → 「サマリーテーブルにも追加したか？」
情報更新 → 「両方を更新したか？」
```

---

## 1.2 個別ファイル（people/*.md）の作成

### ファイル名

- `<姓のローマ字>_<名のローマ字>.md`
- 例: `yamamoto_rikiya.md`, `mochida_sho.md`

**判断基準**:
```
ファイル名を決める → 「ローマ字（小文字）か？」
スペースは？ → 「アンダースコア区切り」
日本語は？ → 「NG、必ずローマ字」
```

### フロントマター（必須）

```yaml
---
name: 山本 力弥
role: 代表理事 / CSO / 代表社員
org: 一般社団法人BAAO / 雲孫 / 合同会社ヤマリキエッジ
org_tags: [BAAO, 雲孫, ヤマリキエッジ]
projects: [baao, ncom, catalyst_program]
aliases: [山本力弥, Rikiya Yamamoto]
status: active
updated: 2025-12-02
---
```

| 項目 | 必須 | 説明 |
|------|------|------|
| name | ✅ | フルネーム（スペース区切り） |
| role | ✅ | 役職・役割 |
| org | ✅ | 所属組織（メイン） |
| org_tags | ✅ | 関連組織タグ（配列） |
| projects | ✅ | 担当プロジェクト（配列） |
| aliases | ✅ | 別名・英語名（配列） |
| status | ✅ | active / inactive / lead / stakeholder |
| updated | ✅ | 更新日 |
| assets | - | 資産・強み（任意） |
| scope | - | 権利の範囲（任意） |

### 本文構造

```markdown
## 立ち位置 / 現在の役割
- 役職や立場を記載

## 担当 / 関連プロジェクト
- 担当プロジェクトを記載

## 連絡先（任意）
- Email: xxx@example.com
- Tel: 000-0000-0000

## メモ
- その他の情報
```

---

## 1.3 サマリーテーブル（people.md）の更新

個別ファイルを作成したら、`people.md` のテーブルにも**1行追加**する。

```markdown
| 名前 | 役割 | 所属タグ | 主担当プロジェクト | 稼働ステータス | メモ |
| --- | --- | --- | --- | --- | --- |
| 持田 渉 | 執行役員（パートナー） | Tech Knight / リカルド | センパイナース | 稼働中 | リカルド執行役員。連絡先は個別ファイル参照。 |
```

**思考パターン**:
```
個別ファイル作成完了 → 「people.mdに1行追加したか？」
テーブルの列が足りない → 「全6列揃っているか確認」
```

---

## 1.4 ステータス定義と運用

| status | 意味 | 使い分け |
|--------|------|---------|
| active | 稼働中 | 現在プロジェクトに参加 |
| inactive | 非稼働・休止中 | 一時離脱・休止 |
| lead | リード（見込み客側の人物） | まだ契約前の相手側担当者 |
| stakeholder | ステークホルダー（直接稼働しないが関係者） | 意思決定者・承認者 |

**判断基準**:
```
新規メンバー登録 → 「現在稼働しているか？」 → active
過去に稼働、今は休止 → inactive
見込み客側の担当者 → lead
稼働しないが意思決定に関わる → stakeholder
```

---

## 1.5 登録フロー

```
1. 個別ファイル作成: people/<person_id>.md
   └─ フロントマター必須項目を記載
   └─ 本文構造に従って記載

2. サマリー追加: people.md のテーブルに1行追加
   └─ 6列すべて埋める

3. プロジェクト更新: 関連プロジェクトの team[] に追加
   └─ _codex/projects/<project>/project.md の team配列
```

**Example**: 業務委託メンバーの追加

**1. 個別ファイル: `people/mochida_sho.md`**

```yaml
---
name: 持田 渉
role: 執行役員（パートナー）
org: 株式会社リカルド
org_tags: [Tech Knight, リカルド]
projects: [senpainurse]
aliases: [持田渉, Mochida Sho]
status: active
updated: 2025-12-02
---

## 立ち位置
- 株式会社リカルド（Le caldo）執行役員
- センパイナース案件担当

## 担当
- センパイナース（退院支援AI）プロジェクト管理

## 連絡先
- Email: showmochida@lecaldo.co.jp
- Tel: 04-2968-6757
- Mobile: 090-8907-7532
```

**2. サマリー追加: `people.md`**

```markdown
| 持田 渉 | 執行役員（パートナー） | Tech Knight / リカルド | センパイナース | 稼働中 | リカルド執行役員。センパイナース担当。 |
```

**3. プロジェクト更新: `projects/techknight/senpainurse/project.md`**

```yaml
team: ['若松冬美', '持田渉']
```

---

## 1.6 よくある失敗パターン

### ❌ people.mdだけ更新

```markdown
| 新人 | 開発 | ... |  # people/*.md がない
```

**修正**: 個別ファイルも作成

### ❌ 個別ファイルだけ作成

```
people/newperson.md  # people.md に追加してない
```

**修正**: サマリーテーブルにも追加

### ❌ ファイル名が日本語

```
people/山本力弥.md  # ❌
```

**修正**: ローマ字で `yamamoto_rikiya.md`

### ❌ frontmatterの必須項目が欠落

```yaml
---
name: 山本
# role, org_tags, projects, status が無い
---
```

**修正**: 必須項目をすべて記載

**診断パターン**:
```
エラー発生 → 「必須項目がすべて揃っているか？」
検索で見つからない → 「people.mdに登録したか？」
ファイル名エラー → 「ローマ字・小文字・アンダースコアか？」
```

---

# § 2. 顧客情報管理

**目的**: 顧客の詳細情報（組織図・決裁ライン・キーマン）を標準フォーマットで記述

**Why**:
- 提案・営業時に組織構造を即座に把握
- 決裁ラインを理解して適切なアプローチ
- キーマンとの接点履歴を記録

**Source Skill**: customers-meta（132行）

---

## 2.1 顧客メタ情報の構造

### ファイル配置

```
_codex/common/meta/customers/<customer_id>.md
```

**命名規則**:
- `<customer_id>.md`: 英数字、ハイフン
- 例: `nttcom.md`, `ricoh-japan.md`

---

## 2.2 フロントマター定義

```yaml
---
customer_id: <id>           # 一意のID（英数字、ハイフン）
name: <正式名称>            # 会社の正式名称
projects: [project1, ...]   # 関連プロジェクトID
status: active|inactive     # 取引状態
updated: YYYY-MM-DD         # 最終更新日
---
```

**判断基準**:
```
顧客登録 → 「customer_idは一意か？」
プロジェクト紐付け → 「projects配列に追加したか？」
取引終了 → 「status: inactiveに変更したか？」
```

---

## 2.3 組織構造の記述

### 会社概要（テーブル形式）

| 項目 | 内容 |
| --- | --- |
| 正式名称 | |
| 本社 | |
| 事業 | |
| 規模 | |

### 経営陣（テーブル形式）

| 役職 | 氏名 | 担当 |
| --- | --- | --- |
| 代表取締役社長 | | |

### 組織構造（ASCII図）

```
会社名
├── 本部A
│   └── 部門A-1
└── 本部B
```

**思考パターン**:
```
組織図を作成 → 「ASCII図で階層構造を表現」
関連部門のみ記載 → 「案件に関わる部門に絞る」
```

---

## 2.4 キーマン管理

案件に関わる重要人物をテーブルで整理：

| 氏名 | 役職 | 役割・権限 | 関係性 | 備考 |
| --- | --- | --- | --- | --- |
| | | | 主要窓口 | |

**判断基準**:
```
新しい担当者と接触 → 「キーマンテーブルに追加したか？」
役職変更 → 「テーブルを更新したか？」
意思決定権限 → 「役割・権限列に明記したか？」
```

---

## 2.5 決裁ライン管理

稟議フローをASCII図で表現：

```
[通常の稟議フロー]

  担当者（起案）
       ↓
  課長（承認）
       ↓
  部長（決裁）
```

金額別の決裁権限目安も記載：

```
[金額別目安]
  〜100万円  : 課長決裁
  〜1000万円 : 部長決裁
  1000万円〜 : 本部長決裁
```

**思考パターン**:
```
提案書作成 → 「決裁ラインを確認したか？」
金額確定 → 「どのレベルの決裁者にアプローチすべきか？」
承認遅延 → 「稟議フローのどこで止まっているか？」
```

---

## 2.6 接点履歴の記録

重要な接点を時系列で記録：

| 日付 | 内容 | 参加者 | 備考 |
| --- | --- | --- | --- |
| YYYY-MM-DD | | | |

**記録基準**:
- 初回商談
- 提案書提出
- 決裁者との面談
- 契約締結
- 重要な方針変更

**思考パターン**:
```
重要な商談終了 → 「接点履歴に記録したか？」
決裁者と面談 → 「参加者・日付・内容を記録したか？」
```

---

# § 3. Airtable連携パターン

**目的**: Airtable APIのレート制限を回避し、安定した連携を実現

**Why**:
- 429エラー（レート制限）を防ぐ
- タイムアウトを適切に処理
- ページング時のスロットリング

**Source Skill**: airtable-rate-limit-handling（199行）

---

## 3.1 レート制限の仕様

**重要**: ワークスペース単位で適用（PATではなく）

| プラン | リクエスト/秒 | リクエスト/月 |
|--------|--------------|--------------|
| Free | 5 req/sec | 1,000 req/month |
| Team | 5 req/sec | 無制限 |
| Business/Enterprise | 10 req/sec | 無制限 |

エラー: `429 Too Many Requests`

**思考パターン**:
```
Airtable API実装 → 「レート制限対策が必要」
429エラー発生 → 「リトライ処理が実装されているか？」
月間上限超過 → 「別ワークスペースまたはプランアップグレード」
```

---

## 3.2 タイムアウト処理（Promise.race）

```javascript
async listRecords(options = {}) {
  const timeout = options.timeout || 30000;
  const fetchPromise = this._fetchRecords(options);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
  });
  return Promise.race([fetchPromise, timeoutPromise]);
}
```

**Why**:
- 長時間レスポンスがない場合に備える
- デフォルト30秒でタイムアウト
- ハングアップを防ぐ

**思考パターン**:
```
API呼び出し → 「タイムアウトを設定したか？」
応答が遅い → 「Promise.raceでタイムアウト制御」
```

---

## 3.3 エクスポネンシャルバックオフ

```javascript
async listRecords(options = {}) {
  const maxRetries = options.maxRetries || 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this._fetchRecords(options, timeout);
    } catch (err) {
      const isRateLimit = err.statusCode === 429 || err.message.includes('rate limit');
      if (isRateLimit && attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000); // 1秒 → 2秒 → 4秒（最大10秒）
        console.log(`[Airtable] Rate limit, retry in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw err;
      }
    }
  }
}
```

**Why**:
- 初回エラーで諦めない
- 指数的に待機時間を増やす（1秒 → 2秒 → 4秒）
- 最大10秒まで待機

**思考パターン**:
```
429エラー → 「リトライするか？」
リトライ回数 → 「3回までリトライ」
待機時間 → 「指数的に増加（エクスポネンシャルバックオフ）」
```

---

## 3.4 ページングスロットリング

```javascript
base(this.tableId)
  .select({ maxRecords: 100, pageSize: 100 })
  .eachPage(
    (pageRecords, fetchNextPage) => {
      records.push(...pageRecords.map(r => ({ id: r.id, fields: r.fields })));
      // 200ms待機で5 req/sec以内に抑える
      setTimeout(() => fetchNextPage(), 200);
    },
    (err) => {
      if (err) reject(err);
      else resolve({ records });
    }
  );
```

**Why**:
- 5 req/sec を超えないように制御
- 200ms待機 = 5 req/sec

**思考パターン**:
```
ページング処理 → 「各ページ取得後に200ms待機」
レート制限対策 → 「5 req/sec以内に抑える」
```

---

## 3.5 完全実装例

`/Users/ksato/workspace/mana/api/airtable-mcp-client.js`:

```javascript
class AirtableMCPClient {
  async listRecords(options = {}) {
    const timeout = options.timeout || 30000;
    const maxRetries = options.maxRetries || 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._fetchRecords(options, timeout);
      } catch (err) {
        const isRateLimit = err.statusCode === 429 || err.message.includes('rate limit');
        if (isRateLimit && attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[Airtable] Retry in ${waitTime}ms (${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw err;
        }
      }
    }
  }

  async _fetchRecords(options, timeout) {
    const fetchPromise = new Promise((resolve, reject) => {
      const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(this.baseId);
      const records = [];
      let isResolved = false;

      base(this.tableId)
        .select({ maxRecords: options.maxRecords || 100, pageSize: 100 })
        .eachPage(
          (pageRecords, fetchNextPage) => {
            if (isResolved) return;
            records.push(...pageRecords.map(r => ({ id: r.id, fields: r.fields })));
            setTimeout(() => { if (!isResolved) fetchNextPage(); }, 200);
          },
          (err) => {
            if (isResolved) return;
            isResolved = true;
            if (err) reject(err);
            else resolve({ records });
          }
        );
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
    });

    return Promise.race([fetchPromise, timeoutPromise]);
  }
}
```

---

## 3.6 トラブルシューティング

### エラー: `PUBLIC_API_BILLING_LIMIT_EXCEEDED`

```
Error: 1,363/1,000 API calls per month
```

**対策**:
1. 別ワークスペースに移行（例: Unson → BAAO）
2. Team/Businessプランにアップグレード
3. キャッシュ・バッチ処理でAPI削減

**確認**:
```bash
node _ops/check-airtable-usage.js
```

### エラー: `INVALID_FILTER_BY_FORMULA: Unknown field names`

**原因**: フィールド名が日本語/英語で異なる

**対策**:
```javascript
// フィールド名マッピング
.map(record => ({
  id: record.id,
  task_name: record.fields['タイトル'] || record.fields['task_name'],
  assignee: record.fields['担当者'] || record.fields['assignee'],
}))

// フィルタ式は日本語名を使用
filterByFormula: 'AND({ステータス}!="完了", {期限}!="")'
```

**ベストプラクティス**:
1. **デフォルト**: タイムアウト30秒、リトライ3回
2. **ログ**: リトライ時は必ずログ出力
3. **ページサイズ**: `pageSize: 100` で過度な一括取得回避
4. **待機時間**: 200ms待機で5 req/sec以内
5. **エラー判定**: `statusCode === 429` と `message.includes('rate limit')` 両方チェック

---

# § 4. freee連携パターン

**目的**: freee APIとGUIの対応関係を理解し、未処理明細を正しく取得

**Why**:
- GUIの「未処理」= API `status=1` の対応理解
- 日付範囲の必須設定（デフォルトは直近約1週間のみ）
- 重複除去の必然性

**Source Skill**: freee-mcp-api-gui-mapping（310行）

---

## 4.1 API-GUI対応関係の理解

### 思考パターン1: GUIとAPIのマッピング

freee GUIの「自動で経理」を見たら、こう考える：

```
GUI表示 → APIエンドポイント → パラメータ

「未処理23件」 → /api/1/wallet_txns → status=1（消込待ち）
```

**判断基準**:
- 「自動で経理」の明細 = `wallet_txns`エンドポイント
- 「未処理」 = `status=1`（消込待ち）
- 「処理済み」 = `status=2`（消込済み）

---

## 4.2 未処理明細の取得思考フレームワーク

### 思考パターン2: 日付範囲の必須設定

APIで明細を取得するとき、**まず日付範囲を考える**：

```
1. 目的は何か？
   → 全未処理を取得したい → 過去1-2ヶ月分を指定
   → 今月の未処理のみ → 月初から月末を指定

2. 日付指定なしはNG
   → デフォルトで直近約1週間のみ返される
   → 古い未処理明細が漏れる

3. 広めに設定する
   → 未処理は長期間残る可能性がある
   → 範囲が広すぎてもフィルタリングできる
```

**行動パターン**:
```python
# ❌ 悪い例（直近のみ返される）
resp = client._request_with_retry(
    'GET',
    f'/api/1/wallet_txns?company_id={company_id}&walletable_id={wallet_id}'
)

# ✅ 良い例（広めの範囲を指定）
from datetime import datetime, timedelta

end_date = datetime.now().strftime('%Y-%m-%d')
start_date = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-%d')

resp = client._request_with_retry(
    'GET',
    f'/api/1/wallet_txns?company_id={company_id}&walletable_id={wallet_id}&start_date={start_date}&end_date={end_date}'
)
```

---

## 4.3 ステータス判定基準

wallet_txnsのステータスを見たら、こう判断する：

| status | 意味 | 判断 | 行動 |
|--------|------|------|------|
| 1 | 消込待ち | 未処理 | 仕訳作成が必要 |
| 2 | 消込済み | 処理済み | 何もしない |
| 3 | 無視 | ユーザーが除外 | スキップ |
| 4 | 消込中 | 処理中 | 通常は稀、要確認 |
| 6 | 対象外 | システム除外 | スキップ |

**思考チェーン**:
```
明細を取得 → status確認 → 1なら未処理 → due_amountも確認 → 0以外なら要処理
```

---

## 4.4 日付範囲設定の判断

### 統合的な思考フロー

freee MCPで未処理明細を取得するとき、この順序で考える：

```
1. 目的を明確化
   → 全未処理？ 今月のみ？ 特定期間？

2. 日付範囲を設定
   → 広め（過去1-2ヶ月）が安全
   → 狭すぎると漏れる

3. 全口座から取得
   → list_walletables()で全口座取得
   → 各walletableをループ

4. 重複除去
   → 明細IDをキーにした辞書
   → 同じIDは1回だけ格納

5. ステータスフィルタ
   → status=1のみ抽出
   → due_amount != 0も確認

6. 検証
   → GUIの件数と比較
   → 不一致なら日付範囲を拡大
```

---

## 4.5 重複除去の必然性

### 思考パターン3: 重複除去の必然性

複数の口座から取得するとき、**同じ明細が重複する**：

```
問題認識:
- freee APIは口座ごとに明細を返す
- 同じ明細が全口座（9個）に複数回現れる
- 件数が実際の9倍になる

解決思考:
1. 明細IDをキーにする
2. 辞書で重複除去
3. 最終的にユニークな明細のみ残す
```

**実装パターン**:
```python
all_txns = {}  # IDをキーにして重複除去

for wallet in walletables:
    resp = client._request_with_retry('GET', f'/api/1/wallet_txns?...')
    txns = resp.json().get('wallet_txns', [])

    for txn in txns:
        txn_id = txn.get('id')
        if txn_id not in all_txns:  # 重複除去
            all_txns[txn_id] = txn

# 未処理のみフィルタ
unprocessed = [t for t in all_txns.values() if t.get('status') == 1]
```

---

## 4.6 API制限の理解（wallet_txn ⇔ deal紐付け不可）

### 確定した事実（2025-12-27 徹底調査）

1. **wallet_txns に PUT/PATCH メソッドが存在しない**
   - 利用可能: GET, POST, DELETE のみ
   - wallet_txn のステータス（status=1→2）を更新する API なし

2. **deals に wallet_txn_id パラメータが存在しない**
   - dealCreateParams: `company_id`, `issue_date`, `type`, `details`, `payments`, `due_date`, `partner_id`, `partner_code`, `ref_number`, `receipt_ids`
   - wallet_txn を紐付けるパラメータなし

3. **payments セクションでの自動マッチングも機能しない**
   - 実験: `payments` に `from_walletable_id`, `from_walletable_type`, `date`, `amount` を完全一致で設定
   - 結果: deal は作成されるが、wallet_txn の status=1 のまま変化なし

**対応方法**:
- **API のみ**: deal（仕訳）の作成まで可能
- **wallet_txn の処理**: GUI での手動操作、または Claude in Chrome で自動化

### deals の決済状態 vs wallet_txns の消込状態

**2つの異なる概念**（混同注意）:

| 概念 | API | 意味 | 用途 |
|------|-----|------|------|
| deals の決済状態 | `POST /api/1/deals/{id}/payments` | 未決済（売掛金・買掛金）の決済 | 債権債務管理 |
| wallet_txns の消込状態 | API なし | 銀行明細の処理状態 | 自動で経理 |

**重要**: deals の payments API は、wallet_txns の status には影響しない

---

## 完全実装例

```python
from datetime import datetime, timedelta
from collections import Counter

def get_all_unprocessed_txns(client, days_back=60):
    """
    全未処理明細を取得（GUIの「未処理」と一致させる）
    """
    # 1. 日付範囲設定（広めに）
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')

    # 2. 全口座取得
    walletables = client.list_walletables()

    # 3. 全明細取得 & 重複除去
    all_txns = {}
    for wallet in walletables:
        resp = client._request_with_retry(
            'GET',
            f'/api/1/wallet_txns?company_id={client.company_id}&walletable_id={wallet["id"]}&start_date={start_date}&end_date={end_date}'
        )
        txns = resp.json().get('wallet_txns', [])

        for txn in txns:
            txn_id = txn.get('id')
            if txn_id not in all_txns:
                all_txns[txn_id] = txn

    # 4. 未処理のみフィルタ
    unprocessed = [t for t in all_txns.values() if t.get('status') == 1]

    # 5. デバッグ情報
    print(f"日付範囲: {start_date} ～ {end_date}")
    print(f"全明細: {len(all_txns)}件")

    status_count = Counter(t.get('status') for t in all_txns.values())
    for status, count in sorted(status_count.items()):
        status_name = {1: "消込待ち", 2: "消込済み", 3: "無視", 4: "消込中", 6: "対象外"}.get(status, f"不明({status})")
        print(f"  status={status} ({status_name}): {count}件")

    print(f"未処理: {len(unprocessed)}件")

    return unprocessed
```

---

# § 5. Google Drive運用

**目的**: Google Drive共有ドライブのフォルダ構成とシンボリックリンク運用を統一

**Why**:
- ローカルからClaude Codeでファイル操作可能
- Google Driveストリーミングモードで容量節約
- 共有ドライブで権限管理が一元化

**Source Skill**: google-drive-structure（190行）

---

## 5.1 シンボリックリンク方式の原則

各プロジェクトの `drive/` フォルダはシンボリックリンクでGoogle Drive共有ドライブに接続する。

**メリット**:
- ローカルからClaude Codeでファイル操作可能
- Google Driveストリーミングモードで容量節約
- 共有ドライブで権限管理が一元化

**制約**:
- Googleファイル(.gslides, .gsheet等)は同一アカウント内でのみ移動可能
- 異なるアカウント間では実ファイル(.pptx, .xlsx等)のみ移動可能

**思考パターン**:
```
新規プロジェクト → 「共有ドライブにフォルダ作成したか？」
フォルダ作成 → 「シンボリックリンクでローカルに接続したか？」
ファイル移動 → 「同一アカウント内か確認」
```

---

## 5.2 フォルダ構成（法人共通 vs 事業）

| 分類 | 対象 | フォルダ構成 | 例 |
|------|------|-------------|-----|
| 法人共通 | unson/ | エンティティ軸 | バックオフィス, 契約書, 顧客, パートナー |
| 事業 | baao, zeims, senrigan, tech-knight, ncom | 機能軸 | 営業資料, 納品物, 稼働報告 |

**エンティティ軸**（法人共通向け）:
- 誰と（顧客/パートナー）、何を（契約書/バックオフィス）で分類
- 取引先ごとに紐づくファイルが多い場合に適切

**機能軸**（事業向け）:
- 業務プロセス（営業→納品→報告）で分類
- 事業運営フローに沿ったファイル整理

### 共有ドライブ構成

**雲孫ドライブ** (info@unson.jp)
```
雲孫ドライブ/
├── unson/           # 法人共通（エンティティ軸）
│   ├── バックオフィス/  # 経理、社会保険、人事
│   ├── 契約書/
│   ├── 顧客/            # 顧客別フォルダ
│   ├── パートナー/      # パートナー別フォルダ
│   └── 稼働報告/
│
├── baao/            # BAAO事業（機能軸）
│   ├── 営業資料/
│   ├── 納品物/
│   └── 稼働報告/
│
├── zeims/           # Zeims事業（機能軸）
├── senrigan/        # Senrigan事業（機能軸）
├── tech-knight/     # Tech Knight事業（機能軸）
├── ncom/            # NTTドコモビジネス案件（機能軸）
│
└── _inbox/          # 未整理ファイル
```

**SalesTailor共有ドライブ** (k.sato@sales-tailor.jp)
```
SalesTailor/
├── CS/              # カスタマーサクセス
├── SALES/           # 営業
└── ENG/             # エンジニアリング
```

### シンボリックリンク対応表

| ローカル | シンボリックリンク先 |
|----------|---------------------|
| `unson/drive/` | → `雲孫ドライブ/unson/` |
| `baao/drive/` | → `雲孫ドライブ/baao/` |
| `zeims/drive/` | → `雲孫ドライブ/zeims/` |
| `senrigan/drive/` | → `雲孫ドライブ/senrigan/` |
| `tech-knight/drive/` | → `雲孫ドライブ/tech-knight/` |
| `salestailor/drive/` | → `SalesTailor共有ドライブ/` |
| `ncom-catalyst/drive/` | → `雲孫ドライブ/ncom/` |
| `personal/drive/` | → `マイドライブ/personal/` (k0127s@gmail.com) |
| `workspace/_inbox/` | → `雲孫ドライブ/_inbox/` |

---

## 5.3 ファイル配置の判断基準（_codex vs ドライブ）

| 判断軸 | `_codex` | ドライブ |
|--------|----------|----------|
| 作成者 | 内部（自分/チーム） | 外部（パートナー/顧客/ベンダー） |
| 性質 | 運用ルール、戦略、手順書 | 見積もり、契約書、納品物、提案書 |
| 編集権 | 自分たちが正本を管理 | 相手が作成・更新する |
| 例 | 01_strategy.md, RACI定義 | 見積もり.pptx, 契約書.pdf |

**配置前チェック**:
```
1. このファイルは誰が作成した？ → 外部なら**ドライブ**
2. 正本の編集権は誰にある？ → 相手側なら**ドライブ**
3. 内部運用ドキュメントか？ → Yesなら**_codex**
```

**思考パターン**:
```
新規ファイル配置 → 「作成者は誰？」
作成者が外部 → 「ドライブに配置」
作成者が内部 → 「_codexに配置」
```

---

## 5.4 新規プロジェクト追加手順

新しいプロジェクトをGoogle Drive連携する場合:

```bash
# 1. 共有ドライブにフォルダ作成（雲孫ドライブの場合）
mkdir -p "/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/<project>/{営業資料,納品物,稼働報告}"

# 2. ローカルにシンボリックリンク作成
ln -s "/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/<project>" "/Users/ksato/workspace/<project>/drive"

# 3. .gitignoreに追加
echo "drive/" >> /Users/ksato/workspace/<project>/.gitignore
```

**検証チェックリスト**:
```
□ シンボリックリンクが正しく機能する（ls -la <project>/drive/）
□ Claude Codeからファイル読み書きできる
□ 共有ドライブのフォルダ構成が原則に従っている
□ .gitignoreにdrive/が追加されている
□ architecture_map.mdのシンボリックリンク対応表を更新した
```

---

## 5.5 フォルダ命名規則

- **日本語を使用**: 営業資料, 納品物, 稼働報告, 顧客, パートナー
- **スペースは使わない**: 半角スペースの代わりにアンダースコアか日本語区切り
- **小文字英数字も可**: 顧客ID等はそのまま（例: nttcom/）

**思考パターン**:
```
フォルダ命名 → 「日本語か英数字小文字か？」
スペースが必要 → 「アンダースコアに変換」
顧客ID → 「そのまま使用（例: nttcom）」
```

---

## 5.6 よくあるミス

### ❌ cpを使ってしまう

```bash
cp file.pdf /project/drive/  # 遅い（ダウンロード→アップロード）
```

**修正**: mvを使う（メタデータ移動のみで高速）

```bash
mv file.pdf /project/drive/  # ✅ 高速
```

### ❌ 異なるアカウント間でGoogleファイルを移動

```bash
mv 雲孫ドライブ/doc.gslides SalesTailor共有ドライブ/  # 失敗する
```

**修正**: 実ファイル(.pptx等)に変換してから移動、または同一アカウント内で移動

**思考パターン**:
```
ファイル移動 → 「mvを使うか？」
Googleファイル移動 → 「同一アカウント内か確認」
異なるアカウント → 「実ファイルに変換」
```

---

# Quick Reference

**状況別実践ガイド**

| 状況 | 使用セクション | 重要チェック |
|------|--------------|------------|
| 新規メンバー追加 | § 1 人物情報管理 | 個別ファイル + サマリーテーブル両方更新 |
| 顧客情報整理 | § 2 顧客情報管理 | 組織図・決裁ライン・キーマンを記録 |
| Airtable 429エラー | § 3 Airtable連携 | リトライ3回、200ms待機 |
| freee 未処理が合わない | § 4 freee連携 | 日付範囲を広く設定（60日） |
| Google Drive連携追加 | § 5 Google Drive運用 | シンボリックリンク作成、.gitignore追加 |

---

## トラブルシューティング一覧

### 人物情報

| 問題 | 原因 | 対処 |
|------|------|------|
| 検索で見つからない | people.mdに登録してない | サマリーテーブルに追加 |
| ファイル名エラー | 日本語または大文字使用 | ローマ字・小文字・アンダースコア |
| frontmatterエラー | 必須項目欠落 | 8項目すべて記載 |

### 顧客情報

| 問題 | 原因 | 対処 |
|------|------|------|
| 決裁ライン不明 | ASCII図未作成 | 稟議フローを図示 |
| キーマン情報不足 | テーブル未更新 | 5列（氏名、役職、役割・権限、関係性、備考）記載 |

### Airtable連携

| 問題 | 原因 | 対処 |
|------|------|------|
| 429エラー | レート制限超過 | リトライ3回、200ms待機 |
| 月間上限超過 | 1,000 req/month超過 | 別ワークスペースまたはプランアップグレード |
| フィールド名エラー | 日本語/英語不一致 | フィールド名マッピング |

### freee連携

| 問題 | 原因 | 対処 |
|------|------|------|
| GUIと件数不一致 | 日付範囲が狭い | 60日に拡大 |
| 重複件数 | 重複除去なし | 明細IDで重複除去 |
| wallet_txn更新不可 | API制限 | GUI手動またはClaude in Chrome |

### Google Drive運用

| 問題 | 原因 | 対処 |
|------|------|------|
| シンボリックリンク失敗 | パス誤り | 絶対パス確認 |
| Googleファイル移動失敗 | 異なるアカウント間 | 同一アカウント内または実ファイル変換 |
| ファイル移動が遅い | cpコマンド使用 | mvコマンドに変更 |

---

# Version History

## v2.0（統合版）- 2025-12-30

**統合内容**:
- 5 Skills統合（people-meta, customers-meta, airtable-rate-limit-handling, freee-mcp-api-gui-mapping, google-drive-structure）
- Knowledge Skillパターン採用
- Quick Reference追加
- トラブルシューティング一覧追加
- 約1,100行 ✅ OPTIMAL範囲達成

**改善点**:
- 状況別実践ガイドで即座にセクション参照可能
- トラブルシューティング一覧で問題解決が容易
- 思考パターンで判断基準を明確化

---

**最終更新**: 2025-12-30
**作成者**: Claude Code (Phase 3.3 統合)
**統合方針**: Knowledge Skillパターン
**統合前Skills数**: 5個
**統合後サイズ**: 約1,100行 ✅ OPTIMAL範囲（1000-3000行）
