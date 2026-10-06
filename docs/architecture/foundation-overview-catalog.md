# Foundationの概要を読み取る境界

- Story: [第一段の目的と現状表示](../management/stories/active/story-foundation-display-stage1.md)
- 判断: 既存のFoundation/Graph読取境界の拡張として実装する。新しい正本やDB表を作らない。

## 取得と所有

`GET /api/foundation/catalog?scope_id=<明示した許可プロジェクト>` は、認証済みprincipalと現在ACLの下で、目的・変数・モデル・哲学の最新の不変版を返す。既存の履歴readiness、現在行との整合、scope・digest検証を通す。履歴や接続を確かめられなければ失敗を返し、空の一覧に置き換えない。

`contractVersion: foundation-overview.v1` と `scopeId` を返す。objectives/variables/modelsは既存のFoundation record、philosophiesはPhilosophy revision recordを用いる。目的の補足 `details` は不変版payloadの表示項目（title、criteria_text、beneficiary_description、evaluation_period_note、evaluator_note、current_state）だけを投影する。現在行から補足を合成しない。

この入口はGETだけを許可し、scope_id以外のqueryや重複指定を断る。認証と接続はホストが所有し、読取検証と表示部品はOSSが所有する。部品は `createFoundationOverview({root, document, scopeId, port})` で明示されたscopeだけを読む。会社名やscopeを推測しない。

## 表示と失敗

目的→記録上の現状・未確認事項→哲学→世界モデルの順に表示する。目的の評価基準は指定された変数の版に一致するときだけ定義を示す。未設定、参照未解決、草案、認識上の状態、検証状態、許可された用途をそれぞれ区別する。登録済みを達成済み・検証済みへ読み替えない。

現状は保存時点の記述であり、今の実績を証明しない。今回は観測値・実績・判断記録を取得しない。取得失敗とschema/scope不一致は確認不能として表示する。scope変更やdestroy後の遅延応答を画面へ反映しない。

## 導入と復帰

組織版は既存BFFで本人のbearerのまま中継し、固定したOSSの部品を配信する。公開版の依存規則（npmの正確なversionとintegrity）は維持する。導入はOSSの公開と組織版のpin更新を別に検証し、本番配備は別の承認と稼働確認を必要とする。復帰は組織版の前のpinと画面構成へ戻す。DB migrationは不要。
