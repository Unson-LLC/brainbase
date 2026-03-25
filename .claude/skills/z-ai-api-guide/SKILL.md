---
name: z-ai-api-guide
description: z.ai（智谱AI / Zhipu AI）のAPI設定・エンドポイント・モデル名・課金体系・LiteLLMプロキシ構成の正本ガイド
user_invocable: false
---

# z.ai（智谱AI）API ガイド

## 基本情報

| 項目 | 内容 |
|------|------|
| 正式名称 | 智谱AI（Zhipu AI） |
| 国際ブランド | Z.AI |
| 中国ドメイン | open.bigmodel.cn |
| 国際ドメイン | z.ai |
| xAIとの関係 | **なし**（完全に別会社。xAIはElon Musk、z.aiは中国のAI企業） |

## APIエンドポイント

**重要**: エンドポイントが2種類あり、課金体系が異なる。

| エンドポイント | 用途 | 課金 |
|---------------|------|------|
| `https://api.z.ai/api/paas/v4` | 一般API | API残高（Cash/Credits）から消費 |
| `https://api.z.ai/api/coding/paas/v4` | **Coding Plan専用** | Coding Planクォータから消費 |
| `https://open.bigmodel.cn/api/paas/v4` | 中国向け一般API | API残高から消費 |

**Coding Planユーザーは必ず `/api/coding/paas/v4` を使うこと。** `/api/paas/v4` を使うとCoding Planクォータではなく一般API残高（別課金）から引かれるため「余额不足」エラーになる。

## 認証

```bash
curl -X POST "https://api.z.ai/api/coding/paas/v4/chat/completions" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5","messages":[{"role":"user","content":"hello"}]}'
```

## モデル一覧

### 有料モデル

| モデル名 | API名 | 入力/1M tokens | 出力/1M tokens | 備考 |
|----------|-------|---------------|---------------|------|
| GLM-5 | `glm-5` | $1.00 | $3.20 | フラッグシップ、744B(40B active)、200Kコンテキスト |
| GLM-5-Code | `glm-5-code` | $1.20 | $5.00 | コーディング特化 |
| GLM-4.5-X | `glm-4.5-x` | $2.20 | $8.90 | ハイエンド |

### 無料モデル

| モデル名 | API名 | 備考 |
|----------|-------|------|
| GLM-4.7-Flash | `glm-4.7-flash` | 高速・軽量、完全無料 |
| GLM-4.5-Flash | `glm-4.5-flash` | 高速・軽量、完全無料 |
| GLM-4.6V-Flash | `glm-4.6v-flash` | ビジョン対応、完全無料 |

## Coding Plan

| プラン | GLM-5アクセス | 価格 |
|--------|--------------|------|
| Free | なし | $0 |
| Pro | あり | $10/月〜 |
| Max | あり | 上位プラン |

**重要**: Coding PlanクォータとAPI課金は**完全に別**。Coding Planの「5 Hours Quota」はCoding Plan専用エンドポイント経由のみで消費される。一般APIエンドポイントを使うとAPI残高（別課金）が必要。

## GLM-5 Thinking（推論モード）制御

GLM-5はデフォルトで `thinking` が有効（reasoning tokensを出力する）。

### thinking無効化

```json
{
  "model": "glm-5",
  "messages": [...],
  "thinking": {
    "type": "disabled"
  }
}
```

- `thinking.type: "disabled"` → `reasoning_content` が返らなくなり、`content` に直接回答が入る
- `thinking.type: "enabled"`（デフォルト）→ `reasoning_content` に思考過程、`content` に回答

### Codex CLI連携時の注意

**Codex CLI (codex-rs) は `reasoning` タイプのストリーミングデルタを正しく処理できない。**
GLM-5のthinkingが有効だと `OutputTextDelta without active item` ERRORが大量にstderrに出る。
LiteLLMの `extra_body` で `thinking: {"type": "disabled"}` を設定して回避する。

## 対応APIフォーマット

- **Chat Completions API**: 対応（`/chat/completions`）
- **Responses API**: **非対応**（OpenAI独自のフォーマット）

## LiteLLMプロキシ構成（Codex CLI連携用）

Codex CLIはResponses APIのみ対応、z.aiはChat Completions APIのみ対応。LiteLLMの`deepseek/`プレフィックスを使うとResponses→Chat Completionsの自動ブリッジが有効になる。

**`openai/`プレフィックスではブリッジされない（Responses APIをそのまま転送して404になる）。**

### 動作するconfig.yaml（推奨）

```yaml
model_list:
  - model_name: glm-5
    litellm_params:
      model: deepseek/glm-5
      api_base: https://api.z.ai/api/coding/paas/v4
      api_key: os.environ/Z_AI_API_KEY
      extra_body:
        thinking:
          type: disabled

general_settings:
  drop_params: true
```

**`extra_body.thinking.type: disabled` が重要。** `litellm_params` 直下に `thinking` を書いてもLiteLLMのDeepSeekトランスフォーマーがドロップする。`extra_body` 経由でz.ai APIにパススルーさせる。

### NGパターン（動かない設定）

| プレフィックス | 結果 | 理由 |
|---------------|------|------|
| `openai/glm-5` | 404 | Responses APIをそのまま転送 |
| `hosted_vllm/glm-5` | 404 | 同上 |
| プレフィックスなし | 400 | プロバイダー不明 |
| `deepseek/glm-5` | **成功** | Chat Completionsへ自動ブリッジ |

| thinking設定場所 | 結果 | 理由 |
|-----------------|------|------|
| `litellm_params.thinking` | **無効** | DeepSeekトランスフォーマーがドロップ |
| リクエストbody直接 | **無効** | 同上 |
| `litellm_params.extra_body.thinking` | **有効** | z.ai APIにパススルー |

### Codex CLI config.toml（コンテナ内 `/paperclip/.codex/config.toml`）

```toml
model = "glm-5"
model_provider = "zai"
web_search = "disabled"

[model_providers.zai]
name = "Z.AI via LiteLLM"
base_url = "http://litellm:4000/v1"
env_key = "OPENAI_API_KEY"

[history]
persistence = "none"
```

## トラブルシューティング

| エラー | 原因 | 対策 |
|--------|------|------|
| `Insufficient balance or no resource package` | 一般APIエンドポイント使用 or API残高ゼロ | `/api/coding/paas/v4`に変更 |
| `404 /v4/responses` | LiteLLMがResponses APIを転送 | `deepseek/`プレフィックス使用 |
| `OutputTextDelta without active item` | GLM-5のthinkingがCodex CLIで処理不能 | `extra_body.thinking.type: disabled` |
| `模型不存在` | モデル名が間違い or 未対応エンドポイント | モデル名とエンドポイントの組み合わせ確認 |
| `external_web_access` エラー | Codex CLIがweb_searchツールを送信 | `web_search = "disabled"` 設定 |
| `Model metadata not found` | Codex CLIにGLM-5のメタデータなし | 機能的には問題なし（警告のみ） |

## Paperclipエージェント設定

| 設定項目 | 値 |
|----------|------|
| adapter | `codex_local` |
| model | `glm-5`（adapter_config.modelで指定） |
| extraArgs | `["--skip-git-repo-check"]` |
| cwd | `/workspace/projects/{project}` |
| dangerouslyBypassApprovalsAndSandbox | `true`（API接続に必要） |
| 環境変数 | `OPENAI_API_KEY=sk-litellm`, `OPENAI_BASE_URL=http://litellm:4000/v1` |
