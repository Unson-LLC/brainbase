import { AsyncLocalStorage } from 'node:async_hooks';
import type { TokenRequestOptions } from './token-manager.js';

export interface TokenProvider {
  getToken(options?: TokenRequestOptions): Promise<string>;
  refresh?(options?: TokenRequestOptions): Promise<void>;
}

export interface RequestTokenState {
  token: string;
}

export class RequestTokenContext implements TokenProvider {
  private readonly storage = new AsyncLocalStorage<RequestTokenState>();

  constructor(private readonly fallback: TokenProvider) {}

  run<T>(state: RequestTokenState, callback: () => T): T {
    return this.storage.run(state, callback);
  }

  async getToken(options?: TokenRequestOptions): Promise<string> {
    return this.storage.getStore()?.token ?? this.fallback.getToken(options);
  }

  async refresh(options?: TokenRequestOptions): Promise<void> {
    if (this.storage.getStore()) {
      throw new Error('The personal MCP token expired; refresh it in the client and reconnect.');
    }
    if (!this.fallback.refresh) throw new Error('Token refresh is not available.');
    await this.fallback.refresh(options);
  }
}
