export interface LoginPayload {
  email: string;
  password: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

/** Decoded JWT payload. `sub` is the user id. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: 'admin' | 'user';
  tokenUse?: 'access' | 'refresh';
  authVersion?: number;
  iat?: number;
  exp?: number;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  departmentId: string | null;
  departmentCode: string | null;
  departmentDescription: string | null;
}
