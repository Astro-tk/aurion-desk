/** Every background job records each run in desk.job_runs. */
export type JobStatus = 'succeeded' | 'failed' | 'skipped';

export interface JobStore {
  start(job: string, runKey: string): Promise<string>;
  finish(id: string, status: JobStatus, details?: Record<string, unknown>, error?: string): Promise<void>;
}

/** Runs fn inside a recorded job run. Errors are recorded and re-thrown. */
export async function withJobRun<T extends { status?: JobStatus; details?: Record<string, unknown> }>(
  store: JobStore,
  job: string,
  runKey: string,
  fn: (runId: string) => Promise<T>,
): Promise<T & { runId: string }> {
  const runId = await store.start(job, runKey);
  try {
    const result = await fn(runId);
    await store.finish(runId, result.status ?? 'succeeded', result.details ?? {});
    return { ...result, runId };
  } catch (err) {
    await store.finish(runId, 'failed', {}, (err as Error).message.slice(0, 1000));
    throw err;
  }
}
