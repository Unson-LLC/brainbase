# workflow

運用フロー図チートシート。「今何すればいい？」の起点。

## フロー全体図

```
思いつき / 課題発見
  │
  ├─ 即対応（小さい修正） ──→ 実装 → /commit → /merge
  │
  └─ 要検討（設計が必要）
      │
      ▼
  Plan Mode（/plan）
      │
      ├─ 設計レビュー
      │   ├─ /plan-ceo-review   （ビジネス判断）
      │   ├─ /plan-eng-review   （技術判断）
      │   └─ /plan-design-review（UI/UX判断）
      │
      ▼
  実装（TDD）
      │
      ├─ Red:   失敗するテストを書く
      ├─ Green: 最速で通す
      └─ Refactor: 重複除去
      │
      ▼
  /commit ──→ /merge
      │
      ▼
  [自動] /retro（金曜）
      │
      ▼
  /learn ──→ wiki/skill に反映
```

## 日次ルーティン

| 時間 | アクション | コマンド |
|------|----------|---------|
| 朝 | ポータル確認（15分） | ブラウザで bb.unson.jp |
| 朝 | mana M1確認 | Slackで自動配信 |
| 日中 | 実装 → コミット | `/commit` |
| 14:00 | ブロッカー確認 | mana M2（Slack自動） |
| 夕方 | PRマージ | `/merge` |

## 週次ルーティン

| 曜日 | アクション | コマンド |
|------|----------|---------|
| 月曜 | M9レポート確認 + 今週の計画 | Slack #project |
| 金曜 16:00 | NoCoDB進捗率更新 | wiki参照 |
| 金曜 18:00 | M9週次チェック確認 | Slack #project |
| 金曜 18:15 | 振り返り | `/retro` |
| 金曜 18:30 | 学習記録 | `/learn` |

## 月次ルーティン

| タイミング | アクション | コマンド |
|----------|----------|---------|
| 月初 | 戦略レビュー | `/cso` |
| 四半期初 | 包括レビュー | `/cso --comprehensive` |
| 月末 | ストーリー見直し | ポータルStoryMap |

## コマンド一覧

| コマンド | 用途 |
|---------|------|
| `/commit` | jj describe + jj new |
| `/merge` | PR作成 → マージ → クリーンアップ |
| `/retro` | 週次振り返り → Inbox |
| `/cso` | 月次戦略レビュー → Inbox |
| `/learn` | 学習をepisodesに登録 |
| `/create-pr` | PR作成のみ |
| `/deploy-merged-pr` | マージ済みPRデプロイ |

## 判断フローチャート

```
何かやりたいことがある
  │
  ├─ バグ修正？ → verify-first-debugging skill
  ├─ 新機能？ → Plan Mode → TDD
  ├─ ドキュメント？ → wiki直接編集
  ├─ 設定変更？ → .env or NocoDB
  └─ わからない → /workflow で確認
```
