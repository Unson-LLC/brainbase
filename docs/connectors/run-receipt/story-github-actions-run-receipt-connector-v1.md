# story-github-actions-run-receipt-connector-v1

Status: implemented_locally
Control-plane dependency: `story-cross-runtime-run-receipt-inbox-v1`  
Implementation owner repo: `code/brainbase`

Implementation artifact: `.github/actions/run-receipt-reporter/action.yml`

## Outcome

GitHub Actionsのworkflow run完了時に、reusable reporterが`run_receipt.v1`をBrainbaseへ配送する。job log本文やartifact内容は送らず、GitHub run URLまたはartifact referenceだけを証跡にする。

## Source identity

- `source.type=github_actions`
- `source.workflow_id=github:<repository_id>:workflow:<workflow_id>`
- `run.external_run_id=github:<repository_id>:run:<run_id>:attempt:<run_attempt>`

## Acceptance boundary

- success/failure/cancelled/action_requiredをGitHubのauthoritative conclusionから写像する。
- repository間collisionとrerun attemptを別identityとして固定する。
- secretless fork/PRではblockedまたはdelivery unavailableを明示し、成功/0件に丸めない。
- reusable workflow fixtureとlocalhost fake endpointで検証し、org/repo secret配布は別の明示承認を要する。

## Local implementation evidence

- JavaScript actionがrepository/workflow/run/attempt identityとauthoritative conclusionを`run_receipt.v1`へ正規化する。
- 実装artifactは`.github/actions/run-receipt-reporter/{action.yml,index.mjs}`、安全な組込みfixtureは`tests/fixtures/run-receipt/github-actions-reporter-step.yml`、contract testは`tests/unit/github-actions-run-receipt-reporter.test.js`に置く。
- 最大3回のbounded retryを行い、secretlessまたはretry exhausted時はredacted receiptを`RUNNER_TEMP`へ残して`delivery-status`を返す。
- `conclusion`は最終stepの`${{ job.status }}`等、GitHub authorityから明示的に渡す。reporter自身が成功を推測しない。
- reusable step fixtureは`always()`でterminal pathから実行し、localhostとpublic fake tokenだけを使う。
- org/repo secret配布、workflowへの組込み、本番canaryは未実施。
