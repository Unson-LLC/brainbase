---
layout: home

hero:
  name: Brainbase
  text: 自分の仕事文脈をAIに渡すためのMCPマニュアル
  tagline: Brainbaseは、自分・仕事・関係性の文脈をローカルSSOTとして育て、CodexやClaude Codeがその文脈を参照しながら作業できるようにするPersonal Onboarding Kitです。
  actions:
    - theme: brand
      text: 最初の導入を始める
      link: /guide/getting-started
    - theme: alt
      text: Brainbaseとは
      link: /guide/what-is-brainbase
    - theme: alt
      text: MCPツールを見る
      link: /reference/mcp-tools

features:
  - title: 説明し直しを減らす
    details: 仕事の前提、関係者、プロジェクト、判断基準をAIが毎回参照できる形に置きます。
  - title: 正本と候補を分ける
    details: メールやメモから得た情報をすぐ正本化せず、確認してから昇格する運用を前提にします。
  - title: CodexやClaude Codeから呼び出す
    details: Brainbase MCPを登録すると、エージェントが必要な文脈を検索しながら作業できます。
---

## このマニュアルの位置づけ

このサイトは、Brainbaseを初めて導入する人向けの入口です。

内部設計資料や開発者向けの仕様書ではなく、まず「AIに二度と説明したくない文脈」をどのように整理し、MCP経由でCodexやClaude Codeに渡すかを説明します。

Brainbase v1の中心は、ローカルの個人SSOTを作り、MCP toolsとオンボーディングCLIでAIエージェントへ渡すことです。サーバー運用やUIは前提にしません。
