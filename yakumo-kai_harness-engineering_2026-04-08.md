# 八雲会ネタ帳: ハーネスエンジニアリング
**日付**: 2026-04-08
**担当**: 佐藤

---

## 導入: ハーネスエンジニアリングとは

**一言で**: AIエージェント（Claude Code）の「手綱」を設計・実装するエンジニアリング

- コードを書くのはAI、**AIの動き方を設計するのが人間**
- プロンプトだけでなく、hooks / guards / skills / commands / plugins という**多層の制御機構**で成り立つ
- brainbaseでは `.claude/` ディレクトリに **98 skills, 28 hooks, 5 commands** が稼働中

---

## 1. アーキテクチャ全体像（5層モデル）

```
Layer 5: CLAUDE.md（思考フレームワーク・判断基準）
Layer 4: Skills（98個の専門知識パック）
Layer 3: Commands（/commit, /merge 等のワークフロー）
Layer 2: Hooks（Pre/Post/Submit/Stop/Start の自動介入）
Layer 1: Guards（jj-commit-guard, push-guard）
```

**話のポイント**: 上の層ほど「柔らかい」（自然言語）、下の層ほど「硬い」（TypeScriptで強制）

---

## 2. Hook設計パターン（最も話せるところ）

### 2.1 ライフサイクル全体をカバー

| タイミング | 何をしてるか | 例 |
|-----------|-------------|-----|
| **SessionStart** | 環境セットアップ | L2/L3から.claude/をコピー |
| **UserPromptSubmit** | プロンプト受信時に注入 | autonomy-reminder, skill-reminder, test-enforcer |
| **PreToolUse** | ツール実行前にゲート | forbidden-commands（rm禁止）, edit-validator |
| **PostToolUse** | ツール実行後に検証 | git通知, activity-bridge, verification-tracker |
| **Stop** | セッション終了前にガード | jj-commit-guard（未コミット防止）, push-guard |

### 2.2 設計の勘所

- **matcherパターン**: `Bash`, `Read`, `Edit|Write|MultiEdit`, `TodoWrite`, `.*`（全ツール）
- **timeout設計**: 3秒（軽量通知）〜 30秒（バリデーション）〜 120秒（テスト実行）
- **薄いwrapper → 厚いcore**: hooks/ディレクトリはエントリポイント、scripts/core/が本体
- **`.*` matcher**: activity-bridge, verification-tracker は全ツール実行を監視

### 2.3 面白い実装例

**forbidden-commands-wrapper**: `rm`, `mv`, `cp`, `git push --force`, `git reset --hard` をPreToolUseでブロック
→ AIに「やっちゃダメ」と言うより**物理的に止める**方が確実

**jj-commit-guard**: Stop時に「(no description set)」の未コミット変更を検出して終了を阻止
→ AIが「終わりました」と言っても**実際にコミットされてなければ止める**

**autonomy-reminder**: プロンプト受信時に「確認を返すな、end-to-endで実行しろ」とリマインド
→ CLAUDE.mdにも書いてあるが**毎回注入して忘れさせない**

---

## 3. Skills = 再利用可能な専門知識パック

### 3.1 構造

```
.claude/skills/
├── tdd-workflow/SKILL.md        # TDDの4Phase自動化
├── verify-first-debugging/SKILL.md  # バグ修正6Phase
├── sns-smart/SKILL.md           # X投稿ワークフロー
├── sales-ops/SKILL.md           # セールス自動化
└── ... (98個)
```

### 3.2 カテゴリ分類

| カテゴリ | 数 | 代表例 |
|---------|---|-------|
| 開発ワークフロー | ~15 | tdd-workflow, git-workflow, dev-architect |
| 運用・インフラ | ~10 | brainbase-ops-guide, deployment-platforms |
| マーケ・セールス | ~15 | sns-smart, salestailor-bulk-campaign |
| ナレッジ・理論 | ~10 | behavioral-persuasion, eos-framework |
| トラブルシュート | ~8 | verify-first-debugging, ttyd-rendering-fix |
| その他 | ~40 | meishi-management, remotion-video-builder |

