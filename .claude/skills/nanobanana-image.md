---
description: "Google Gemini 3 Pro Image APIを使って画像を生成する"
---

# Nano Banana Pro 画像生成スキル

Google AI Studio API（Gemini）を使って画像を生成する。

## 前提条件

- 環境変数 `GEMINI_API_KEY` が設定されていること

## 使い方

```
/nanobanana-image <プロンプト>
```

## 実行手順

### 1. APIキーの確認

```bash
echo $GEMINI_API_KEY
```

設定されていない場合はユーザーに設定を依頼する。

### 2. 画像生成APIを呼び出す

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "<プロンプト>"}]}],
    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
  }' | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -d > /tmp/generated_image.png
```

### 3. 生成された画像を確認

```bash
open /tmp/generated_image.png
```

または Read ツールで画像を表示してユーザーに見せる。

## モデル選択

| モデル | 用途 |
|--------|------|
| `gemini-3-pro-image-preview` | 最高品質、4K対応、テキストレンダリング優秀（推奨） |
| `gemini-2.5-flash-image` | 高速生成、コスト効率重視 |

## 注意事項

- 詳細な説明文の方が良い結果が得られる（キーワード羅列より文章で）
- 生成画像には SynthID 透かしが含まれる
- API利用料金に注意
