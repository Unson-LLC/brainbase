# brainbase ↔ mana 連携ガイド

**対象**: brainbase-unson と mana の両方を使うメンバー（業務委託 / 社員）
**更新日**: 2026-05-05

---

## ひと言まとめ

- **brainbase**: 自分のローカルで起動する **「自分用の作業ハブ + Graph SSOT 窓口」**。 セッション・タスク・wiki・Graph 参照・MCP を 1 画面で扱う。
- **mana**: クラウド側で動く **「みんなの Slack 秘書」**。 朝の brief・期限リマインド・週次 milestone・議事録キャプチャを Slack に流す。
- **接続点**: 両者は **NocoDB（タスク / プロジェクト管理の SSOT）と Slack** を共有して連携する。 直接 RPC で呼び合うわけではない。

---

## それぞれの役割

| 観点 | brainbase | mana |
|---|---|---|
| 起動場所 | 各メンバーのローカル PC（`localhost:31013`） | AWS Lambda + GitHub Actions セルフホストランナー |
| 主な UI | ブラウザ（自分専用ダッシュボード）+ Claude Code MCP | **Slack**（DM / メンション / ボタン） |
| 認証 | Slack OAuth → `~/.brainbase/tokens.json` | Slack Bot Token（社内共通） |
| LLM | ローカル Claude Code（個人 plan） | Bedrock (Claude API) / Claude CLI（Max plan） |
| 主な責務 | 自分の作業状態を**操作する** | チームへ**通知・促す** |

---

## どこで繋がっているか

```
            ┌──────────────────────────────────────┐
            │    NocoDB (brainbase base)           │
            │  pva7l2qlu6fdfip                     │
            │  - タスク / スプリント / マイルストーン │
            │  - 課題（バグ / 要求） / 議事録タスク   │
            └────────┬───────────────────────┬─────┘
                     │ 読み書き              │ 読み書き
                     │                       │
        ┌────────────▼─────────┐   ┌─────────▼────────────┐
        │  brainbase           │   │  mana                │
        │  (各人ローカル)       │   │  (クラウド)           │
        ├──────────────────────┤   ├──────────────────────┤
        │ ・タスク表示 / 更新   │   │ ・M1 朝のbrief        │
        │ ・mana Capture       │   │ ・M3/M4 期限/超過     │
        │   /api/brainbase/    │   │ ・M6 進捗レポート     │
        │   mana/capture       │   │ ・M9 週次milestone    │
        │ ・mana ワークフロー   │   │ ・Slack mention処理  │
        │   実行履歴の閲覧      │   │ ・議事録 / 名刺OCR    │
        └────┬─────────────┬───┘   └────────┬─────────────┘
             │             │                │
             │             │  GitHub Actions│
             │             │  実行履歴       │
             │             ▼                │
             │       ┌─────────────┐        │
             │       │  GitHub     │◀───────┘
             │       │  (mana repo) │
             │       └─────────────┘
             │
             ▼
       ┌──────────────────┐
       │  Slack            │◀─────── mana が直接投稿
       │  (DM / mention)   │
       └──────────────────┘
```

### 共有しているもの

1. **NocoDB の brainbase base（`pva7l2qlu6fdfip`）**
   - mana が朝の brief や期限リマインドで読むタスクと、 brainbase 上で各メンバーが更新するタスクは **同じ NocoDB レコード**。
   - brainbase の `mana Capture`（後述）で投げた課題も同じ base に `status: "captured"` で入る。
   - つまり brainbase 上で完了にしたタスクは mana の翌朝 brief から自動で消える。

2. **Slack（同じワークスペース）**
   - mana は Slack に投稿する側。
   - brainbase はメンバー認証（Slack OAuth）の経路としてだけ使う。 brainbase 自体は基本 Slack に投稿しない。

3. **GitHub Actions のワークフロー履歴**
   - brainbase の `/api/brainbase/mana-workflow-stats` は、 mana の M1〜M12 ワークフロー（GitHub Actions）の最近の成功/失敗を見せる UI 用 API。
   - メンバーが「mana の朝メッセージ来てない」 と思ったとき、 brainbase 上から実行履歴を確認できる。

### 共有していないもの

- brainbase のセッション状態（tmux セッション、 ttyd 端末、 Claude Code の対話）は **個人ローカル限定**。 mana は触れない。
- mana の Slack 投稿の意思決定（brief 内容の生成）は mana 内部で完結。 brainbase は呼ばれない。

