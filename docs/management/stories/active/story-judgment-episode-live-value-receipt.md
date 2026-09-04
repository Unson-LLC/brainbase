# Story: 新規Codexタスクで判断価値レシートを表示する

## 利用者価値

Brainbase利用者として、新しく開始したCodexタスクでもBrainbaseが人間への不要な確認を止め、仕事を進めた結果を完了直後の判断レシートで確認したい。これにより、実装済みという説明ではなく、実際に何を聞かずに何が進んだかで価値を判断できる。

## 再現済みの問題

2026-09-02に新規Codexタスクで実証したところ、Codex Appの`agent_created_thread`では初回依頼が`create_thread`の`function_call_output`として記録され、`UserPromptSubmit`が発火しなかった。Stopは`judgment_episode_not_found`と`episode_candidate_count: 0`を記録し、不要な確認の差し戻しも`Brainbase判断レシート`の表示も発生しなかった。

2026-09-04の再実証ではepisode復元と不要確認の差し戻しまでは動作したが、Codex Desktopが継続後のStopを再送しなかったためfinalと判断レシートが未確定になった。またPostToolUse payloadだけではDesktopの`fileChange`と正本読戻しの対象が欠落し、成果確認済みvalue proofへ結合できなかった。

## 受け入れ基準

- [ ] AC-001: 新規Codex委任タスクで`UserPromptSubmit`が発火しなくても、最初のStopが同じsession_idとturn_idに紐づくjudgment episodeを正確に1件開始し、`post_generation_recovery`と記録する。
- [ ] AC-002: 現在turnの`create_thread`または`send_message_to_thread`が残した正規の`codex_delegation`入力だけを復元し、別turn・別tool・別session component・壊れた包みは採用しない。
- [ ] AC-003: episode開始に必要な入力が本当に欠ける場合は、黙って成功させず原因を特定できる監査結果を残す。
- [ ] AC-004: 不要な確認をHostが差し戻したfresh taskで、同一質問に束縛された`Brainbase判断レシート`が最終assistant回答の監査ブロックに1回表示され、Stopがその実回答を検証する。
- [ ] AC-005: 通常続行、人間判断、既存の監査fail-closed契約を弱めない。
- [ ] AC-006: PR前受入はunitとHost entrypoint integrationの同一HEAD証拠で判定する。Story全体と本番releaseは、merge後のtarget SHAを4面へ反映したfresh Codex taskの同一run証拠が揃うまで完了としない。
- [ ] AC-007: runtime 2.4 continuationでも`completed` state PostToolUseは状態証拠を記録するだけとし、後続Stopだけが実回答の監査ブロックを検証してcomplete finalを確定する。
- [ ] AC-008: Desktopの`thread_items`を同一session_id、turn_id、tool_use_idで照合し、完了済み`fileChange`の成果物と単一`read`の正本読戻しだけをvalue proof証拠へ結合する。

## 制約

Codex App本体はこのリポジトリの変更対象外であり、委任turnのmodel生成前に`UserPromptSubmit`を追加できない。そのため本StoryではStop hookを最初の強制境界として使い、初回の不要確認をユーザーへ確定表示する前に差し戻す。復元routeは差し戻し以降だけを支配し、すでに生成された初回回答を事前に導いたとは主張しない。通常のuser turnや復元不能な孤児Stopを成功へ丸めない。

runtime 2.4 continuationでも、最後の正常な`completed` state PostToolUseは確定に必要な状態証拠として扱う。finalの確定境界は後続Stopだけであり、Stopが届かない場合をowner表示成功へ丸めない。

## 対象外

- Slack、Mana、Webの表示Adapter
- 判断レシートのSchemaやCore Rendererの再設計
- Canonical Task mutationの`persisted_readiness_mismatch`修正
