# キャラクター画像生成ガイド

## 概要

nano_bananaで佐藤さんのキャラクターイラストを生成する方法。
**すべてのテンプレートで自動的に佐藤さんの顔と感情表現が含まれます**。
プロセスエコノミー型SNS投稿（30日アクション等）に最適。

### 🎭 NEW: 感情表現機能
- **デフォルトで参照画像を使用**: `-r`オプション不要（自動で`sato-keigo.jpg`を使用）
- **各テンプレートに最適な感情**: confessionなら後悔、incidentなら衝撃の表情を自動生成
- **顔が見える**: 不自然でない限り、佐藤さんの顔がはっきり表示される
- **感情が伝わる**: 各テンプレートのコンテキストに合った感情表現

---

## 基本コマンド

```bash
cd /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts

# シンプル版（参照画像は自動で使用される）
/Users/ksato/workspace/.venv/bin/python nano_banana.py \
  "メインテーマ" \
  "ポイント1" \
  "ポイント2" \
  "ポイント3" \
  -t テンプレート名 \
  -o /Users/ksato/workspace/brainbase-config/_codex/sns/images/出力ファイル名.png

# 従来版（-r オプションで明示的に指定も可能）
/Users/ksato/workspace/.venv/bin/python nano_banana.py \
  "メインテーマ" \
  "ポイント1" \
  "ポイント2" \
  "ポイント3" \
  -t テンプレート名 \
  -r /Users/ksato/workspace/brainbase-config/_codex/brand/assets/profile/sato-keigo.jpg \
  -o /Users/ksato/workspace/brainbase-config/_codex/sns/images/出力ファイル名.png
```

---

## 参照画像

- **場所**: `/Users/ksato/workspace/brainbase-config/_codex/brand/assets/profile/sato-keigo.jpg`
- **説明**: Xプロフィール写真（黒スーツ、ターコイズ背景）
- **自動使用**: `-r` オプション省略時、自動的にこの画像を使用
- **上書き**: 別の画像を使いたい場合のみ `-r` で指定

---

## テンプレートの特徴

### 統一トーン戦略（全テンプレート共通）

**ブランド認知のための視覚的一貫性**:
- **SNS戦略との整合**: 川岸式「①アイコン：認知（モノクロで統一など、記憶に残る）」
- **KPI達成**: 連続視聴率向上のため、「この人の投稿だ」と即座に認識させる
- **見慣れ→第一想起**: スクロール中に一瞬見ただけで佐藤さんと認識できる視覚体験

**統一要素（全テンプレート共通）**:
- **描画スタイル**: Semi-realistic business illustration
- **品質**: Modern, clean, professional
- **禁止**: 漫画/アニメ風、フォトリアル
- **顔の特徴**: 参照画像から忠実に再現
- **服装**: 黒スーツ、プロフェッショナルな外見

**可変要素（テンプレートごとに最適化）**:
- 背景色・パターン（turquoise, dark, YouTube風など）
- ライティング（スポットライト、自然光、ドラマチック）
- エフェクト（進捗バー、緊急速報テープ、グラフなど）
- レイアウト（中央、左右分割、コーナー）

### キャラクター再現の仕様
- 参照画像から顔の特徴を維持
- 黒スーツのプロフェッショナルな外見を保持
- ターコイズ/シアン背景（参照画像に合わせる）※テンプレートにより変更可
- 16:9横長レイアウト（SNS最適）
- セミリアルなイラスト調（写実的すぎず、漫画的すぎず）**全テンプレートで一貫**

### 感情表現の自動選択

各テンプレートで最適な感情表現を自動生成：

| テンプレート | 感情・表情 | 配置 | 用途 |
|------------|----------|------|------|
| **character** | 自信、決意 | 中央メイン | 宣言・挑戦 |
| **infographic** | 説明、プロフェッショナル | 右側30% | 情報説明 |
| **progress** | 悩み→希望（左右で変化） | 左右分割 | 変化の過程 |
| **incident** | 驚き、衝撃 | 中央目立つ | 事件・問題発生 |
| **confession** | 後悔、内省、正直 | 中央スポットライト | 失敗告白 |
| **mystery** | 困惑、好奇心、思考 | 考え込む姿 | 謎・疑問提起 |
| **gap** | 期待→落胆（左右で変化） | 左右対比 | ギャップ表現 |
| **poll** | 親しみ、誘いかけ | 上部または横 | 投票呼びかけ |
| **recovery** | 苦闘→決意（V字に沿う） | V字の谷 | 回復過程 |
| **framework** | 知識、プロフェッショナル | 右下コーナー小 | 概念説明 |

### ポーズのバリエーション（自動選択）
文脈に応じて以下から自動選択：
- 腕組みの自信あるポーズ（宣言/告知系）
- 顎に手を当てた思考ポーズ（課題解決系）
- 前方を指すアクティブポーズ（挑戦/行動系）
- ラップトップ作業中（進捗報告系）
- ボード前でのプレゼン（説明系）
- 頭を抱える（後悔/失敗系）
- 驚きの手を上げる（衝撃系）

---

## 30日アクション投稿への活用例

### 1. プロセスエコノミー宣言投稿

```bash
# シンプル版（-r 不要！）
/Users/ksato/workspace/.venv/bin/python nano_banana.py \
  "AIで事業の80%を自動化する挑戦、始めます" \
  "現在の自動化率：約40%" \
  "目標：6ヶ月で80%達成" \
  "週次で進捗を公開していきます" \
  -t character \
  -o /Users/ksato/workspace/brainbase-config/_codex/sns/images/30day_declaration.png
```

