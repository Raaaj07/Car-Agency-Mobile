import { Matches } from 'class-validator';

/** D-1: payee VPA stored on the driver profile (PATCH /drivers/me/upi-vpa). */
export class SetUpiVpaDto {
  // spec: name@handle — letters/digits/._- before the @, letters after.
  @Matches(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/, {
    message: 'vpa must be a valid UPI ID like name@bank',
  })
  vpa!: string;
}
