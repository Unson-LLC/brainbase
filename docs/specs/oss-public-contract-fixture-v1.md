# Spec: OSS公開契約fixture v1

Story ID: `story-oss-public-contract-fixture-v1`
親Story: [OSSの公開契約をfixtureで固定する](../stories/story-oss-public-contract-fixture-v1.md)

状態: Develop（fixture・テスト実装済み。2026-11-01 Director 決定を反映。release 未確認）

基準: origin/develop e5f0db5e（#930 merge 後）。旧Draft #476（`codex/oss-public-contract-fixtures`）は MCP tool 15件・CLI 23件・bin 2つを前提にしていたが、現行の公開面はそれより広い。下の事実はすべて基準commitのソースから確かめた。

## 確かめた現行の公開面

- MCP（`src/server.ts`）: `toolDefinitions` は18件。`createServer()` の tools/list は非公開関数 `configuredToolDefinitions` を通り、次のように変わる。
  - 既定（`BRAINBASE_PERSONAL_KNOWLEDGE_MODE` / `BRAINBASE_PERSONAL_KG_STORAGE_MODE` が未設定か `local`）: 18件。
  - `managed_cloud`: `personal_knowledge_context` / `personal_knowledge_register` / `personal_knowledge_search` の3件だけ。foundation 接続は無視される。
  - local で `createServer({ foundation })`: 18件に `foundationPublicToolDefinitions`（`src/foundation-public-provider.ts`）の4件を足した22件。
- queue（`src/queue-task-tools.ts`、#930）: `createQueueTaskTools({ backend, resolveAgent })` に backend を渡したときだけ7件を返す。`createServer()` には登録されない。subpath `@unson/brainbase-mcp/queue-task-tools` を定義済みだが未release。名前は `QUEUE_TASK_TOOL_NAMES`、定義は `queueTaskToolDefinitions`。
- host 用の組み立て部品（`src/foundation-authenticated-tools.ts`）: `foundationPublicTools`（上の4件に必須の `scope_id` を足した版）と `foundationAdoptionTools`（`foundation_adopt`、「gm以上」という組織の役割を前提にする）。OSSの `createServer()` は登録しない。
- CLI（`src/cli.ts` の `runCli`）: `switch (parsed.command)` の case は29個。うち `review:serve` は `web:serve` と同じ処理に落ちる別名（コメントで明記）なので、正規の command は28個。`--help` は switch より前で usage を返し、usage は29個すべてを `brainbase <command>` の形で載せている。未知の command は usage を出して1を返す。
- package（`package.json`）: name `@unson/brainbase-mcp`、main `dist/index.js`、types `dist/index.d.ts`、bin `brainbase-mcp` → `dist/index.js`、`brainbase` → `dist/cli.js`。2つの入口の src（`src/index.ts` / `src/cli.ts`）は `#!/usr/bin/env node` で始まる。`files` には既に `contracts` が入り、`exports` には `./package.json` があり、`contracts/judgment-dag/*.json` などは個別に export されている。version は 0.49.0。
- tarball の検査: `tests/repo-hygiene.test.ts` の INV-4 と `tests/e2e/brainbase-mcp-only-acceptance.spec.ts` は、どちらも tarball の中身が `contracts/` で始まるものを含む許可リストに収まることを確かめている。`files` の完全一致を見ているのは INV-4 だけである。tarball の一覧は `scripts/npm-release.mjs` の `packFilesInIsolation`（build 中の dist と競合しないよう生成物を除いて staging から `npm pack --dry-run --ignore-scripts --json` する）で取る。
- 件数を直書きした既存のassert: `tests/mcp-contract.test.ts` の「C-6 lists exactly the v1 tools」（18件を順番つきで）と `tests/queue-task-tools.test.ts` の AC-1（`toHaveLength(18)`）。
- CHANGELOG ファイルはリポジトリにない。

## 決定

- 日時: 2026-11-01
- 決定者: claude-code（OCO scope）。根拠は Director 指示 2026-11-01 18:42 JST（brainbase#505: #476 だけを作り直す）。追加判断は末尾の「Director 決定事項」に記録する。

