import { Injectable, UnauthorizedException } from '@nestjs/common';
import { assertWithinLimit, RateLimiter } from '@meshforge/manufacturing/server/util-common';

const MINUTE = 60_000;

type ResponseHeaders = { setHeader(name: string, value: string): unknown } | null | undefined;

/** The client address, behind the proxies trusted by TRUST_PROXY. */
export function clientAddress(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

export function normalizedEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

const signInMessage = (wait: string) => `Too many sign-in attempts. Wait ${wait}, then try again.`;
const resetMessage = (wait: string) => `Too many password reset requests. Wait ${wait}, then try again.`;

/**
 * Limits on the sign-in and password endpoints, kept in the API's memory:
 * - sign-in: 30 wrong passwords per client address per 5 minutes, and 10 per email per
 *   15 minutes. Successful sign-ins never count, so a shared shop-floor terminal can sign in
 *   any number of people; a success clears that email's count only;
 * - forgot password: 3 requests per email and 20 per address per hour;
 * - reset password and email verification codes: 10 attempts per address per 15 minutes.
 */
@Injectable()
export class AuthAttemptLimits {
  readonly loginPerAddress = new RateLimiter({ limit: 30, windowMs: 5 * MINUTE });
  readonly loginFailuresPerEmail = new RateLimiter({ limit: 10, windowMs: 15 * MINUTE });
  readonly forgotPerEmail = new RateLimiter({ limit: 3, windowMs: 60 * MINUTE });
  readonly forgotPerAddress = new RateLimiter({ limit: 20, windowMs: 60 * MINUTE });
  readonly codePerAddress = new RateLimiter({ limit: 10, windowMs: 15 * MINUTE });

  /**
   * Runs one password sign-in under the limits. Only a wrong email or password (401) counts,
   * against both the email and the client address; success clears the email's count.
   */
  async signIn<T>(address: string, email: unknown, response: ResponseHeaders, attempt: () => Promise<T>): Promise<T> {
    const key = normalizedEmail(email);
    assertWithinLimit(this.loginFailuresPerEmail.peek(key), signInMessage, response);
    assertWithinLimit(this.loginPerAddress.peek(address), signInMessage, response);
    try {
      const result = await attempt();
      this.loginFailuresPerEmail.reset(key);
      return result;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.loginFailuresPerEmail.hit(key);
        this.loginPerAddress.hit(address);
      }
      throw error;
    }
  }

  /** Sign-in without a password (Google): only the per-address limit applies. */
  assertSignInAddress(address: string, response: ResponseHeaders): void {
    assertWithinLimit(this.loginPerAddress.hit(address), signInMessage, response);
  }

  assertForgotPassword(address: string, email: unknown, response: ResponseHeaders): void {
    assertWithinLimit(this.forgotPerAddress.peek(address), resetMessage, response);
    assertWithinLimit(this.forgotPerEmail.hit(normalizedEmail(email)), resetMessage, response);
    this.forgotPerAddress.hit(address);
  }

  assertCodeAttempt(address: string, response: ResponseHeaders): void {
    assertWithinLimit(this.codePerAddress.hit(address), (wait) => `Too many attempts. Wait ${wait}, then try again.`, response);
  }
}
