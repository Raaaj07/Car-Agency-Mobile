// UPI deep-link helpers for the driver's payment QR (GPay / PhonePe / Paytm
// all understand the standard `upi://pay` intent, so a single QR works for
// every UPI app).

/** Basic VPA sanity check: name@bank (letters, digits, ., -, _ before @). */
export function isValidUpiId(vpa: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa.trim());
}

/**
 * Builds the UPI payment intent encoded into the QR code.
 * `amount` is the exact ride cost (fare total + any tip) so the payer's app
 * pre-fills the correct value and cannot edit the note.
 *
 * The payee address (`pa`) is written WITHOUT percent-encoding: a validated
 * VPA only contains letters, digits and `. _ - @`, all URL-safe, and the NPCI
 * linking spec / several UPI apps expect a literal `@` — `name%40bank` makes
 * some of them reject the scan ("invalid QR"). Free text (payee name, note)
 * is encoded.
 */
export function buildUpiPaymentUrl(params: {
  vpa: string;
  payeeName: string;
  amount: number;
  note?: string;
}): string {
  const { vpa, payeeName, amount, note } = params;
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const parts = [
    `pa=${vpa.trim()}`,
    `pn=${encodeURIComponent(payeeName)}`,
    `am=${safeAmount.toFixed(2)}`,
    'cu=INR',
  ];
  if (note) parts.push(`tn=${encodeURIComponent(note)}`);
  return `upi://pay?${parts.join('&')}`;
}
