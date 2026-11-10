// Native modules that jest-expo does not mock. kv-store is an in-memory map reachable from tests.
const mockStore = new Map<string, string>();

jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: {
    getItemSync: (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null),
    setItemSync: (k: string, v: string) => void mockStore.set(k, v),
    removeItemSync: (k: string) => void mockStore.delete(k),
  },
}));

(globalThis as unknown as { __kvStore: Map<string, string> }).__kvStore = mockStore;

beforeEach(() => mockStore.clear());

// expo-secure-store has no JS fallback under Jest. In-memory map, reachable from tests.
const mockSecrets = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  __esModule: true,
  getItemAsync: async (k: string) => (mockSecrets.has(k) ? mockSecrets.get(k)! : null),
  setItemAsync: async (k: string, v: string) => void mockSecrets.set(k, v),
  deleteItemAsync: async (k: string) => void mockSecrets.delete(k),
}));
(globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore = mockSecrets;
beforeEach(() => mockSecrets.clear());

// expo-camera has no JS fallback under Jest. A controllable stand-in: tests set `__camera` fields.
interface CameraControl {
  permission: { granted: boolean; status: string; canAskAgain: boolean } | null;
  /** What the system dialog answers when the app asks. */
  onRequest: { granted: boolean; status: string; canAskAgain: boolean };
  requested: number;
  takePicture: (options?: unknown) => Promise<{ uri: string; width: number; height: number }>;
  taken: number;
}
const mockCamera: CameraControl = {
  permission: { granted: true, status: "granted", canAskAgain: true },
  onRequest: { granted: true, status: "granted", canAskAgain: true },
  requested: 0,
  takePicture: async () => ({ uri: "file:///cache/shot.jpg", width: 4000, height: 3000 }),
  taken: 0,
};
(globalThis as unknown as { __camera: CameraControl }).__camera = mockCamera;
beforeEach(() => {
  mockCamera.permission = { granted: true, status: "granted", canAskAgain: true };
  mockCamera.onRequest = { granted: true, status: "granted", canAskAgain: true };
  mockCamera.requested = 0;
  mockCamera.taken = 0;
  mockCamera.takePicture = async () => ({ uri: "file:///cache/shot.jpg", width: 4000, height: 3000 });
});

jest.mock("expo-camera", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require("react");
  const { View } = require("react-native");
  const control = (): CameraControl => (globalThis as unknown as { __camera: CameraControl }).__camera;
  const CameraView = React.forwardRef(function CameraView(props: { onCameraReady?: () => void; testID?: string }, ref: unknown) {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: (options: unknown) => {
        control().taken += 1;
        return control().takePicture(options);
      },
    }));
    React.useEffect(() => {
      props.onCameraReady?.();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return React.createElement(View, { testID: props.testID ?? "camera-view" });
  });
  function useCameraPermissions() {
    const [permission, setPermission] = React.useState(control().permission);
    const request = async () => {
      control().requested += 1;
      const next = control().onRequest;
      setPermission(next);
      return next;
    };
    return [permission, request, request];
  }
  return { __esModule: true, CameraView, useCameraPermissions };
});
