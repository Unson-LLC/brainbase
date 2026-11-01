# docs検証結果

Story ID: `story-mcp-queue-task-tools-v1`

最終レビュー5件の修正後の検証。実装AC-1〜AC-12は未実装・未実行。本変更はStory / Specと検証証跡のみ。

| 正確な検証コマンド | 結果 |
| --- | --- |
| `npm run docs:check` | pass |
| `npm run docs:build` | pass |
| `python3 /tmp/q1-review-check-docs.py` | pass |
| `git diff --check` | pass |
| `GIT_INDEX_FILE=/tmp/q1-review-final.index git diff --check` | pass |

最終実行は5種類 pass / 0 fail。途中でhelperのrenameがファイルシステム境界により失敗し、移動前の`python3 /tmp/q1-review-check-docs.py`はexit 2（ファイルなし）だった。コピーと元ファイル削除に切り替えた後、同じ検査はpass。helperはPR artifactsに含めず、今回の実行環境の`/tmp/q1-review-check-docs.py`だけに置いた。この一時ファイルはPRから再現できる検証資産ではない。

一時helperは空白・ローカルリンク・JSON例・一般的な資格情報パターン・12 ACのテスト割当を確認した。特定の文言や非公開サービスの文字列に依存しない。scripts / workflowsに個人名・OSS security専用check scriptは確認できず、文書の目視確認も実施した。公式Security Checkの代替ではない。

新規ファイルを含む空白検査の準備:

```sh
GIT_INDEX_FILE=/tmp/q1-review-final.index git read-tree HEAD
GIT_INDEX_FILE=/tmp/q1-review-final.index git add -N -- docs/stories/story-mcp-queue-task-tools-v1.md docs/specs/mcp-queue-task-tools-v1.md .vibepro/pr/story-mcp-queue-task-tools-v1
GIT_INDEX_FILE=/tmp/q1-review-final.index git diff --check
```

実indexは変更していない。既存node_modules symlinkは追加対象外。

## VibePro記録

上記5コマンドそれぞれに`vibepro verify record . --id story-mcp-queue-task-tools-v1 --kind docs --status pass --command '<正確なコマンド>'`を再実行した。途中のhelper失敗も同じcommandに`--status fail`を指定して記録を試行した。一時index検査後の記録再試行1件を含め、計7件ともexit 1、出力は`verify record --kind must be one of: unit, integration, e2e, typecheck, build`。docs種別の記録は未完了。前回のunit代替も`requires a recognized executable unit check`で拒否されたため、今回unit代替の再試行はしない。

```sh
vibepro verify record . --id story-mcp-queue-task-tools-v1 --kind build --status pass --command 'npm run docs:build' --target docs/specs/mcp-queue-task-tools-v1.md --target docs/stories/story-mcp-queue-task-tools-v1.md --scenario 'VitePress builds Story and Spec' --observed build_exit_code=0
```

上記はexit 0。出力: `kind: build`, `status: pass`, `evidence_source: self_reported`, `managed_worktree: not_recorded`, `Warnings: none`。artifactは`verification-evidence.json`。過去のfail履歴は手編集で消していない。docs種別の公式記録方法はowner / Maintainerへの未確認事項。

## 再レビュー指摘への対応

1. blocking High: 検査を証跡配下へ移し（最終レビューの対応5で検査スクリプト自体を削除。下の追記を参照）、非公開サービス固有の文字列を除去した。
2. blocking Medium: 公開handler、backend結果契約、host HTTP adapterのエラー表を分離。throw / rejectはunknown。HTTP変換はhost専用scenario、AC-8は構造化fixture結果を検査する。
3. Medium: describe.eachはAC-2〜AC-9のみ。AC-10 / AC-11はtop-level、AC-11はHTTPのみと明記した。
4. Low: scripts配下のPythonを削除。証跡配下へ移し（最終レビューの対応5で削除済み）、固定文言assertと再現不能な/tmp行を除去した。
5. Low: 有効化はbackend注入、別flagなしと明記し、AC-1名を同期した。
6. Low: AC-2 / AC-4はlist / nextのみ。get / by_idは承認時だけ追加する別it名を指定し、非登録はAC-1で検証する。
7. Low: Storyのwrite到達先をhost注入のQueueTaskBackendへ合わせた。

## 最終レビュー指摘への対応

1. Medium: 100ページ・反復cursorの停止をconsumer向け推奨へ移し、公開エラー`task_pagination_limit`を削除。AC-2を1ページ応答・cursor転送・次cursorと終端の保持に限定した。
2. Low: backend認証拒否のwrite outcomeは未送信を証明した場合のみnot_sent、それ以外unknownと明記した。
3. Low: 401は業務拒否ではなく認証済みagentとして利用できない状態なのでunavailableとする理由を追記した。
4. Low: host HTTPテストのファイル・名前は別repositoryへの契約であり、本PRと公開CIでは存在・実行結果を検証できないと明記した。
5. Low: PR artifactsのhelperを削除し、今回の検査は/tmpで実行した。記録を実際のコマンド・失敗・再実行結果に合わせた。
