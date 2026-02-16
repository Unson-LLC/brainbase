# Claude Code × GLM-5 記事作成用リサーチ資料

**作成日**: 2026-02-12
**目的**: X記事用の正確な情報まとめ（別ライターが記事化するための資料）

---

## 1. 背景・課題

### 1-1. Claude Codeの課題

| 課題 | 詳細 |
|------|------|
| **月額費用が高い** | Claude Pro/Maxプランは高額。チーム全体で導入するとコストが爆発的に増加 |
| **メンバー配布の困難さ** | 各メンバーに個別のサブスクリプション契約が必要。管理コストもかかる |
| **API課金の複雑さ** | 従量課金は予測が難しく、突然の高額請求リスクがある |

### 1-2. 意思決定の理由

**なぜz.aiを選んだのか**:
1. **サブスクリプション型**で予測可能なコスト
2. **APIキー配布**でチーム全体に同一環境を展開可能
3. **Claude Codeと完全互換**（裏側でGLMモデルを使用）
4. **GLM-5が最新かつ高性能**（Opus 4.6級の性能）

---

## 2. 解決策：z.aiのGLM Coding Plan

### 2-1. 仕組み

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code                          │
│  (見た目・操作はそのまま)                                  │
└─────────────────────┬───────────────────────────────────┘
                      │ 環境変数でバックエンド切り替え
                      ▼
