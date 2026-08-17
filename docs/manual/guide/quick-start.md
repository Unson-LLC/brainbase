# 10分で試す

このページは、Brainbaseを初めて試す人の進行表です。上から順に進み、終わった項目に自分でチェックを付けてください。途中で中断しても、このページへ戻れば再開できます。

最初の目標は、すべての情報源をつなぐことではありません。自分が承認した仕事の前提を使い、AIが一度役立つ回答を返すところまで進めます。

## 現在地メモ

このページのチェックは画面を閉じると保存されません。中断前にコードブロックをコピーし、手元のメモへ実結果だけを残してください。

```text
完了済み:
次にやること:
未確認:
最後に確認した実結果:
```

`ready: true`、設定生成、画面表示だけは「完了済み」に入れません。実結果がないものは「未確認」に残します。

## 1. 準備する

- [ ] Node.js 20以上とnpmが使える
- [ ] CodexでBrainbaseのフォルダを開いた
- [ ] Brainbaseをビルドした

```bash
git clone https://github.com/Unson-LLC/brainbase.git
cd brainbase
npm install
npm run build
```

Codexへ次の一言を入力します。

```text
Brainbaseのオンボーディングを始めたいです。
```

Codexは次の開始コマンドを使います。

```bash
npm run onboard:start -- --target codex
```

公開CLIをインストール済みの場合は、`brainbase onboard:start --target codex`を使います。`--help`はデータを書き込まず、最短の3ステップを先頭に表示します。

- [ ] 最初に試す現実の依頼をひとつ決めた
- [ ] その依頼を扱うプロジェクトをひとつ決めた

詳しい意味は[準備と目的](/guide/getting-started)を参照してください。

## 2. 最初の価値を確認する

自分、プロジェクト、関係者、判断を勝手に正本へ保存しません。Codexが示した候補を確認し、残したい最小限の事実だけを承認します。

開始コマンドが表示した`onboard:seed`を確認して実行し、続いて実際の依頼を渡します。

```bash
brainbase onboard:demo --scenario "実際に試す依頼"
```

通常表示は次の一手だけに絞っています。保存候補、情報源、運用化まで一度に確認したい場合だけ、`onboard:start`または`onboard:demo`へ`--details`を付けます。

関係者の入力形式が誤っている場合、保存は行われません。エラーに表示される再実行コマンドは、名前、価値観、プロジェクト、判断基準、正しい関係者入力を保持し、誤った関係者入力だけを例へ置き換えます。

- [ ] 承認した事実だけを登録した
- [ ] 実際の依頼で`onboard:demo`を試した
- [ ] 以前なら説明し直していた前提が、回答に使われた

`ready: true`や設定ファイルの生成だけでは完了ではありません。実際の依頼で役立つ出力を確認して、初めてこの段階は完了です。

## 3. MCPを登録する

まず設定を書き込まないdry-runで内容を確認します。

```bash
npm run onboard:install -- --target codex --dry-run
```

生成された設定断片は、まだ登録完了ではありません。

既存設定を変更する前に、`~/.codex/config.toml`が存在する場合は別名へコピーし、既存設定をバックアップしてください。バックアップを確認してから、Brainbaseの項目だけを追加します。

```bash
cp -n ~/.codex/config.toml ~/.codex/config.toml.before-brainbase
```

`onboard:install` は既存設定を自動マージしません。既存のMCP項目を消さず、dry-runで確認したBrainbaseの項目だけを追加してください。

Codexを再起動して新しいtaskを開き、次を確認します。

- [ ] MCPサーバー`brainbase`が起動した
- [ ] `get_context`、`search`、`onboarding_status`が見える
- [ ] `get_context`が承認済みの文脈を返した
- [ ] `search`が登録した人物またはプロジェクトを見つけた

error、空の結果、権限待ち、未確認を成功扱いしないでください。MCPの動作確認が終わるまで、Judgment Hostへ進まないでください。

詳しい登録方法は[MCPを登録する](/guide/mcp-install)を参照してください。

## 4. 任意でJudgment Hostを登録する

Judgment HostはCodex用の任意設定です。どの依頼を判断に使い、実際にどのBrainbase toolを呼んだかを監査したい場合だけ進みます。

```bash
brainbase judgment:install --target codex --dry-run
```

リポジトリをcloneして試している場合は、`node dist/cli.js judgment:install --target codex --dry-run`を使います。

既存の`~/.codex/hooks.json`が存在する場合は、先にバックアップします。

```bash
cp -n ~/.codex/hooks.json ~/.codex/hooks.json.before-brainbase
```

既存Hookを残し、`UserPromptSubmit`、`PostToolUse`、`Stop`の3項目だけを追加します。Codexを再起動して新しいtaskを開き、`doctor --judgment-hooks`が3項目を`ready`として返すことと、普通の質問の返答先頭に監査行が出ることを確認します。

- [ ] 3つのHookが`ready`になった
- [ ] 新しいtaskで`🧠`行が表示された
- [ ] 実際のBrainbase tool呼び出しに対応する`📚`行を確認した

表示だけでは、ファイル書き込み、送信、公開、デプロイの成功や許可は証明しません。詳しくは[Judgment Hostを登録する](/guide/judgment-audit)を参照してください。

## 5. 中断したらここから再開

どこまで進んだか分からない場合は、設定を追加し直さず、次の順で現在地を確認します。

```bash
npm run build
npm run doctor
```

1. `onboard:demo`で承認済みの文脈が使えるか確認する。
2. 新しいtaskでMCPの`get_context`と`search`を試す。
3. Judgment Hostを使う場合だけ、3つのHookと監査行を確認する。
4. 最初に通らない項目へ戻り、その一項目だけを直す。

生成ファイル、dry-run、`ready: true`だけを完了の根拠にしません。実結果を取れない項目は未確認のまま残します。

## 設定を元へ戻す

Brainbase追加後にCodexや既存MCPが起動しなくなった場合は、編集を続けず、バックアップしたファイルと現在のファイルを見比べます。Brainbaseの追加前へ戻す必要がある場合は、現在のファイルを別名で保存してから、確認済みのバックアップを元の設定へ戻すようCodexへ依頼してください。

どのファイルが正しいか判断できない場合は上書きせず、現在の設定、バックアップ、`doctor`の結果を並べて確認します。
