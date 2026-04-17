---
name: x-article-buzz-strategy
description: "X Article バズ戦略"
---

# X Article Buzz Strategy

X記事（Article）機能を活用してバズを生み出す戦略。32万ビューの実績に基づく。

---

## 概要

2026年1月、X公式が「記事形式の投稿をアルゴリズム優遇」を発表。この波に乗る戦略。

---

## 背景：X公式の動き

- **2026年1月16日**: X公式とイーロン・マスクが記事優遇を発表
- **収益分配強化**: クリエイターへの還元を増加
- **100万ドル賞金**: 最優秀長編記事プログラム開始
- **AI駆動型アルゴリズム**: 質の高い長文コンテンツを優先表示

---

## 32万ビューの5つの成功要因

### 1. 公式アルゴリズムの波乗り
- Xが「質の高い長文記事」を推しているタイミングに投稿
- AIによるコンテンツ評価が長文記事を優遇

### 2. トレンド選定
- 旬のネタを選ぶ（例: Claude Code）
- AI技術の進化は常にユーザーの関心を惹きつける

### 3. 英語→日本語の価値変換
- 有益な英語記事を日本語で解説
- 翻訳＋解説だけで高い価値が生まれる

### 4. セルフ引用のフック
- 記事公開後、自分で「引用リポスト」
- 要約やフックとなる文章を追加
- タイムラインでのクリック率が劇的に向上

### 5. オリジナルアイキャッチ
- note.comと同じ画像で視認性向上
- 「いつもの顔」でブランド認知

---

## チェーン引用（Chain Quote）戦略

### 仕組み

```
記事A（バズ）
  ↓ 引用リンクとして貼る
記事B（冒頭: 「前回の記事で反響があった〇〇ですが〜」）
  ↓ 引用リポストで拡散
記事C...
```

### 効果
- 過去記事への再流入
- 新記事の信頼性担保
- インプレッション循環
- 雪だるま式にフォロワー増加

### 実装手順
1. 記事Aがバズる
2. 記事Bを書く際、冒頭に記事Aを引用リンク
3. 記事B投稿後、引用リポストで拡散
4. 記事Cで記事Bを引用...（繰り返し）

---

## AIツール活用ポイント

### 自動化すべき作業
- トレンド情報収集
- 構成作成
- X記事フォーマット最適化（Markdown直貼りではなくHTML rich paste版を作成）
- 目を引くフック作成

---

## X Article 入稿フォーマット

X ArticleはMarkdownをそのまま貼っても見出し・太字・箇条書きに自動変換されない前提で運用する。

## X Article ヘッダー画像

- 推奨アスペクト比: **5:2**
- 推奨解像度: **1600x640**
- 最低運用: `1500x600` 以上の5:2横長バナー
- Nano Banana生成時はプロンプトに `Aspect ratio 5:2, resolution 1600x640` を明記する
- Nano Bananaが16:9など別サイズで返す場合があるため、生成後に必ず `sips -g pixelWidth -g pixelHeight <image>` で確認する
- サイズが違う場合は、最終入稿ファイルを `{topic}_header_1600x640.png` として5:2に整形してから使う
- ヘッダー画像は `_codex/sns/images/` に保存する

### Anthropic / Claude 系記事のヘッダー

Anthropic、Claude、Claude Code、Claude Code SDK、MCP、Anthropic Enterprise、Cowork などが主題の記事では、通常の汎用ビジネス図解ではなく、**Anthropic公式っぽい編集デザイン + Clawdキャラクター**を使う。

デザイン方針:
- 色: 黒、Anthropic/Claude系のオレンジ、暖かい紙色・クリーム背景
- 雰囲気: 余白多め、ミニマル、公式ブログ風、過度な青系SaaS図解にしない
- キャラクター: Clawd風のオレンジのピクセルステッカーキャラクターを入れる
- Clawdはロボット風・リアル動物風にしない。参照画像のような「オレンジの四角いドット絵ステッカー、白フチ、短い足、小さい黒目」に寄せる
- 本文のフックを大きく入れる。文字は少なく、X Article一覧で読めるサイズにする

Nano Banana生成時:
- Clawd参照画像がある場合は必ず `--ref-image <path>` で渡す
- 参照画像の現行例: `/Users/ksato/workspace/var/uploads/1776315447244-660192818.png`
- プロンプトには `Use the reference image as the source for the Clawd mascot shape and style` を含める
- プロンプトには `Aspect ratio 5:2, resolution 1600x640` を含める
- 生成後、必ず `sips -g pixelWidth -g pixelHeight <image>` で確認する
- Nano Bananaが5:2で返さない場合は、最終入稿用に `{topic}_header_1600x640.png` へ整形する

プロンプト例:
```bash
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/common/ops/scripts/nano_banana.py \
  -t character \
  -r /path/to/clawd_reference.png \
  -o /Users/ksato/workspace/shared/_codex/sns/images/{topic}_header_nano.jpg \
  -p "Use the reference image as the source for the Clawd mascot shape and style. Create a 5:2 X Article header image, resolution 1600x640, in Anthropic / Claude Code editorial style: warm off-white paper background, black typography, orange accent color, minimal premium layout. Preserve the reference mascot identity: orange pixel-art sticker character, simple square body, tiny black square eyes, short legs, white sticker outline, cute flat paper-sticker feel. Include one or more Clawd stickers from the reference style, not a robot, not realistic animal, not 3D. Main Japanese title text must be clear and large: {topic}. Keep composition clean and professional, suitable as X Article header. No logos, no watermark." \
  "{topic}" "point1" "point2" "point3"
```

### 正本
- 本文正本: `_codex/sns/drafts/{topic}_final.md`
- X Article貼り付け用: `_codex/sns/drafts/{topic}_x_article.html`
- 確認用プレーンテキスト: `_codex/sns/drafts/{topic}_x_article.txt`（必要な場合のみ）

### HTML rich paste方式
1. Markdown本文からHTML版を作る
2. HTMLは `h1` / `h2` / `p` / `strong` / `ul` / `li` を中心にする
3. ブラウザで `{topic}_x_article.html` を開く
4. 記事本文だけを選択してコピーする
5. X Articleエディタへ貼り付ける
6. 見出し・太字・箇条書きが保持されていることを確認する

### 禁止
- X Article用にMarkdownをそのまま渡して完了扱いにしない
- `#` / `##` / `**bold**` / `- list` が文字として残る形式を最終入稿フォーマットにしない
- APIで整形済みArticle下書きを作れる前提にしない
- 16:9画像をX Articleヘッダーの最終成果物として渡さない

### メリット
- 戦略に集中できる
- 公式発表から即座にテスト可能
- コンテンツ量産と質の維持を両立

---

## 実践チェックリスト

- [ ] X Premiumに加入（投稿表示優遇）
- [ ] トレンドテーマを選定
- [ ] 英語圏のバズ記事をリサーチ
- [ ] 日本語で価値変換した記事を作成
- [ ] オリジナルアイキャッチを用意
- [ ] 記事公開後、セルフ引用リポスト
- [ ] 次回記事で前回記事を引用（チェーン構築）

---

## 関連Skills

- `x-curate-smart` - 海外キュレーション自動化
- `x-curate-strategy` - 海外キュレーション戦略
- `sns-smart` - SNS投稿自動化Orchestrator
- `note-smart` - note記事自動化Orchestrator

---

## 出典

ハヤシシュンスケ（@The_AGI_WAY）の実験ログ（2026年1月）
