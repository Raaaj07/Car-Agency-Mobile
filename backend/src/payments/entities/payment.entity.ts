import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PaymentMethod, PaymentStatus } from '../../rides/entities/ride.entity';

@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  rideId!: string;

  @Column({ type: 'varchar', length: 10 })
  method!: PaymentMethod;

  @Column({ type: 'int' })
  amount!: number; // rupees

  @Column({ type: 'varchar', length: 100 })
  providerOrderId!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  providerPaymentId?: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status!: PaymentStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
