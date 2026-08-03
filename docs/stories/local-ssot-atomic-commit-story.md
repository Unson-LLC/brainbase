---
story_id: story-brainbase-local-ssot-atomic-commit
title: 並行更新でもローカルSSOTを一つの整合した状態として保存する
status: active
period: 2026Q3
spec: docs/specs/local-ssot-atomic-commit.md
architecture: docs/architecture/story-brainbase-local-ssot-atomic-commit.md
business_metric: canonical writeのlost update件数とpartial commit件数を0にする
created_at: 2026-08-03
updated_at: 2026-08-03
---

# 並行更新でもローカルSSOTを一つの整合した状態として保存する

## 背景

Brainbase OSSのcanonical local SSOTは、`graph.json`、`relationships.json`、`personal-kg.jsonl`、`decisions.jsonl`の4ファイルで構成される。Ontology 1.0.0は書込予定のaggregate全体を検証するが、その後の保存は4回の独立したwriteであり、同時実行では後勝ちによる更新消失、途中失敗では新旧データの混在が起こり得る。

## 誰が・何を・なぜ

Brainbase OSS利用者とagentは、複数のオンボーディング操作が同時に走った場合や保存途中で障害が起きた場合でも、承認済みの事実を失わず、Ontology検証済みの一つの状態としてcanonical SSOTを読みたい。これにより「検証は通ったが保存結果は別のaggregate」という抜けをなくす。

## 代表シナリオ

- 2つの`onboard:seed`が同じPersonal OSへ同時に事実を追加しても、両方が最終状態に1回ずつ残る。
- 4ファイルの公開途中でwriteが失敗しても、次のBrainbase readは失敗前または成功後のaggregateだけを返し、新旧混在を返さない。
- 初回の`onboard:init`と通常writeが競合しても、4 canonical filesは完全な初期状態または検証済みの更新後状態としてだけ見える。
- Ontology違反がある予定aggregateは、従来どおり最初のcanonical writeより前に拒否される。
- 従来の4ファイルだけで作られたPersonal OSを、そのまま読み、最初のatomic commit後も同じファイル形式で利用できる。

## 受け入れ基準

- [ ] canonical writeはプロセス間排他の中で`load → mutate → ontology validation → publish`を実行する。
- [ ] `initializePersonalOs`による4 canonical filesの初回作成も、同じlockとrecovery境界を使う。
- [ ] 2つの別プロセスによる並行writeでlost updateが発生しない。
- [ ] 通常mutationのpublish途中の失敗は4ファイルすべてを完全な`previous`へrollbackし、登録済み初期化のpublish途中の失敗は完全な`next`へroll forwardする。
- [ ] process crashでtransaction残骸が残っても、次のBrainbase read/writeは通常mutationを完全な`previous` aggregateへrollbackし、初期化を完全な`next` aggregateへroll forwardする。
- [ ] active writerのlockは奪わず、回復不能またはlock timeoutはfail loudする。
- [ ] `onboard:seed`、`onboard:projects --write`、`onboard:apply --write`が同じatomic commit境界を使う。
- [ ] 個別fileの低水準write helperをpublic APIにせず、canonical aggregate writeがatomicityとOntology guardを迂回できない。
- [ ] 既存の4 canonical file名・schema・MCP read contractを維持する。
- [ ] 通常のCLI/MCP readはlock・recovery errorをrejectし、`audit_ontology`は既存contractどおり`status: unverified`として返す。
- [ ] Brainbase API/CLIを経由しないraw fileの同時直接readはatomic保証外であることを文書化する。
- [ ] targeted test、別process concurrency test、full test、buildで現在HEADを検証する。

## スコープ外

- hosted databaseや分散lockの導入
- network filesystem上の複数host間lock保証
- raw fileを直接読む外部processへの共有lock強制
- canonical file formatの変更、single aggregate file、symlink based generationへの移行
