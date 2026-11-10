import type { NormalizedRunReceipt } from './run-receipt.js';

/**
 * Shared host boundary for durable run-receipt ingest and query.
 *
 * The OSS package only defines the contract and validates the port shape.
 * Storage, authentication, organization scoping, HTTP, and readback remain
 * owned by the consumer that supplies this port.
 */
export interface RunReceiptPersistenceInput<Context = unknown> {
  payload: unknown;
  normalized: NormalizedRunReceipt;
  context: Context;
}

export interface RunReceiptQueryInput<Request = unknown, Context = unknown> {
  request: Request;
  context: Context;
}

export interface RunReceiptPort<
  Request = unknown,
  Context = unknown,
  Persisted = unknown,
  Queried = unknown
> {
  persist(input: RunReceiptPersistenceInput<Context>): Persisted | PromiseLike<Persisted>;
  query(input: RunReceiptQueryInput<Request, Context>): Queried | PromiseLike<Queried>;
}

/**
 * Validate the common receipt boundary without assuming a storage provider.
 * A label keeps the existing routine/automation diagnostics specific to their
 * host-facing service while sharing the actual shape check.
 */
export function assertRunReceiptPort(
  port: unknown,
  label = 'run receipt'
): asserts port is RunReceiptPort {
  if (!port || typeof port !== 'object'
    || typeof (port as { persist?: unknown }).persist !== 'function'
    || typeof (port as { query?: unknown }).query !== 'function') {
    throw new Error(`${label} port with persist and query is required`);
  }
}
