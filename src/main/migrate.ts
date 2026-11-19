/**
 * Upgrades for files kept on the user's computer. When a file's format changes, the change
 * ships a step here (see AGENTS.md): a stored file is upgraded, never thrown away.
 */

/** Turns a payload saved as version N into version N + 1. */
export type Migration = (payload: unknown) => unknown;

/** Thrown when a file was written by a newer version of the app than this one. */
export class NewerFileError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(`The file is version ${found}; this app reads up to version ${supported}`);
  }
}

/**
 * Runs the steps from `from` up to `to`, one version at a time. `steps` is keyed by the version
 * a step upgrades *from*, so `steps[1]` turns version 1 into version 2. A missing step is a bug
 * in the change that bumped the version, so it throws instead of guessing.
 */
export function migrate(
  payload: unknown,
  from: number,
  to: number,
  steps: Readonly<Record<number, Migration>>,
): unknown {
  if (from > to) throw new NewerFileError(from, to);
  let current = payload;
  for (let version = from; version < to; version += 1) {
    const step = steps[version];
    if (!step) throw new Error(`No migration from version ${version} to ${version + 1}`);
    current = step(current);
  }
  return current;
}