┌─────────────────────────────────────────────────────────┐
│              z.ai API                                   │
│  GLM-4.5-air / GLM-4.7 / GLM-5                         │
└─────────────────────────────────────────────────────────┘
```

**ポイント**:
- Claude Codeのフロントエンドはそのまま
- バックエンドのAPI呼び出し先をZ.aiに変更
- ユーザー体験は変わらない

### 2-2. 設定方法

**ファイル**: `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5"
  }
}
```

**モデル階層**:

| Claude Code階層 | GLMモデル | 用途 |
|-----------------|-----------|------|
| Haiku | glm-4.5-air | 軽量タスク・検索 |
| Sonnet | **glm-5** | 標準的なコーディング |
| Opus | **glm-5** | 複雑なタスク・推論 |

---

## 3. 価格情報（2026年2月時点）

### 3-1. GLM Coding Plan価格（2026年2月12日改定）

| プラン | 初回（3ヶ月） | 2回目以降（3ヶ月） | 月額換算 |
|--------|--------------|-------------------|----------|
| **Lite** | $30 | $27 | ~$9/月 |
| **Pro** | $90 | $81 | ~$27/月 |
| **Max** | $240 | $216 | ~$72/月 |

### 3-2. 値上げの背景

- **2026年2月11-12日**に30%の値上げを実施
- 理由: 需要の急増、投資コストの増加
- **既存契約者は値上げ対象外**（祖父条項）

### 3-3. API単価（従量課金）

| モデル | Input | Cached Input | Output |
|--------|-------|--------------|--------|
| **GLM-5** | $1 | $0.2 | $3.2 |
| **GLM-5-Code** | $1.2 | $0.3 | $5 |

### 3-4. 競合比較

| サービス | 月額 | 特徴 |
|----------|------|------|
| **Z.ai Lite** | ~$9 | 120 prompts/5時間 |
| **Z.ai Pro** | ~$27 | 600 prompts/5時間 |
| **Z.ai Max** | ~$72 | 最大リミット |
| Claude Pro | $20 | 公式 |
| Claude Max | $200 | 公式 |

---

## 4. GLM-5の性能

### 4-1. 発表概要

| 項目 | 内容 |
|------|------|
| **発表日** | 2026年2月11日 |
| **開発元** | Zhipu AI（Z.ai） |
| **種別** | オープンソースLLM |
| **パラメータ** | 745B（7,450億） |
| **特徴** | 低ハルシネーション率、エージェント特化 |

### 4-2. ベンチマーク比較

| ベンチマーク | GLM-5 | Claude Opus 4.5/4.6 | 備考 |
|--------------|-------|---------------------|------|
| **SWE-bench Verified** | 77.8 | 80.9 | Opusが~3%上 |
| **Terminal-Bench** | ✅ 勝利 | - | GLM-5が上回る |
| **BrowseComp** | ✅ 勝利 | - | GLM-5が上回る |
| **Artificial Analysis Index** | 50 | より高い | 平均(25)の倍 |

### 4-3. 競合モデルとの比較（2026年2月同日発表）

| モデル | 特徴 | 価格帯 |
|--------|------|--------|
| **GLM-5** | オープンソース、低コスト | ~$72/月（Max） |
| **Claude Opus 4.6** | 使いやすさ重視、少し「怠惰」 | ~$200/月 |
| **GPT-5.3 Codex** | アクティブ、品質0.70 | ~$1単価 |

### 4-4. コミュニティ評価

- 「Pony Alpha」というコードネームでリークされ話題に
- フロントエンド開発でClaude Opus 4.6と同等の成果
- シングルショットプロンプトだけで高い成果
- 中国AI株がGLM-5発表で30%急騰

---

## 5. メリットまとめ

### 企業導入の利点

1. **コスト削減**: Claude Max ($200/月) → GLM Max (~$72/月) で約64%削減
2. **APIキー一元管理**: 1つのプランからAPIキーを発行し、チーム全体に配布可能
3. **予測可能な費用**: サブスクリプション型で予算管理が容易
4. **体験の継続性**: Claude CodeのUI/UXはそのまま
5. **最新モデル**: GLM-5はOpus級の性能

### 注意点

- 初回セットアップで環境変数の設定が必要
- 既存のClaude Code設定との整合性確認が必要
- 日本語での応答品質は要検証

---

## 6. 参考リンク

### 公式
- [Z.ai Subscription Page](https://z.ai/subscribe)
- [Z.ai Pricing Documentation](https://docs.z.ai/guides/overview/pricing)
- [GLM-5 公式発表](https://z.ai/blog)

### ニュース
- [Reuters: Zhipu releases GLM-5](https://www.reuters.com/technology/chinese-ai-startup-zhipu-releases-new-flagship-model-glm-5-2026-02-11/)
- [VentureBeat: GLM-5 low hallucination rate](https://venturebeat.com/technology/z-ais-open-source-glm-5-achieves-record-low-hallucination-rate-and-leverages)
- [Bloomberg: Zhipu unveils GLM-5](https://www.bloomberg.com/news/articles/2026-02-11/china-s-zhipu-unveils-new-ai-model-jolting-race-with-deepseek)
- [CNBC: Zhipu stock surges 30%](https://www.cnbc.com/2026/02/12/chinese-ai-stocks-new-model-and-agent-releases-zhipu-minimax.html)
- [Reuters: Zhipu hikes prices](https://www.reuters.com/technology/chinese-ai-startup-zhipu-hikes-prices-coding-plan-demand-rises-2026-02-12/)

### コミュニティ
- [Reddit: GLM-5 vs Opus 4.6 comparison](https://www.reddit.com/r/ClaudeAI/comments/1r2531t/zai_didnt_compare_glm5_to_opus_46_so_i_found_the/)
- [Reddit: New Z.ai prices](https://www.reddit.com/r/ZaiGLM/comments/1r23nym/new_zai_coding_plan_prices/)
- [Reddit: GLM-5 745B parameter leak](https://www.reddit.com/r/accelerate/comments/1r2hr1k/glm5_chinas_745b_parameter_opensource_model_that/)
- [X: Z.ai Official Announcement](https://x.com/Zai_org/status/2021656635668901985)
- [X: Nathan Lambert analysis](https://x.com/natolambert/status/2020885646555107619)

### 分析記事
- [Artificial Analysis: GLM-5](https://artificialanalysis.ai/models/glm-5)
- [LLM Stats: GLM-5](https://llm-stats.com/models/glm-5)
- [Interconnects AI: Opus 4.6 vs Codex 5.3](https://www.interconnects.ai/p/opus-46-vs-codex-53)

---

## 7. 記事用フック案

### タイトル案
1. 「Claude Codeを1/3の価格で使う方法：GLM-5で月72ドルを実現」
2. 「Claude Opus級の性能が72ドルで？GLM-5×Claude Codeの衝撃」
3. 「チーム全員にClaude Codeを配る最強のコスト削減術」

### 導入フック
- Claude Max $200/月 → GLM Max $72/月（64%削減）
- 「GLM-5はOpus 4.6と同等の性能」と専門家が評価
- 中国のAI株が30%急騰した「GLM-5」とは？

### 構成案
1. 問提起：Claude Code高い問題
2. 解決策：Z.ai APIキーで裏側切り替え
3. 証拠：GLM-5のベンチマーク
4. 手順：設定方法（コピペ可）
5. まとめ：コスト削減の具体数

---

**この資料の使い方**:
- 各セクションの情報を記事に転用
- リンクは必要に応じて本文または末尾に配置
- 数字・事実はこの資料が正（必要に応じて再確認）
