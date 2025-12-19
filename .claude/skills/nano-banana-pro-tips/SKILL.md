---
name: nano-banana-pro-tips
description: Nano Banana Pro（Gemini画像生成）の活用術。文字描写・図解生成・写真合成のテクニックと、nano_banana.pyとの連携方法を参照する際に使用。
---

## Triggers

以下の状況で使用：
- Gemini Nano Banana Proで画像を生成したいとき
- SNS用のサムネイル画像を作成したいとき
- nano_banana.pyを使ってプログラマティックに画像生成したいとき

# Nano Banana Pro 活用術

## Nano Banana Proの5つの特徴

### ① 文字描写力（SoTA Text Rendering）
- 日本語を正確に画像内に描写
- ロゴデザイン、ポスタータイトル、看板の文字が違和感なく生成

### ② 高解像度と自由なアスペクト比
- 最大2K、4Kアップスケール対応
- ワイドスクリーン、縦長スマホ壁紙など自由指定可能

### ③ 広範囲な知識（Enhanced World Knowledge）
- 文化的背景、専門的ツール、複雑なシチュエーションを理解
- 日本文化への理解が向上（銭湯の入り方、お茶の淹れ方など）

### ④ 洗練されたスタイル変換
- 「写真をアニメ調に」「スケッチを油絵風に」
- 元の構図を保ちつつ画風だけをコントロール

### ⑤ 進化した写真合成
- 最大6枚の画像を自然に統合
- 光の向き、影の落ち方、質感まで自動調整

## 使い方（Geminiアプリ）

1. 「思考モード」を選択
2. ツールから「🍌画像を生成」を選択
3. 画像を編集・統合したい場合は「＋」から最大6枚まで入力

## 活用事例とプロンプト例

### 1. 旅行プランニング（Deep Research連携）

```
添付ファイルの内容をもとに、北鎌倉を探索する旅のしおりを作成して！
スタイルは『水彩画風』で、温かみのあるタッチに。
お寺や神社の位置を地図に記載して、簡単な説明も加えて欲しい。
北鎌倉駅も画像に組み込んでざっくりした地理的な位置関係を反映させて。
アスペクト比はスマホで見やすい 9:16 で
```

### 2. バナー作成

- 参照したいバナー画像と商品/人物の画像を入力
- 配置からロゴ、「SALE」「NEW ARRIVAL」などの文字まで自然にレイアウト

### 3. 手順の図式化

```
天ぷらそばの作り方を可愛らしい画像とともにフローチャートにして
```

```
お客様へ訪問する際に名刺を渡す手順を仕事のできるビジネスパーソンとしてまとめて
その手順を全てフローチャート風に画像としてまとめて！添付キャラクターを使ってね！
```

### 4. 漫画制作

- キャラクターの一貫性を維持したまま異なる表情やシーンを描き分け
- 吹き出しの中にストーリーに沿ったセリフを挿入
- 4コマ漫画、コミックストリップなど

### 5. 2次元と3次元の融合

- 自分が撮影した風景写真にキャラクターを自然に配置
- 光の当たり方や影の落ち方が自動調整

### 6. 日常の写真編集

- 集合写真に写り込んだ不要な背景を消す
- 曇り空を青空に変える

## nano_banana.py との連携

brainbaseでは `nano_banana.py` でプログラマティックに画像生成が可能。

### スクリプトパス

```
/Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py
```

### 基本コマンド

```bash
# テンプレート一覧
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py --list

# テンプレート指定で生成
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py \
  -t <template> \
  "トピック" \
  "ポイント1" "ポイント2" "ポイント3"

# カスタムプロンプトで生成
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py \
  -p "カスタムプロンプト" \
  "トピック" \
  "ポイント1" "ポイント2"

# 参照画像を使って生成
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py \
  -t infographic \
  -r /path/to/reference.png \
  "トピック" "ポイント1"
```

### カスタムプロンプトのプレースホルダー

- `{topic}` - トピック（第1引数）
- `{points_text}` - ポイントのリスト（第2引数以降）

### 利用可能なテンプレート

**情報整理向け:**
- `infographic` - ビジネスインフォグラフィック（青白基調）
- `exploded` - 3D CADスタイルの分解図
- `dashboard` - ダッシュボード風（ダークテーマ）
- `framework` - 概念・フレームワーク図
- `isometric` - アイソメトリック・ピクト図解
- `graphrec` - グラフィックレコーディング風
- `whiteboard` - ホワイトボード図解

**感情・プロセス向け（SNS用）:**
- `progress` - 進捗/Before-After
- `incident` - 事件風サムネ（感情トリガー）
- `poll` - 投票/アンケート
- `recovery` - V字回復ストーリー
- `confession` - 告白/懺悔
- `mystery` - 謎/なぜ？
- `gap` - ギャップ/期待と現実

## LP画像生成プロンプト（参照）

スマホ向けLP画像を生成する詳細プロンプトは以下を参照：

```
/Users/ksato/workspace/_codex/sources/global/nano-banana-lp-prompt.md
```

## プロンプト構築の基本5要素

1. **被写体**: 誰または何が写っているか
2. **構図**: クローズアップ、ワイドショット、ローアングル等
3. **アクション**: 何が起こっているか
4. **場所**: どんな場面か
5. **スタイル**: 3Dアニメ、水彩画、フォトリアリスティック等

## Tips

1. **生成は「運」** - 同じプロンプトでも結果が変わる。何度か試してから判断
2. **簡潔に記載** - プロンプトが多いと効果が分かりにくい。少しずつ足す
3. **改行は `<br>` で制御** - デザイン上の改行位置を指定可能
4. **デザインの言語化が重要** - 知識と言語化能力がプロンプト精度を左右

---
最終更新: 2025-12-19
