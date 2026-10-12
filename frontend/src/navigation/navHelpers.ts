import { useEffect, useRef } from 'react';
import {
  CommonActions,
  NavigationState,
  PartialState,
  useNavigation,
} from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainTabParamList, RiderHomeStackParamList, RootStackParamList } from './types';
import { useRideStore } from '../store/rideStore';

export type RiderHomeStackNav = NativeStackNavigationProp<RiderHomeStackParamList>;
export type RiderTabNav = BottomTabNavigationProp<MainTabParamList>;
export type RootStackNav = NativeStackNavigationProp<RootStackParamList>;

/** Action types that would take the user backwards out of a screen. */
const BACK_ACTION_TYPES = new Set(['GO_BACK', 'POP', 'POP_TO', 'POP_TO_TOP']);

/**
 * Block back-style navigation (Android hardware back, iOS swipe-back, header
 * arrow) on a screen, optionally running `onBlocked` instead — e.g. FindingDriver
 * opens the cancel-confirmation modal, live-trip screens swallow the press.
 *
 * REPLACE/RESET are intentionally NOT blocked: the live-ride chain advances
 * itself with replace (FindingDriver → YouGotTheRide → …), and `usePreventRemove`
 * cannot be used here because it fires beforeRemove for *every* route-removing
 * action — it would also swallow our own replaces and wedge the ride flow.
 */
export function usePreventBack(onBlocked: () => void, prevent = true): void {
  const navigation = useNavigation<RiderHomeStackNav>();
  const blockedRef = useRef(onBlocked);
  useEffect(() => {
    blockedRef.current = onBlocked;
  });
  useEffect(() => {
    if (!prevent) return undefined;
    return navigation.addListener('beforeRemove', (event) => {
      if (BACK_ACTION_TYPES.has(event.data.action.type)) {
        event.preventDefault();
        blockedRef.current();
      }
    });
  }, [navigation, prevent]);
}

/**
 * Reset the rider Home stack to exactly [HomeDashboard, ...extra]. Used whenever
 * the booking/live chain must not leave stale screens underneath it.
 */
export function resetRiderHomeStack(
  nav: RiderHomeStackNav,
  extra: (keyof RiderHomeStackParamList)[] = [],
): void {
  nav.dispatch(
    CommonActions.reset({
      index: extra.length,
      routes: [{ name: 'HomeDashboard' }, ...extra.map((name) => ({ name }))],
    }),
  );
}

/**
 * Live-ride screens must never render without a ride (a dead page stuck on
 * "Searching…"/an empty map). If the ride vanished under them, go home.
 */
export function useRequireActiveRide(): void {
  const navigation = useNavigation<RiderHomeStackNav>();
  const activeRide = useRideStore((s) => s.activeRide);
  useEffect(() => {
    if (!activeRide) resetRiderHomeStack(navigation);
  }, [activeRide, navigation]);
}

/**
 * Cross-tab entry into the rider Home stack (Trips → Resume, Services tile).
 * Prune the Home stack back to its root first — so a half-finished booking can
 * never sit underneath the screen we're opening — then navigate into HomeTab.
 * The prune is a targeted RESET (only dispatched when there is something to
 * clear); if it is ever unhandled the plain navigate still behaves as before.
 */
export function enterRiderHome<S extends keyof RiderHomeStackParamList>(
  nav: BottomTabNavigationProp<MainTabParamList>,
  screen: S,
  params?: RiderHomeStackParamList[S],
): void {
  const homeRoute = nav.getState().routes.find((r) => r.name === 'HomeTab');
  const nested = homeRoute?.state;
  if (nested && typeof nested.key === 'string' && nested.routes.length > 1) {
    const rootRoute = nested.routes[0];
    nav.dispatch({
      // Rebuild the stack root as a plain partial route: a full route object
      // (with `state: NavigationState`, i.e. `stale: false`) is not assignable
      // to a reset payload, and HomeDashboard has no nested navigator anyway.
      ...CommonActions.reset({
        index: 0,
        routes: [{ name: rootRoute.name, key: rootRoute.key, params: rootRoute.params }],
      }),
      target: nested.key,
    });
  }
  // Dispatch (instead of the typed navigate) because the generic screen name
  // can't narrow through the NavigatorScreenParams overload.
  nav.dispatch(CommonActions.navigate('HomeTab', { screen, params }));
}

/**
 * Ride cancelled (by the rider or the driver): land on the outcome screen with
 * a fresh Main underneath it. A fresh Main re-initialises the tab navigator and
 * the Home stack at HomeDashboard, so the cancelled ride's booking/live screens
 * can never linger below RideCancelled, and no second Main is stacked (D4).
 */
export function goToRideCancelled(
  nav: RootStackNav,
  params?: RootStackParamList['RideCancelled'],
): void {
  nav.dispatch(
    CommonActions.reset({
      index: 1,
      routes: [{ name: 'Main' }, { name: 'RideCancelled', params }],
    }),
  );
}

/** Flattened focused-route path — used by the __DEV__ navigation logger. */
export function flattenRouteNames(
  state: NavigationState | PartialState<NavigationState> | undefined,
): string[] {
  const names: string[] = [];
  let current: NavigationState | PartialState<NavigationState> | undefined = state;
  while (current && current.routes.length > 0) {
    const focused = current.routes[current.index ?? current.routes.length - 1];
    if (!focused) break;
    names.push(focused.name);
    current = focused.state;
  }
  return names;
}