**結果**:
- ✅ 佐藤さんの顔がはっきり見える
- ✅ 腕組みの自信あるポーズ（自動選択）
- ✅ 進捗バー（40% → 80%）の可視化
- ✅ ターコイズ背景でブランド統一
- ✅ 宣言文を日本語で明示

### 2. 週次進捗報告（progress: 感情変化を表現）

```bash
/Users/ksato/workspace/.venv/bin/python nano_banana.py \
  "今週の自動化進捗：45%達成" \
  "会議記録の自動化を実装" \
  "タスク管理の一本化完了" \
  "来週：意思決定ログの自動抽出に挑戦" \
  -t progress \
  -o /Users/ksato/workspace/brainbase-config/_codex/sns/images/weekly_progress_w1.png
```

**結果**:
- ✅ 左側：悩んでいた佐藤さん（困った表情）
- ✅ 右側：希望を持った佐藤さん（決意の表情）
- ✅ 感情の変化が一目でわかる

### 3. 参加型企画（poll: 誘いかける表情）

```bash
/Users/ksato/workspace/.venv/bin/python nano_banana.py \
  "次に自動化すべき業務はどれ？" \
  "A: 経費精算の入力" \
  "B: 顧客対応メールの下書き" \
  "C: 定例ミーティングの議事録" \
  -t poll \
  -o /Users/ksato/workspace/brainbase-config/_codex/sns/images/poll_next_automation.png
```

**結果**:
- ✅ 親しみやすい表情で投票を呼びかける佐藤さん
- ✅ 「一緒に考えよう」という雰囲気

### 4. 失敗告白（confession: 後悔の表情）

```bash
/Users/ksato/workspace/.venv/bin/python nano_banana.py \
  "完璧なツールを3つ導入したら、仕事が破綻した" \
  "ツールA、B、Cは単体では最高" \
  "でも連携できずデータが散乱" \
  "結局、手作業で統合する羽目に" \
  -t confession \
  -o /Users/ksato/workspace/brainbase-config/_codex/sns/images/tool_failure_confession.png
```

**結果**:
- ✅ 頭を抱える佐藤さん（内省的な表情）
- ✅ スポットライトの中で正直に告白
- ✅ 脆弱性を見せることで共感を得る

### 5. 事件発生（incident: 衝撃の表情）

```bash
/Users/ksato/workspace/.venv/bin/python nano_banana.py \
  "本番環境で、全データが消えた" \
  "バックアップを取ったつもりだった" \
  "でも、バックアップ先も同じサーバー" \
  "復旧不可能" \
  -t incident \
  -o /Users/ksato/workspace/brainbase-config/_codex/sns/images/data_loss_incident.png
```

**結果**:
- ✅ 驚いて両手を上げる佐藤さん
- ✅ 【悲報】緊急速報テープ
- ✅ スクロールを止める視覚的インパクト

---

## 他テンプレートとの組み合わせ

`character`テンプレートは人物中心。情報整理には他テンプレートを併用：

| 用途 | テンプレート | 説明 |
|------|-------------|------|
| 人物+宣言 | `character` | 30日アクション宣言、週次報告 |
| 進捗の方向性だけ | `progress` | V字回復、Before/Afterの対比（オチは隠す） |
| 投票・アンケート | `poll` | 参加型企画 |
| 失敗告白 | `confession` | 静かで内省的な失敗共有 |
| 謎・疑問 | `mystery` | 「なぜ？」で止める投稿 |

---

## トラブルシューティング

### 画像が生成されない
- GOOGLE_API_KEYが設定されているか確認：`echo $GOOGLE_API_KEY`
- 参照画像のパスが正しいか確認：`ls -lh /Users/ksato/workspace/brainbase-config/_codex/brand/assets/profile/sato-keigo.jpg`

### キャラクターが似ていない
- `-r`オプションで参照画像を必ず指定
- 参照画像が正しく保存されているか確認（26KB以上）

### 画像の保存先
デフォルトは`/Users/ksato/workspace/_codex/sns/images/`
`-o`オプションで任意のパスに変更可能

---

## 参考：SNS戦略との対応

| SNS戦略の要素 | character活用方法 |
|--------------|------------------|
| プロセスエコノミー | 週次進捗報告で本人が登場 → 「当事者感」醸成 |
| ワンチャン感 | 本人の顔が見える → 「1人社長」の弱者性を可視化 |
| 連続ドラマ型 | 毎週同じキャラで登場 → 「次どうなる？」継続性 |
| 参加型企画 | 投票呼びかけで本人登場 → 「一緒に考えてる」感 |

---

**最終更新**: 2026-01-01
**作成者**: Claude Code
**バージョン**: 2.0（感情表現機能追加）
**参照**: `/Users/ksato/workspace/brainbase-config/_codex/sns/sns_strategy_os.md`

---

## 変更履歴

### v2.0 (2026-01-01)
- 🎭 **感情表現機能追加**: すべてのテンプレートで佐藤さんの顔と感情を自動表現
- 🔄 **デフォルト参照画像**: `-r`オプション不要（自動で`sato-keigo.jpg`使用）
- 📊 **感情マッピング**: 9テンプレート×感情パターンの自動選択
- 🎨 **統一トーン戦略**: キャラクター描画スタイルを全テンプレートで統一（Semi-realistic business illustration）
- ✅ **テスト完了**: confession、incident テンプレートで動作確認済み

### v1.0 (2026-01-01)
- ✨ 初版リリース: characterテンプレート作成
- 📝 基本的な使い方ガイド