### 3.3 話のポイント

- Skillsは**CLAUDE.mdに書ききれない専門知識**を外部化したもの
- UserPromptSubmitの`skill-reminder`フックが**関連Skillを自動サジェスト**
- 「Skillsに登録しておいて」で`skill-creator`が新Skill自動生成

---

## 4. Commands = ワークフロー定型化

| コマンド | やること |
|---------|--------|
| `/commit` | jj describe + 「悩み→判断→結果」のナラティブ |
| `/merge` | push → PR作成 → マージ → ブランチ掃除 一気通貫 |
| `/create-pr` | Jujutsuセッションからgh pr create |
| `/deploy-merged-pr` | サーバー側worktree更新 + 条件付きリスタート |
| `/learn` | 学びをbrainbase learnシステムに登録 |

**話のポイント**: コマンドは「AIへの指示」ではなく「AIが実行するマクロ」

---

## 5. 学習ループ = /learn + skill-creator

### 5.1 /learn コマンド

- セッション中の学びを `brainbase learn add` でエピソードとして登録
- 登録されたものは学習inboxに入り、レビュー後に正式採用
- **自動振り分け**: Why/Policy/定義 → wiki DB、When/How/手順 → skills

```
学びが発生
→ /learn で候補登録
→ brainbase learn inbox でレビュー
→ wiki_candidate or skill_candidate に振り分け
→ 正本（wiki DB or .claude/skills/）に昇格
```

### 5.2 skill-creator = 「Skillsに登録しておいて」

- 会話中に「Skillsに登録しておいて」と言うだけで新Skill自動生成
- 4Phase: 要件分析 → Skill設計 → SKILL.md生成 → ファイル配置
- 重複検出・既存Skillへのパッチも判断

### 5.3 話のポイント

- ハーネスは**固定物ではなく、運用しながら育つ**
- /learnで知見を蓄積 → skill-creatorでSkill化 → skill-reminderフックで自動注入
- この**学習→定着→想起のサイクル**がハーネスの成長エンジン

---

## 6. スケジュール実行 = 定期的な振り返りと運用

### 6.1 利用可能な仕組み

| 仕組み | 用途 |
|--------|------|
| `/schedule` | cronベースでリモートエージェントを定期実行 |
| `/loop` | セッション内で繰り返し実行（デフォルト10分間隔） |
| `RemoteTrigger` | 外部からエージェント実行をトリガー |

### 6.2 定期ワークフロー例

| 頻度 | コマンド/Skill | やること |
|------|---------------|--------|
| **毎朝** | `/ohayo`（ops-daily） | メール振り分け・カレンダー確認・タスク優先度・インフラヘルスチェック |
| **週末** | `/retro`（dev-ship内） | 週次コミット分析・パターン検出・改善提案レポート |
| **月一** | `/ceo` | 経営視点の振り返り・KPI確認・戦略判断 |

### 6.3 ops-daily（毎朝の自動化）

3職能が並列で動く:
1. **Executive Assistant**: ブリーフィング、メール仕分け、緊急抽出、スケジュール調整
2. **Infrastructure Manager**: リポジトリ同期、ヘルスチェック、バックアップ
3. **Knowledge Analyst**: 学習抽出、KPI計算、SNSバズ分析、週次レポート

### 6.4 話のポイント

- ハーネスは「リアクティブ」（hookで受動的に介入）だけでなく**「プロアクティブ」**（スケジュールで能動的に実行）
- `/ohayo` → 日次 / `/retro` → 週次 / `/ceo` → 月次 の**3層の振り返りサイクル**
- 人間がやらなくても**AIが定期的に振り返りを回す**

---

## 7. CLAUDE.md = 思考フレームワーク注入

### 6.1 Agent Operating Policy（0.0〜0.7）

最も特徴的なセクション:

