# SNS投稿（ドラフト作成 → 画像生成 → X投稿）

ユーザーの入力（ネタ/アイデア/今日の作業）から、X投稿のドラフトを2-3案作成し、選択した案で画像生成→投稿まで実行。

## 参照すべきファイル

作成前に必ず以下を読み込んでください：
1. `_codex/sns/sns_strategy_os.md` - 戦略・ポジショニング
2. `_codex/sns/rules.md` - ガードレール
3. `_codex/sns/x_account_profile.md` - アカウント情報・人格定義
4. `_codex/sns/post_log.md` - 投稿履歴（ネタ被り防止用）

## アカウント軸

- **肩書き**: 事業OSエンジニア
- **テーマ**: 複数事業を同じOS（構造・KPI）で回す設計図を公開
- **ターゲット**: GM候補 / 経営者 / 事業責任者
- **KPI**: DM・商談・採用（フォロワー数より重要）

## ガードレール（必須）

- ❌ 禁止: ツール感想だけ / 一般論だけ / 事業OSと無関係なAIニュース
- ✅ 「OSのどこが変わるか」を最低1行入れる
- ✅ **「悩み→判断→結果」型を必ず1案は出す**（何に悩み、なぜその判断をし、どうなったか）
- ✅ 問いかけCTAで締める（「〜な人いる？」「みんなはどうしてる？」など）
- ❌ DM誘導は避ける（ハードルが高い）
- ✅ トーン: 簡潔・具体・再現性。誇張NG、数字は根拠付き

## 出力フォーマット

各案を以下の形式で出力：

```
━━━━━━━━━━━━━━━━━━━━
📝 案1（投稿の型）
━━━━━━━━━━━━━━━━━━━━

【本文】
（280文字以内のX投稿文。人格定義に従った口調で）

【タグ案】なし or #タグ
【CTA】問いかけ形式（例：「〜な人いる？」「みんなはどうしてる？」）
【テンプレ】infographic / exploded / dashboard / framework

━━━━━━━━━━━━━━━━━━━━
```

## 実行フロー

### Step 1: ネタ収集
1. `git log --oneline --since="midnight"` で今日のコミット確認
2. `_codex/sns/post_log.md` を読み、過去に投稿したトピックを確認
3. ユーザー入力がなければコミット内容からネタ抽出（既出トピックは除外）
4. 戦略ファイル・人格定義を読み込み

### Step 2: ドラフト作成
1. **「悩み→判断→結果」型を必ず1案は含める**
   - 何に悩んだか（トレードオフ、選択肢の比較）
   - なぜその判断をしたか（理由、根拠）
   - どうなったか（結果、学び）
   - ※ユーザーに「何を悩んだか」をヒアリングして深掘りする
2. 「OSのどこが変わるか」の視点で再構成
3. 人格定義に従った口調・表現で作成（「〜なんよな」「マジで」等）
4. ガードレールをチェックしながら2-3案作成
5. 各案に【テンプレ】を指定（infographic / exploded / dashboard / framework）

### Step 3: ユーザー選択
案を提示したら、AskUserQuestionで選択を求める：

```
どの案で投稿しますか？
- 案1で投稿
- 案2で投稿
- 案3で投稿
- 修正したい
- 投稿しない（ドラフト保存のみ）
```

### Step 4: 画像生成
選択された案の【テンプレ】を使ってNano Banana Proで画像生成：

```bash
# テンプレート一覧確認
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py --list

# 画像生成（本文から自動でポイント抽出）
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py \
  -t <template> \
  "トピック" \
  "ポイント1" "ポイント2" "ポイント3"
```

テンプレート：
- `infographic` - ビジネス図解（ポイント整理向け）
- `exploded` - 3D分解図（システム構造向け）
- `dashboard` - ダッシュボード（KPI向け）
- `framework` - 概念図（フレームワーク向け）

### Step 5: 投稿確認
生成された画像パスを確認後、最終確認：
- 「この内容で投稿しますか？」（dry-runの結果を見せる）
- OKなら `--dry-run` を外して実行

### Step 6: 投稿実行

```bash
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/_codex/common/ops/scripts/sns_post.py \
  --title "トピック要約" \
  --body "投稿本文" \
  --image <生成された画像パス>
```

投稿完了後：
1. URLを報告
2. `post_log.md` に自動記録される

## オプション

| 引数 | 動作 |
|------|------|
| `--draft-only` | ドラフト作成のみ（投稿しない） |
| `--skip-image` | 画像生成をスキップ |
| `--image PATH` | 既存画像を使用 |

## 入力例

- `/sns` → 今日のコミットからネタ抽出
- `/sns BAAOを3分割した` → 指定ネタで案作成
- `/sns --draft-only` → ドラフト保存のみ
- `/sns --image /path/to/img.png` → 既存画像で投稿

$ARGUMENTS
