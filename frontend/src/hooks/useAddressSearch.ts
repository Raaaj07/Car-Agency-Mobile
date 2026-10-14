/**
 * useAddressSearch – shared Mapbox address search with debounce.
 *
 * Used by the home sheet's inline "Where do you want to go?" input and the
 * Select Destination screen so both behave identically: 3+ characters,
 * 400 ms debounce, stale responses dropped by sequence number.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { searchAddress, GeocodeResult } from '../api/mapbox';

const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 3;

export interface AddressSearchApi {
  suggestions: GeocodeResult[];
  isSearching: boolean;
  /** Feed every keystroke (or '') — handles debounce, min length and staleness. */
  runSearch: (query: string) => void;
  /** Cancel any pending search and clear results (screen blur / mode exit). */
  resetSearch: () => void;
}

export function useAddressSearch(): AddressSearchApi {
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY_LENGTH) {
      seqRef.current += 1; // invalidate any in-flight response
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const seq = ++seqRef.current;
    debounceRef.current = setTimeout(() => {
      searchAddress(query)
        .then((results) => {
          if (seq === seqRef.current) setSuggestions(results);
        })
        .catch(() => {
          if (seq === seqRef.current) setSuggestions([]);
        })
        .finally(() => {
          if (seq === seqRef.current) setIsSearching(false);
        });
    }, DEBOUNCE_MS);
  }, []);

  const resetSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    seqRef.current += 1;
    setSuggestions([]);
    setIsSearching(false);
  }, []);

  return { suggestions, isSearching, runSearch, resetSearch };
}
