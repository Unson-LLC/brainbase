export type OperationalizationTarget = 'codex' | 'claude' | 'codecode' | 'agent';

export interface OperationalizationAction {
  id: 'public-skills' | 'routines' | 'mcp-config' | 'source-allowlist' | 'verification';
  title: string;
  status: 'pending';
  command: string;
  why: string;
  safety: string;
}

export interface OperationalizationPlan {
  goal: string;
  completed: string[];
  pending: OperationalizationAction[];
  recommendedOrder: string[];
  safetyRules: string[];
  completionCheck: string[];
}

export interface OperationalizationPlanInput {
  target?: OperationalizationTarget;
  dataDir?: string;
  cwd?: string;
  firstValueReady?: boolean;
}

export function buildOperationalizationPlan(input: OperationalizationPlanInput = {}): OperationalizationPlan {
  const target = input.target ?? 'agent';
  const dataDir = input.dataDir ?? '<personal-os-dir>';
  const cwd = input.cwd ?? '<brainbase-checkout>';
  const installTarget = target === 'agent' ? '<agent>' : target;
  const skillsTarget = target === 'claude' ? 'claude' : target === 'codex' ? 'codex' : 'portable';
  const routinesTarget = target === 'claude' ? 'claude' : 'codex';

  return {
    goal: '初回価値を確認した後、必要な運用設定だけを順に完了する。',
    completed: input.firstValueReady
      ? [
        '承認した最小文脈をローカルへ保存済み。',
        'doctorで初回価値デモの準備完了を確認可能。',
        'onboard:demoでプロンプト、サンプル結果、価値の説明を確認済み。'
      ]
      : [
        'Personal OSの準備を開始済み。'
      ],
    pending: [
      {
        id: 'public-skills',
        title: '公開Brainbaseオンボーディングスキルを配置する',
        status: 'pending',
        command: `brainbase onboard:skills --target ${skillsTarget}`,
        why: 'エージェントが実行環境で、オンボーディング、参照元取込、候補レビュー、日次ルーティンの手順を使えるようにします。',
        safety: '標準はプレビューです。明示的な --out 指定時だけ書き込み、既存のSKILL.mdを上書きしません。'
      },
      {
        id: 'routines',
        title: 'ohayo / oyasumi / retroルーティンを登録する',
        status: 'pending',
        command: `brainbase onboard:routines --target ${routinesTarget} --cwd ${commandArg(cwd)}`,
        why: '朝、終業時、週次振り返りの予定を登録して初めて運用ループが動きます。',
        safety: '最初は一時停止または確認付きで登録します。定義生成だけではスケジュール済みになりません。'
      },
      {
        id: 'mcp-config',
        title: 'Brainbase MCP設定を実際のエージェント設定へ反映する',
        status: 'pending',
        command: `brainbase onboard:install --target ${installTarget} --dir ${commandArg(dataDir)} --dry-run`,
        why: 'プレビューは設定形式の確認に留まり、実設定を更新するまでエージェントはBrainbaseを呼べません。',
        safety: 'プレビュー確認後、利用者の承認を得て実設定へ反映し、対象エージェントを再起動します。'
      },
      {
        id: 'source-allowlist',
        title: '参照許可範囲、取込、候補レビューを決める',
        status: 'pending',
        command: 'brainbase onboard:diagnose-sources --email <provider> --calendar <provider> --drive <provider> --drive-folder <folder-id> --tasks <tool>',
        why: 'メール、カレンダー、ドライブ、ファイル、タスクは任意の追加参照元であり、取込前に明示的な許可範囲が必要です。',
        safety: '取込素材はsources/に置き、レビュー済み候補だけを承認済みローカル記憶へ昇格します。'
      },
      {
        id: 'verification',
        title: 'doctorとMCP get_context / searchで確認する',
        status: 'pending',
        command: `brainbase doctor --dir ${commandArg(dataDir)}`,
        why: '新しいエージェントセッションでdoctorとMCPツールが承認済み文脈を示して初めて運用可能です。',
        safety: 'コマンド生成だけで完了扱いせず、設定反映後にget_context/searchを確認します。'
      }
    ],
    recommendedOrder: [
      '対象エージェントへ公開スキルを配置する。',
      'ohayo / oyasumi / retroを生成し、一時停止または確認付きで登録する。',
      'Brainbase MCP設定を実際のCodex / Claude / CodeCode設定へ反映し、エージェントを再起動する。',
      '追加文脈が必要な場合だけ参照許可範囲を決め、取込と候補レビューを行う。',
      'doctorを実行し、新しいエージェントセッションでMCP get_contextとsearchを確認する。'
    ],
    safetyRules: [
      '利用者の承認なしに実設定、スケジュール、正本ファクトを書き込みません。',
      '生成したスキル、ルーティン、MCPプレビューをインストール完了扱いしません。',
      'OAuthトークン、パスワード、APIキー、更新トークンをチャットへ貼るよう求めません。',
      '参照元の取込はローカル優先とし、正本化前にレビューします。'
    ],
    completionCheck: [
      '利用者が初回価値の出力を確認済み。',
      '完了報告に残っている運用設定をすべて記載済み。',
      '実設定反映後、対象エージェントからBrainbase MCP get_context/searchを呼び出せる。',
      '参照許可範囲と候補レビューを完了、または明示的に延期済み。'
    ]
  };
}

function commandArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
