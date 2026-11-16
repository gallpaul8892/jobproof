import { forwardRef, useCallback, useEffect, useImperativeHandle, type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { makePlaceholderJpeg, type CanvasFactory, browserCanvas } from "../placeholder";

/**
 * Stand-in for expo-camera in the browser demo. There is no real camera: no getUserMedia call, so
 * the browser never asks for camera or microphone access. The "shutter" takes a generated
 * placeholder JPEG, one per press, numbered so they can be told apart.
 */
export interface CameraPermission {
  granted: boolean;
  status: "granted";
  canAskAgain: boolean;
  expires: "never";
}
const GRANTED: CameraPermission = { granted: true, status: "granted", canAskAgain: true, expires: "never" };

export function useCameraPermissions(): [CameraPermission, () => Promise<CameraPermission>] {
  const request = useCallback(async () => GRANTED, []);
  return [GRANTED, request];
}

export interface CameraHandle {
  takePictureAsync(options?: unknown): Promise<{ uri: string; width: number; height: number }>;
}

let canvasFactory: CanvasFactory = browserCanvas;
/** For tests: draw on something other than a real canvas. */
export function setCameraCanvasFactory(factory: CanvasFactory): void {
  canvasFactory = factory;
}

let shots = 0;
const HUES = [210, 28, 160, 330, 48, 270];

export interface CameraViewProps {
  style?: StyleProp<ViewStyle>;
  onCameraReady?: () => void;
  onMountError?: (event: { message: string }) => void;
  testID?: string;
  children?: ReactNode;
  // The real component takes more; the demo accepts and ignores what the app passes.
  facing?: string;
  flash?: string;
  mode?: string;
  animateShutter?: boolean;
}

export const CameraView = forwardRef<CameraHandle, CameraViewProps>(function CameraView({ style, onCameraReady, testID }, ref) {
  useImperativeHandle(ref, () => ({
    async takePictureAsync() {
      shots += 1;
      const image = makePlaceholderJpeg({ title: "Demo photo", subtitle: `Taken with the demo camera, shot ${shots}`, hue: HUES[shots % HUES.length]! }, canvasFactory);
      return { uri: image.uri, width: image.width, height: image.height };
    },
  }));
  useEffect(() => {
    onCameraReady?.();
  }, [onCameraReady]);
  return (
    <View style={[styles.fill, style]} testID={testID} accessibilityLabel="Demo camera view">
      <Text style={styles.text}>Demo camera</Text>
      <Text style={styles.small}>No real camera is used. Press the round button to take a sample photo.</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { backgroundColor: "#2b3138", alignItems: "center", justifyContent: "center", padding: 24 },
  text: { color: "#ffffff", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  small: { color: "#d5dae0", fontSize: 16, textAlign: "center" },
});
