import { UserEntity } from '@gearapps/api/data-access';
import {
  AccessTokenPayload,
  CreateUser,
  PublicUser,
  UpdateUser,
  User,
} from '@gearapps/shared/domain';
import { RequestUser } from '@gearapps/api/core';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

const BCRYPT_ROUNDS = 10;

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  fname: user.fname,
  lname: user.lname,
});

@Injectable()
export class UsersService {
  constructor(@InjectRepository(UserEntity) private readonly repo: Repository<User>) {}

  registrationEnabled(): boolean {
    return true;
  }

  async validateToken(payload: AccessTokenPayload): Promise<RequestUser> {
    const user = await this.findOne(payload.sub);
    return { userId: user.id, email: user.email, fname: user.fname, lname: user.lname };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Returns null (rather than throwing) so auth can fail without leaking which emails exist. */
  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email: email.toLowerCase() });
  }

  async create(data: CreateUser): Promise<User> {
    const email = data.email.toLowerCase();
    if (await this.repo.existsBy({ email })) {
      throw new ConflictException(`User '${email}' already exists`);
    }
    const password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    return this.repo.save(this.repo.create({ ...data, email, password }));
  }

  async update(id: string, data: UpdateUser): Promise<User> {
    await this.findOne(id);
    const patch: UpdateUser = { ...data };
    if (patch.email) patch.email = patch.email.toLowerCase();
    if (patch.password) patch.password = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
    await this.repo.save({ ...patch, id });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.repo.remove(user);
  }

  verifyPassword(user: User, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, user.password);
  }
}
