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

PR番号やtitleだけではrepositoryを跨いで一意にならない。canonical identityは`repository + pull_request + role`であり、merge済みの場合はmerge SHAを加える。source-lockはupstream repository、PR、role、merge SHAを同時に固定する。title一致だけのopen PR、別repositoryの同番号PR、consumer PRをproducerへ代入しない。

## 証拠境界

- external stateは`OPEN`、`MERGED_EXTERNALLY`等の観測値で、Program statusではない。
- Program statusはMaster Roadmapの6語彙だけを使う。
- merge/release/docsはdelivery provenanceであり、review、Gate、production、利用者成果を代替しない。
- missing、stale、not_collectedはpassへ丸めない。

このStory自身は契約資料とtestのみなので最大`contract_ready`とする。
