// wiki stories.mdから新規ストーリーレコードをNoCoDB「ストーリー」テーブルに作成
// Usage: node scripts/create-story-records-from-wiki.js [--dry-run] [--project=salestailor]

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;
const WIKI_API_URL = process.env.WIKI_API_URL || 'http://localhost:31013/api/wiki/page';

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const PROJECTS = [
    { code: 'baao', baseId: 'pqj22ze3jh0mkms', tableId: 'mm6b4dlz6w2wnnj' },
    { code: 'dialogai', baseId: 'ptykrgx40t36l9y', tableId: 'mqjcl7pechscy1y' },
    { code: 'ncom', baseId: 'p95wu69gwchz94m', tableId: 'mvu6jwaq67j2god' },
    { code: 'salestailor', baseId: 'pqot58neiu3o1xo', tableId: 'mmljchzw0wnzg7z' },
    { code: 'senrigan', baseId: 'p0f59uaty8zr8yd', tableId: 'ml9wn9die5f5jap' },
    { code: 'mywa', baseId: 'p8gn2zt3k3bhia3', tableId: 'mvsil7ns45x5h8z' },
    { code: 'zeims', baseId: 'pr8u5q4qnb8op11', tableId: 'mmbujavunaxsfdl' },
    { code: 'back_office', baseId: 'pypw36aox9nkhb6', tableId: 'm12o5wttp2v98zl' },
    { code: 'brainbase', baseId: 'pva7l2qlu6fdfip', tableId: 'ml7hpqcvv3v8dms' },
    { code: 'techknight', baseId: 'p3tzrrtqi5hm40t', tableId: 'mqzhsliq8xiavvy' },
    { code: 'vibepro', baseId: 'pfgza5aei6wboaq', tableId: 'mjpg80jobkjo8lz' }
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

async function fetchWikiStories(projectCode) {
    try {
        const response = await fetch(`${WIKI_API_URL}?path=${projectCode}/stories.md`);
        if (!response.ok) return [];
        const data = await response.json();
        if (data.error || !data.content) return [];

        const stories = [];
        const content = data.content;

        // Method 1: YAML code blocks
        const yamlBlocks = content.match(/```yaml\n([\s\S]*?)```/g) || [];
        for (const block of yamlBlocks) {
            const yaml = block.replace(/```yaml\n/, '').replace(/```/, '').trim();
            const story = parseYamlBlock(yaml);
            if (story.story_id && story.horizon && story.name) {
                stories.push(story);
            }
        }

        // Method 2: Markdown sections with frontmatter
        if (!stories.length) {
            const storySections = content.split(/(?=^# Story:)/m);
            for (const section of storySections) {
                if (!section.startsWith('# Story:')) continue;
                const story = parseMarkdownSection(section);
                if (story.story_id) stories.push(story);
            }
        }

        return stories;
    } catch (error) {
        console.error(`Failed to fetch wiki stories for ${projectCode}:`, error.message);
        return [];
    }
}

function parseYamlBlock(yaml) {
    const story = {};
    for (const line of yaml.split('\n')) {
        const match = line.match(/^(\w[\w_]*)\s*:\s*["']?([^"'\n]+)["']?/);
        if (match && !line.startsWith('  ')) {
            const [, key, val] = match;
            if (['criteria', 'beat_map'].includes(key)) continue;
            story[key] = val.replace(/^["']|["']$/g, '').trim();
        }
    }
    return story;
}

function parseMarkdownSection(section) {
    const story = {};
    const titleMatch = section.match(/^# Story:\s*(.+)/);
    story.name = titleMatch ? titleMatch[1].trim() : '';

    const fmMatch = section.match(/\n---\n([\s\S]*?)\n---/);
    if (fmMatch) {
        for (const line of fmMatch[1].split('\n')) {
            const m = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
            if (m) story[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
    }
    return story;
}

async function fetchExistingRecords(tableId) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records?limit=200`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch records: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

async function createRecord(tableId, story) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records`, {
        method: 'POST',
        headers: {
            'xc-auth': JWT_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            'マイルストーン名': story.name,
            'Story ID': story.story_id,
            'Horizon': story.horizon,
            'View': story.view || 'business',
            'Period': story.period || '',
            'ステータス': story.status || 'active',
            '進捗率': 0
        })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Create failed: ${response.status} ${body}`);
    }
    return response.json();
}

async function processProject(project, dryRun) {
    console.log(`\n--- ${project.code.toUpperCase()} ---`);

    const wikiStories = await fetchWikiStories(project.code);
    console.log(`  Wiki stories: ${wikiStories.length}`);

    if (!wikiStories.length) {
        console.log(`  ⚠️  No stories found in wiki, skipping`);
        return { created: 0, skipped: 0 };
    }

    const existingRecords = await fetchExistingRecords(project.tableId);
    const existingStoryIds = new Set(
        existingRecords.map(r => r['Story ID'] || r['story_id']).filter(Boolean)
    );

    console.log(`  Existing story records: ${existingStoryIds.size}`);

    let created = 0;
    let skipped = 0;

    for (const story of wikiStories) {
        if (existingStoryIds.has(story.story_id)) {
            console.log(`  ✓ "${story.name}" already exists (${story.story_id})`);
            skipped++;
            continue;
        }

        if (dryRun) {
            console.log(`  [DRY RUN] Would create: ${story.story_id} - ${story.name}`);
        } else {
            try {
                await createRecord(project.tableId, story);
                console.log(`  ✓ Created: ${story.story_id} - ${story.name}`);
                created++;
            } catch (error) {
                console.error(`  ✗ Failed to create ${story.story_id}: ${error.message}`);
            }
        }
    }

    return { created, skipped };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const projectArg = args.find(a => a.startsWith('--project='));
    const targetProject = projectArg ? projectArg.split('=')[1] : null;

    console.log('=== wiki storiesからNoCoDB「ストーリー」レコード作成 ===');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
    console.log(`Target: ${targetProject || 'All projects'}\n`);

    console.log('Signing in...');
    await signin();
    console.log('✓ Authenticated\n');

    const projectsToProcess = targetProject
        ? PROJECTS.filter(p => p.code === targetProject)
        : PROJECTS;

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const project of projectsToProcess) {
        try {
            const { created, skipped } = await processProject(project, dryRun);
            totalCreated += created;
            totalSkipped += skipped;
        } catch (error) {
            console.error(`✗ ${project.code}: ${error.message}`);
        }
    }

    console.log(`\n=== 完了 ===`);
    console.log(`Created: ${totalCreated}`);
    console.log(`Skipped: ${totalSkipped}`);
}

main().catch(console.error);