| Policy | 内容 |
|--------|-----|
| **0.1 Default To Autonomous** | 確認を返すな、end-to-endで完了させろ |
| **0.2 Clarify Only When Material** | 「わからない」ではなく「誤ると高コスト」な時だけ質問 |
| **0.3 Commit Small, Then Move** | 1意図=1commit、未コミットで次に行くな |
| **0.4 Skills First** | 記憶で進めるな、まずSkill確認 |
| **0.6 Deterministic Guards** | 「気をつける」ではなく「止まる仕組み」で再発防止 |

### 6.2 設計思想

- **自然言語で書いた「法律」** → hookで「執行」
- CLAUDE.md単体では守られない → hookとの**二重構造**が重要
- 例: 0.1の「確認を返すな」→ autonomy-reminderフックで毎回注入

---

## 7. 監視・状態管理

### Activity Bridge
- 全ツール実行で brainbase API（:31013/:31014）にハートビート送信
- セッション状態をJSONで永続化
- 用途: brainbase UIでのセッション可視化

### Verification Tracker
- 検証ステップの完了を追跡
- 「テスト実行した？」をhookレベルで強制

### ログ
- 日次ローテーション: pretooluse / posttooluse / userpromptsubmit / stop
- デバッグ用: hook実行の成功/失敗を全記録

---

## 9. 議論したいポイント

### Q1: ハーネスの「正しい厚さ」はどこか？
- 今は28 hooks + 29 core modules → **重すぎないか？**
- timeout超過でUXが悪化するリスク
- 「AIを信頼する」vs「AIを制御する」のバランス

### Q2: CLAUDE.md vs Hooks の役割分担
- 自然言語で十分なもの / TypeScriptで強制すべきもの の線引き
- CLAUDE.mdに書いても守られなかったもの → hookに昇格させた経験

### Q3: Skills の粒度
- 98個は多すぎるか？ → **発見性の問題**
- skill-reminderフックが自動サジェストするが、精度は？
- 「使われないSkill」の棚卸しは必要か

### Q4: 学習ループの回し方
- /learnで登録 → inboxレビュー → Skill化 のサイクルは回っているか？
- 「使われないSkill」の棚卸しは必要か
- 学習の自動化はどこまでできるか（人間のレビューなしで昇格させてよいか）

### Q5: スケジュール実行の実用性
- `/ohayo`（日次）/ `/retro`（週次）/ `/ceo`（月次）は定着しているか？
- 人間不在でも回るプロアクティブな運用の価値
- コスト（API呼び出し）とのバランス

### Q6: このアプローチのスケーラビリティ
- 個人プロジェクト → チーム開発への拡張
- `.claude/` を共有するか、個人カスタマイズを許すか
- brainbaseでは SessionStart hook で L2/L3 から配布 → **中央集権的配布**

---

## 10. まとめ: ハーネスエンジニアリングの要点

1. **多層防御**: 自然言語（CLAUDE.md）+ コード（hooks）+ 知識（skills）の三位一体
2. **Deterministic > Reminder**: 「気をつけて」より「止める」
3. **ライフサイクル全体**: SessionStart〜Stop まで隙間なくカバー
4. **自律と制御の共存**: 0.1で自律を促しつつ、hookで暴走を防ぐ
5. **知識の外部化**: 98 skillsで専門知識をモジュール化、必要時に注入
6. **学習ループ**: /learn → skill-creator → skill-reminder の知識成長サイクル
7. **プロアクティブ運用**: スケジュール実行で日次/週次/月次の振り返りを自動化

---

## 補足: 数字で見るbrainbaseのハーネス

| 項目 | 数量 |
|------|------|
| Hook TypeScript | 28 |
| Hook Shell Script | 4 |
| Core Modules | 29 |
| Skills | 98 |
| Custom Commands | 5 |
| Schedule Commands | 3（日次/週次/月次） |
| CLAUDE.md セクション数 | 9大項目 |
| Agent Operating Policy | 8条 |
