import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row = one authenticated device session.
 *
 * Design goals (task 2):
 *  - Multiple devices can hold independent sessions (one row per device/login).
 *  - On every refresh the token is rotated: a new row is written with the new
 *    hash, and the old row's `previousTokenHash` keeps the old hash for a
 *    30-second grace window (handles lost-ACK retries).
 *  - If a rotated token is presented AFTER the grace window, the whole session
 *    family (same `familyId`) is revoked (replay attack detected).
 *  - `revokedAt` non-null means the session is dead; the token stored in
 *    `tokenHash` is no longer accepted.
 *  - Logout sets `revokedAt` only for the current session.
 *  - "Logout everywhere" sets `revokedAt` for all sessions of a user.
 */
@Entity('refresh_sessions')
export class RefreshSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  /**
   * All rotations of the same original login share a familyId. A replay
   * attack (stale token used after grace window) revokes the whole family.
   */
  @Index()
  @Column({ type: 'uuid' })
  familyId!: string;

  /** SHA-256 hash of the current refresh token for this session. */
  @Index('IDX_refresh_sessions_token_hash')
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  /**
   * SHA-256 hash of the immediately previous token, kept for a 30-second
   * grace window. Allows a client whose refresh response was lost in transit
   * to retry with the same token and get a fresh pair.
   */
  @Index('IDX_refresh_sessions_prev_hash')
  @Column({ type: 'varchar', length: 64, nullable: true })
  previousTokenHash?: string | null;

  /**
   * Timestamp when `previousTokenHash` was installed (i.e. when the previous
   * rotation happened). Used to expire the grace window.
   */
  @Column({ type: 'timestamptz', nullable: true })
  previousTokenAt?: Date | null;

  /** Human-readable label set at login time; helps users on the "sessions" list. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  deviceLabel?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt?: Date | null;

  @Index('IDX_refresh_sessions_expires')
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;
}
