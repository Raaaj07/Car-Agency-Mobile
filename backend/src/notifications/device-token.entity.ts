import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One row per installed app instance that registered for push. `token` is
 * unique: if the same device signs in as another user the row simply moves.
 * `sessionId` ties it to the login session (best-effort cleanup on logout).
 */
@Entity('device_tokens')
export class DeviceTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', nullable: true })
  sessionId?: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200 })
  token!: string;

  @Column({ type: 'varchar', length: 10, default: 'android' })
  platform!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
