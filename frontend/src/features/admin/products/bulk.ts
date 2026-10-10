export interface BulkItem {
  id: number;
  name: string;
}
export interface BulkResult extends BulkItem {
  ok: boolean;
  error?: string;
}

/**
 * Run `action` for each item one after another (never in parallel: the API audits every change and a partial failure
 * must leave a clear, ordered record). A failure does not stop the run; `shouldStop` lets the user cancel between items.
 */
export async function runBulk(
  items: readonly BulkItem[],
  action: (item: BulkItem) => Promise<unknown>,
  opts: {
    describeError: (e: unknown) => string;
    onProgress?: (done: number, total: number, last: BulkResult) => void;
    shouldStop?: () => boolean;
  },
): Promise<{ results: BulkResult[]; stopped: boolean }> {
  const results: BulkResult[] = [];
  let stopped = false;
  for (const item of items) {
    if (opts.shouldStop?.()) {
      stopped = true;
      break;
    }
    let result: BulkResult;
    try {
      await action(item);
      result = { ...item, ok: true };
    } catch (e) {
      result = { ...item, ok: false, error: opts.describeError(e) };
    }
    results.push(result);
    opts.onProgress?.(results.length, items.length, result);
  }
  return { results, stopped };
}
