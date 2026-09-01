<!-- brainbase:public-message:start -->
# Brainbase

## 一般論ではなく、あなたの判断基準から始まるAI。

Brainbaseは、仕事の前提、優先順位、過去の判断とその理由をローカルの正本に置き、CodexやClaude Codeが新しいセッションでも同じ文脈から考え始められるようにするOSSです。

> **AIに、自分の仕事を毎回説明し直さない。**

人間は、仕事の目的、判断基準、任せてよい範囲を決める。  
AIは、それらを参照して選択肢を比較し、見落としを指摘し、許可された範囲を進める。
<!-- brainbase:public-message:end -->

## なぜ必要か

会社では、資料や議事録が残っていても、次のものは人の頭の中に残りがちです。

- なぜこの顧客を優先したのか
- なぜ売上になる提案を断ったのか
- 何を守るために、その方針を選んだのか
- どこまでAIや別の担当者へ任せてよいのか
- 実行後の結果を見て、何を変えるべきなのか

この状態では、AIに毎回同じ説明が必要になり、担当者が変わると判断品質が落ち、重要な判断が経営者へ戻り続けます。

Brainbaseは「何を決めたか」だけでなく、**誰のために、何を優先し、何を守り、どの根拠から決めたか**を残します。

## 具体例

会社の方針が「単発受託を増やさず、再利用できる資産になる案件を選ぶ」だったとします。

一般的なAIは、売上や利益率だけを見て受注を勧めるかもしれません。Brainbaseを参照するAIは、経営者の稼働、再利用性、既存方針、顧客との関係まで確認し、次のように判断できます。

> 短期売上は得られますが、経営者の個別稼働が増え、再利用可能な資産も残らないため、現行方針には合いません。導入手順を標準化し、他の担当者でも実施できる条件なら受注候補になります。

Brainbaseの価値は、情報を多く保存することではありません。**その人や会社なら、なぜそう判断するのかを次の人とAIへ渡すこと**です。

## 現在のOSS版

このリポジトリは、Brainbaseの共通Judgment DAG基盤と、最初の入口であるローカル優先のPersonal Onboarding Kitを提供します。

現在利用できる主な範囲は次のとおりです。

- ローカルSSOTへ、自分、プロジェクト、関係者、判断基準、決定事項を保存する
- MCP経由でCodex、Claude Code、CodeCodeから文脈を参照する
- Graph v2とOntology 2.0.0で、人物・組織・プロジェクト・判断を正規IDで接続する
- `resolve_entity`、`get_context`、`search`で、依頼を正しい文脈へ接続する
- Judgment DAGを型検証し、ローカルの決定論的runnerで実行する

組織向けのRBAC、承認、監査、マルチユーザー、managed connector、hosted runtimeは、共通の脳モデルを変えずに組織版で追加する領域です。

