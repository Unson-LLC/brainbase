# story-github-actions-run-receipt-connector-v1

Status: planned  
Control-plane dependency: `story-cross-runtime-run-receipt-inbox-v1`  
Implementation owner repo: `code/brainbase`

Planned implementation artifact: `.github/actions/run-receipt-reporter/action.yml`

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
