# プロジェクト知識画面の表示契約

既存GraphProjectDetailのproject、participants、relations、source、asOfを読み、概要と情報探索を構成する。関連対象はIDで統合し、関係は方向と出典を維持する。未知の型・関係は元のラベルで表示する。decisionを未決と推測しない。goalの未記入を完了・目的なしと解釈しない。

Sigma.jsとgraphologyをバンドルしてui配下で配信する。mountProjectGraphはnodes/edges/onSelectを受け、destroyでイベントとWebGL資源を解放する。選択時に隣接関係を強調し、図の外でも同じ情報を読める。存在しない端点から架空のノードを作らない。

Graph APIは読み取り、訂正権限は既存createGraphProjectsViewで維持する。個人情報の組織送信・新たな正本・業務固有型の強制は行わない。

検証対象: project-workspaceの投影と未知情報、Graph UIの既存訂正・読取権限、ローカルホストの静的資産配信、組織版の共通UIマウント、Sigma.js実ブラウザ表示。

## 段階的読み込みの表示契約

- `renderProjectKnowledgeSkeleton` は、`state=ok` かつ実データの項目がある補足セクションを、目的・関係者・判断・関連情報のスケルトンより前に置く。取得済みの項目がないセクションは、個別の読み込み・未接続・読み取り失敗としてスケルトンの後に残す。
- Graph詳細が取得できた後の概要は、目的・関係者の `bb-pkw-columns` の直後に補足情報を置き、その後に判断と関連情報を置く。これにより、先に到着したタスクなどの実データが大きな一覧の後ろへ移動しない。
- 補足情報の更新は既存のDOMブロックを置き換える。Graphのcanvas、タブ、選択状態を再生成せず、取得失敗は失敗表示として残す。スクロール位置を強制せず、未取得の値や件数を推測して表示しない。
