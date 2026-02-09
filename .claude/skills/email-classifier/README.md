# email-classifier Skill

Gmail自動分類ルールを管理・適用するSkill。

## 概要

YAMLファイルでメール分類ルールを定義し、メールオブジェクトに対してマッチングを実行。適切なラベルとアクション（archive, markAsRead等）を返す。

## ディレクトリ構造

```
.claude/skills/email-classifier/
├── SKILL.md                      # Skill定義
├── README.md                     # このファイル
└── rules/
    ├── default_rules.yml         # デフォルト分類ルール（全アカウント共通）
    ├── unson_rules.yml           # unson専用ルール（オプション）
    ├── salestailor_rules.yml     # salestailor専用ルール（オプション）
    └── techknight_rules.yml      # techknight専用ルール（オプション）
```

## ルールファイル形式

### default_rules.yml

```yaml
rules:
  - id: github-notifications
    name: GitHub Notifications
    enabled: true
    priority: 90
    accountIds: []  # 全アカウント対象（空配列）
    condition:
      type: AND
      rules:
        - field: from
          operator: equals
          value: "notifications@github.com"
    actions:
      addLabels:
        - "dev/github"
      removeLabelIds:
        - "INBOX"
      markAsRead: false
```

### フィールド説明

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `id` | ✅ | ルールの一意識別子（英数字・ハイフン） |
| `name` | ✅ | ルールの表示名 |
| `enabled` | ✅ | 有効化フラグ（`true`/`false`） |
| `priority` | ✅ | 優先度（高い順に実行: 90 > 80 > 70） |
| `accountIds` | ✅ | 対象アカウントID（空配列 = 全アカウント） |
| `condition` | ✅ | マッチング条件 |
| `actions` | ✅ | マッチ時のアクション |

### Condition Type

- `AND`: すべてのルールが真
- `OR`: 1つ以上のルールが真

### Operators

| Operator | 説明 | 例 |
|----------|------|-----|
| `equals` | 完全一致 | `"notifications@github.com"` |
| `contains` | 部分一致（大文字小文字区別なし） | `"請求書"` |
| `regex` | 正規表現 | `"(?i)invoice\|billing"` |
| `startsWith` | 前方一致 | `"noreply"` |
| `endsWith` | 後方一致 | `"@github.com"` |

### Actions

| Action | 型 | 説明 |
|--------|-----|------|
| `addLabels` | string[] | 追加するラベル名（例: `["dev/github"]`） |
| `removeLabelIds` | string[] | 削除するラベルID（例: `["INBOX", "UNREAD"]`） |
| `archive` | boolean | アーカイブフラグ |
| `markAsRead` | boolean | 既読フラグ |

**注意**: `removeLabelIds: ["INBOX"]`を設定すると自動的にアーカイブされます。

## 使い方

### 1. デフォルトルールの編集

```bash
# ルールファイルを編集
code /Users/ksato/workspace/.claude/skills/email-classifier/rules/default_rules.yml
```

### 2. アカウント専用ルールの作成（オプション）

特定のアカウントだけに適用したいルールがある場合：

```bash
# unson専用ルールを作成
cp default_rules.yml unson_rules.yml
# ルールを編集
code unson_rules.yml
```

### 3. Skill呼び出し（Orchestratorから）

```markdown
**Input**:
- message:
    from: "notifications@github.com"
    subject: "Pull Request #123 opened"
    body: "A new PR has been opened..."
- accountId: "unson"

**Output**:
{
  "addLabelIds": ["dev/github", "dev/pr"],
  "removeLabelIds": ["INBOX"],
  "actions": {
    "archive": false,
    "markAsRead": false
  },
  "matchedRuleIds": ["github-pr"]
}
```

## ルール設計のベストプラクティス

### 1. Priorityの設定

- **90-100**: 緊急・重要（システム通知、セキュリティアラート）
- **80-89**: ビジネス関連（請求書、契約書）
- **70-79**: 開発関連（GitHub, Vercel, CI/CD）
- **60-69**: 一般通知
- **50-59**: プロモーション・スパム

### 2. accountIdsの使い分け

```yaml
# 全アカウント対象
accountIds: []

# 特定アカウントのみ
accountIds:
  - unson
  - techknight
```

### 3. Conditionの組み合わせ

```yaml
# AND: すべて満たす
condition:
  type: AND
  rules:
    - field: from
      operator: equals
      value: "notifications@github.com"
    - field: subject
      operator: contains
      value: "Pull Request"

# OR: いずれか満たす
condition:
  type: OR
  rules:
    - field: subject
      operator: contains
      value: "請求書"
    - field: subject
      operator: contains
      value: "invoice"
```

### 4. 正規表現の使用例

```yaml
# 大文字小文字を区別しない
- field: subject
  operator: regex
  value: "(?i)invoice|billing"

# メールアドレスのドメイン部分マッチ
- field: from
  operator: regex
  value: "@(github|vercel)\\.com$"

# 日本語・英語混在
- field: subject
  operator: regex
  value: "(請求書|invoice|billing)"
```

## トラブルシューティング

### ルールがマッチしない

1. **enabled**: `true`になっているか確認
2. **accountIds**: 対象アカウントIDが含まれているか確認（空配列 = 全対象）
3. **condition**: AND/ORの組み合わせが正しいか確認
4. **operator**: `contains`は大文字小文字を区別しない、`equals`は完全一致

### YAML構文エラー

```bash
# YAML構文チェック（Python）
python3 -c "import yaml; yaml.safe_load(open('default_rules.yml'))"
```

エラーがある場合、デフォルトルールのみが使用されます（エラーログ出力）。

## 実装例

現在定義されているルール（default_rules.yml）：

1. **github-notifications** (priority: 90): GitHub全般通知
2. **github-pr** (priority: 85): GitHub PR通知
3. **invoices-jp** (priority: 80): 請求書（日本語・英語）
4. **spam-promotions** (priority: 70): スパム・プロモーション
5. **vercel-deploy** (priority: 75): Vercelデプロイ通知
6. **business-contract** (priority: 78): 業務委託契約関連

## 今後の拡張

- [ ] Slack通知ルール
- [ ] AWS/GCP通知ルール
- [ ] カレンダー招待ルール
- [ ] 添付ファイルベースのルール

## License

MIT
