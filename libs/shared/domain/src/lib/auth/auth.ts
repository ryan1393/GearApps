export interface LoginPayload {
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
}

/** Decoded JWT payload. `sub` is the user id. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  fname?: string;
  lname?: string;
  token_use?: 'lapper-access';
  iat?: number;
  exp?: number;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
