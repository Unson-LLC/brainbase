# カスタムコマンド チートシート

## Git / リポジトリ管理

| コマンド | 説明 |
|---------|------|
| `/pull` | workspace配下の全gitリポジトリをpull（dirty はスキップ） |
| `/commit` | CLAUDE.md のルールに従って標準コミット |

## タスク管理

| コマンド | 説明 |
|---------|------|
| `/task <タスクID>` | 指定タスクのメタ情報収集・実行準備 |
| `/schedule` | 今日のタイムスケジュール作成 |

## SNS / コンテンツ

| コマンド | 説明 |
|---------|------|
| `/sns` | X投稿（ドラフト作成 → 画像生成 → 投稿） |

## Skills管理

| コマンド | 説明 |
|---------|------|
| `/learn-skills` | 学習キューからSkills更新案を自動生成 |
| `/approve-skill` | 生成された更新案を承認・適用 |

## 名刺OCR / データ化

| コマンド | 説明 |
|---------|------|
| `/meishi <subcommand>` | Mistral OCRを使った名刺→CSV自動化フロー（詳細は `meishi.md`） |

## オプション例

```bash
/pull --no-ff-only    # fast-forward以外も許可
/task TECHKNIGHT-W3   # 特定タスクIDを指定
```
