/**
 * Promo code entry on the ride summary. Pure (no React / network imports), so
 * the rules run in plain Jest. The server decides everything that matters
 * (POST /promos/validate, and again when the ride is booked); these helpers
 * only clean the typed text and turn the server's answer into a decision.
 */

export const PROMO_CODE_MIN_LENGTH = 3;
export const PROMO_CODE_MAX_LENGTH = 30;

/** What the rider typed, the way the server compares it: trimmed, upper case. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** A message when the text can not be a code at all (nothing is sent), else null. */
export function promoCodeProblem(code: string): string | null {
  if (!code) return 'Enter a promo code.';
  if (code.length < PROMO_CODE_MIN_LENGTH || code.length > PROMO_CODE_MAX_LENGTH) {
    return `A promo code has ${PROMO_CODE_MIN_LENGTH} to ${PROMO_CODE_MAX_LENGTH} characters.`;
  }
  return null;
}

export interface ValidationAnswer {
  valid: boolean;
  discountAmount: number;
  message: string;
}

export type PromoDecision =
  | { ok: true; code: string; discountAmount: number }
  | { ok: false; message: string };

/**
 * The server's answer -> apply the code or show why not. A "valid" answer with
 * an unusable amount is treated as a failure rather than applying a bad number.
 */
export function promoDecision(answer: ValidationAnswer, code: string): PromoDecision {
  const amount = Number(answer.discountAmount);
  if (answer.valid && Number.isFinite(amount) && amount >= 0) {
    return { ok: true, code, discountAmount: Math.round(amount) };
  }
  return { ok: false, message: answer.message?.trim() || 'This promo code can not be applied.' };
}
