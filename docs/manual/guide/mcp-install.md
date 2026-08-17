# MCPを登録する

Brainbase MCPを登録すると、CodexやClaude Codeがローカルの正本を必要な時に読めるようになります。CLIサンプルの後ではなく、実エージェントで最初の価値を確認する前に設定します。

初回導入を一枚で進める場合は、[10分で試す](/guide/quick-start)のチェックリストを開いたまま、このページを詳細説明として参照してください。

## dry-runで内容を確認する

まず実際の設定ファイルへ書き込まず、設定内容だけを確認します。

```bash
npm run onboard:install -- --target codex --dry-run
npm run onboard:install -- --target claude --dry-run
```

実行ファイルとデータディレクトリには絶対パスを使います。相対パスは、エージェントを起動した場所によって参照先が変わるため避けます。

## 設定断片を保存する

確認した設定をファイルへ保存する場合は、既存のエージェント設定とは別の出力先を指定します。

```bash
npm run onboard:install -- --target codex --output /tmp/brainbase-mcp.toml
```

`onboard:install` は既存のMCP設定へ自動マージしません。ユーザーが内容を承認した後、CodexやClaude Codeに既存設定を読ませ、Brainbaseの項目だけを追加させます。既存のMCP設定は消さないでください。反映後はエージェントを再起動します。

## 新しいセッションで確認する

1. MCPサーバー `brainbase` が起動している
2. `resolve_entity`、`get_context`、`list_entities`、`search`、`search_personal_kg`、`onboarding_status` と、必要に応じて5つの `brainbase_onboarding_*` toolが見える
3. `onboarding_status` が登録済みと未設定の項目を返す
4. `get_context` が自分、仕事、関係性の文脈を返す
5. `resolve_entity`が文章中の人物やプロジェクトを正規IDへ接続し、`search`が登録した人物とプロジェクトを見つける

確認できたら、[フェーズ3: 最初の価値](/guide/first-value)の現実の依頼を送り、実回答を見た本人が役立ったかを判断します。toolが見えることや正規IDが返ることだけでは初回価値の達成ではありません。

## うまく動かない時

次の順で確認します。

```bash
npm run build
npm run doctor
```

`doctor`はGraphを`healthy`、`issues`、`migration_required`、`invalid`、`unavailable`に分けます。`migration_required`、`invalid`、`unavailable`は非0で終了するため、CIやエージェントが正常と誤認しません。`localBackend.connected`はローカル正本へ接続できた状態であり、`agentMcp.status: not_verified`や`operationallyReady: false`を実エージェント接続済みへ読み替えないでください。

- `~/.brainbase/personal-os/` が存在するか
- MCP設定の実行ファイルが絶対パスか
- エージェントを設定反映後に再起動したか
- 古いセッションではなく、新しいセッションで確認しているか

設定が読まれていても、正本が空なら仕事の文脈は返りません。その場合は[フェーズ2: 仕事の前提](/guide/project-context)へ戻ります。

## Judgment Hostは別に登録する

MCPの登録は、AIがBrainbaseのtoolを呼べるようにする設定です。どの依頼を判断に使い、実際にどのtoolを呼んだかを毎turn監査するCodex用Judgment Hostは別の任意設定です。

Judgment Hostを使う場合は、MCPの動作確認後に[Judgment Hostを登録して判断・参照証跡を確認する](/guide/judgment-audit)へ進み、`UserPromptSubmit`、`PostToolUse`、`Stop` の3つを登録してください。
