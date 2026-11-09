import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { toPublicUser, UsersService } from './users.service';

describe('AuthService', () => {
  const user = { id: 'u1', email: 'a@b.c', password: 'hash', fname: 'A', lname: 'B' };
  const users = {
    findByEmail: jest.fn(),
    verifyPassword: jest.fn(),
  } as unknown as jest.Mocked<UsersService>;
  const jwt = new JwtService({ secret: 'test-secret-test-secret-test-secret-1234' });
  const svc = new AuthService(users, jwt);

  it('issues a token with the user id as subject', async () => {
    users.findByEmail.mockResolvedValue(user);
    users.verifyPassword.mockResolvedValue(true);
    const { access_token } = await svc.login({ email: 'a@b.c', password: 'pw' });
    expect(jwt.verify(access_token)).toMatchObject({ sub: 'u1', email: 'a@b.c' });
  });

  it('fails the same way for unknown email and wrong password', async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(svc.login({ email: 'x', password: 'y' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    users.findByEmail.mockResolvedValue(user);
    users.verifyPassword.mockResolvedValue(false);
    await expect(svc.login({ email: 'a@b.c', password: 'bad' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects tampered tokens', async () => {
    await expect(svc.verify('not.a.token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signs the account version from the same password-validated user snapshot', async () => {
    const versioned = { ...user, authVersion: 3 };
    users.findByEmail.mockResolvedValue(versioned);
    users.verifyPassword.mockResolvedValue(true);
    const { access_token } = await svc.login({ email: user.email, password: 'pw' });
    expect(jwt.verify(access_token)).toMatchObject({ auth_version: 3 });
    expect(toPublicUser(versioned)).toEqual({
      id: user.id,
      email: user.email,
      fname: user.fname,
      lname: user.lname,
    });
  });
});
