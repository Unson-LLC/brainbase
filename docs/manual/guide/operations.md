# フェーズ5: 運用開始

最初の価値を確認した後で、Brainbaseを日常的に使うための設定を行います。生成された設定を見ただけでは完了にしません。

## 1. Skillsを確認する

Brainbaseの公開Skillsを、利用中のAIエージェント向けに生成します。

```bash
node dist/cli.js onboard:skills --target codex
```

Claude Codeでは `--target claude` を使います。標準では確認用の内容を出力するだけです。配置先を指定して実ファイルを作る場合は、出力内容と既存Skillsへの影響を確認してから `--out` を使います。

## 2. 見直しルーティンを準備する

```bash
node dist/cli.js onboard:routines --target codex --cwd /path/to/brainbase
```

`ohayo`、`oyasumi`、`retro` の定義が生成されます。最初は停止状態または実行前に確認する設定にし、自動で正本を書き換えないようにします。

## 3. MCP設定を確認する

```bash
npm run onboard:install -- --target codex --dry-run
```

`onboard:install` は既存設定へ自動マージしません。内容を確認した後、AIまたはユーザーがBrainbaseの項目だけを既存設定へ追加し、CodexやClaude Codeを再起動します。詳しい手順は[MCPを登録する](/guide/mcp-install)にあります。

## 4. ローカルデータを点検する

```bash
npm run doctor
```

正本ファイル、初期登録、接続状態に問題がないことを確認します。

## 5. 新しいセッションで確かめる

設定前から開いていたセッションではなく、新しいCodexまたはClaude Codeのセッションを開きます。次を依頼してください。

```text
Brainbase MCPの状態を確認し、私の現在のプロジェクトと重要な関係者を説明してください。
続けて、登録したプロジェクトについて検索してください。
```

AIがMCPの `onboarding_status`、`resolve_entity`、`get_context`、`search` を使い、正本に基づいて答えられれば運用開始です。

Codex HostにJudgment Resolverを導入した場合は、すべての返答の先頭に `🧠 判断参照:` と、それに続く `📚` または `⚠️` の参照証跡が表示されることも確認します。前者は判断に使った依頼と対応方針、後者は実際のBrainbase MCP呼び出し、または参照不要で0回だった事実を示します。詳しい見方と3つのHookの導入手順は[Judgment Hostを登録して判断・参照証跡を確認する](/guide/judgment-audit)にあります。

## 導入完了の基準

- 現実の依頼で、説明し直さなくて済む価値を確認した
- MCPからプロジェクトと関係者を取得できる
- Judgment Resolver導入時は、毎回の返答で参照元と判断結果を確認できる
- 不明な情報を推測せず、正本と確認中の情報を分けられる
- 日々の気づきを見直し、承認した情報だけを正本へ反映できる

Skills、ルーティン、MCP設定の生成だけでは完了ではありません。
