---
layout: home

hero:
  name: Brainbase
  text: 自分の仕事文脈をAIに渡すためのMCPマニュアル
  tagline: Brainbaseは、自分・仕事・関係性の文脈をローカルSSOTとして育て、CodexやClaude Codeがその文脈を参照しながら作業できるようにするPersonal Onboarding Kitです。
  image:
    src: /assets/brainbase-hero.webp
    alt: 仕事の文脈をBrainbaseに整理し、AIエージェントへ渡す流れ
  actions:
    - theme: brand
      text: 10分で試す
      link: /guide/quick-start
    - theme: alt
      text: 導入の流れを見る
      link: /guide/onboarding-process

features:
  - title: ひとつの実用場面から始める
    details: すべてのデータをつなぐ前に、AIへ説明し直したくない仕事をひとつ選びます。
  - title: プロジェクトを中心に整理する
    details: 目的、関係者、関係性、判断基準、決定事項を、仕事のまとまりごとに整理します。
  - title: 人が確認してから記録する
    details: AIは確認用の下書きを作り、承認された情報だけを今後の前提として残します。
  - title: AIの判断根拠を毎回確認できる
    details: 今の質問か、直前のどの依頼を参照し、どのように判断したかを、返答の先頭に短く表示します。
---

## このマニュアルの位置づけ

このサイトは、Brainbaseを初めて導入する人向けの入口です。

迷わず始めたい場合は、[10分で試すためのチェックリスト](/guide/quick-start)を開いてください。途中で中断しても、同じページの「中断したらここから再開」から現在地を確認できます。

内部設計資料や開発者向けの仕様書ではなく、まず「AIに二度と説明したくない文脈」をどのように整理し、MCP経由でCodexやClaude Codeに渡すかを説明します。

Brainbase v1の中心は、ローカルに自分の仕事の正本を作り、MCPとオンボーディングCLIでAIエージェントへ渡すことです。サーバー運用やUIは前提にしません。

導入は、準備、仕事の前提、最初の価値、必要な情報源、運用開始の5フェーズで進めます。最初からすべてのメールやファイルを取り込む必要はありません。
