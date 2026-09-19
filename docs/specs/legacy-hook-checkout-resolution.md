# Story: hookを個人の旧checkoutに依存させない

利用者がrepoを任意の場所へ配置しても、hookは現在repo・明示設定・同repoのworktree・PATHから実行ツールを解決できる。別の個人checkoutを暗黙に使わない。

## 最小Spec

- run-hook.shの固定された個人checkout fallbackのみを除去する。
- bundle優先、repo-local tsx、明示BRAINBASE_HOOK_REPO_ROOT、同repo worktree、PATHの順序と引数・元cwd・終了コードを維持する。
- 候補がなければ127と解決方法を返す。成功やhook実行済みへ変換しない。
- 関連するSlack/Infisical Skillの2案内は、確認済みBrainbase checkoutのrepo rootから実行する手順に直す。secret取得・Slack検索は実行しない。
- runtime更新・再起動・本番反映、元dirty checkoutの切替は対象外。

## 判断と検証

代替案は固定パスを新しい個人パスに置き換えることだが、配布先で成立しないため採用しない。明示設定を残すことで、依存物を別のcheckoutに置く利用者は必要な場所を指定できる。

隔離fixtureで各ツール解決経路、bundle優先、引数・cwd保持、127を検証する。禁止固定パスの回帰テストをRedからGreenへ進める。関連設定テスト、shell構文、差分チェック、独立レビューを行う。Graphify未一致は影響不明として残す。

## 検証結果

- 変更前は固定パス禁止の1件だけ失敗し、削除後は新規8件と既存設定2件が成功した。
- shell構文と差分チェックは成功した。
- Graphify更新後もshellとSkillの3ファイルは未一致。テストのみ一致し、全体の影響判定はunknownのまま。
- 本番runtimeの更新・再起動、Slack/Infisicalへの操作は実施していない。