実装済み・develop・計画中の境界は、[現在の状態](https://brainbase.pages.dev/guide/status)を参照してください。

## 10分で試す

```bash
git clone https://github.com/Unson-LLC/brainbase.git
cd brainbase
npm install
npm run build
npm run onboard:start -- --target codex
```

公開CLIをインストール済みの場合は次を使います。

```bash
brainbase onboard:start --target codex
# 表示された onboard:seed を確認して実行
brainbase onboard:install --target codex --dry-run
# 設定を承認して反映し、Codexを再起動
# 新しいセッションで resolve_entity / get_context / search を使う
```

`onboard:demo`はローカルCLIのプレビューであり、初回価値の証明ではありません。実際のエージェントがBrainbaseを使った回答を返し、本人が役立つと判断して初めて完了です。

詳しい手順は[10分で試す](https://brainbase.pages.dev/guide/quick-start)にまとめています。

## エージェントと始める

Codex または Claude Code に、繰り返し説明したくない文脈を聞き取らせる場合は、最初に次を実行します。

```bash
brainbase onboard:agent
brainbase onboard:demo --scenario "<Brainbaseを使って答えてほしい実際の依頼>"
```

最初の価値確認後に、必要なソースだけを段階的に追加します。エージェントは **diagnose the local source setup** を行い、候補をcanonical SSOTへ直接書き込みません。**Review candidates with the user, then promote only approved facts** を原則にします。

```bash
brainbase onboard:diagnose-sources --email gmail --calendar google-calendar --drive google-drive --drive-folder "<folder-id>" --tasks notion
brainbase onboard:candidates
```

**Register active projects** with `brainbase onboard:projects`; dry-runを確認してから、承認済みのプロジェクト文脈だけを`--write`で昇格します。

### Google Workspace local-first adopter

常時稼働のMac mini、Google Workspace、補助Gmail、許可したDrive/local folder、Calendar/notesに散在するタスクを対象にする例です。全Driveやhome directory全体は走査しません。

```bash
brainbase onboard:plan --profile google-workspace-local --host mac-mini --email google-workspace --secondary-email gmail --calendar google-calendar --drive google-drive --drive-folder "<folder-id>" --local-folder "/Users/owner/Notes" --tasks scattered-calendar-notes --inactive-task-tool notion
```

## 30 Minute Setup

手動セットアップ、source allowlist、candidate reviewの詳細は[公開マニュアル](https://brainbase.pages.dev/guide/quick-start)を参照してください。

## Judgment DAG

Brainbaseの内部では、判断を次の流れとして扱います。

```text
Observation
  -> Interpretation
  -> Judgment
  -> Commitment
  -> Action
  -> Outcome
  -> Learning
  -> Judgment update
```

公開packageから、Judgment DAGの型、事前検証、ローカルrunnerを利用できます。

```ts
import { readFileSync } from 'node:fs';
import {
  executeJudgmentDAG,
  validateJudgmentDAG
} from '@unson/brainbase-mcp/judgment-dag';

const fixtureUrl = import.meta.resolve(
  '@unson/brainbase-mcp/contracts/judgment-dag/fixture.json'
);
const dag = JSON.parse(readFileSync(new URL(fixtureUrl), 'utf8'));
const checked = validateJudgmentDAG(dag);

const record = await executeJudgmentDAG({
  run_id: 'example-run',
  dag,
  input: { source: 'fixture' },
  runners: {
    deterministic: {
      version: 'example-runner-1.0.0',
      run: ({ node, dependency_outputs }) => ({
        node_id: node.id,
        dependency_ids: dependency_outputs.map(({ node_id }) => node_id)
      })
    }
  }
});

console.log(checked.execution_order, record.execution_order);
```

機械可読の公開契約は次の4ファイルです。

- `contracts/judgment-dag/schema.json`
- `contracts/judgment-dag/fixture.json`
- `contracts/judgment-dag/source-lock.json`
- `contracts/judgment-dag/digest.json`

`node.depends_on`と`relation: "depends_on"` edgeは完全なmirrorです。missing、cycle、reverse-layer、scope不一致、不正runner登録は、最初のrunner呼び出し前にfail closedで拒否されます。

`source-lock.sources`は入力契約の固定対象を列挙し、`digest.files`は配布物の各sha256を保持します。総合digestは、各行を`path + NUL + sha256 + LF`としてpath順に連結したcanonical bytesから計算します。

## BrainbaseとMana

```text
Brainbase = 判断構造を記憶・整理・実行・再生・評価する
Mana      = いつ動かすかを決め、優先順位を付け、継続的に追跡する
```

Brainbaseは実行可能な組織認知を担います。Manaは、その判断構造を継続的に起動し、仕事を前へ進める自律運営を担います。

## 安全なオンボーディング

生成物やdry-runだけを導入完了にしません。

```bash
brainbase onboard:skills --target codex
brainbase onboard:routines --target codex --cwd /path/to/brainbase
brainbase onboard:install --target codex --dry-run
brainbase doctor
```

After the demo, keep onboarding open. Confirm public skills placement, `ohayo` / `oyasumi` / `retro` registration, the real MCP config merge, source allowlist / import / candidate review decisions, and MCP `resolve_entity` / `get_context` / `search` verification.

Do not treat those generated artifacts as installed until the user approves file writes, scheduler registration, and live configuration changes.

### Autonomy Gate canary

Autonomy Gateは既定で`off`です。最初は単一projectだけを明示してHook設定を生成し、出力を確認してからCodex設定へ反映します。

```bash
brainbase judgment:install --target codex --autonomy-mode canary --autonomy-project brainbase --dry-run
```

canaryは、テスト・読取・調査・ローカルで可逆な作業の不要な確認だけを同じCodexターンへ戻します。外部送信、本番操作、破壊、権限変更、機密/個人情報、契約、支払、新しい価値判断は人間境界のままです。判定はローカルjournalへcase-boundなimmutable receiptとして記録されます。

## 公開説明の更新

公開コピーは`docs/publication/public-message.json`から投影されます。マーカー内の文章を個別に手修正しないでください。

```bash
npm run docs:check
npm run docs:sync
```

Brainbase Graphから公開説明を昇格する場合は、snapshot hashと人間の承認を含むcandidateを作り、次の順で進めます。

```bash
npm run docs:promotion:plan -- --candidate /path/to/candidate.json
npm run docs:promotion:apply -- --candidate /path/to/candidate.json
npm run docs:check
npm run docs:build
npm run docs:smoke
```

`public-message-promotion.yml`は同じ処理を行い、直接公開せずレビュー用PRを作成します。

## 開発

```bash
npm ci
npm run build
npm test
npm run docs:check
npm run docs:build
npm run docs:smoke
```

### Maintainer release operation

Publication is serialized by the GitHub workflow. Direct local `release:publish` is rejected; maintainers must not publish with a local npm token.

Dispatch the reviewed ref once when automatic publication needs recovery:

```bash
RELEASE_REF="<reviewed-develop-commit>"
gh workflow run npm-publish.yml --ref develop -f release_ref="$RELEASE_REF"
```

After the workflow succeeds, verify npm `gitHead`, `dist.integrity`, and dist-tag, and verify that the GitHub Release targets the reviewed release commit. If npm already contains the version, treat that version as immutable; fix the source, increment the version, and run the reviewed workflow again.

## ドキュメント

- [公開マニュアル](https://brainbase.pages.dev/)
- [Brainbaseの全体像](https://brainbase.pages.dev/guide/grand-design)
- [Judgment DAGの考え方](https://brainbase.pages.dev/guide/judgment-system)
- [現在の状態](https://brainbase.pages.dev/guide/status)
- [MCPツール](https://brainbase.pages.dev/reference/mcp-tools)
- [Core Philosophy](docs/core-philosophy.md)
- [Judgment DAG architecture](docs/architecture/judgment-dag-core.md)
- [Judgment DAG milestones](docs/management/judgment-dag-milestones.md)

MIT License
