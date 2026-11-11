export class SlidingWindowLimiter {
  #requests = new Map(); // userId -> array of timestamps
  #maxRequests;
  #windowMs;

  constructor({ maxRequests, windowMs }) {
    this.#maxRequests = maxRequests;
    this.#windowMs = windowMs;
  }

  allow(userId, now = Date.now()) {
    if (!this.#requests.has(userId)) {
      this.#requests.set(userId, []);
    }

    const userRequests = this.#requests.get(userId);
    const windowStart = now - this.#windowMs;

    // Remove old requests outside the window
    while (userRequests.length > 0 && userRequests[0] <= windowStart) {
      userRequests.shift();
    }

    if (userRequests.length < this.#maxRequests) {
      userRequests.push(now);
      return true;
    }

    return false;
  }

  getRemaining(userId, now = Date.now()) {
    if (!this.#requests.has(userId)) {
      return this.#maxRequests;
    }

    const userRequests = this.#requests.get(userId);
    const windowStart = now - this.#windowMs;

    // Remove old requests outside the window
    while (userRequests.length > 0 && userRequests[0] <= windowStart) {
      userRequests.shift();
    }

    return Math.max(0, this.#maxRequests - userRequests.length);
  }
}