/**
 * Sliding-window rate limiter: at most `limit` hits per `windowMs` for each key.
 * Used to stop a single socket (or IP) from flooding the room with events.
 */
export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  consume(key, now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  clear(key) {
    this.hits.delete(key);
  }
}
