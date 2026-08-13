import fs from 'node:fs';
import path from 'node:path';

export async function listRoutineDeadLetters({ directory }) {
    if (!fs.existsSync(directory)) return [];

    const items = [];
    for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.json')).sort()) {
        const filePath = path.resolve(directory, name);
        const receipt = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const workflowId = receipt?.source?.workflow_id;
        const automationId = workflowId && workflowId !== '__connector_observation__'
            ? workflowId
            : receipt?.source?.name;
        if (typeof automationId !== 'string' || !automationId.trim()) continue;
        items.push({
            automation_id: automationId,
            created_at: fs.statSync(filePath).mtime.toISOString(),
            path: filePath
        });
    }

    return items.sort((left, right) => right.created_at.localeCompare(left.created_at)
        || left.automation_id.localeCompare(right.automation_id));
}
