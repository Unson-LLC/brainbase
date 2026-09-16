# WorktreeごとのGraphify影響分析

## Story

開発者として、どのworktreeで実装していても、そのworktreeの現行ソースに対応するGraphify成果物を使って影響範囲を確認したい。main checkoutの成果物を流用せず、実装前の欠落時生成と実装後の一度の更新を標準手順にする。

## Acceptance Criteria

- `--ensure-graph`は対象worktreeに成果物がない場合だけVibePro経由で生成する。
- `--refresh-graph`は対象worktreeの成果物を現行ソースから更新する。
- Graphify未導入・生成失敗・不完全な結果を「影響なし」と扱わない。
- 旧VibeProのmanaged-worktree機構を復活させない。

## Verification

- `npm run test:run -- tests/unit/graphify-impact-context.test.js`
- 対象worktreeで`--refresh-graph`を実行し、`.vibepro/graphify/graph.json`をreadbackする。
