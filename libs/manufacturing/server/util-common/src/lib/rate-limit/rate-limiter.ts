import { HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimiterOptions {
  /** Events allowed per key in one window. */
  limit: number;
  /** Window length in milliseconds. The window starts with the first event of a key. */
  windowMs: number;
  /** Most keys kept in memory. When full, expired keys go first, then the oldest. */
  maxKeys?: number;
  /** Clock, for tests. */
  now?: () => number;
}

export interface RateLimitState {
  /** False once the key has used its limit for the current window. */
  allowed: boolean;
  /** Whole seconds until the key's window ends (at least 1 while limited, 0 otherwise). */
  retryAfterSeconds: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * A small fixed-window counter kept in this process's memory. Each key (an address, an email,
 * or one global key) may record `limit` events per window. Memory stays bounded: expired keys
 * are swept as the map grows, and at `maxKeys` the oldest key is dropped.
 *
 * Counts are per API process and start empty after a restart, which suits one API instance.
 */
export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxKeys: number;
  private readonly now: () => number;
  private nextSweep = 0;

  constructor(private readonly options: RateLimiterOptions) {
    if (!(options.limit >= 1) || !(options.windowMs >= 1)) throw new Error('Rate limit and window must be positive');
    this.maxKeys = Math.max(1, options.maxKeys ?? 10_000);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The key's state without recording anything. */
  peek(key: string): RateLimitState {
    const entry = this.current(key);
    if (!entry || entry.count < this.options.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: this.secondsUntil(entry.resetAt) };
  }

  /** Records one event for the key, unless it is already limited. Returns the state before it. */
  hit(key: string): RateLimitState {
    const state = this.peek(key);
    if (!state.allowed) return state;
    const now = this.now();
    const entry = this.current(key);
    if (entry) {
      entry.count++;
    } else {
      this.makeRoom(now);
      this.entries.set(key, { count: 1, resetAt: now + this.options.windowMs });
    }
    return state;
  }

  /** Forgets the key, for example after a successful sign-in. */
  reset(key: string): void {
    this.entries.delete(key);
  }

  private current(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.resetAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private secondsUntil(time: number): number {
    return Math.max(1, Math.ceil((time - this.now()) / 1000));
  }

  private makeRoom(now: number): void {
    // A full sweep at most once per window keeps each request cheap even when the map is full.
    if (now >= this.nextSweep) {
      for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
      this.nextSweep = now + this.options.windowMs;
    }
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** HTTP 429 with a plain message. Send `retryAfterSeconds` as the Retry-After header too. */
export class TooManyAttemptsException extends HttpException {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message, retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** "1 minute", "15 minutes": how long to wait, for messages. */
export function waitDescription(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Throws a 429 (and sets Retry-After on the response) when the state is limited.
 * `message` receives the wait, for example "15 minutes".
 */
export function assertWithinLimit(
  state: RateLimitState,
  message: (wait: string) => string,
  response?: { setHeader(name: string, value: string): unknown } | null,
): void {
  if (state.allowed) return;
  response?.setHeader('Retry-After', String(state.retryAfterSeconds));
  throw new TooManyAttemptsException(message(waitDescription(state.retryAfterSeconds)), state.retryAfterSeconds);
}
