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

この契約のcanonical identityはrepository=`Unson-LLC/brainbase-unson`、pull_request=`1302`、role=`producer_contract_delivery`、merged_sha=`ad908bce7b90678f9ed7f1c570f808bdf1a500ad`である。`scripts/program/reconcile-external-delivery.mjs`は候補集合から4要素が完全一致する唯一のdeliveryだけを選ぶ。さらにcanonical候補は`state=MERGED_EXTERNALLY`、`mergeable=MERGEABLE`、`merge_state_status=CLEAN`、merge provenance、canonical GitHub PR URLをすべて必須とする。欠損、unknown、conflicting、dirty、非merged、または`merged_sha`と`merge.sha`の矛盾はfail closedにする。

## 証拠境界

- external stateは`OPEN`、`MERGED_EXTERNALLY`等の観測値で、Program statusではない。
- Program statusはMaster Roadmapの6語彙だけを使う。
- merge/release/docsはdelivery provenanceであり、review、Gate、production、利用者成果を代替しない。
- missing、stale、not_collectedはpassへ丸めない。

このStory自身は契約資料とtestのみなので最大`contract_ready`とする。
