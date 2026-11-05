/** Token supply is owned by the host; this package does not manage credentials. */
export interface TokenRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface TokenProvider {
  getToken(options?: TokenRequestOptions): Promise<string>;
  refresh?(options?: TokenRequestOptions): Promise<void>;
}
