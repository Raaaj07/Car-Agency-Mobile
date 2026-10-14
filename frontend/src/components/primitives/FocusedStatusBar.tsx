import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';

interface Props {
  /** 'light' = white icons (use on navy/dark backgrounds), 'dark' = dark icons. */
  style?: 'light' | 'dark';
}

/**
 * Status-bar style for ONE screen. App.tsx sets a global dark status bar, which
 * makes the clock/battery icons invisible on navy screens (sign-in hero, driver
 * dashboard header, admin hero). Render this on such a screen: it only applies
 * while the screen is focused, and the previous style comes back automatically
 * when it blurs or unmounts (stack screens stay mounted underneath).
 */
export const FocusedStatusBar: React.FC<Props> = ({ style = 'light' }) => {
  const isFocused = useIsFocused();
  return isFocused ? <StatusBar style={style} /> : null;
};
