import { HttpStatus } from '@nestjs/common';

import { assertWithinLimit, RateLimiter, TooManyAttemptsException, waitDescription } from './rate-limiter';

describe('RateLimiter', () => {
  let time: number;
  const now = () => time;
  beforeEach(() => (time = 1_000_000));

  it('allows the limit per window, then reports the wait until the window ends', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000, now });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    time += 10_000;
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(limiter.peek('a').allowed).toBe(false);
    expect(limiter.peek('b').allowed).toBe(true);
    time += 50_000;
    expect(limiter.hit('a').allowed).toBe(true);
  });

  it('does not count events while limited', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now });
    limiter.hit('a');
    limiter.hit('a');
    limiter.hit('a');
    time += 1000;
    expect(limiter.peek('a').allowed).toBe(true);
  });

  it('forgets one key on reset', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now });
    limiter.hit('a');
    limiter.hit('b');
    limiter.reset('a');
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.peek('b').allowed).toBe(false);
  });

  it('keeps memory bounded: expired keys are swept and the oldest key goes when full', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now });
    limiter.hit('a');
    limiter.hit('b');
    limiter.hit('c');
    limiter.hit('d');
    expect(limiter.size).toBe(3);
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.peek('d').allowed).toBe(false);
    time += 1000;
    limiter.hit('e');
    expect(limiter.size).toBe(1);
  });

  it('throws 429 with Retry-After when limited', () => {
    const response = { setHeader: jest.fn() };
    expect(() => assertWithinLimit({ allowed: true, retryAfterSeconds: 0 }, () => 'x', response)).not.toThrow();
    let thrown: unknown;
    try {
      assertWithinLimit({ allowed: false, retryAfterSeconds: 120 }, (wait) => `Wait ${wait}.`, response);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TooManyAttemptsException);
    expect((thrown as TooManyAttemptsException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((thrown as TooManyAttemptsException).getResponse()).toMatchObject({ message: 'Wait 2 minutes.' });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '120');
  });

  it('describes waits in plain words', () => {
    expect(waitDescription(1)).toBe('1 second');
    expect(waitDescription(45)).toBe('45 seconds');
    expect(waitDescription(60)).toBe('1 minute');
    expect(waitDescription(61)).toBe('2 minutes');
  });
});
