---
name: brainbase-graph-philosophy-context
description: brainbase Graphを読む・書く・参照して判断する時に、Graph SSOTとBrainbase Philosophy Contextを必ず前提にするためのSkill。固有名詞、推進案件、CRM、Graph API、MCP Graph tools、philosophy contextを扱う時に使用する。
---

# Brainbase Graph Philosophy Context

## 目的

Graph操作時に、entityの事実確認だけでなく `Brainbase Philosophy Context` を判断前提として必ず扱う。

`philosophy` はUIで見せる項目ではない。`CLAUDE.md` と同じく、agent / tool / Graph操作の前に読むべき思想・判断基準である。

## 原則

- Graph SSOTは固有名詞、組織、顧客、パートナー、プロジェクト、用語、意思決定、推進案件の一次情報である。
- Graph操作前には `Brainbase Philosophy Context` を読み、その `prompt_block` を判断前提として扱う。
- MCP Graph系ツールは `includePhilosophy: false` を明示しない限り、デフォルトで思想contextを先頭に付与する。
- 議事録、transcript、memory、推測は参考値であり、Graphと食い違えばGraphを優先する。
- 思想contextは「表示用の説明」ではなく、作成・更新・レビュー時の制約である。

## 使うタイミング

- 人物、組織、顧客、パートナー、プロジェクト、用語、意思決定を書く時
- Graph entity / edge を読む、作る、更新する時
- 推進案件、CRM、NocoDB projection、診断、Growth導線を扱う時
- MCP `brainbase` の `get_context` / `list_entities` / `get_entity` / `search` を使う時
- Graph APIを `curl` で直接叩く時

## MCPでの標準手順

Graph系MCPツールを優先する。

```typescript
mcp__brainbase__get_context({
  topic: "推進案件",
  project: "brainbase",
  scope: "crm",
  objectType: "push_case",
  operation: "read"
})
```

返答の先頭に出る `Brainbase Philosophy Context` を、以降の判断前提として扱う。

```text
Brainbase Philosophy Context
Scope: crm
...
---
...
```

この区切りより上は、単なる参考説明ではなく操作前提である。

## scopeの選び方

| scope | 使う場面 |
|---|---|
| `graph` | 固有名詞、関係、Graph SSOT全般 |
| `crm` | 推進案件、顧客獲得、営業、NocoDB CRM projection |
| `growth` | 佐藤ブランド、広告、LP、診断導線、商談化 |
| `automation` | agent実行、自律化、承認、ガードレール |
| `data` | 正本分担、Transcript、Communication、Projection |
| `development` | Story、Spec、Skill、Policy、hook、実装判断 |

## curlで直接確認する場合

MCPが使えない時だけ直接APIを使う。

```bash
TOKEN=$(jq -r .access_token ~/.brainbase/tokens.json)

curl -s -H "Authorization: Bearer $TOKEN" \
  -H "x-brainbase-role: gm" \
  -H "x-brainbase-projects: brainbase,unson" \
  -H "x-brainbase-clearance: internal,restricted,finance,hr,contract" \
  "https://bb.unson.jp/api/info/context?project=brainbase&types=project&includePhilosophy=true&scope=crm" \
  | jq -r '.philosophy_context.prompt_block'
```

## 禁止

- `includePhilosophy: false` を通常運用で使うこと
- NocoDBやUI projectionをGraph正本の代わりに扱うこと
- 会話ログや議事録の表記をGraph確認なしに正として使うこと
- `philosophy` を画面表示用フィールドとして扱い、Graph操作前contextとして使わないこと

## 判断テスト

- Graphを読む/書く前にPhilosophy Contextを見たか
- この情報はGraph正本か、Wiki/docsか、NocoDB運用ビューか、UI projectionか
- 推進案件中心の設計になっているか
- UIやNocoDBを正本化していないか
- memoryや議事録とGraphが食い違った時にGraphを優先しているか
