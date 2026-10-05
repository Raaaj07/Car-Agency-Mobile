import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ImageStyle,
  LayoutChangeEvent,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  GestureStateChangeEvent,
  GestureUpdateEvent,
  PanGestureHandlerEventPayload,
  PinchGestureHandlerEventPayload,
  TapGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import { X, ExternalLink, RotateCcw } from 'lucide-react-native';
import { Button } from '../primitives/Button';
import { colors, radii, shadows, typography } from '../../theme/theme';

interface DocumentViewerModalProps {
  visible: boolean;
  title: string;
  mime: string | null;
  /** Signed, short-lived URL (Cloudinary docs). */
  url: string | null;
  /** Legacy inline fallback (local-disk docs). */
  base64?: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Called on error state / expired signed URL ("refetch" per spec §3.2). */
  onRetry?: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const ZOOM_HEIGHT = 420;
const ANIM_MS = 220;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Largest (screen-space) pan offset for a given scale inside a box. */
const maxOffset = (size: number, scale: number) => Math.max(0, (size * (scale - 1)) / 2);

/**
 * Fullscreen document viewer. Images zoom with real pinch/pan/double-tap on
 * BOTH platforms (A-15: `ScrollView maximumZoomScale` pinch-zooms iOS only) —
 * react-native-gesture-handler gestures driving `Animated` (reanimated is not
 * a dependency), scale clamped 1x–4x, reset whenever the modal closes. PDFs
 * hand off to the system viewer; failures offer a signed-URL refetch.
 */
export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  visible,
  title,
  mime,
  url,
  base64,
  loading = false,
  error = null,
  onClose,
  onRetry,
}) => {
  const { height } = useWindowDimensions();
  const isImage = !!mime?.startsWith('image/');
  const isPdf = mime === 'application/pdf';

  const source = url ?? (base64 && mime ? `data:${mime};base64,${base64}` : null);

  // Lazy init: reading useRef(...).current during render trips react-hooks/refs.
  const [scale] = useState(() => new Animated.Value(MIN_SCALE));
  const [translateX] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(0));

  // JS-side mirror of the animated values (gesture math reads these; the
  // listeners below keep them exact even mid-animation).
  const values = useRef({ scale: MIN_SCALE, tx: 0, ty: 0 });
  const pinchStart = useRef({ scale: MIN_SCALE, tx: 0, ty: 0 });
  const pinching = useRef(false);
  // null = "resync before applying the next pan delta" (after an interruption).
  const panLast = useRef<{ x: number; y: number } | null>(null);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const onBoxLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setBox((prev) => (prev.w === width && prev.h === h ? prev : { w: width, h }));
  }, []);

  useEffect(() => {
    const idS = scale.addListener(({ value }) => {
      values.current.scale = value;
    });
    const idX = translateX.addListener(({ value }) => {
      values.current.tx = value;
    });
    const idY = translateY.addListener(({ value }) => {
      values.current.ty = value;
    });
    return () => {
      scale.removeListener(idS);
      translateX.removeListener(idX);
      translateY.removeListener(idY);
    };
  }, [scale, translateX, translateY]);

  // Reset on close so the next document always opens at 1x, centred.
  useEffect(() => {
    if (visible) return;
    scale.stopAnimation();
    translateX.stopAnimation();
    translateY.stopAnimation();
    scale.setValue(MIN_SCALE);
    translateX.setValue(0);
    translateY.setValue(0);
  }, [visible, scale, translateX, translateY]);

  const apply = useCallback(
    (s: number, tx: number, ty: number) => {
      values.current = { scale: s, tx, ty };
      scale.setValue(s);
      translateX.setValue(tx);
      translateY.setValue(ty);
    },
    [scale, translateX, translateY],
  );

  // Gesture callbacks as useCallbacks: the react-hooks/refs rule rejects ref
  // closures created inline inside the render-time gesture builder below.
  const handlePinchStart = useCallback(() => {
    pinching.current = true;
    pinchStart.current = { ...values.current };
  }, []);

  const handlePinchUpdate = useCallback(
    (e: GestureUpdateEvent<PinchGestureHandlerEventPayload>) => {
      const s0 = pinchStart.current.scale;
      // Scale about the pinch focal point: keep the point under the fingers
      // fixed (T' = F - s'/s0 * (F - T0)).
      const next = clamp(s0 * e.scale, MIN_SCALE, MAX_SCALE);
      const ratio = next / s0;
      const fx = e.focalX - box.w / 2;
      const fy = e.focalY - box.h / 2;
      apply(
        next,
        clamp(fx - ratio * (fx - pinchStart.current.tx), -maxOffset(box.w, next), maxOffset(box.w, next)),
        clamp(fy - ratio * (fy - pinchStart.current.ty), -maxOffset(box.h, next), maxOffset(box.h, next)),
      );
    },
    [apply, box.w, box.h],
  );

  const handlePinchFinalize = useCallback(() => {
    pinching.current = false;
    panLast.current = null; // re-baseline pan so it never jumps
  }, []);

  const handlePanUpdate = useCallback(
    (e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      if (pinching.current) {
        panLast.current = null;
        return;
      }
      if (panLast.current === null) {
        // First frame after mount / a pinch — absorb the offset, don't jump.
        panLast.current = { x: e.translationX, y: e.translationY };
        return;
      }
      const dx = e.translationX - panLast.current.x;
      const dy = e.translationY - panLast.current.y;
      panLast.current = { x: e.translationX, y: e.translationY };
      const s = values.current.scale;
      apply(
        s,
        clamp(values.current.tx + dx, -maxOffset(box.w, s), maxOffset(box.w, s)),
        clamp(values.current.ty + dy, -maxOffset(box.h, s), maxOffset(box.h, s)),
      );
    },
    [apply, box.w, box.h],
  );

  const handlePanFinalize = useCallback(() => {
    panLast.current = null;
  }, []);

  const handleDoubleTap = useCallback(
    (_e: GestureStateChangeEvent<TapGestureHandlerEventPayload>, success: boolean) => {
      if (!success) return;
      const target = values.current.scale > MIN_SCALE + 0.05 ? MIN_SCALE : DOUBLE_TAP_SCALE;
      scale.stopAnimation();
      translateX.stopAnimation();
      translateY.stopAnimation();
      Animated.parallel([
        Animated.timing(scale, { toValue: target, duration: ANIM_MS, useNativeDriver: false }),
        Animated.timing(translateX, { toValue: 0, duration: ANIM_MS, useNativeDriver: false }),
        Animated.timing(translateY, { toValue: 0, duration: ANIM_MS, useNativeDriver: false }),
      ]).start();
    },
    [scale, translateX, translateY],
  );

  /* eslint-disable react-hooks/refs --
     Gesture only *stores* these callbacks here; RNGH invokes them from native
     touch events on the JS thread, never during render, so the captured refs
     (values/pinchStart/panLast/pinching) are only read from event handlers. */
  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Tap().numberOfTaps(2).maxDuration(300).onEnd(handleDoubleTap),
        Gesture.Simultaneous(
          Gesture.Pinch()
            .onStart(handlePinchStart)
            .onUpdate(handlePinchUpdate)
            .onFinalize(handlePinchFinalize),
          Gesture.Pan().onUpdate(handlePanUpdate).onFinalize(handlePanFinalize),
        ),
      ),
    [
      handleDoubleTap,
      handlePinchStart,
      handlePinchUpdate,
      handlePinchFinalize,
      handlePanUpdate,
      handlePanFinalize,
    ],
  );
  /* eslint-enable react-hooks/refs */

  const transform = useMemo(
    () => [{ translateX }, { translateY }, { scale }],
    [translateX, translateY, scale],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* RNGH needs a root view inside RN Modal (separate native hierarchy). */}
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.backdrop, { maxHeight: height }]}>
          <View style={[styles.sheet, { maxHeight: height * 0.88 }]}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close document viewer"
                hitSlop={10}
                style={styles.close}
              >
                <X size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.content}>
              {loading ? (
                <View style={styles.center}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.hint}>Loading document…</Text>
                </View>
              ) : error ? (
                <View style={styles.center}>
                  <Text style={styles.errorText}>{error}</Text>
                  {onRetry ? (
                    <Button
                      title="Refetch"
                      variant="outline"
                      size="small"
                      fullWidth={false}
                      onPress={onRetry}
                      leftIcon={<RotateCcw size={16} color={colors.primary} />}
                      style={styles.retryBtn}
                    />
                  ) : null}
                </View>
              ) : !source ? (
                <View style={styles.center}>
                  <Text style={styles.hint}>Document is not available.</Text>
                </View>
              ) : isImage ? (
                <GestureDetector gesture={gesture}>
                  <View style={styles.zoomBox} onLayout={onBoxLayout} collapsable={false}>
                    <Animated.View style={[styles.zoomLayer, { transform }]}>
                      <Animated.Image
                        source={{ uri: source }}
                        style={styles.image}
                        resizeMode="contain"
                      />
                    </Animated.View>
                  </View>
                </GestureDetector>
              ) : isPdf && url ? (
                <View style={styles.center}>
                  <Text style={styles.hint}>PDF preview is not available inline.</Text>
                  <Button
                    title="Open PDF"
                    variant="primary"
                    size="medium"
                    fullWidth={false}
                    onPress={() => void Linking.openURL(url)}
                    leftIcon={<ExternalLink size={16} color={colors.textLight} />}
                    style={styles.openBtn}
                  />
                </View>
              ) : (
                <View style={styles.center}>
                  <Text style={styles.hint}>Preview is not available for this file type.</Text>
                  {url ? (
                    <Button
                      title="Open file"
                      variant="outline"
                      size="small"
                      fullWidth={false}
                      onPress={() => void Linking.openURL(url)}
                      leftIcon={<ExternalLink size={16} color={colors.primary} />}
                      style={styles.openBtn}
                    />
                  ) : null}
                </View>
              )}
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    overflow: 'hidden',
    ...shadows.modal,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  title: {
    ...typography.cardTitle,
    flex: 1,
    marginRight: 12,
  },
  close: {
    padding: 2,
  },
  content: {
    padding: 12,
    minHeight: 260,
  },
  zoomBox: {
    height: ZOOM_HEIGHT,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  zoomLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  } as ImageStyle,
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  hint: {
    ...typography.body,
    textAlign: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  retryBtn: {
    marginTop: 4,
  },
  openBtn: {
    marginTop: 4,
  },
});
