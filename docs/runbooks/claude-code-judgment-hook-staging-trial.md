# Claude Codeの判断フックをstagingで試す手順

この手順は、試す人が変数をexportせず、tokenも貼らずに、Claude Codeの判断の履歴をstagingに残せるかを確かめるためのものです。本番には使いません。

## 前提

次の3つがstagingに入っていることを、先に運用する側が確かめます。

- Hostがprojectを決める処理。`@unson/brainbase-mcp`の`remote-judgment-hook-http`で、明示のヘッダー、Hostのリポジトリ対応、本人のprojectが1つならそれ、の順に決める。
- `brainbase login`と`judgment:install --target claude-code`を含む`@unson/brainbase-mcp`の版。
- その版にpinを上げたstagingのMCPとAPI。

運用する側は、次の値を試す人に渡します。

- APIのURL。以下では`<API>`と書く。
- hosted MCPのURL。以下では`<MCP>`と書く。
- 試す人のproject。projectが1つなら、Hostが自動で選ぶので渡さなくてよい。

試す人のアカウントは、WorkOSかSlackの普通のログインで入れるものにします。stagingの試験用入口のアカウントは、端末のログインの承認を断られます。

## 試す人の手順

1. Node.js 20以上を入れる。
2. パッケージを入れる。

   ```sh
   npm install -g @unson/brainbase-mcp@<版>
   ```

3. 端末からログインする。表示されたURLをブラウザで開き、いつものログインで承認する。

   ```sh
   brainbase login --server <API>
   brainbase login:status
   ```

   `login:status`に、サーバーとtokenの期限が出れば成功です。tokenそのものは表示されません。

4. Claude Codeにフックを登録する。

   ```sh
   brainbase judgment:install --target claude-code --origin <MCP>
   ```

   projectが2つ以上ある人は`--project <project>`を足します。特定のリポジトリだけを記録したいときは`--repositories github.com/<owner>/<名前>`を足します。複数ならカンマで区切ります。名前だけや`<owner>/<名前>`では登録できません。同じ名前の別のリポジトリまで記録しないためです。足さなければ、gitのリポジトリの中で動くClaude Codeのターンはすべて記録されます。`--repositories`に空の値を渡すと、登録できません。先に`--dry-run`をつけると、書き込む内容だけを表示します。

   Hostに送るリポジトリ名も`github.com/<owner>/<名前>`の形です（originのURLから作り、小文字にそろえます）。ターンの途中で別のリポジトリに移ると、そのあとの記録は送りません。originのないリポジトリでは、ターンを始めたチェックアウトの中だけを同じターンとして扱います。gitの外での記録は送りません。

   設定ファイルを既定の場所以外に置くときは`--config <パス>`を足します。Claude Codeに登録するコマンドにも、そのパスが入ります。`--settings`と同じファイルは指定できません。判断フックの設定ではないファイルがすでにあるパスも、指定できません。上書きしないためです。

   ターンの送り先は、ターンを始めたときの設定で決まります。ターンの途中で設定ファイルの送り先やprojectを変えると、そのターンの残りは送りません。`--config`を変えて2つ登録したときは、設定ごとに別のターンとして送ります。

5. Claude Codeを起動し直す。変数はexportしない。
6. 記録したいリポジトリの中で、Claude Codeに1つ依頼を送り、答えが出るまで待つ。
7. stagingのWeb画面で、判断の履歴を開く。いま送った依頼のターンが1件増えていることを確かめる。

## うまくいかないとき

Claude Codeの画面に`⚠️ Brainbase判断フック:`で始まる警告が出ます。作業は止まりません。警告の中の理由で、次のように直します。

- `judgment_hook_login_missing`、`judgment_hook_login_expired`: `brainbase login --server <API>`をやり直す。
- `judgment_hook_login_refresh_unavailable`: APIが一時的にtokenを更新できない。少し待って、もう一度依頼を送る。
- `judgment_hook_http_400_judgment_project_unresolved`: projectが2つ以上あり、Hostが決められなかった。手順4を`--project <project>`つきでやり直す。
- `judgment_hook_http_403_project_not_authorized`: 指定したprojectに権限がない。運用する側にprojectと権限を確かめてもらう。
- `judgment_hook_http_503_judgment_project_lookup_failed`: Hostのリポジトリ対応の検索に失敗した。何も記録されていない。もう一度依頼を送る。
- `judgment_hook_unreachable`、`judgment_hook_timeout`: `<MCP>`に届かない。URLとネットワークを確かめる。
- `judgment_turn_repository_changed`: ターンの途中で別のリポジトリに移った。回答は送っていない。次の依頼は元のリポジトリで送る。
- `judgment_turn_destination_changed`: ターンの途中で設定ファイルの送り先かprojectが変わった。回答は送っていない。次の依頼から新しい送り先に送る。

## やめるとき

```sh
brainbase judgment:install --target claude-code --remove
brainbase logout
```

1つ目はClaude Codeの設定から判断フックだけを外し、フックの設定ファイルを消します。外すのは、このコマンドが同じ設定ファイルで登録したものだけです。その登録が見つからないときは、何も変えずに失敗します。設定ファイルが判断フックのものでなければ、登録だけを外してファイルは残します。`--config`をつけて登録したときは、外すときも同じ`--config`をつけます。ほかのフックと設定は残ります。2つ目は、この端末に保存したログインを消します。

一時的に止めたいだけなら、`BRAINBASE_CLAUDE_JUDGMENT_HOOK=disabled`をつけてClaude Codeを起動します。

## 運用する側の確認

E2Eの証拠として、次の3つを時刻つきで残します。

- 試す人の端末で、`brainbase login:status`の出力。tokenは出ない。
- Claude Codeで依頼を送った時刻と、警告が出なかったこと。
- stagingのWeb画面で、その時刻のターンが判断の履歴に出ている画面のスクリーンショット。

試験のあとは、試す人に「やめるとき」の2つを実行してもらいます。
