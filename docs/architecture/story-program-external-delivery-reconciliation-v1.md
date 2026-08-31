# Program external delivery reconciliation v1 Architecture

## 判断

外部delivery ledgerとProgram work-package stateを別の状態機械として扱う。delivery ledgerはGitHub/npm等の観測事実を保持し、Program stateはMaster Roadmapのexit gateだけで遷移する。delivery観測からProgram statusへの暗黙変換は設けない。

```text
live source readback
  -> repository-qualified delivery identity
  -> source-lock lineage check
  -> external delivery ledger
  -X-> Program status promotion

exact-HEAD test + independent review + CI + production/exit evidence
  -> Program status transition
```

## identity境界

PR番号やtitleだけではrepositoryを跨いで一意にならない。canonical identityは`repository + pull_request + role`であり、A0 producerのroleは全surfaceで`producer_contract_delivery`とする。merge済みの場合はmerge SHAを加える。P0 machine source-lockが権威を持つのはupstream repositoryとmerged SHAである。Program-owned companion lockはその実値を直接照合し、live readback由来のPRとProgram契約由来のroleを結合する。title一致だけのopen PR、別repositoryの同番号PR、consumer PRをproducerへ代入しない。

この契約のcanonical identityはrepository=`Unson-LLC/brainbase-unson`、pull_request=`1302`、role=`producer_contract_delivery`、merged_sha=`ad908bce7b90678f9ed7f1c570f808bdf1a500ad`である。`scripts/program/reconcile-external-delivery.mjs`は候補集合から4要素が完全一致する唯一のdeliveryだけを選ぶ。canonical候補に必須なのは`state=MERGED_EXTERNALLY`、`merge.sha`、`merge.merged_at`、`merge.merged_by`、`merged_sha=merge.sha`、canonical GitHub PR URLというimmutableなmerge provenanceである。`mergeable`と`merge_state_status`は`pre_merge_health`に保存する別の観測値であり、GitHubのpost-merge readbackが`UNKNOWN`でもimmutable provenanceを無効にしない。`pre_merge_health`を記録する場合は各値を許容された観測値として検証し、欠損・不正な値はfail closedにする。全候補はrepositoryとPR番号の組を一意にし、重複、非merged、provenance欠損、またはSHA矛盾はfail closedにする。

## selector invocation boundary

selectorのownerは`scripts/program/reconcile-external-delivery.mjs`を実行する専用Story `story-program-external-delivery-reconciliation-v1`である。triggerはexternal delivery readback完了後、Program statusを評価する前とする。selectorのfailure surfaceは例外を投げるfail-closedで、呼び出し側はreconciliation Gateを`needs_review`として扱い、候補を黙って除外したりProgram statusを昇格したりしない。このowner、trigger、failure surfaceは`canonicalSelectorContract`として機械正本にも保持する。

## 証拠境界

- external stateは`OPEN`、`MERGED_EXTERNALLY`等の観測値で、Program statusではない。
- Program statusはMaster Roadmapの6語彙だけを使う。
- merge/release/docsはdelivery provenanceであり、review、Gate、production、利用者成果を代替しない。
- missing、stale、not_collectedはpassへ丸めない。

このStory自身は契約資料とtestのみなので最大`contract_ready`とする。
