/**
 * Route incoming envelopes to handlers by type.
 */

export class MessageRouter {
  constructor() {
    this._handlers = new Map();
  }

  /**
   * Register an async handler for a given envelope type.
   * @param {string} type - The envelope type (e.g. 'query', 'response').
   * @param {(envelope: object) => Promise<void>} handler
   */
  registerHandler(type, handler) {
    this._handlers.set(type, handler);
  }

  /**
   * Route an envelope to the registered handler based on envelope.type.
   * Logs a warning if no handler is registered for the type.
   * @param {object} envelope
   */
  async route(envelope) {
    const handler = this._handlers.get(envelope.type);

    if (!handler) {
      console.warn(`[MessageRouter] No handler registered for type: ${envelope.type}`);
      return;
    }

    await handler(envelope);
  }
}
