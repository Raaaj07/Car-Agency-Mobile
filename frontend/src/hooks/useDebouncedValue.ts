import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has been stable for `delayMs` — used for the admin
 * search bars (300 ms debounce, A-9: no extra renders per keystroke).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
