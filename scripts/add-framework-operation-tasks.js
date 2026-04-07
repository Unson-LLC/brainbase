// フレームワーク運用タスクをNoCoDB brainbase タスクテーブルに一括登録
// Usage: node scripts/add-framework-operation-tasks.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const BRAINBASE_TASK_TABLE_ID = 'm7iys8m7o1abr3f';

const TASKS = [
    // P0: 運用ガイド・SOP整備
    {
        title: "Event記録ガイド作成",
        description: "Decision/Work/Ship/Learnをどう記録するか、具体例を含めたガイドライン作成。\n\n含むべき内容:\n- 各Eventタイプの定義と例\n- 記録頻度（最低1日1Event推奨）\n- NoCoDB vs wiki使い分け\n- Slack連携方法",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "ポータル確認フロー定義",
        description: "朝の15分ルーティンとして、ポータルで何を確認すべきか手順化。\n\n含むべき内容:\n- Frame確認（方向性ズレチェック）\n- StoryMap確認（進捗・期限チェック）\n- ValueLoop確認（昨日の実績確認）\n- Events確認（最新動向把握）",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "週次ストーリー進捗更新手順書",
        description: "金曜午後30分ルーティンとして、NoCoDB「ストーリー」進捗率更新手順。\n\n含むべき内容:\n- 進捗率計算方法（criteria達成度ベース）\n- ステータス遷移判断基準\n- 遅延時の対応フロー\n- mana M9レポート活用",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "mana M9チェック活用ガイド",
        description: "週次マイルストーンチェック（M9）をどう経営判断に活かすか。\n\n含むべき内容:\n- M9レポート読み方\n- 遅延検知時のアクション\n- GM/CTOへのエスカレーション基準",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "月次ストーリー見直し会議テンプレート",
        description: "月次でStoriesを見直す会議アジェンダテンプレート。\n\n含むべき内容:\n- 各Storyの進捗率レビュー\n- criteria達成度確認\n- 次月アクションプラン\n- 必要なピボット判断",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "四半期フレーム適合性チェックフロー",
        description: "四半期でFrameとの整合性を確認するフロー定義。\n\n含むべき内容:\n- WHO/WHAT/HOW変化チェック\n- Story方向性適合性確認\n- 戦略ピボット判断基準\n- 次四半期Story策定",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    // P0: NoCoDB入力ルール明確化
    {
        title: "NoCoDB入力ルール文書化",
        description: "「ストーリー」テーブルへの入力必須項目・ルール明文化。\n\n含むべき内容:\n- story_id必須（wiki stories.mdと一致）\n- ステータス遷移ルール（draft→active→completed→archived）\n- 進捗率更新頻度（週次必須）\n- 期限設定ルール（quarter=3ヶ月、month=1ヶ月）\n- horizon/view/period必須",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    // P1: 経営ダッシュボード・レポート自動化
    {
        title: "週次全PJ進捗率サマリー自動化（mana M7/M8拡張）",
        description: "全プロジェクトのストーリー進捗率を週次で自動集計・Slack通知。\n\n技術:\n- mana M7（Executive Dashboard）拡張\n- NoCoDB「ストーリー」テーブル全PJ集計\n- Slack DM自動送信",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "月次OKR達成率レポート自動生成",
        description: "各StoryのciteriaチェックベースでOKR達成率を自動計算。\n\n技術:\n- wiki stories.md criteria解析\n- commit/signal達成度判定\n- レポートMarkdown生成→Slack投稿",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "Slack遅延アラート・達成祝福自動通知",
        description: "進捗遅延時の自動アラート、Story完了時の祝福メッセージ。\n\n通知条件:\n- 期限超過Story検知→GM/CTO/担当者へDM\n- 進捗率3週連続20%未満→エスカレーション\n- Story completed→チームチャンネルへ祝福",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    // P1: アラート・リマインダー設定
    {
        title: "進捗率低下早期警告システム（mana拡張）",
        description: "週次で進捗率20%未満のStoryを検知し早期アラート。\n\n技術:\n- mana M9拡張\n- 進捗率履歴トラッキング\n- 3週連続低下→GM/CTOエスカレーション",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "story_id未紐付けマイルストーン検知スクリプト",
        description: "NoCoDB「ストーリー」でstory_idが空のレコードを検知・通知。\n\n技術:\n- 日次cron（mana M1拡張）\n- 全11PJチェック\n- Slack通知",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    // P2: チーム向けオンボーディング
    {
        title: "フレームワーク説明スライド・オンボーディング資料作成",
        description: "新メンバー向けFrame/Story/Event概念説明スライド + ポータル使い方動画（5分）+ NoCoDB入力チュートリアル（Loom）\n\n含むべき内容:\n- Frame/Story/Eventとは何か\n- なぜこのフレームワークを使うのか\n- ポータル操作デモ\n- NoCoDB入力手順\n- 1週間オンボーディングチェックリスト",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    }
];

let JWT_TOKEN = null;

async function signin() {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v1/auth/user/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!response.ok) {
        throw new Error(`Signin failed: ${response.status}`);
    }
    const data = await response.json();
    JWT_TOKEN = data.token;
}

async function createTask(task) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${BRAINBASE_TASK_TABLE_ID}/records`, {
        method: 'POST',
        headers: {
            'xc-auth': JWT_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            'タイトル': task.title,
            '説明': task.description,
            'ステータス': task.status,
            '優先度': task.priority,
            'プロジェクト': task.project
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to create task: ${response.status} ${body}`);
    }

    return response.json();
}

async function main() {
    console.log('=== フレームワーク運用タスク一括登録 ===');
    console.log(`NocoDB: ${NOCODB_BASE_URL}`);
    console.log(`Tasks: ${TASKS.length}\n`);

    console.log('Signing in...');
    await signin();
    console.log('✓ Authenticated\n');

    let created = 0;
    for (const task of TASKS) {
        try {
            await createTask(task);
            console.log(`✓ [${task.priority}] ${task.title}`);
            created++;
        } catch (error) {
            console.error(`✗ ${task.title}: ${error.message}`);
        }
    }

    console.log(`\n=== 完了: ${created}/${TASKS.length}件登録 ===`);
}

main().catch(console.error);