---

## メンバー視点での使い分け

| やりたいこと | どっち | 入口 |
|---|---|---|
| 朝、 今日やることを Slack で受け取る | mana | 自分宛 DM（M1 朝のブリーフィング） |
| 期限が近いタスクが来てるか確認 | mana | DM（M3 / M10） |
| 期限超過がないか確認 | mana | DM（M4） |
| その日のうちに思いついた課題を入れる | brainbase | 各人ローカル UI の **「+ 課題キャプチャ」**（mana Capture） |
| タスクの詳細編集・並び替え | brainbase or NocoDB 直 | brainbase UI / NocoDB UI |
| 議事録から自動でタスクが起きてくる | mana | Slack に議事録ファイルを共有 → mana が解析 → NocoDB に登録 → Slack に承認 DM |
| 週末にスプリントの進捗確認 | mana | 金 18:00 の M9 週次マイルストーン |
| brainbase Graph で人物・組織・プロジェクトを引く | brainbase | Claude Code に直接質問（[brainbase MCP 経由](member-onboarding.md#brainbase-mcpbrainbase-graphとは)） |
| mana の朝メッセージが来ない原因調査 | brainbase | UI の mana ワークフロー実行履歴ビュー |

---

## brainbase に組み込まれている mana 連携 API

メンバーが直接叩くことは少ないが、 ローカル UI の以下の機能はこれらに依存している。

| Endpoint | 用途 | 依存先 |
|---|---|---|
| `GET /api/brainbase/mana-workflow-stats` | mana の GitHub Actions 実行履歴を集計 | GitHub API（mana repo） |
| `GET /api/brainbase/mana-history/...` | mana の Slack 投稿履歴 | DynamoDB `mana-message-history` |
| `POST /api/brainbase/mana/capture` | 課題即キャプチャ（Slack を経由せず NocoDB 直登録） | NocoDB brainbase base |
| `POST /api/brainbase/mana/chat` | mana チャット（ローカル UI 内、 mana ペルソナで対話） | Bedrock (Claude API) |

実装の入口: `server/routes/brainbase.js` → `mana-routes.js` / `mana-capture-routes.js`

---

## 環境変数の対応関係

両方が同じ NocoDB base / Slack workspace を見るための変数。 設定は各リポジトリに分かれている。

| 変数 | brainbase 側 | mana 側 | 用途 |
|---|---|---|---|
| NOCODB_URL | `.env`（共有 brainbase base 指定） | Lambda 環境変数 | 同じ NocoDB を指す |
| NOCODB_TOKEN | `.env` | Lambda 環境変数 | API 認証 |
| MANA_MESSAGE_HISTORY_TABLE | `.env` で DynamoDB テーブル名指定 | mana 側で書き込み | brainbase が mana の投稿履歴を読む |
| MANA_REPO_PATH | `.env` でローカル mana repo を指す | - | brainbase の workflow-stats API で履歴を読むため |

`./scripts/setup.sh`（メンバーオンボーディング）でこの辺は自動的に Infisical から注入される。 個別に設定する必要は基本ない。

---

## トラブルシューティング

| 症状 | 確認場所 | 対処 |
|---|---|---|
| mana の朝メッセージが届かない | brainbase UI の mana ワークフロー履歴 | M1 が失敗していたら GitHub Actions ログを見る |
| brainbase で完了にしたタスクが mana brief に残る | NocoDB 上のステータス | NocoDB 側で `status` が更新されていない可能性。 ステータス値の英日表記ゆれを確認 |
| Slack 議事録共有しても NocoDB にタスクが起きない | mana Lambda ログ | `processFileUpload.js` 周辺。 mana の Slack bot 招待漏れも確認 |
| mana Capture（brainbase 側）で 500 が出る | brainbase server log | `NOCODB_TOKEN` 未設定 / brainbase base へのアクセス権限なし |

---

## さらに詳しく

- mana 側の全体像: `/Users/ksato/workspace/projects/mana/architecture.md`
- mana のメッセージ設計（M1〜M12）: `/Users/ksato/workspace/projects/mana/02_message_design_v2.md`
- mana のインフラ（Lambda / セルフホストランナー）: `.claude/skills/mana-infrastructure/SKILL.md`
- brainbase 全体: `docs/architecture/DESIGN.md`
- brainbase MCP / Graph SSOT: [member-onboarding.md](member-onboarding.md#brainbase-mcpbrainbase-graphとは)
