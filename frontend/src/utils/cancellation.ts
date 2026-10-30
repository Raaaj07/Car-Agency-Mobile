/**
 * What to show as the reason on the "Ride Cancelled" screen.
 *
 * The reason string comes from the server and can be a sentence the rider
 * picked ("Changed my mind / No longer needed"), text an admin typed, or a
 * machine code written by the system (for example `no_drivers_available`).
 * Machine codes are turned into plain words; an empty reason returns null so
 * the screen can say "no reason given" instead of inventing one.
 */
const KNOWN_CODES: Record<string, string> = {
  no_drivers_available: 'No drivers were available nearby',
};

export function cancellationReasonText(reason: string | null | undefined): string | null {
  const text = reason?.trim();
  if (!text) return null;
  // Looks like a machine code (lower_snake_case, no spaces): make it readable.
  if (/^[a-z0-9]+(_[a-z0-9]+)*$/.test(text)) {
    const known = KNOWN_CODES[text];
    if (known) return known;
    const words = text.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return text;
}
