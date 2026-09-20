# 現行Skillsと読み込み元の整合

2026-09-20。前の短縮版がマージ済みでも、Skillの配布リンクが古いcheckoutを指す場合には利用者の作業へ反映されない。現行開発入口の指示の修正と、実際の読み込み元の確認を一つの成果として扱う。

## 修正

- TDD、リファクタリング、設計、セキュリティ: 適用条件、入力・成果、必要な検証を残す。固定モデル・工程数・テスト件数・一律の数値を完了条件にしない。
- Judgment: そのturnのHostとTurnContractを正本にする。Hostが監査を別表示する構成で本文に監査行を再挿入しない。権限・証拠・最終stateの境界は保持する。
- Executor: 現行の利用者指定とツールのworker役割を使う。cc-router固有のaliasは、その経路を明示的に使う場合だけ確認する。
- AGENTS/CLAUDE: Wikiへの移設指示とWiki廃止の矛盾を除く。別作業の分類方針を取り込まず、既存の所有・配布原則だけを残す。
- Jev: 現行入口と版の確認を候補選びの前に行う。dev-ops/dev-shipを通常利用対象として優先した判断を撤回する。削除・再導入は行わない。

## 配布先へ反映するとき

1. 実際のSkillパスとsymlink先、repo・branch・HEAD・dirty/staged状態を確認する。
2. 反映対象と既存dirtyファイルのhash・内容をrepo外へ退避する。秘密値をログやチーム文書へ転載しない。
3. マージ済み対象ファイルと、それに必要な新しい参照資料だけを反映する。開始時hashから変化した対象は上書きしない。branch切替、reset、無関係なstashは行わない。
4. AGENTSのように既存変更がある場合は、既存変更を保った適用結果を先に作り、今回の差分と既存の差分を照合する。解消できない競合は対象を止める。
5. 実読込パスから内容とhash、相対参照先、AGENTS/CLAUDE同一性を確認する。他のdirty/stagedファイルが変わっていないことも確認する。

マージ、ローカル反映、次のtaskでの選択・挙動確認は別の事実として報告する。反映後のdirty差分を勝手にcommit/stash/resetしない。進行中taskへすでに入った古いコンテキストの置換までは保証しない。

## 検証の境界

本文・frontmatter・相対リンク・AGENTSの同一性と行数・差分を確認し、独立レビューを行う。Graphifyが対象Markdownを扱えない場合は影響不明として、直接の参照照合で補う。Jevは修正候補の補助に限定する。実務の品質や速度が改善したかは代表タスクでの別の比較が必要。

[Story](../user_stories/active/story-active-skill-contracts.md) / [Spec](../specs/story-active-skill-contracts-spec.md) / [Jev再チェック](jev-skill-audit.md)
