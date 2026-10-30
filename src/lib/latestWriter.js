/**
 * Serialize writes of a value that changes quickly (the beans on a board) so the last value the
 * user produced is the last one stored. Without it, two quick taps send two updates that can land
 * in the wrong order and leave an older board on the server.
 *
 * One write is in flight at a time; values pushed meanwhile collapse into the newest one.
 * `push(value)` resolves when that value or a newer one is stored, and rejects if the write
 * fails; the failed value stays queued and goes out with the next push or `flush()`.
 */
export function createLatestWriter(write) {
  let pending;
  let hasPending = false;
  let inflight = null;

  async function drain() {
    while (hasPending) {
      const value = pending;
      hasPending = false;
      try {
        await write(value);
      } catch (err) {
        if (!hasPending) {
          pending = value;
          hasPending = true;
        }
        throw err;
      }
    }
  }

  function start() {
    if (!inflight) {
      inflight = drain().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  return {
    push(value) {
      pending = value;
      hasPending = true;
      return start();
    },
    flush() {
      return hasPending ? start() : inflight ?? Promise.resolve();
    },
  };
}