### D-1 ファイル名と形

`contracts/brainbase-public-contract.v1.json` を使う。旧Draft と同じ名前にして #505 / #476 から辿れるようにする。`contracts/` 直下に単一ファイルを置く前例（`contracts/public-message-candidate.schema.json`）があり、`files` に `contracts` が既に入っているので、`package.json` も tarball 許可リストも変えなくてよい。

中身の形（schema）は旧Draft から変える。旧Draft は未mergeなので互換を保つ相手はいない。

- 退けた案: `contracts/public-contract/fixture.json` + `schema.json`（judgment-dag と同じ置き方）。JSON Schema を別ファイルで持つと、照合するものが1つ増えるだけで、テストの strict な形チェック（AC-6）と役割が重なる。
- 退けた案: 旧Draft の平らな `mcpTools` 配列。条件で変わる tool 群を表せない。

### D-2 fixture を package exports で公開する

2026-11-01 Director 決定: `./contracts/brainbase-public-contract.v1.json` を同名ファイルへ export する。組織版 consumer は package 内の配置探索に依存せず subpath を解決できる。

### D-3 MCP tool は「出る条件ごとの群」で記録する

既定の18件だけを記録すると、managed_cloud で3件に絞られることも、foundation 接続時の4件も、#930 の queue 7件も、意図せず消えたり増えたりしたときに検出できない。どれも利用者のエージェントから呼ばれる名前なので、4つの群として記録する。

| 群 id | 出る条件 | 記録のしかた | 実装からの取り方 |
| --- | --- | --- | --- |
| `local` | 既定。`createServer()`、mode は local | tool名と必須入力の全件 | env を local に固定し、`createServer()` と `InMemoryTransport` で tools/list |
| `managed_cloud` | `BRAINBASE_PERSONAL_KNOWLEDGE_MODE=managed_cloud` | `local` から選ぶ tool名だけ（`selectsFrom: "local"`） | env を managed_cloud に固定して tools/list。結果は `local` の該当entryと名前・必須入力まで一致すること |
| `foundation_connected` | local で `createServer({ foundation })` | `local` に足される分だけ（`extends: "local"`） | foundation を渡して tools/list。結果 = `local` ∪ この群、重なりなし |
| `queue_task_tools` | `createQueueTaskTools({ backend, resolveAgent })` に backend を渡したとき（subpath `@unson/brainbase-mcp/queue-task-tools`） | tool名と必須入力の全件 | `src/testing/queue-task-tools-contract.ts` の reference backend で `createQueueTaskTools` を呼び、返った `definition` |

- tools/list を通すのは、`configuredToolDefinitions` の絞り込みまで含めて、クライアントに実際に見える面を src を変えずに照合するためである。`toolDefinitions` を直接読むだけでは managed_cloud の絞り込みを確かめられない。
- tools/list は provider を呼ばないので、`foundation_connected` は `{ provider, resolveContext: () => null }` の型を合わせた stub で足りる（作る前に `createServer` を読んで、今もそうであることを確かめる）。
- env は群ごとに `vi.stubEnv` で `BRAINBASE_PERSONAL_KNOWLEDGE_MODE` と `BRAINBASE_PERSONAL_KG_STORAGE_MODE` の両方を固定し、終わったら戻す。開発者の環境変数で結果が変わらないようにする。
- `foundationPublicTools`（`scope_id` 付き）と `foundation_adopt` は `mcp.internalTools` に名前と必須入力を記録する。公開群の対象外で、OSS server は登録しない。同名の公開foundation版とは必須入力で区別する。
- 退けた案: 既定の18件だけ（旧Draft と同じ）。上のとおり、条件つきの面の変化を取りこぼす。
- 退けた案: 群ごとに見えている全件を重ねて記録する。local に1件足すだけで3群の差分になり、レビューで読みにくい。差分（`extends`）と選択（`selectsFrom`）で書けば、1つの変更は1か所にしか出ない。

