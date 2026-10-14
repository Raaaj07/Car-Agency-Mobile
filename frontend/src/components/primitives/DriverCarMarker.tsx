/**
 * DriverCarMarker — the live driver car on the map (rider "driver is coming" /
 * trip screens, and the driver's own navigation map).
 *
 * GPS fixes only arrive every few seconds, so rendering them directly makes the
 * car teleport. This marker instead glides from the previous fix to the new one
 * over (roughly) the time that elapsed between the two fixes, so it appears to
 * drive continuously, and it turns to face the direction of travel.
 *
 * Heading comes from the driver's device when the server relays it; otherwise
 * it is computed from the bearing between consecutive positions.
 *
 * All React state updates happen inside a requestAnimationFrame loop (capped at
 * ~30 fps) — never directly in an effect body.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MarkerView } from '@rnmapbox/maps';
import { CarTopDown } from './MapMarkers';

interface Point {
  lat: number;
  lng: number;
}

interface Pose extends Point {
  heading: number; // degrees, normalised to [0, 360)
}

interface Tween {
  from: Pose;
  to: Pose; // `to.heading` is "unwrapped" so interpolation takes the short way round
  start: number;
  duration: number;
}

interface Props {
  position: Point;
  /** Degrees, 0 = north, clockwise. Omit to derive from movement. */
  heading?: number | null;
}

const MIN_TWEEN_MS = 800;
const MAX_TWEEN_MS = 4500;
const DEFAULT_TWEEN_MS = 3000; // first update after mount (no previous fix to time against)
const TURN_MS = 600; // heading catches up faster than position
const FRAME_MS = 33; // ~30 fps is plenty for a slow-moving marker
const SNAP_DISTANCE_M = 400; // a bigger jump (reconnect, first real fix) is not driven — snap
const MIN_BEARING_MOVE_M = 3; // ignore GPS jitter when deriving heading from movement

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;
const angleDiff = (to: number, from: number) => norm360(to - from + 180) - 180;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Equirectangular distance — accurate to well under a metre at city scale. */
function metersBetween(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng);
}

/** Initial bearing from a to b in degrees (0 = north, clockwise). */
function bearingBetween(a: Point, b: Point): number {
  const phi1 = rad(a.lat);
  const phi2 = rad(b.lat);
  const dLambda = rad(b.lng - a.lng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return norm360((Math.atan2(y, x) * 180) / Math.PI);
}

export const DriverCarMarker: React.FC<Props> = ({ position, heading }) => {
  const [pose, setPose] = useState<Pose>(() => ({
    lat: position.lat,
    lng: position.lng,
    heading: heading != null && Number.isFinite(heading) ? norm360(heading) : 0,
  }));

  const poseRef = useRef<Pose>(pose); // what is currently on screen
  const tweenRef = useRef<Tween | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const lastFixAtRef = useRef(0);

  // Mirror of `pose` for the effect below; written in an effect (not during
  // render) to satisfy react-hooks/refs.
  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);

  useEffect(() => {
    const tick = (t: number) => {
      const tween = tweenRef.current;
      if (!tween) {
        rafRef.current = null;
        return;
      }
      if (t - lastFrameRef.current >= FRAME_MS) {
        lastFrameRef.current = t;
        const elapsed = Date.now() - tween.start;
        const p = tween.duration <= 0 ? 1 : Math.min(1, elapsed / tween.duration);
        const ph = tween.duration <= 0 ? 1 : Math.min(1, elapsed / Math.min(tween.duration, TURN_MS));
        const next: Pose = {
          lat: tween.from.lat + (tween.to.lat - tween.from.lat) * p,
          lng: tween.from.lng + (tween.to.lng - tween.from.lng) * p,
          heading: norm360(tween.from.heading + (tween.to.heading - tween.from.heading) * ph),
        };
        poseRef.current = next;
        setPose(next);
        if (p >= 1) {
          tweenRef.current = null;
          rafRef.current = null;
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const current = poseRef.current;
    const target: Point = { lat: position.lat, lng: position.lng };
    const distance = metersBetween(current, target);
    const hasHeading = heading != null && Number.isFinite(heading);
    if (distance < 0.5 && !hasHeading) return; // nothing to animate

    let nextHeading = current.heading;
    if (hasHeading) nextHeading = norm360(heading as number);
    else if (distance >= MIN_BEARING_MOVE_M) nextHeading = bearingBetween(current, target);

    const now = Date.now();
    const sinceLastFix = lastFixAtRef.current > 0 ? now - lastFixAtRef.current : DEFAULT_TWEEN_MS;
    lastFixAtRef.current = now;

    tweenRef.current = {
      from: { ...current },
      to: {
        ...target,
        heading: current.heading + angleDiff(nextHeading, current.heading),
      },
      start: now,
      // duration 0 = snap (applied on the first animation frame).
      duration:
        distance > SNAP_DISTANCE_M
          ? 0
          : Math.min(MAX_TWEEN_MS, Math.max(MIN_TWEEN_MS, sinceLastFix)),
    };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
    // `tick` reads everything it needs from refs, so a rerun with a new
    // position simply replaces tweenRef and the running loop picks it up.
  }, [position.lat, position.lng, heading]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      tweenRef.current = null;
    },
    [],
  );

  return (
    <MarkerView coordinate={[pose.lng, pose.lat]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
      {/* Square box big enough for the car at any rotation, so Android never
          clips the corners of the rotated view. */}
      <View style={styles.box} pointerEvents="none">
        <View style={{ transform: [{ rotate: `${pose.heading}deg` }] }}>
          <CarTopDown />
        </View>
      </View>
    </MarkerView>
  );
};

const styles = StyleSheet.create({
  box: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
