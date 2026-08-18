---
name: brainbase-onboarding
description: Brainbaseの初回オンボーディングで、接続済みMCP、Google Drive、Gmail、ローカル管理フォルダを起点に、自社の候補世界を証拠付きで立ち上げ、レビューとPromotion Gateを経て最初の有用な回答まで進めるSkill。単一文書はfallbackとして扱う。
---

# Brainbase Connected-world Onboarding

## 目的

利用者に自社情報を再入力させず、すでに仕事が存在する接続先から「Brainbaseが理解した自社の世界」を最初の10分で立ち上げる。10分はsourceがreadyになった時点から測り、OAuthや管理者承認の待ち時間とは分ける。

## Source of Truth

- Story: `docs/stories/story-ten-minute-world-onboarding.md`
- Architecture: `docs/architecture/ten-minute-world-onboarding-architecture.md`
- Spec: `docs/specs/ten-minute-world-onboarding-spec.md`
- Capability: `docs/brainbase-capabilities/capabilities/onboarding.connected-world.yml`

このSkillはホストagentで利用可能なconnectorを編成する。Brainbase serverが、同じホストにある別MCPやapp connectorの接続状態を列挙できるとは仮定しない。

## 必須フロー

1. 利用者が最初に答えてほしい実務上の問いを一つ確定する。
2. 現在のagentで実際に呼べるMCP、Google Drive、Gmail connectorと、利用者が明示したlocal rootを棚卸しする。tool不在、認証失敗、timeoutは`未確認`または固有の失敗状態であり、0件やreadyではない。
3. 各sourceについて認可状態、health確認時刻、evidence参照、選択可能scopeだけをinventory JSONへ記録する。credential、token、本文は記録しない。
4. `node scripts/normalize-onboarding-source-inventory.mjs <inventory.json>` で状態を正規化する。`ready`の自己申告だけでは開始しない。
   - `can_start_warm_path`: readyなMCP / Drive / Gmail / local folderがある時だけtrue
   - `can_start_fallback_path`: 一次sourceがなくreadyな`single_document`がある時だけtrue
   - `can_start_onboarding`: 上記いずれかで安全に開始できる時true
5. 利用者にaccount / server / resource / folder / project / query / date rangeの必要最小scopeを選んでもらう。明示済みの依頼範囲から安全に一意なら、再確認を要求しない。
6. metadata-firstで列挙し、問いに必要な文書またはmessage bodyだけをbounded fetchする。
7. person / org / project / relationship / decision候補を、source pointer、evidence hash、scope、observed/inferred、confidence付きでCandidate Storeへ送る。
8. approve / edit / reject / mergeの人間レビューを行う。未承認候補とinferred edgeはGraph SSOTへ書かない。
9. 承認済み候補だけを既存のPromotion Gateへ渡す。
10. Graph SSOTから改めてcontextを取得して最初の問いへ答える。最初の画面は表や内部状態から始めず、短い箇条書きで `覚えていたこと`、`つながったこと`、`次にできること` の3節をこの順に示す。確認済み事実と未確認事項を混ぜず、entity ID、digest、tool traceなどの技術詳細は求められた時の別表示にする。
11. 回答本文は保存せず、回答hash、使用entity、不足context、`presentation_contract_version=first_value_clarity.v1`、実際に提示した3節をreceiptへ残す。その後、利用者本人の`useful`または`not_useful`を記録する。CLIサンプル、合成ペルソナ、処理時間だけを価値の証拠にしない。

## Connector別境界

- `mcp`: callableなtool/resourceとactorのproject scopeを確認する。MCP接続表示だけをhealth証拠にしない。
- `google_drive`: account、Drive、folder、file metadataを先に見せ、選択文書だけを読む。元ACLを越えない。
- `gmail`: account、query、label、date rangeを固定し、thread metadataを先に読む。全メール本文を初回同期しない。
- `local_folder`: 利用者が明示したrootだけを対象にする。最初は`rg --files <root>`等でmetadataを棚卸しし、`.git`、secret、credential、build output、scope外pathを除外する。
- `single_document`: connectorを使いたくない、または認可待ちの利用者向けfallback。同じevidence/review/promotion境界を通す。

一次sourceが一つでもreadyなら`single_document`を標準経路として推奨しない。別sourceへ自動で切り替えたり、利用者が選んでいない範囲を読んだりしない。

## Failure Semantics

| 状態 | 意味 | 次の動作 |
| --- | --- | --- |
| `waiting_for_authorization` | OAuth、管理者承認、OS権限待ち | 待ち時間を別計測し、希望時のみfallbackを提示 |
| `unavailable` | connector/toolが現在利用不能 | 不在を0件と解釈しない |
| `error` | healthまたは収集失敗 | エラー証拠を残し、勝手に別sourceを読まない |
| `unconfirmed` | evidence、scope、healthのいずれか不足 | `ready`へ進めない |
| `ready` | provider固有scope・認可・妥当なhealth/evidenceが確認済み | source種別に応じwarm/fallbackを分離して開始可否を判定 |

## 完了条件

connector接続、inventory、候補生成、graph表示、CLIサンプルだけでは完了しない。承認済みGraph contextで3節の実用回答を生成し、利用者本人が`useful`または`not_useful`を記録した`first_value_answer_reviewed`だけをオンボーディング完了とする。

## 禁止

- hostに存在しないconnectorや接続状態をBrainbase server内に捏造する
- 認証失敗、timeout、部分取得を空配列へ丸める
- raw本文、credential、token、secretをGraph SSOTまたはinventoryへ保存する
- LLM抽出結果を直接Graph writerへ渡す
- inferred relationをobserved factとして自動昇格する
- 初回回答を表、設定完了、ID一覧、CLIサンプルから始める
- 合成ペルソナや処理時間を利用者本人の価値判定へ置き換える
- production E2E未確認の状態を提供済みと報告する
