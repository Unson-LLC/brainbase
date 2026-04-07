// wiki stories.mdのstory_idをNoCoDB「ストーリー」レコードに紐付け
// Usage: NOCODB_API_TOKEN=xxx node scripts/link-story-ids-to-nocodb.js [--dry-run] [--project=salestailor]

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
            const storyIdMatch = yaml.match(/story_id:\s*["']?([^"'\n]+)["']?/);
            const nameMatch = yaml.match(/name:\s*["']?([^"'\n]+)["']?/);
            const horizonMatch = yaml.match(/horizon:\s*["']?([^"'\n]+)["']?/);

            if (storyIdMatch) {
                stories.push({
                    story_id: storyIdMatch[1].trim(),
                    name: nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : '',
                    horizon: horizonMatch ? horizonMatch[1].trim() : ''
                });
            }
        }

        // Method 2: Markdown sections with frontmatter
        if (!stories.length) {
            const storySections = content.split(/(?=^# Story:)/m);
            for (const section of storySections) {
                if (!section.startsWith('# Story:')) continue;
                const fmMatch = section.match(/\n---\n([\s\S]*?)\n---/);
                if (fmMatch) {
                    const meta = {};
                    for (const line of fmMatch[1].split('\n')) {
                        const m = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
                        if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
                    }
                    if (meta.story_id) {
                        stories.push({
                            story_id: meta.story_id,
                            name: section.match(/^# Story:\s*(.+)/)?.[1] || '',
                            horizon: meta.horizon || ''
                        });
                    }
                }
            }
        }

        return stories;
    } catch (error) {
        console.error(`Failed to fetch wiki stories for ${projectCode}:`, error.message);
        return [];
    }
}

async function fetchNocodbMilestones(tableId) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records?limit=200`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch NocoDB records: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

async function updateRecord(tableId, recordId, story_id) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records`, {
        method: 'PATCH',
        headers: {
            'xc-auth': JWT_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            Id: recordId,
            'Story ID': story_id
        })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Update failed: ${response.status} ${body}`);
    }
    return response.json();
}

async function linkProject(project, dryRun) {
    console.log(`\n--- ${project.code.toUpperCase()} ---`);

    // Fetch wiki stories
    const wikiStories = await fetchWikiStories(project.code);
    console.log(`  Wiki stories: ${wikiStories.length}`);

    if (!wikiStories.length) {
        console.log(`  ⚠️  No stories found in wiki, skipping`);
        return { linked: 0, skipped: 0 };
    }

    // Fetch NocoDB milestones
    const milestones = await fetchNocodbMilestones(project.tableId);
    console.log(`  NocoDB milestones: ${milestones.length}`);

    // Link by name matching
    let linked = 0;
    let skipped = 0;

    for (const milestone of milestones) {
        const msName = milestone['マイルストーン名'] || milestone['名前'] || milestone['Name'] || '';
        const existingStoryId = milestone['Story ID'] || milestone['story_id'];

        if (!msName) {
            skipped++;
            continue;
        }

        if (existingStoryId) {
            console.log(`  ✓ "${msName}" already has story_id: ${existingStoryId}`);
            continue;
        }

        // Find matching story
        const matchedStory = wikiStories.find(s =>
            s.name.includes(msName) || msName.includes(s.name) ||
            (s.horizon && msName.toLowerCase().includes(s.horizon.toLowerCase()))
        );

        if (matchedStory) {
            if (dryRun) {
                console.log(`  [DRY RUN] Would link "${msName}" → ${matchedStory.story_id}`);
            } else {
                try {
                    await updateRecord(project.tableId, milestone.Id || milestone.id, matchedStory.story_id);
                    console.log(`  ✓ Linked "${msName}" → ${matchedStory.story_id}`);
                    linked++;
                } catch (error) {
                    console.error(`  ✗ Failed to link "${msName}": ${error.message}`);
                }
            }
        } else {
            console.log(`  ⚠️  No match for "${msName}"`);
            skipped++;
        }
    }

    return { linked, skipped };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const projectArg = args.find(a => a.startsWith('--project='));
    const targetProject = projectArg ? projectArg.split('=')[1] : null;

    console.log('=== NoCoDB story_id紐付けスクリプト ===');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
    console.log(`Target: ${targetProject || 'All projects'}\n`);

    console.log('Signing in...');
    await signin();
    console.log('✓ Authenticated\n');

    const projectsToProcess = targetProject
        ? PROJECTS.filter(p => p.code === targetProject)
        : PROJECTS;

    let totalLinked = 0;
    let totalSkipped = 0;

    for (const project of projectsToProcess) {
        try {
            const { linked, skipped } = await linkProject(project, dryRun);
            totalLinked += linked;
            totalSkipped += skipped;
        } catch (error) {
            console.error(`✗ ${project.code}: ${error.message}`);
        }
    }

    console.log(`\n=== 完了 ===`);
    console.log(`Linked: ${totalLinked}`);
    console.log(`Skipped: ${totalSkipped}`);
}

main().catch(console.error);
