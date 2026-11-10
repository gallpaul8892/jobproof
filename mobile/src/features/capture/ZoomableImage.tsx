import { useState } from "react";
import { Image, PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Button } from "../../ui/Button";
import { CAMERA_BG } from "../../ui/colours";
import { MAX_SCALE, MIN_SCALE, zoomIn, zoomOut } from "../../capture/zoom";
import { ZoomController } from "../../capture/zoomController";

/**
 * Full-screen picture with pinch-to-zoom, drag when zoomed and double-tap to zoom in or out.
 * Two buttons do the same for people who cannot pinch (and for TalkBack). Nothing here edits the picture.
 */
export function ZoomableImage({ uri, label, testID = "photo-image" }: { uri: string; label: string; testID?: string }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [ctl] = useState(() => new ZoomController((scale, x, y) => setView({ scale, x, y })));
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => ctl.wants(e.nativeEvent.touches.length),
      onMoveShouldSetPanResponder: (e) => ctl.wants(e.nativeEvent.touches.length),
      onPanResponderGrant: (e) => ctl.grant(e.nativeEvent.touches),
      onPanResponderMove: (e, g) => ctl.move(e.nativeEvent.touches, g.dx, g.dy),
      onPanResponderRelease: (_e, g) => ctl.release(g.dx, g.dy, Date.now()),
    }),
  );
  const { scale, x, y } = view;

  const onLayout = (e: LayoutChangeEvent) => ctl.setFrame(e.nativeEvent.layout.width, e.nativeEvent.layout.height);

  return (
    <View style={styles.wrap}>
      <View style={styles.frame} onLayout={onLayout} {...responder.panHandlers} testID={`${testID}-frame`}>
        <Image
          source={{ uri }}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
          testID={testID}
          style={[styles.image, { transform: [{ translateX: x }, { translateY: y }, { scale }] }]}
        />
      </View>
      <View style={styles.buttons}>
        <Button label="Zoom out" variant="secondary" disabled={scale <= MIN_SCALE} onPress={() => ctl.apply(zoomOut(scale), x, y)} testID="photo-zoom-out" />
        <Button label="Zoom in" variant="secondary" disabled={scale >= MAX_SCALE} onPress={() => ctl.apply(zoomIn(scale), x, y)} testID="photo-zoom-in" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  frame: { height: 360, backgroundColor: CAMERA_BG, overflow: "hidden", borderRadius: 8 },
  image: { width: "100%", height: "100%" },
  buttons: { flexDirection: "row", gap: 10, justifyContent: "center" },
});