必須入力の比べ方: `inputSchema.required` のトップレベルだけを、重複なしで文字列のコード単位順（JavaScript の既定の `sort()`）に並べて比べる。`required` が無ければ `[]`。入れ子の required（例: `resolve_entity` の `mentionSpans[].start`）、`oneOf` の中身、property 名・型・説明文、annotations は記録しない。tool 名の並びも契約にしない（fixture 側は名前順に並べ、照合は名前をキーにした集合で行う）。

### D-4 CLI command は source の switch を読み、`--help` の出力で裏を取る

1. `src/cli.ts` から `switch (parsed.command) {` を探す（ちょうど1回あること）。そこから同じ switch の `default:` までの間の `case '<name>':` を集め、間に文を挟まず続く case を1つの fall-through 群にまとめる。
2. 集めた名前の集合 = fixture の `commands` ∪ `aliases` のキー。重複があれば失敗。
3. `aliases` の各キーは、値（正規 command）と同じ fall-through 群にあること。逆に、2つ以上の名前を持つ群はすべて `aliases` で説明されていること。
4. `runCli(['--help'], io)` が0を返し、出力に `brainbase <name>` が fixture の全 command と別名について現れること。
5. `runCli(['__brainbase_contract_unknown__'], io)` が1を返すこと（未知 command が既定の分岐に落ちることの確認）。

src は変えない。switch の形が変わったら 1 が見つからずにテストが大きな声で失敗するので、そのときは集め方を同じPRで直す。

- 退けた案: 各 command を実際に `runCli` で呼んで既知/未知を見分ける。`mcp` は stdio server を起動し、`web:serve` はポートを開き、`graph:upgrade` は組織の Graph へ接続しようとする。副作用なしに既知を判別できない。
- 退けた案: command 一覧を `src/cli.ts` から export して switch をそれで回す。dispatch の書き換えは「振る舞いを変えない」に反する危険があり、src の差分が増える。
- 退けた案: 旧Draft のように `src/cli.ts` 全体を `case '...'` の正規表現で読む。switch の外の case（将来の別の switch）まで拾い、別名の関係も表せない。
- `review:serve` は `aliases: { "review:serve": "web:serve" }` として記録する。commands に並べると「独立した command」と読めてしまい、`web:serve` と別の振る舞いに変わっても検出できない。

### D-5 bin は manifest 一致に加えて build 後の実体と shebang まで見る

fixture の `package` と `package.json` の name / main / types / bin が完全一致すること（bin は2つで、キーと値の両方）。加えて、main・types・各 bin の指すファイルが build 後に存在し、bin の指す2つのファイルが `#!/usr/bin/env node` で始まること。

CI（`.github/workflows/test.yml`）は `npm run build` の後に `npm test` を走らせ、既存の `tests/mcp-contract.test.ts` も `dist/index.js` を起動しているので、dist に依存する前例がある。ファイルが無いときは「build してから実行する」ことを含む失敗メッセージにする。

- 退けた案: manifest の一致だけ（旧Draft）。bin の先のファイル名が変わったり shebang が落ちたりしても通ってしまい、`npx brainbase` が壊れるのを検出できない。
- 退けた案: bin を実際に起動する。`brainbase-mcp` は stdio server を起動し続ける。
- 退けた案: src の shebang だけを見る。src → dist の対応を仮定することになり、配布物そのものは見ていない。

### D-6 tarball は既存の `packFilesInIsolation` で確かめ、許可リストのテストは変えない

AC-4 のテストは `scripts/npm-release.mjs` の `packFilesInIsolation(repoRoot)` が返す一覧に `contracts/brainbase-public-contract.v1.json` が含まれることだけを見る。`files` の完全一致（INV-4）と許可リスト（INV-4 と mcp-only acceptance ac:11）は既存テストの担当のままにする。どちらも既に `contracts` / `contracts/` を許しているので変えない。

- 退けた案: 旧Draft のように直接 `npm pack --dry-run --json` を呼ぶ。prepack などの script が走り、並行する build と競合しうる。既存の隔離手順があるので、それに揃える。
- 退けた案: 許可リストに fixture のパスを個別に足す（旧Draft）。今の許可リストは `contracts/` 前方一致で、足す必要がない。

