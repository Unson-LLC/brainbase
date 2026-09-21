# 個人基盤 v1 コア

## ストーリー

OSS版のBrainbaseを使う人として、個人の知識を一つの永続的なローカル所有者で管理し、組織クライアントと同じ登録・検索契約を使いたい。将来SlackやCodexを接続したときにも、自分のデータが別のコンテキストと暗黙に混ざらないようにするためである。

## 要件の出典

- 契約: `docs/architecture/personal-foundation-v1.md`
- 仕様: `docs/specs/personal-foundation-v1-core-spec.md`
- 実装: `src/personal-knowledge.ts`

## 受入条件

- 厳密なコンテキストは `contract_version`、`scope`、`owner_person_id`、`organization_id`、`source_id` の5フィールドだけを持つ。個人所有と組織内本人専用のコンテキストは、それぞれの `organization_id` 規則に従う。
- 登録・検索クライアントは期待するコンテキストを `X-Brainbase-Personal-Context` に設定し、書込みが受け付けられる前に不正または不一致のコンテキストを拒否する。
- OSSのローカル保存は、解決したPersonal OSディレクトリの下に独立した `personal-knowledge-v1` ディレクトリを作成し、所有者と `source_id` の識別情報を永続化する。組織やHTTP待受を必要としない。
- 同じ `event_id` と正規化後の内容を同時に登録した場合、すべての呼出しが一つの永続イベントに収束する。同じIDで内容が異なる登録は失敗する。
- managed clientは接続先と認証を検証し、リダイレクトと通信失敗を拒否し、ローカル保存へフォールバックしない。
- MCPは明示的なcontext/register/searchツールを提供し、モデルが制御する引数から所有者、組織、source、ファイルシステムのパスを受け付けない。
- managed_cloudのMCPセッションは `personal_knowledge_context`、`personal_knowledge_register`、`personal_knowledge_search` だけを広告・実行し、既存のローカルPersonal OSツールを広告せず、呼び出しも拒否する。組織Graphなど別の組織機能は別MCPで提供する。localモードの既存ツールと `search_personal_kg` の互換性は維持する。
- 既存の `search_personal_kg` ツールと、そのローカルPersonal KGの動作は変更せず利用できる。

## 対象外

- 既存の `personal-kg.jsonl` データの移行や再分類は行わない。
- 共有・昇格・削除の知識APIは追加しない。
- OSS版パッケージにWebログインや組織管理UIは追加しない。
