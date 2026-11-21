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
   brainbase judgment:install --target claude-code --origin <MCP> --server <API>
   ```

   `--server`には、手順3でログインしたAPIのURLを書きます。省くと、いま保存しているログインのサーバーを使います。ログインもしていないときは、登録できません。フックは、保存したログインがこのサーバーのものであるときだけtokenを送ります。あとで別の環境（本番など）にログインし直すと、このフックは何も送らず、`judgment_hook_login_origin_mismatch`の警告を出します。別の環境のtokenを、このHostに送らないためです。

   projectが2つ以上ある人は`--project <project>`を足します。特定のリポジトリだけを記録したいときは`--repositories github.com/<owner>/<名前>`を足します。複数ならカンマで区切ります。名前だけや`<owner>/<名前>`では登録できません。同じ名前の別のリポジトリまで記録しないためです。足さなければ、gitのリポジトリの中で動くClaude Codeのターンはすべて記録されます。`--repositories`に空の値を渡すと、登録できません。名前の末尾の`.git`は、originのURLと同じく1つだけ取ります。名前そのものが`.git`で終わる自前のGitサーバーのリポジトリは、`--repositories <host>/<owner>/<名前>.git`のように、末尾に`.git`をもう1つ足して書きます。設定ファイルに保存した名前は、読み直しても変わりません。先に`--dry-run`をつけると、足すフックと外す登録、フックの設定ファイルの中身だけを表示します。Claude Codeの設定のほかの部分（`env`など）は表示しません。秘密の値がログに残らないようにするためです。

   Hostに送るリポジトリ名も`github.com/<owner>/<名前>`の形です（originのURLから作ります）。originのURLは、`git remote get-url origin`と同じくgitに聞きます。`insteadOf`による書き換えも、gitの全体の設定も効きます。gitが入っていないときや、gitがこのフォルダーを扱えないときは、何も送らずに`judgment_repository_unresolved`の警告を出します。ホスト名は大文字と小文字を区別しません。パスは、`github.com`では区別せず小文字にそろえ、ほかのホストでは区別します。自前のGitサーバーでは、`--repositories`にoriginと同じ大文字・小文字で書きます。ターンの途中で別のリポジトリに移ると、そのあとの記録は送りません。ターンの途中で`--repositories`からそのリポジトリを外したときも、そのあとの記録と回答は送りません（設定は記録のたびに読み直します）。originのないリポジトリでは、ターンを始めたチェックアウトの中だけを同じターンとして扱います。gitの外での記録は送りません。

   設定ファイルを既定の場所以外に置くときは`--config <パス>`を足します。Claude Codeに登録するコマンドにも、そのパスが入ります。`--settings`と同じファイルは指定できません。判断フックの設定ではないファイルがすでにあるパスも、指定できません。上書きしないためです。

   1つのフックの設定ファイルは、1つのClaude Codeの設定（`--settings`）の登録にだけ使えます。別の`--settings`で登録した`--config`を指定すると、何も変えずに失敗します。登録するたびに新しい登録のidを作り、設定ファイルと登録するコマンドの両方に書きます。idの合わない古いコマンド（コピーした設定など）は、何も送らずに警告を出します。同じ設定ファイルを別のパス（リンクしたディレクトリなど）で指定しても、同じファイルとして扱います。登録し直すと前のコマンドを置き換え、どちらのパスで外しても同じ登録が外れます。

   Claude Codeの設定ファイルがシンボリックリンクのときは、リンクを残したまま、リンク先のファイルを書き換えます。リンク先がないリンクは、何も変えずに失敗します。登録では、フックの設定ファイルを先に書き、Claude Codeの設定をあとに書きます。あとの書き込みが失敗したときは、フックの設定ファイルを前の内容に戻します（新しく作ったときは消します）。前の登録は、前と同じ送り先へ送り続けます。

   登録と解除は、同じClaude Codeの設定か同じフックの設定ファイルを使うものどうしで、1つずつ順に動きます。同時に動かしても、先の登録が消えることはありません。待つためのロックは、それぞれのファイルの実体の隣（`<ファイル>.brainbase-install.lock`）に置き、終われば消えます。この名前のファイルが、brainbaseの書いたロックでないときは消さずに待ち、時間切れのときは確かめるファイルの場所を出します。HOMEを変えて動かした登録どうしも、同じファイルなら互いを待ちます。

   判断フックはClaude Codeの作業を止めません。Hostの返事のうち、Claude Codeに渡すのは、人に見せる通知とモデルへの補足（PreToolUseの知識取得では、その拒否）だけです。

   ターンの送り先は、ターンを始めたときの設定で決まります。ターンの途中で設定ファイルの送り先やprojectを変えると、そのターンの残りは送りません。`--config`を変えて2つ登録したときは、設定ごとに別のターンとして送ります。Hostに送るsession_idとturn_idには、登録ごとの印をつけます。同じHostに2つ登録しても、ターンがぶつかりません。

5. Claude Codeを起動し直す。変数はexportしない。
6. 記録したいリポジトリの中で、Claude Codeに1つ依頼を送り、答えが出るまで待つ。
7. stagingのWeb画面で、判断の履歴を開く。いま送った依頼のターンが1件増えていることを確かめる。

## うまくいかないとき

Claude Codeの画面に`⚠️ Brainbase判断フック:`で始まる警告が出ます。作業は止まりません。警告の中の理由で、次のように直します。

- `judgment_hook_login_missing`、`judgment_hook_login_expired`: `brainbase login --server <API>`をやり直す。
- `judgment_repository_unresolved`: gitからoriginを確かめられなかった。`git -C <フォルダー> remote get-url origin`が動くかを確かめる。
- `judgment_hook_login_origin_mismatch`: 保存しているログインが、登録したときの`--server`と別のサーバーのもの。`brainbase login --server <API>`で、登録したときのAPIにログインし直す。別の環境で使うなら、手順4をその環境の`--origin`と`--server`でやり直す。
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

1つ目はClaude Codeの設定から判断フックだけを外し、フックの設定ファイルを消します。外すのは、このコマンドが同じ設定ファイルで登録したものだけです。その登録が見つからないときは、何も変えずに失敗します。`--config`にフックの設定ファイルへのシンボリックリンクを渡したときは、リンク先の設定ファイルを消し、リンクは残します。設定ファイルが判断フックのものでなければ、登録だけを外してファイルは残します。設定ファイルが別の`--settings`の登録に使われているときも、登録だけを外してファイルは残します。`--config`をつけて登録したときは、外すときも同じ`--config`をつけます。ほかのフックと設定は残ります。2つ目は、この端末に保存したログインを消します。

一時的に止めたいだけなら、`BRAINBASE_CLAUDE_JUDGMENT_HOOK=disabled`をつけてClaude Codeを起動します。

## 運用する側の確認

E2Eの証拠として、次の3つを時刻つきで残します。

- 試す人の端末で、`brainbase login:status`の出力。tokenは出ない。
- Claude Codeで依頼を送った時刻と、警告が出なかったこと。
- stagingのWeb画面で、その時刻のターンが判断の履歴に出ている画面のスクリーンショット。

試験のあとは、試す人に「やめるとき」の2つを実行してもらいます。
