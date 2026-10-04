import { IsIn, IsString, Length } from 'class-validator';

/**
 * POST /admin/rides/:id/payment body — the admin's payment resolution (P-1):
 * `paid` settles the ride (paymentMarkedBy='admin'), `disputed` flags it for
 * follow-up. `note` explains the decision and is stored in the audit trail.
 */
export class ResolvePaymentDto {
  @IsIn(['paid', 'disputed'])
  status!: 'paid' | 'disputed';

  @IsString()
  @Length(5, 300)
  note!: string;
}