### D-7 件数はテストに直書きしない

新しいテストは件数を書かない。fixture の entry が契約そのもので、tool や command を足すときは fixture の差分がレビューに乗ること自体が目的である。件数を書くと、追加のたびに fixture とテストの2か所を直すことになり、差分の意味がぼやける。代わりに、各群・commands が空でないこと（AC-6）と、実装との集合一致（AC-1 / AC-2）で、「両方が空で一致」という素通りを防ぐ。

既存の mcp-contract C-6 と queue AC-1 の固定一覧・件数assertを fixture の local 群との集合比較へ置き換える。他の入力schema検証とqueue非漏出の検証は維持する。

### D-8 振る舞い・version・lockfile は変えない

Director 決定の反映では fixture・テスト・package exports・文書を変更する。`src/` の挙動、package version、`package-lock.json`、`tsconfig.json` は変えない。fixture は package version を持たない（release のたびに変わり、公開面の変化ではないため）。fixture の形の version は `schemaVersion: "1.0.0"` とファイル名の `v1` で表す。

## fixture の形

```json
{
  "schemaVersion": "1.0.0",
  "package": {
    "name": "@unson/brainbase-mcp",
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "bin": { "brainbase": "dist/cli.js", "brainbase-mcp": "dist/index.js" }
  },
  "mcp": {
    "internalTools": [{ "name": "foundation_adopt", "requiredInput": ["digest", "id", "revision", "scope_id", "type"] }],
    "toolGroups": [
      { "id": "local", "condition": "...", "tools": [{ "name": "get_context", "requiredInput": [] }] },
      { "id": "managed_cloud", "condition": "...", "selectsFrom": "local", "toolNames": ["personal_knowledge_context"] },
      { "id": "foundation_connected", "condition": "...", "extends": "local", "tools": [{ "name": "foundation_read", "requiredInput": ["id", "revision", "type"] }] },
      { "id": "queue_task_tools", "condition": "...", "releaseStatus": "unreleased", "tools": [{ "name": "claim_next", "requiredInput": [] }] }
    ]
  },
  "cli": {
    "bin": "brainbase",
    "commands": ["doctor"],
    "aliases": { "review:serve": "web:serve" }
  }
}
```

（`...` と各配列は省略。全件は下の「基準commitでの初期値」）

- トップレベルのキーは `schemaVersion` / `package` / `mcp` / `cli` だけ。各 object も上に書いたキーだけを持つ。
- `internalTools` は公開対象外のvariantを名前と必須入力で記録する。空・重複・未知キーは拒否する。queue 群は必須の `releaseStatus: "unreleased"` を持つ。
- `toolGroups` の id は上の4つちょうど。テストは id ごとに取り方を知っており、知らない id があれば失敗する。
- `condition` は人が読むための1行の説明で、テストは空でない文字列であることだけを見る。
- `tools` は `name` 順、`requiredInput` と `toolNames` と `commands` はコード単位順、重複なし。`bin` と `aliases` のキーも同じ順に並べる（JSON の比較は順に依存しないが、差分を読みやすくするため）。
- `cli.bin` は command を受ける bin の名前で、`package.bin` のキーの1つであること。

### 基準commit（e5f0db5e）での初期値

実装PRでは下を写すのではなく、上の取り方で実装から観測した結果と突き合わせて作る。食い違えば観測を正とし、PR本文に差を書く。

