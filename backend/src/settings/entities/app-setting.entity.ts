import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Operator-editable runtime settings (one row per key). Today it only holds
 * the driver search radius, but the shape is generic so the next admin knob
 * does not need a new table. Values are stored as strings and parsed by the
 * SettingsService that owns the key.
 */
@Entity('app_settings')
export class AppSettingEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'varchar', length: 255 })
  value!: string;

  // Admin user id that last changed the value (null for the built-in default).
  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy: string | null = null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
