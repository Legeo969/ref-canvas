export type TrashItem = (filename: string) => Promise<void>;

/**
 * Retries transient Windows shell failures without changing deletion semantics:
 * if the OS recycle bin remains unavailable, the source is left untouched.
 */
export async function moveToRecycleBin(
  filename: string,
  trashItem: TrashItem,
  options: {
    attempts?: number;
    wait?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<void> {
  const attempts = options.attempts ?? 6;
  const wait = options.wait ?? ((delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)));
  let failure: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await trashItem(filename);
      return;
    } catch (error) {
      failure = error;
      if (attempt < attempts - 1) await wait(75 * (attempt + 1));
    }
  }
  const detail = failure instanceof Error ? failure.message : String(failure);
  throw new Error(`RECYCLE_BIN_FAILED: ${detail}`);
}
