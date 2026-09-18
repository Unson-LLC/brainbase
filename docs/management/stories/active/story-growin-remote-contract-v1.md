# Story: Growin配備後のMCP契約を検証する

- Story ID: `story-growin-remote-contract-v1`
- Status: active

## 利用者価値

Growin環境の配備後検証で、現在必要なGraphツールとリリース識別子を確認し、廃止済みツールが残る古い配備を成功扱いしない。

## 受入条件

1. MCPの`/health/version`が空でない`git_sha`を返す。
2. `search`、`resolve_entity`、`get_entity`、`list_entities`が公開されている。
3. 廃止済みの`get_context`と`search_wiki`が公開されていない。
4. 既存のテナント分離と会議前データ検証を維持する。

## 対象外

- Growin本番への配備
- ルーティンの外部作用を伴う実行
- ウッディ環境での受入確認
