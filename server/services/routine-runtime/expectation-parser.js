import fs from 'node:fs';

function fail(index, field, message) {
    throw new Error(`expectations[${index}].${field} ${message}`);
}

function requireString(value, index, field) {
    if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
        fail(index, field, 'must be a non-empty trimmed string');
    }
    return value;
}

function requireInteger(value, index, field, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        fail(index, field, `must be an integer from ${minimum} to ${maximum}`);
    }
    return value;
}

export function parseRoutineExpectations(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('expectations must be a non-empty array');
    }

    const routines = new Set();
    const automationIds = new Set();
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`expectations[${index}] must be an object`);
        }
        const routine = requireString(entry.routine, index, 'routine');
        const automationId = requireString(entry.automation_id, index, 'automation_id');
        if (routines.has(routine)) fail(index, 'routine', 'must be unique');
        if (automationIds.has(automationId)) fail(index, 'automation_id', 'must be unique');
        routines.add(routine);
        automationIds.add(automationId);

        const sourceType = requireString(entry.source_type, index, 'source_type');
        const projectId = requireString(entry.project_id, index, 'project_id');
        if (sourceType !== 'codex_automations') fail(index, 'source_type', 'must be codex_automations');
        if (projectId !== 'brainbase') fail(index, 'project_id', 'must be brainbase');
        const timezone = requireString(entry.timezone, index, 'timezone');
        if (timezone !== 'Asia/Tokyo') fail(index, 'timezone', 'must be Asia/Tokyo');

        if (!entry.schedule || typeof entry.schedule !== 'object' || Array.isArray(entry.schedule)) {
            fail(index, 'schedule', 'must be an object');
        }
        const kind = requireString(entry.schedule.kind, index, 'schedule.kind');
        if (!['daily', 'weekly'].includes(kind)) fail(index, 'schedule.kind', 'must be daily or weekly');
        const schedule = {
            kind,
            hour: requireInteger(entry.schedule.hour, index, 'schedule.hour', 0, 23),
            minute: requireInteger(entry.schedule.minute, index, 'schedule.minute', 0, 59)
        };
        if (kind === 'weekly') {
            schedule.day_of_week = requireInteger(entry.schedule.day_of_week, index, 'schedule.day_of_week', 0, 6);
        }

        const graceMinutes = requireInteger(entry.grace_minutes, index, 'grace_minutes', 1, 24 * 60);
        if (!Array.isArray(entry.required_artifacts) || entry.required_artifacts.length === 0) {
            fail(index, 'required_artifacts', 'must be a non-empty array');
        }
        const requiredArtifacts = entry.required_artifacts.map((artifact, artifactIndex) =>
            requireString(artifact, index, `required_artifacts[${artifactIndex}]`));
        if (new Set(requiredArtifacts).size !== requiredArtifacts.length) {
            fail(index, 'required_artifacts', 'must not contain duplicates');
        }

        return {
            routine,
            automation_id: automationId,
            source_type: sourceType,
            project_id: projectId,
            timezone,
            schedule,
            grace_minutes: graceMinutes,
            required_artifacts: requiredArtifacts
        };
    });
}

export function loadRoutineExpectations(filePath) {
    return parseRoutineExpectations(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}
