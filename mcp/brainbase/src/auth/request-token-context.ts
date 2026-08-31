import { AsyncLocalStorage } from 'node:async_hooks';

export interface TokenProvider {
  getToken(): Promise<string>;
  refresh?(): Promise<void>;
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

  async getToken(): Promise<string> {
    return this.storage.getStore()?.token ?? this.fallback.getToken();
  }

  async refresh(): Promise<void> {
    if (this.storage.getStore()) {
      throw new Error('The personal MCP token expired; refresh it in the client and reconnect.');
    }
    if (!this.fallback.refresh) throw new Error('Token refresh is not available.');
    await this.fallback.refresh();
  }
}
