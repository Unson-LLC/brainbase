# Graphify軽量参照

Story: `docs/management/stories/story-graphify-default-impact.md`

- Manifestに実装専用のengineering DAGを定義し、observe → graphify-impact → hypothesisの順序とする。既存engineering DAGは非実装で維持する。
- graphify-impactは対象repoと変更対象を確定して軽量なCLIを呼ぶ実行指示。インストール済みなら規模で省略しない。通常のコード・テスト確認を置き換えない。
- CLIは既存graphを対象ファイルで限定して読み、直接隣接するノードを上限付きで返す。自動のインストール、全体再生成、LLM呼び出しはしない。
- CLIの再利用キーは対象repo、対象ファイル集合、対象ソース状態、graph内容。ソースの変更では無効化する。キャッシュはrepo外の一時領域に置く。
- 導入なし・graphなし・一致なし・不正graph・鮮度不明を個別に返す。内容ハッシュ等の証拠がないgraphを最新と断定しない。
- 不足時は必要な更新・コード確認を選び、同条件の反復呼び出しや毎回の再生成を要求しない。

検証: Resolverで実装のみ選択されること、順序・既存契約・manifest lock、CLIで再利用と無効化・欠測・部分範囲を検証する。
