/**
 * Portable batch boundary for meeting-derived Personal KG extraction.
 *
 * A consumer supplies the meeting rule/extraction callback because source
 * schemas, identity, redaction policy, and candidate shape are tenant-owned.
 * This module owns the common collection/count contract and keeps the batch
 * boundary independent from any database or model provider.
 */

export interface RoutinePersonalKgMeetingResult<TCandidate = unknown> {
  adopted?: readonly TCandidate[];
  rejected?: readonly unknown[];
  needs_review?: readonly unknown[];
}

export interface RoutinePersonalKgExtractionOptions<
  TMeeting,
  TCandidate = unknown
> {
  date: string;
  meetings?: readonly TMeeting[];
  sourceSystem: string;
  extract: (input: {
    meeting: TMeeting;
    date: string;
    index: number;
  }) => RoutinePersonalKgMeetingResult<TCandidate>;
  dedupe?: (candidates: readonly TCandidate[]) => readonly TCandidate[];
}

export interface RoutinePersonalKgExtractionResult<TCandidate = unknown> {
  date: string;
  source_system: string;
  counts: {
    adopted: number;
    rejected: number;
    needs_review: number;
  };
  adopted: TCandidate[];
  rejected: unknown[];
  needs_review: unknown[];
}

/**
 * Collect meeting extraction results using the portable result shape.
 * Extraction errors intentionally propagate to the consumer: a host decides
 * whether a failed meeting should be retried, surfaced for review, or stop a
 * run, and the common package must not silently convert it to success.
 */
export function extractRoutinePersonalKgCandidates<TMeeting, TCandidate = unknown>(
  options: RoutinePersonalKgExtractionOptions<TMeeting, TCandidate>
): RoutinePersonalKgExtractionResult<TCandidate> {
  if (!options || typeof options !== 'object') {
    throw new Error('routine Personal KG extraction options are required');
  }
  if (typeof options.date !== 'string' || options.date.trim() === '') {
    throw new Error('routine Personal KG extraction date is required');
  }
  if (typeof options.sourceSystem !== 'string' || options.sourceSystem.trim() === '') {
    throw new Error('routine Personal KG extraction sourceSystem is required');
  }
  if (typeof options.extract !== 'function') {
    throw new Error('routine Personal KG extraction callback is required');
  }

  const adopted: TCandidate[] = [];
  const rejected: unknown[] = [];
  const needsReview: unknown[] = [];
  const meetings = Array.isArray(options.meetings) ? options.meetings : [];

  meetings.forEach((meeting, index) => {
    const result = options.extract({ meeting, date: options.date, index }) || {};
    adopted.push(...(Array.isArray(result.adopted) ? result.adopted : []));
    rejected.push(...(Array.isArray(result.rejected) ? result.rejected : []));
    needsReview.push(...(Array.isArray(result.needs_review) ? result.needs_review : []));
  });

  const deduped = options.dedupe ? options.dedupe(adopted) : adopted;
  const finalAdopted = Array.isArray(deduped) ? [...deduped] : adopted;
  return {
    date: options.date,
    source_system: options.sourceSystem,
    counts: {
      adopted: finalAdopted.length,
      rejected: rejected.length,
      needs_review: needsReview.length
    },
    adopted: finalAdopted,
    rejected,
    needs_review: needsReview
  };
}
