# ストーリー: UnsonOS エージェント組織基盤

## 文書メタ情報

- 状態: 有効
- 種別: ストーリー
- 主題: エージェント組織基盤
- 親文書: [UnsonOS 実行基盤と UI](../frames/unson-os-runtime-ui-frame.md)
- 派生元: [UnsonOS 実行基盤と UI](../frames/unson-os-runtime-ui-frame.md)
- 関連文書: [エージェント組織基盤アーキテクチャ](../architecture/unson-os-agent-org-foundation-architecture.md), [エージェント組織基盤仕様](../specs/unson-os-agent-org-foundation-spec.md)
- 置換: なし

## ユーザーストーリー

**誰が**: 複数プロジェクトと複数 AI を同時に回す実務担当兼意思決定者（佐藤）
**何を**: Brainbase 上で、セッション中心の作業管理ではなく、role / agent / task / run 中心で AI 組織を運用したい
**なぜ**: 単発のAI利用や人手でのセッション切り替えだけでは、委譲・承認・監査を伴う継続運用が破綻しやすいから

## 背景

- 現在の Brainbase は実務担当向け操作台として成立している
- session / worktree / task / schedule / MCP を横断して人間が運用する前提は強い
- ただし AI 組織としての role / manager / worker 構造、委譲ルール、承認ゲート、監査ログは正面から扱っていない
- OpenGoat はかなり近い参考実装だが、UnsonOS は Brainbase 拡張として独自に定義する

## 目指す状態

- Brainbase の UI とセッション管理を活かしたまま、AI 組織の実行基盤層を載せられる
- 人間は実務担当 / 承認者 に寄り、低リスク作業は agent が半自律で進める
- run の成否、承認待ち、成果物、失敗理由が追跡できる

## 受け入れ条件

| AC | 内容 | 検証方法 |
|----|------|---------|
| AC1 | Brainbase / OpenGoat / UnsonOS の責務差分が文書内で明確に分かれる | ストーリー冒頭の背景と目指す状態を読んで役割混同がないことを確認 |
| AC2 | v0 の主語が `project/session` ではなく `organization/role/agent/work item/run` に移る | 登場する主要概念が agent 組織中心で統一されていることを確認 |
| AC3 | v0 が semi-autonomous 前提で、人間介入ポイントが明示されている | 承認必須条件と例外時の人間介入条件が書かれていることを確認 |
| AC4 | Brainbase を実務担当向け操作面として残し、置き換え対象にしない方針が明示される | Brainbase 拡張であることがストーリーに明記されていることを確認 |
| AC5 | OpenGoat は参考実装であり、依存前提ではないことが明示される | 採用方針が背景に明記されていることを確認 |
| AC6 | v0 の成功条件として、委譲・実行・承認・監査の最小ループが定義される | 目指す状態と後続仕様の接続が確認できること |

## 優先度

**P0** - UnsonOS の境界を誤ると以後の実装判断が全部ブレるため最優先

## 依存関係

- 既存の Brainbase 実務担当向け操作台
- 既存の session/worktree 管理
- 既存の EventBus / Store / DI Container / Service Layer
- 既存の MCP 連携基盤
