import { setTimeout as delay } from 'node:timers/promises';

// Ten reconnects follow the initial attempt. Abort cancels both requests and waits.
export async function withProviderRetries(operation, { signal, retries = 10, delayMs = 30000, onRetry = () => {}, shouldRetry = () => true, wait = delay } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw signal.reason || Error('Остановлено');
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
      onRetry({ attempt: attempt + 1, retries, delayMs, error });
      await wait(delayMs, undefined, { signal });
    }
  }
}
