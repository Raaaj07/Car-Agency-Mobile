import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User as FrontendUser } from '../../common/frontend-contracts';

export type UserRole = 'rider' | 'driver';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true })  // was: not nullable
  phone?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleId?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  appleId?: string | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  role?: UserRole | null;

  @Column({ type: 'varchar', length: 10, default: 'en' })
  language!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Maps this entity to the exact `User` shape the frontend's authStore
   * expects, so nothing needs remapping client-side.
   */
  toFrontendUser(): FrontendUser {
  return {
    name: this.name,
    phone: this.phone ?? '',
    ...(this.email ? { email: this.email } : {}),
    ...(this.avatar ? { avatar: this.avatar } : {}),
  };
}
}
