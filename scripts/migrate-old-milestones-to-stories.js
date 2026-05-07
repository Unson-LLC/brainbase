// 旧マイルストーン形式レコードをStory形式に移行
// Usage: node scripts/migrate-old-milestones-to-stories.js [--dry-run] [--project=<code>]

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const PROJECTS = [
    { code: 'baao', tableId: 'mm6b4dlz6w2wnnj' },
    { code: 'dialogai', tableId: 'mqjcl7pechscy1y' },
    { code: 'ncom', tableId: 'mvu6jwaq67j2god' },
    { code: 'salestailor', tableId: 'mmljchzw0wnzg7z' },
    { code: 'senrigan', tableId: 'ml9wn9die5f5jap' },
    { code: 'mywa', tableId: 'mvsil7ns45x5h8z' },
    { code: 'zeims', tableId: 'mmbujavunaxsfdl' },
    { code: 'back_office', tableId: 'm12o5wttp2v98zl' },
    { code: 'brainbase', tableId: 'ml7hpqcvv3v8dms' },
    { code: 'techknight', tableId: 'mqzhsliq8xiavvy' },
    { code: 'vibepro', tableId: 'mjpg80jobkjo8lz' }
];

let JWT_TOKEN = null;

async function signin() {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v1/auth/user/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!response.ok) throw new Error(`Signin failed: ${response.status}`);
    const data = await response.json();
    JWT_TOKEN = data.token;
}

async function fetchRecords(tableId) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records?limit=200`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch records: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

async function archiveRecord(tableId, recordId) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records`, {
        method: 'PATCH',
        headers: {
            'xc-auth': JWT_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            Id: recordId,
            'ステータス': 'archived'
        })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Archive failed: ${response.status} ${body}`);
    }
    return response.json();
}

function classifyRecord(record) {
    const storyId = record['Story ID'] || record['story_id'];
    const name = record['名前'] || record['name'] || record['マイルストーン名'] || '';
    const status = record['ステータス'] || record['status'] || '';
    const progress = record['進捗率'] || 0;

    // Story ID設定済み → 新形式
    if (storyId && storyId.trim() !== '') {
        return { type: 'new_story', record };
    }

    // 完了済み旧マイルストーン → アーカイブ候補
    if (status === 'completed' || status === '完了' || progress >= 1) {
        return { type: 'completed_old', record };
    }

    // 進行中旧マイルストーン → 移行候補
    if (status === 'active' || status === '進行中' || (progress > 0 && progress < 1)) {
        return { type: 'active_old', record };
    }

    // その他（draft等） → 要確認
    return { type: 'other', record };
}

async function processProject(project, dryRun) {
    console.log(`\n━━━ ${project.code.toUpperCase()} ━━━`);

    const records = await fetchRecords(project.tableId);
    console.log(`Total records: ${records.length}`);

    const classified = {
        new_story: [],
        completed_old: [],
        active_old: [],
        other: []
    };

    for (const record of records) {
        const { type } = classifyRecord(record);
        classified[type].push(record);
    }

    console.log(`\n分類結果:`);
    console.log(`  ✅ 新Story形式: ${classified.new_story.length}件`);
    console.log(`  📦 完了済み旧形式: ${classified.completed_old.length}件 → アーカイブ候補`);
    console.log(`  🔄 進行中旧形式: ${classified.active_old.length}件 → 移行候補`);
    console.log(`  ❓ その他: ${classified.other.length}件 → 要確認`);

    // 完了済み旧形式をアーカイブ
    let archived = 0;
    if (classified.completed_old.length > 0) {
        console.log(`\n完了済み旧マイルストーンをアーカイブ:`);
        for (const record of classified.completed_old) {
            const id = record.Id || record.ID;
            const name = record['名前'] || record['name'] || record['マイルストーン名'] || '(no name)';

            if (dryRun) {
                console.log(`  [DRY RUN] Would archive: [${id}] ${name}`);
            } else {
                try {
                    await archiveRecord(project.tableId, id);
                    console.log(`  ✓ Archived: [${id}] ${name}`);
                    archived++;
                } catch (error) {
                    console.error(`  ✗ Failed: [${id}] ${name} - ${error.message}`);
                }
            }
        }
    }

    // 進行中旧形式を表示（手動移行が必要）
    if (classified.active_old.length > 0) {
        console.log(`\n⚠️ 進行中旧マイルストーン（要移行）:`);
        for (const record of classified.active_old) {
            const id = record.Id || record.ID;
            const name = record['名前'] || record['name'] || record['マイルストーン名'] || '(no name)';
            const progress = record['進捗率'] || 0;
            console.log(`  - [${id}] ${name} (進捗: ${Math.round(progress * 100)}%)`);
        }
        console.log(`\n  💡 対応方法:`);
        console.log(`     1. wiki stories.mdに該当Storyを追加`);
        console.log(`     2. create-story-records-from-wiki.js で新Story作成`);
        console.log(`     3. 進捗率を手動で新Storyに転記`);
        console.log(`     4. 旧レコードをアーカイブ`);
    }

    return {
        new_story: classified.new_story.length,
        archived,
        active_old: classified.active_old.length,
        other: classified.other.length
    };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const projectArg = args.find(a => a.startsWith('--project='));
    const targetProject = projectArg ? projectArg.split('=')[1] : null;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('旧マイルストーン → Story形式 移行スクリプト');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
    console.log(`Target: ${targetProject || 'All projects'}\n`);

    await signin();
    console.log('✓ Authenticated\n');

    const projectsToProcess = targetProject
        ? PROJECTS.filter(p => p.code === targetProject)
        : PROJECTS;

    let totalArchived = 0;
    let totalActiveOld = 0;

    for (const project of projectsToProcess) {
        try {
            const result = await processProject(project, dryRun);
            totalArchived += result.archived;
            totalActiveOld += result.active_old;
        } catch (error) {
            console.error(`\n✗ ${project.code}: ${error.message}`);
        }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`完了: ${totalArchived}件アーカイブ`);
    console.log(`要対応: ${totalActiveOld}件の進行中旧マイルストーン`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

main().catch(console.error);
