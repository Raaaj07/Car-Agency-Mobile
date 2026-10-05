import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler'; // ADD
// D-4: must register the background location handler at global scope (before
// anything renders) — see src/lib/locationTask.ts.
import './src/lib/locationTask';
import { AppNavigator } from './src/navigation/AppNavigator';
import { colors } from './src/theme/theme';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.primary }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}