- `local`（18）: `audit_ontology` []、`brainbase_onboarding_first_value` [action, runId]、`brainbase_onboarding_get` [runId]、`brainbase_onboarding_ingest` [candidates, runId, source]、`brainbase_onboarding_review` [actions, runId]、`brainbase_onboarding_start` [sources, valueTarget]、`get_context` []、`get_ontology` []、`infer_decisions` []、`list_entities` []、`onboarding_status` []、`ontology_impact` []、`personal_knowledge_context` []、`personal_knowledge_register` [event]、`personal_knowledge_search` [query]、`resolve_entity` [asOf, text]、`search` [query]、`search_personal_kg` [query]
- `managed_cloud`（3）: `personal_knowledge_context`、`personal_knowledge_register`、`personal_knowledge_search`
- `foundation_connected`（+4）: `foundation_describe` []、`foundation_read` [id, revision, type]、`foundation_validate_problem` [snapshot]、`foundation_validate_reference` [reference]
- `queue_task_tools`（7）: `attach_evidence` [expected_version, kind, ref, task_id]、`claim_next` []、`claim_task` [task_id]、`get_task` [task_id]、`list_my_tasks` []、`renew_claim` [task_id]、`update_status` [expected_version, task_id, to_status]
- `cli.commands`（28）: `doctor`、`graph:bundles`、`graph:upgrade`、`judgment:hook`、`judgment:install`、`mcp`、`memory:list`、`memory:register`、`onboard:agent`、`onboard:apply`、`onboard:candidates`、`onboard:demo`、`onboard:diagnose-sources`、`onboard:extract`、`onboard:import`、`onboard:init`、`onboard:install`、`onboard:plan`、`onboard:projects`、`onboard:recommend`、`onboard:routines`、`onboard:seed`、`onboard:skills`、`onboard:start`、`ontology:audit`、`ontology:migrate`、`ontology:show`、`web:serve`
- `cli.aliases`: `review:serve` → `web:serve`

件数は読み手の目安としてここに書くだけで、テストには書かない（D-7）。

## 記録する面と記録しない面

| 記録する | 記録しない |
| --- | --- |
| package の name / main / types / bin | version、description、dependencies、`exports` の一覧、`files` |
| MCP の4群の tool名とトップレベルの必須入力 | property 名・型・説明文、入れ子の required、`oneOf`、annotations、result payload、エラーの形 |
| CLI の command名と別名 | option・flag、出力の形、exit code の意味（未知 command の1は照合に使うが記録しない） |
| | host が組み立てる `foundationPublicTools`（`scope_id` 付き）と `foundation_adopt` |
| | `exports` の subpath（queue など）の型や関数名 |

## 照合のしかたと失敗の意味

テストファイルは `tests/public-contract-fixture.test.ts` の1つ。fixture を実装から生成しない。生成すると fixture の差分がいつも「再生成した」だけになり、レビューが素通りになる。fixture を書き換える script（snapshot 更新）も作らない。代わりに、失敗メッセージには実装から観測した値と fixture の値の差（足りない名前・余分な名前・必須入力の違い）を出し、人が fixture を直せるようにする。

テストが失敗したら、それは「公開面と fixture が食い違っている」ことだけを意味する。直し方は2つで、どちらも同じPRで行う。

- 意図しない変更なら、実装を戻す。
- 意図した変更なら、fixture を直し、PR本文に公開面の変更として書く。削除・名前変更・必須入力の追加・bin の変更は既存の利用者を壊す変更であり、そう明記する（version の扱いは下）。

fixture そのものが壊れている（JSON として読めない、未知のキー、並び崩れ、重複、空の群）ときも失敗させる。黙って読み飛ばさない。

## 受け入れ条件と追加するテスト

すべて `tests/public-contract-fixture.test.ts` の top-level `describe('OSS public contract fixture')` の中の `it` で、名前は下と完全一致させる。

