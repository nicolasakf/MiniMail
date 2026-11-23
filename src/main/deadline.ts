/**
 * Rejects with `message` when `task` has not settled within `ms`, and calls `onExpire` so the
 * caller can stop whatever the task is stuck on (for example by closing its connection). The task
 * itself cannot be cancelled; this only stops anything from waiting on it any longer.
 */
export function withDeadline<T>(task: Promise<T>, ms: number, message: string, onExpire?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onExpire?.();
      } catch {
        // expected: stopping what the task is stuck on is best effort; the caller gets the deadline error either way.
      }
      reject(new Error(message));
    }, ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
