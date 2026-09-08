# 継続依頼のResolver結果を同一ターンへ確実に記録する

## 利用者価値

Resolverが返した判断契約をHookが失わず、確認が必要な場合も本当の不足情報を一度で伝える。呼び出し済みなのに「モデル未呼び出し」として再実行を要求しない。

## 受入条件

- AC-1: 同一ターンに束縛された正規の `needs_classification` 契約を記録し、Resolver呼び出しの実施と分類完了を区別する。
- AC-2: 有効契約と所有者向け監査は実際の不足理由を使い、bootstrapの `model_interpretation_missing` に戻さない。
- AC-3: 別ターン・異なる入力digest・不正な状態形状は受理しない。確認が必要な契約を実行許可へ昇格しない。
- AC-4: 実サービスの返却契約をHookへ渡す結合テストで境界を検証する。

## 調査と判断

最新の基準は origin/develop の 354c5c97e。直近の監査取得順序・本文再生成防止の修正後にも、Hostの `judgmentTurnResolutionData` は `resolved` と非null分類だけを受理していた。サービスとMCPは `needs_classification`・null分類を正規の契約として返す。この不一致により、PostToolUseはイベント保存前の束縛検証で失敗し、初期契約が残る。

報告対象タスクの生レスポンスでも、transportはcompleted、外側はok、内側はneeds_classification・knowledge_project_code_missing・project_code=nullだった。保存済み入力と応答を隔離fixtureへコピーした再現では `judgment_turn_resolution_binding_invalid` を確認した。実journalにはResolverイベントがなく、audit_readのignoredイベントだけが残っていた。利用者の会話・実journalを成果物に転載せず、この境界の検証済み事実だけを残す。

なぜ古い理由になるか: 有効契約への更新がないため。なぜ更新がないか: 記録前に束縛不正となるため。なぜ束縛不正か: 正規の分類保留契約をパーサーが除外していたため。

修正は返却契約の受理境界に限定する。プロジェクト未設定のタスクで会話中の名前から権限境界を推測する変更は行わない。プロジェクト不足そのものとHookによる理由の消失は別問題として扱う。

対象はagent_created_threadで、読める子タスクのraw rolloutには親の依頼・委譲文がuser本文として存在しなかった。Hostが除外したのは注入envelopeであり、利用者本文の抽出漏れとは確認されなかった。別のCodex内部履歴の有無は未確認。注入情報を利用者発言へ混ぜる変更はしない。

## 前提と検証範囲

- 元の作業場所は未解決マージがあるため変更せず、外付けディスクの独立作業場所を使用。
- Node.js 22.23.2と独立した依存関係で対象テストを実行する。テストは一時journalを使い、利用者の実journalを書き換えない。
- コードグラフの対象検索はmissing_graph、影響範囲・鮮度はunknown。呼び出し元・サービス・MCP・テストを直接確認。
- ローカル結合テストと稼働環境の新規タスクE2Eは別に扱う。後者を未実施のまま成功とはしない。

## 修正

Hostの受理対象を、サービスとMCPが返す3状態（resolved / needs_classification / needs_policy_resolution）へそろえる。分類保留はnull分類と実理由を検証し、Hostの既存turn_id・request_digest・context_digest検証を通す。新たに受け入れる保留契約には自律実行判断の必須検証を適用する。MCP側のmanaged binding検証は変更しない。

Resolverイベントのsuccessは「有効な判断契約を受信した」を表す。実行許可ではない。契約は既存のturn_contractに保存し、effectiveEpisodeを通じて監査とStopが使う。追加確認はescalateのまま保持する。別の保留状態管理やResolver再呼び出し経路は増やさない。

Hookのモデル向け説明文も状態別に分ける。resolvedでは古い確認要求を取り除き、保留契約では現在の不足情報・方針衝突に関する質問を保持する。これにより「確認を消す」と「確認する」が同じ応答に混在しない。

## VibeProの扱い

Storyと2条項のSpecをVibeProへ記録した。CLIのfinal保存には廃止済みreadiness要求が残るため、検証済みdraft.jsonを本変更のSpecとして残す。旧ゲートを復活させず、対象テスト・独立レビュー1波・通常のGitHub PRで引き渡す。個人絶対パスを含むCLIの診断出力は共有成果物へ転載しない。

CLIのverify recordはREDを保存できたが、GREENのintegration登録ではこのリポジトリの標準test:runコマンドを認識せず拒否した。テスト実行自体の失敗ではない。認識器に合わせた別コマンドへ偽装せず、実行結果を検証記録へ残す。