| AC | 検証する条件 | 正確なテスト名 |
| --- | --- | --- |
| AC-1 | 4群それぞれで、観測した tool名と必須入力が fixture と集合として一致する。`managed_cloud` は `local` の該当entryと一致、`foundation_connected` は `local` と重ならず、両者の和が観測と一致。観測側に重複名があれば失敗 | `AC-1 matches every MCP tool group and its required input` |
| AC-2 | switch の case の集合 = commands ∪ 別名。別名は正規 command と同じ fall-through 群。複数名の群はすべて別名として記録済み。`--help` の出力が全名を含む。未知 command は1を返す | `AC-2 matches every routed CLI command and alias` |
| AC-3 | `package` が manifest の name / main / types / bin と完全一致。main・types・bin の指すファイルが build 後に存在し、bin の2つが `#!/usr/bin/env node` で始まる。`cli.bin` が `package.bin` のキー | `AC-3 matches the package manifest and built entry points` |
| AC-4 | `packFilesInIsolation` の一覧に `contracts/brainbase-public-contract.v1.json` が含まれる | `AC-4 ships the fixture in the npm tarball` |
| AC-5 | fixture の文字列に `://`、`bb.unson.jp`、`lightsail`、`infisical`（大文字小文字を問わず）、`/Users/`、`/home/`、`~/`、Windows のドライブパス、メールアドレスの形が無い。`package` のパスはすべて `dist/` で始まる相対パス | `AC-5 contains only public OSS surface` |
| AC-6 | `schemaVersion` が `1.0.0`。各 object は決められたキーだけを持つ。群 id は4つちょうど。各配列は並び済み・重複なし・空でない。`selectsFrom` / `extends` は `local` を指す | `AC-6 rejects a malformed fixture` |

| AC-7 | package exports と実際のsubpath解決でfixtureを読める | `AC-7 exposes the fixture through package exports` |
| AC-8 | internal定義が実装と一致し、公開群・OSS tools/listにinternal variantがない | `AC-8 keeps internal foundation tools out of the public contract` |
| AC-9 | 既存C-6とqueue AC-1がfixtureを参照し固定件数を持たない | `AC-9 existing contract tests use the fixture as the single source of truth` |
| AC-10 | queue群のreleaseStatusが必須でunreleased | `AC-10 marks queue task tools as unreleased` |

AC-1 と AC-2 は、fixture の1件を消した場合と1件足した場合に失敗することを、実装時にローカルで一度確かめ、PR本文に書く（そのための壊れた fixture をリポジトリには置かない）。

## PR の分け方

1. 本PR（docs）: Story、Spec、`.vibepro/pr/story-oss-public-contract-fixture-v1/`。コードは書かない。
2. 実装PR（1本）: fixture と検証テストを追加する。Director 決定の反映で package exports、既存契約テスト、リリース方針も更新する。`npm run build` の後に `npx vitest run tests/public-contract-fixture.test.ts`、`tests/repo-hygiene.test.ts`、`npm run docs:check` を通す。e2e の mcp-only acceptance は変えないが、走らせて結果を PR に書く。

群ごとや AC ごとに PR を分けない。fixture は1つのファイルで、途中の状態（例: MCP だけ記録）を出すと、そのあいだ記録していない面の変更が素通りになるため。

## version の扱い

- 本PRも実装PRも、`package.json` の version と `package-lock.json` を変えない。
- fixture が tarball に入るのは追加なので、0.x の次の release では patch として release note に書く。実際の version は release 時に決める。CHANGELOG ファイルは無いので、実装PRの本文と release PR に書く。
- fixture の差分のうち、tool / command / bin の削除・名前変更、必須入力の追加は既存の利用者を壊す変更である。0.x の間は minor bump で出し、追加変更は patch とする（npm release Spec の方針に従う）。
- fixture の形を互換なく変えるときは `contracts/brainbase-public-contract.v2.json` を新しく作り、`schemaVersion` を `2.0.0` にする。v1 を同じ名前のまま書き換えない。

## Director 決定事項

決定日: 2026-11-01。決定者: Director。

1. fixture の package exports entry を追加する（D-2、AC-7）。
2. scope_id付き foundationPublicTools と foundation_adopt は internal として明記し、公開契約の対象外とする（AC-8）。
3. mcp-contract C-6 と queue AC-1 の固定一覧・件数assertは fixture 比較へ置き換える（AC-9）。
4. 0.x の公開面の破壊的変更は minor、追加変更は patch。リリース方針は [npm release Spec](story-brainbase-oss-npm-release.md) に記録する。
5. queue 7件は契約に残し、群に releaseStatus: unreleased を必須で記録する（AC-10）。
6. MCP result payload とエラーの形の固定は別Storyへ延期する。本変更では実装しない。
