# note記事 最終調整ファイル

**記事タイトル**: マッキンゼーCEOが語った「AIに勝てる3スキル」を、現場で使える形に翻訳してみた

---

## 1. 見出し画像プロンプト（Nano Banana Pro用）

### 推奨プロンプト

```
A modern business illustration in 16:9 aspect ratio. Split composition showing contrast between AI and human roles. Left side: abstract geometric AI neural network patterns in cool blue tones. Right side: a confident business professional (mid-40s, Japanese male) standing at a whiteboard, writing strategic keywords. The two sides blend in the center, symbolizing collaboration. Color palette: navy blue, slate gray, subtle gold accents. Clean, minimalist corporate style. Leave negative space in the upper-left corner for text overlay. No text in the image itself.
```

### 日本語版（参考）

```
16:9のビジネスイラスト。AIと人間の役割の対比を表現した分割構図。左側：クールな青系統の抽象的な幾何学模様でAIのニューラルネットワークを表現。右側：40代の日本人ビジネスマンがホワイトボードに戦略的キーワードを書いている。中央で2つの側面が融合し、協働を象徴。配色：ネイビーブルー、スレートグレー、控えめなゴールドのアクセント。クリーンでミニマルな企業スタイル。左上にテキストオーバーレイ用の余白を確保。画像内にテキストは入れない。
```

### 生成コマンド

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "A modern business illustration in 16:9 aspect ratio. Split composition showing contrast between AI and human roles. Left side: abstract geometric AI neural network patterns in cool blue tones. Right side: a confident business professional (mid-40s, Japanese male) standing at a whiteboard, writing strategic keywords. The two sides blend in the center, symbolizing collaboration. Color palette: navy blue, slate gray, subtle gold accents. Clean, minimalist corporate style. Leave negative space in the upper-left corner for text overlay. No text in the image itself."}]}],
    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
  }' | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -d > /tmp/ai_human_skills_header.png
```

---

## 2. メタ情報

- **タイトル**: マッキンゼーCEOが語った「AIに勝てる3スキル」を、現場で使える形に翻訳してみた
- **タグ**: #AI活用 #マネジメント #ビジネススキル #マッキンゼー #キャリア
- **公開推奨日時**: 平日朝7:00-8:00（通勤時間帯）または昼12:00-13:00（昼休み）
  - 理由: ビジネスパーソン向け記事のため、通勤・昼休みの隙間時間に読まれやすい
  - 特に火曜〜木曜が推奨（月曜は週初めで忙しく、金曜は週末モードで読まれにくい）
- **想定読了時間**: 8分

---

## 3. 公開チェックリスト

- [ ] タイトル確定
- [ ] 見出し画像準備（上記プロンプトで生成 → Canvaで文字追加）
- [ ] タグ設定（5個以上）
- [ ] X告知文準備
- [ ] 次回記事の構想（Vol.2: 課題設定力の深掘り）

---

## 4. X告知文（投稿用）

### メイン告知文（280文字）

```
【note更新】マッキンゼーCEOが語った「AIに勝てる3スキル」

CES 2026での発言を、現場で使える形に翻訳しました。

元記事の抽象的な表現を
・課題設定力
・志を抱く能力
・価値設定能力
に再解釈。

明日から使える具体例も紹介。

「AIに仕事を奪われる」という漠然とした不安を感じている人に読んでほしい。

https://note.com/aibiznavigator/n/xxxxx
```

### ショート版（140文字）

```
マッキンゼーCEOが語った「AIに勝てる3スキル」を、現場で使える形に翻訳しました。

・課題設定力
・志を抱く能力
・価値設定能力

明日から使える具体例付き。

https://note.com/aibiznavigator/n/xxxxx
```

### リポスト用（100文字）

```
AIに勝てる人間のスキルは「問いを立て、志を持ち、価値を決める」こと。

現場で使える形に翻訳しました。
```

---

## 5. 記事本文（最終版）

ファイルパス: `/Users/ksato/workspace/brainbase-config/_codex/sns/drafts/ai_human_skills_draft_v2.md`

※ドラフトv2をそのまま使用（スコア82点で合格済み）

---

## 6. シリーズ構想

| Vol. | タイトル案 | テーマ |
|------|-----------|--------|
| 1 | 本記事 | 3スキルの全体像と翻訳 |
| 2 | 「良い問い」の立て方 | 課題設定力の深掘り |
| 3 | チームを動かす「語り方」 | 志を抱く能力の深掘り |
| 4 | 「何を大切にするか」の決め方 | 価値設定能力の深掘り |

---

## 7. 公開後アクション

1. X告知文を投稿
2. 24時間後にPV・スキ数を確認
3. コメントがあれば返信
4. 1週間後にVol.2の執筆開始

---

最終更新: 2026-01-22
