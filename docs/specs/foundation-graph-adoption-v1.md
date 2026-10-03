# Spec: foundationの草案の採用 v1

Graphのfoundationの書き込み（`@unson/brainbase-mcp/foundation-graph-write`）は、すべての書き込みを草案（`adoptionState: 'draft'`・`storage: 'candidate'`・`authorizedUses: ['draft']`）にそろえる。そのため、判断や評価に使える定義を作る経路が無かった。`validateFoundationGraphAdoption(input)` と `normalizeFoundationGraphAdoption(input)` は、草案を判断と評価に使える版にする「採用」の書き込みを検査する（brainbase-project ADR-015）。I/Oは行わず、ホストが同じ取引の中で読んだ今の行を渡す。

| 入力 | 内容 |
|---|---|
| `context` | 認証済みの採用者（`principal`）と、選んだプロジェクト（`projectCode`） |
| `row` | 今のGraphの行（`payload.foundation` が今の定義） |
| `expected` | 採用者が確かめた版（`revision`）とdigest（`sha256:…`、`digestFoundationDefinition`） |
| `adoption` | 採用者の組織の権限の証跡（`authorityRef`、ホストが照合済み）と時刻（`adoptedAt`） |

| 条件 | 外れたときのcode |
|---|---|
| 確かめた版とdigestが、今の版と同じ | `ADOPTION_TARGET_CHANGED` |
| 今の版が草案である | `ALREADY_ADOPTED` |
| 採用者が草案の持ち主（`acl.ownerId`）でない | `ADOPTER_IS_OWNER` |
| 草案の範囲が選んだプロジェクトの中 | `SCOPE_VIOLATION` |
| 採用後の定義が判断と評価の検査を通る | `DEFINITION_NOT_READY` |
| 権限の証跡がある | `AUTHORITY_REQUIRED` |

結果は次の版（`revision + 1`）である。中身は今の版と同じで、変わるのは次だけ。
- `adoptionState: 'approved'`、`storage: 'ontology'`
- `authorizedUses: ['draft', 'judgment', 'evaluation']`（実行は含めない）
- `provenance` の末尾に `{ sourceId: 'foundation-adoption:<id>@<採用した版>', sourceKind: 'decision', evidenceIds: [authorityRef] }`

Graphの行の `payload.adoption` には、採用者・権限の証跡・採用した版とdigest・時刻を入れる。採用後に草案として書き直すと、次の版は再び草案になる。

## MCPの tool：`foundation_adopt`

`@unson/brainbase-mcp/foundation-authenticated-tools` の `foundationAdoptionTools` と `handleFoundationAdoptionToolCall` は、正本APIの採用の経路（`POST /api/company-os/foundation-adoptions`）を呼ぶ tool を提供する。

- 入力は `{ scope_id, type, id, revision, digest }` だけである。`revision` と `digest` は、採用者が `foundation_read` で確かめた値を渡す。
- 送る前に、本人がそのプロジェクトを使えるかを確かめる。CSRF のトークンを取り、`x-brainbase-scope` にプロジェクトを付けて送る。
- 経路の拒否（持ち主・付与不足・版の変化・準備不足）は、その code のまま返す。応答の版が `revision + 1` でなければ、成功として扱わない。
