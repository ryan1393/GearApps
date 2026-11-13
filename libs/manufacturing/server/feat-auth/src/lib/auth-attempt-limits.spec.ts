import { ForbiddenException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { TooManyAttemptsException } from '@meshforge/manufacturing/server/util-common';

import { AuthAttemptLimits } from './auth-attempt-limits';

const wrong = () => Promise.reject(new UnauthorizedException('Invalid email or password'));
const right = () => Promise.resolve('tokens');

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return HttpStatus.OK;
  } catch (error) {
    return (error as { getStatus(): number }).getStatus();
  }
}

describe('AuthAttemptLimits', () => {
  let limits: AuthAttemptLimits;
  let response: { setHeader: jest.Mock };
  beforeEach(() => {
    limits = new AuthAttemptLimits();
    response = { setHeader: jest.fn() };
  });

  it('stops wrong passwords for one email after 10, from any address', async () => {
    for (let i = 0; i < 10; i++)
      expect(await statusOf(limits.signIn(`10.0.0.${i}`, 'Admin@Example.test', response, wrong))).toBe(401);
    let thrown: unknown;
    await limits.signIn('10.0.1.1', ' admin@example.TEST ', response, right).catch((error) => (thrown = error));
    expect(thrown).toBeInstanceOf(TooManyAttemptsException);
    expect((thrown as TooManyAttemptsException).message).toMatch(/^Too many sign-in attempts\. Wait 15 minutes/);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '900');
    // Another account is not affected.
    expect(await statusOf(limits.signIn('10.0.1.1', 'other@example.test', response, right))).toBe(200);
  });

  it('clears only that email on success', async () => {
    for (let i = 0; i < 9; i++) await statusOf(limits.signIn(`10.0.0.${i}`, 'a@example.test', response, wrong));
    for (let i = 0; i < 9; i++) await statusOf(limits.signIn(`10.0.1.${i}`, 'b@example.test', response, wrong));
    expect(await statusOf(limits.signIn('10.0.2.1', 'a@example.test', response, right))).toBe(200);
    expect(await statusOf(limits.signIn('10.0.2.2', 'a@example.test', response, wrong))).toBe(401);
    expect(await statusOf(limits.signIn('10.0.2.3', 'b@example.test', response, wrong))).toBe(401);
    expect(await statusOf(limits.signIn('10.0.2.4', 'b@example.test', response, right))).toBe(429);
  });

  it('does not count an inactive account (correct password) as a wrong password', async () => {
    const inactive = () => Promise.reject(new ForbiddenException('User account is inactive'));
    for (let i = 0; i < 12; i++) await statusOf(limits.signIn(`10.0.0.${i}`, 'a@example.test', response, inactive));
    expect(await statusOf(limits.signIn('10.0.1.1', 'a@example.test', response, right))).toBe(200);
  });

  it('allows 30 wrong passwords per address in 5 minutes', async () => {
    for (let i = 0; i < 30; i++)
      expect(await statusOf(limits.signIn('192.0.2.1', `user${i}@example.test`, response, wrong))).toBe(401);
    expect(await statusOf(limits.signIn('192.0.2.1', 'new@example.test', response, right))).toBe(429);
    expect(await statusOf(limits.signIn('192.0.2.2', 'new@example.test', response, right))).toBe(200);
  });

  it('never counts successful sign-ins against a shared terminal', async () => {
    for (let i = 0; i < 100; i++)
      expect(await statusOf(limits.signIn('192.0.2.9', `operator${i}@example.test`, response, right))).toBe(200);
  });

  it('allows 3 forgot-password requests per email and 20 per address an hour', () => {
    for (let i = 0; i < 3; i++) limits.assertForgotPassword(`10.0.0.${i}`, 'a@example.test', response);
    expect(() => limits.assertForgotPassword('10.0.0.9', 'A@example.test', response)).toThrow(TooManyAttemptsException);
    for (let i = 0; i < 20; i++) limits.assertForgotPassword('192.0.2.1', `u${i}@example.test`, response);
    expect(() => limits.assertForgotPassword('192.0.2.1', 'fresh@example.test', response)).toThrow(
      'Too many password reset requests. Wait 60 minutes, then try again.',
    );
    // The refused request did not use up the fresh email's allowance.
    limits.assertForgotPassword('192.0.2.2', 'fresh@example.test', response);
  });

  it('allows 10 reset or verification code attempts per address in 15 minutes', () => {
    for (let i = 0; i < 10; i++) limits.assertCodeAttempt('192.0.2.1', response);
    expect(() => limits.assertCodeAttempt('192.0.2.1', response)).toThrow(TooManyAttemptsException);
    expect(() => limits.assertCodeAttempt('192.0.2.2', response)).not.toThrow();
  });
});
