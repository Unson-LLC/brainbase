export type ToolHandler<T> = (name: string, args: Record<string, unknown>) => Promise<T | null>;

export async function dispatchFirst<T>(
  handlers: Array<ToolHandler<T>>,
  name: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  for (const handler of handlers) {
    const result = await handler(name, args);
    if (result !== null) return result;
  }
  return null;
}
