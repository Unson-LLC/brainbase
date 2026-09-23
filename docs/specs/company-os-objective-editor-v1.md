# Spec: Objective共通編集UIとFoundation HTTP境界

## 目的

`story-company-os-objective-editor-v1` の共通UIについて、Objectiveの正本・版・判断利用可否を同じ画面で確認し、許可された作成・改訂だけを行える最小契約を定める。画面は組織のメンバー・RACI・承認規則やデータベースを所有しない。

## 境界

- `ui/objective-editor.js` と `ui/objective-editor.css` はブラウザで直接利用できるOSSモジュールである。
- UIは `ObjectiveEditorPort` 相当の関数、trusted context、DOM rootをホストから受け取る。認証token、tenant、scope、ACLはフォームから受け取らない。
- `src/foundation-http.ts` はFetch `Request`/`Response` のroute handlerを提供する。TCP listenerを起動せず、`createFoundationHttpRouter`にObjective・Reservation・Decision等のrouteを合成できる。
- contextはホストの `resolveContext(request)` が解決する。未解決なら401、bodyに含まれるprincipal・tenant・scope・ACL等は拒否する。
- POST/PUT/PATCH/DELETEはrouterのCSRF verifierが必須。未設定は501、失敗は403とする。
- 正本の保存・認可・版生成・readbackは `CompanyOsObjectives` と `FoundationRevisionStore` に委譲する。UIやHTTP handlerはsidecarやBFF DBへ書き込まない。

## HTTP契約

共通prefixは `/api/foundation` とする。

| Method | Path | 役割 |
| --- | --- | --- |
| GET | `/objectives` | Objectiveの最新revision一覧 |
| POST | `/objectives` | Objective revision 1の作成 |
| GET | `/objectives/:id` | 指定revisionまたは最新revisionの読出し |
| PUT | `/objectives/:id` | `expectedRevision`または`If-Match`を使うCAS改訂 |
| GET | `/objectives/:id/readiness` | 保存内容から判断利用可否を再検証 |
| GET/PUT | `/objectives/:id/constraints` | typed Constraint revision参照の読出し・置換 |
| GET | `/stories/:id/objectives` | 既存Story→Objective typed relationの読出し |

POST/PUTのbodyはObjectiveの意味・望ましい状態・beneficiary・criteria・評価期間などのドメイン提案だけを受ける。ACL、scope、storage、provenance、authorizedUses、principal、tenant、role、permissionなどのauthority fieldをbodyに含めた場合は400で拒否する。write adapterの `buildDefinition` がtrusted contextから完全な定義を組み立て、HTTP handlerはupdate時にauthority/provenanceの変更も拒否する。

PUTはCAS値を省略できない。`expectedRevision`/`expected_revision` または `If-Match` がなければ400とする。storeが版競合を返した場合は409を返し、リトライや自動上書きをしない。保存レスポンスは `saved_unverified` とし、クライアントが同じID・返却revisionを読戻して検証する。

一覧やrelationの返却は、空配列と応答欠損を区別する。欠損・未提供・権限不足を空や成功へ変換しない。

## UI契約

- Objectiveの `meaning`、`desiredState`、beneficiary、criteria、評価期間、既存の採用状態を編集できる。
- criteriaはVariableの明示revisionを持つ。Variableの最新revisionへ暗黙追随しない。
- readinessを `判断に利用可能`、`下書き`、`未確認` と区別する。readyは保存成功や観測値の存在を意味しない。
- constraintはID・revisionのtyped referenceとして編集する。Constraint本文や組織の承認画面を複製しない。
- Story参照は既存の `contributes_to`、`execution_depends_on`、`time_condition` を表示し、Story本文をObjectiveへコピーしない。
- mutation後は返却referenceの同一ID・新revisionをreadbackする。readback不一致は `保存済み・未確認` とし、verifiedへ昇格しない。
- 409では入力中のdraftを保持し、現在revisionを表示する。自動再試行・上書きはしない。
- `permission_denied`、`api_unavailable`、`missing`、`conflict` を個別表示する。未知・部分応答を `0件` や成功と表示しない。

## 組織版の合成

組織版はOSS UIをimportし、独自shell、context resolver、CSRF verifier、Foundation adapter、Story/Constraint providerを注入する。組織のmember・RACI・承認規則は組織側で所有する。Foundation HTTP routeは同じlocal serverのrouterへ追加し、Objective専用listenerや独自UI SSOTを作らない。

Reservationなど既存のNode HTTP adapterが、`(IncomingMessage, ServerResponse, trustedContext) => Promise<boolean>` のようにリクエストを引き受ける契約を持つ場合も、同じlocal serverの小さいcomposition hostで共存させる。hostは一度だけtrusted context（tenant、principal、scope）を解決し、Reservation handlerへ渡す。Reservationのmutationはhandlerが`serviceFactory`と`MutationOrigin`検証を通してから実行する。Objective側はNode requestをFetch `Request`へ変換して`createFoundationHttpRouter().handle()`へ渡し、`Response`をNode responseへ書き戻す。各handlerが自分のprefixを所有し、`boolean`の未処理結果またはHTTP route matchで次のhandlerへ進むため、別port・別listener・独自の認証境界を増やさない。

```text
local server
  └─ resolveTrustedContext(request)
       ├─ reservationHandler(nodeReq, nodeRes, context)
       │    └─ serviceFactory(context) + verified MutationOrigin
       └─ foundationRouter.handle(fetchReq)
            └─ Objective route + CSRF verifier + canonical FoundationStore
```

このComposition Hostは製品固有の認証・tenant選択をOSSへ移す場所ではない。OSSが提供するのは、ObjectiveのFetch route handlerと、Node/Fetchの変換位置を明示できるroute契約である。Reservation実装をこのSpecへimportせず、上記の互換signatureを満たすadapterとして同居させる。

## 検証

- UIのnormalize/controllerテストはfixtureで、state区別・同一ID/new revision readback・409上書き禁止を確認する。
- HTTPテストはtrusted context、CSRF、body authority拒否、CAS必須、409変換、future route合成を確認する。
- 実storeの既存Foundationテストで、revision生成とcanonical readbackを確認する。fixture UIの成功を永続化の成功とは扱わない。
