import { readFileSync } from 'node:fs';
import {
  EVIDENCE_ATTACHMENT_NAME,
  EVIDENCE_CONTENT_TYPE,
  atomicWriteJson,
  createRunnerResult,
  parseFinalEventEnvelope,
  validateEvidenceEnvironment,
} from './canonical-task-evidence-protocol.js';

function attachmentBody(attachment) {
  if (attachment.body !== undefined) return attachment.body;
  if (!attachment.path) return null;
  try {
    return readFileSync(attachment.path);
  } catch {
    return null;
  }
}

export default class CanonicalTaskPlaywrightReporter {
  constructor() {
    this.evidence = validateEvidenceEnvironment(process.env);
    this.tests = [];
  }

  onTestEnd(test, result) {
    const finalEvents = [];
    for (const attachment of result.attachments ?? []) {
      if (
        attachment.name !== EVIDENCE_ATTACHMENT_NAME
        || attachment.contentType !== EVIDENCE_CONTENT_TYPE
      ) continue;
      const event = parseFinalEventEnvelope(attachmentBody(attachment), this.evidence);
      if (event) finalEvents.push(event);
    }

    this.tests.push({
      title: test.title,
      status: result.status,
      final_events: finalEvents,
    });
  }

  async onEnd() {
    await atomicWriteJson(
      this.evidence.resultPath,
      createRunnerResult('playwright', this.evidence, this.tests),
    );
  }
}
