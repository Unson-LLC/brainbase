---
name: brainbase-content-ssot
description: brainbaseのコンテンツをDistribution Modelに沿って配置し、個人原稿・チーム文書・Graph facts・配信状態を混在させないためのSkill。
---

# brainbase-content-ssot

## 境界

コンテンツの正本は一箇所に集約するのではなく、所有者と配布範囲で決める。

| 内容 | 正本 |
|---|---|
| 佐藤個人のSNS原稿・運用資料 | `/Users/ksato/workspace/sns/` |
| 事業・案件のチーム文書 | 対応する `{project}-project.git` |
| 組織横断の運用方針・規約 | 所有するrepoの追跡文書（Brainbase共通運用は `code/brainbase/docs/`） |
| ブランド定義 | Graph SSOT（`entity_type: brand`） |
| ブランド画像・配布アセット | Google Drive（GraphはURLを保持） |
| 人・組織・意思決定・RACI等の事実 | Graph SSOT |
| 配信状態・計測値 | NocoDB等の運用DB |

Brainbase Wiki、`shared/`、`_codex/`、submoduleによる共有方式は廃止済み。新規作成・参照・復活をしない。Brainbaseはコンテンツの保管場所ではなく、正本を検索・取得・実行へ接続するコントロールプレーンとして扱う。

## 佐藤個人のSNS運用

- ルート: `/Users/ksato/workspace/sns/`
- 長文: `sns/drafts/{topic}_{structure|draft|reviewed|final}.md`
- X Article: `sns/drafts/{topic}_x_article.html`
- 短文バッチ: `sns/drafts/batch_YYYY-MM-DD/all_drafts.md`
- 戦略・ガードレール: `sns/sns_strategy_os.md`、`sns/style_guide.md`、`sns/rules.md`、`sns/x_account_profile.md`

noteとX Articleは同じ `{topic}_final.md` を本文正本として使う。NocoDBは原稿本文の正本にせず、状態・配信・計測の運用DBとして扱う。

## 昇格ルール

個人領域の内容を他メンバーへ配る必要が生じた時点で、コピーを増やさず正本を移す。

- 事業固有 → 対応するproject repo
- 組織横断の運用方針・規約 → 所有するrepo（Brainbase共通運用は `code/brainbase/docs/`）
- 事実 → Graph
- 大容量アセット → Drive

移行後の旧ファイルはリンクまたは移行記録だけにし、二重正本を作らない。
