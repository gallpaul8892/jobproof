import { createRef } from "react";
import { Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { CameraView, setCameraCanvasFactory, useCameraPermissions, type CameraHandle } from "./camera";
import { fakeCanvasFactory } from "../support";

function Probe() {
  const [permission, request] = useCameraPermissions();
  return <Text>{`${permission.granted}:${permission.status}:${typeof request}`}</Text>;
}

describe("camera stand-in", () => {
  it("is always allowed and has nothing to ask the visitor", async () => {
    await render(<Probe />);
    expect(await screen.findByText("true:granted:function")).toBeTruthy();
  });

  it("says it is a demo camera, reports ready and takes numbered placeholder pictures", async () => {
    const { factory, made } = fakeCanvasFactory();
    setCameraCanvasFactory(factory);
    const ref = createRef<CameraHandle>();
    const ready = jest.fn();
    await render(<CameraView ref={ref} onCameraReady={ready} testID="camera-view" />);
    expect(screen.getByText("Demo camera")).toBeTruthy();
    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    const a = await ref.current!.takePictureAsync({ exif: true });
    const b = await ref.current!.takePictureAsync();
    expect(a.uri.startsWith("data:image/jpeg")).toBe(true);
    expect(a.uri).not.toBe(b.uri);
    expect([a.width, a.height]).toEqual([1280, 960]);
    expect(made[0]!.texts.some((t) => /shot \d+/.test(t))).toBe(true);
  });

  it("opens no real camera: no getUserMedia is ever called", async () => {
    const getUserMedia = jest.fn();
    Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia } }, configurable: true });
    const { factory } = fakeCanvasFactory();
    setCameraCanvasFactory(factory);
    const ref = createRef<CameraHandle>();
    await render(<CameraView ref={ref} />);
    await ref.current!.takePictureAsync();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
