# Public message publication contract

`docs/publication/public-message.json`は、Brainbaseの公開説明へ使用する**承認済み投影**です。Brainbase Graphそのものの正本ではなく、公開対象として人間が承認した内容と証跡をGitHubへ持ち込む境界です。

## なぜこの境界が必要か

GraphのPhilosophyやDecisionを直接Webへ公開すると、次の問題が起きます。

- 未承認のdraftが公開される
- 個人・組織内の情報が混入する
- どのsnapshotを公開したか分からない
- README、manual、package descriptionが別々に古くなる
- 公開後の差分と責任者を追えない

そのため、公開経路を次へ固定します。

```text
Brainbase Graph
  -> exact entity id / version / snapshot hash
  -> approved public-message candidate
  -> dry-run plan
  -> generated projection
  -> GitHub PR
  -> CI
  -> human merge
  -> Cloudflare Pages
  -> public readback
```

## 現在のbaseline

初回の`public-message.json`は、2026-08-25にrepository ownerが明示承認したコピーを`human_approved_baseline`として記録しています。Graph由来であるとは主張しません。

今後のpromotion candidateは`source.type=brainbase_graph`を必須とし、次を含めます。

- `entity_id`
- 任意の`entity_version`
- `snapshot_hash`
- `exported_at`
- `scope`
- 人間の`approved_by`、`approved_at`、`reason`

schemaは`contracts/public-message-candidate.schema.json`です。

## planとapply

```bash
npm run docs:promotion:plan -- --candidate /path/to/candidate.json
npm run docs:promotion:apply -- --candidate /path/to/candidate.json
```

`plan`は書き込みを行わず、source、approval、変更field、対象file、candidate digestを出力します。

`apply`は次だけを変更できます。

- `docs/publication/public-message.json`
- `docs/publication/history/<candidate_id>.json`
- public-message markerを持つ投影file
- `package.json`のdescription

historyはcreate-onceです。同じcandidateはidempotentですが、同じIDの異内容は拒否します。

## 自動PR

`.github/workflows/public-message-promotion.yml`は、workflow dispatchまたは`brainbase-public-message-candidate` repository dispatchを受け付けます。

入力はpublic copyだけを含むbase64 JSONです。workflowはcandidateを検証し、plan、apply、test、docs build、smokeを行い、review用PRを作ります。直接merge・deployはしません。

## 手修正を禁止する範囲

次のmarker内は生成投影です。

```text
brainbase:public-message:start
brainbase:public-message:end
```

一箇所だけを手修正すると`npm run docs:check`が失敗します。コピー変更はcandidateまたは`public-message.json`から同期してください。
