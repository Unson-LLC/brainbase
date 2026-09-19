# 廃止済み開発runtime操作の退役

## Outcome / Story
利用者がBrainbaseの現役コマンド・手順を使っても、廃止済みsession APIやBrainbase所有の開発プロセスcleanupへ誘導されない。判断の正本はdocs/architecture/ADR-019-codex-owns-development-runtime.md。

## 受け入れ条件
1. 旧cleanupとcron wrapperはtmux/MCP終了・ログ削除等を実行せず、退役理由をstderrへ出し非zero終了する。引数やAUTO_CONFIRMでも迂回できない。
2. 旧dev-server-worktree起動/停止入口もデータコピー・プロセス開始/停止・一時領域削除をしない。現在の明示的な開発手順へ案内する。
3. merge/create-prと関連する現役案内は退役session/state APIを要求せず、対象branch/dirty状態・通常のPR/CI/権限境界を確認する。
4. 隔離したテストで旧入口の副作用がないことを検証する。稼働プロセス、履歴データ、production設定は変更しない。

## 範囲外
STATE_PATH互換、NocoDBデータ移行、本番deploy、認証web、履歴削除。旧MCP source除去は次のfocused change。

## 検証
対象shellの構文検査、退役入口のsandboxed unit tests、関連するretired capability tests。全suiteはCI。

## 後続Story: 旧cleanup配布テンプレートの退役
- 対象: `config/com.brainbase.cleanup.plist`。今回のstubによりプロセス停止はできないが、新規登録すると定期的に非zero終了する。
- 完了条件: テンプレートの新規利用を止め、既存登録はownerと実パスを確認して個別に退役する。他環境の登録有無を不在扱いしない。
- 現在の確認範囲: このMacのユーザーcrontabと指定launchd設定ディレクトリに旧cleanupの直接登録なし。全ホストや間接呼出しは未確認。
