import { useEffect, useRef, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { formatTime } from "@jobproof/shared";
import { useJobPhotos, useLocalStore } from "../../db/localStore";
import type { Stage } from "../../db/photoRepo";
import { CAPTURE_MSG, photoCount } from "../../capture/messages";
import type { StorageStatus } from "../../capture/captureService";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Button } from "../../ui/Button";
import { CAMERA_BAR, CAMERA_BG, ON_CAMERA } from "../../ui/colours";
import { GalleryImportButton } from "./GalleryImport";
import { StageButtons } from "./StageButtons";
import { useOwnerId } from "./useOwner";

/** The shutter is at least 72 dp (T-003e): large enough for a gloved thumb. */
export const SHUTTER_SIZE = 80;

/**
 * The in-app camera (T-003e). The camera stays mounted between shots; the shutter is only
 * unavailable while the camera itself is taking the picture, and saving happens in the
 * background, so the next shot is ready straight away (NFR-3). The photo goes into app-private
 * storage, never the phone's gallery (P6). The job, stage and item are read when the shutter is
 * pressed, so leaving for another job cannot move a photo that is still being saved.
 */
export function CameraScreen({ jobId, itemId }: { jobId: string; itemId?: string }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  const store = useLocalStore();
  const owner = useOwnerId();
  const photos = useJobPhotos(jobId);
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const taking = useRef(false);
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<Stage>(() => (store && owner ? store.photos.lastStage(owner) : "before"));
  const [message, setMessage] = useState<string | undefined>();
  const [storage, setStorage] = useState<StorageStatus>(() => store?.capture.storageStatus() ?? "ok");
  const [lastId, setLastId] = useState<string | undefined>();

  // Remember which job the camera is open for: if the app dies mid-save, recovery attaches the file to it.
  useEffect(() => {
    if (store && owner) store.photos.setCaptureIntent(owner, jobId);
  }, [store, owner, jobId]);

  if (!store || !owner) return null;

  function chooseStage(s: Stage) {
    setStage(s);
    store!.photos.setLastStage(owner!, s);
  }

  async function shoot() {
    if (taking.current || !cameraRef.current) return;
    const target = { ownerUserId: owner!, jobId, stage, itemId: itemId ?? null };
    const room = store!.capture.room(target);
    setStorage(store!.capture.storageStatus());
    if (!room.ok) {
      setMessage(room.message);
      return;
    }
    setMessage(undefined);
    taking.current = true;
    let shot;
    try {
      shot = await cameraRef.current.takePictureAsync({ exif: true, skipProcessing: false });
    } catch {
      setMessage(CAPTURE_MSG.saveFailed);
      return;
    } finally {
      taking.current = false;
    }
    // Saving continues without holding up the next shot.
    void store!.capture.saveShot(target, shot).then((result) => {
      setStorage(store!.capture.storageStatus());
      if (result.ok) setLastId(result.photo.id);
      else setMessage(result.message);
    });
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace(`/jobs/${jobId}`));
  const last = photos.find((p) => p.id === lastId) ?? undefined;

  const header = (
    <View style={[styles.top, { backgroundColor: CAMERA_BAR }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={back} style={styles.done} testID="camera-done">
        <Text style={styles.doneText}>{"‹"} Done</Text>
      </Pressable>
      <Text style={styles.counter} accessibilityLiveRegion="polite" testID="camera-counter">
        {photoCount(photos.length)}
      </Text>
    </View>
  );

  if (!permission) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.background }]} testID="camera-loading">
        <Text accessibilityRole="progressbar" style={[styles.text, { color: theme.text }]}>
          Checking the camera…
        </Text>
      </View>
    );
  }

  if (!permission.granted) {
    const denied = asked || permission.status === "denied";
    const canAsk = permission.canAskAgain;
    return (
      <View style={[styles.fill, styles.pad, { backgroundColor: theme.background }]} testID={denied ? "camera-denied" : "camera-rationale"}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {denied ? "Camera is off" : "Allow the camera"}
        </Text>
        <Text style={[styles.text, { color: theme.text }]} testID="camera-permission-text">
          {denied ? CAPTURE_MSG.cameraDenied : CAPTURE_MSG.cameraNeeded}
        </Text>
        {canAsk ? (
          <Button
            label="Allow camera"
            onPress={() => {
              setAsked(true);
              void requestPermission();
            }}
            testID="camera-allow"
          />
        ) : (
          <Button label="Open settings" onPress={() => void Linking.openSettings()} testID="camera-open-settings" />
        )}
        <GalleryImportButton jobId={jobId} itemId={itemId} testID="camera-gallery-fallback" />
        <Button label="Back to the job" onPress={back} variant="secondary" testID="camera-back" />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: CAMERA_BG }]} testID="camera-screen">
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash="off"
        mode="picture"
        animateShutter
        onCameraReady={() => setReady(true)}
        onMountError={() => setMessage(CAPTURE_MSG.cameraUnavailable)}
        testID="camera-view"
      />
      {header}
      <View style={styles.spacer} pointerEvents="none" />
      {storage !== "ok" ? (
        <Text style={[styles.banner, { backgroundColor: CAMERA_BAR }]} accessibilityLiveRegion="polite" testID="storage-banner">
          {storage === "full" ? CAPTURE_MSG.storageFull : CAPTURE_MSG.storageLow}
        </Text>
      ) : null}
      {message ? (
        <Text style={[styles.banner, { backgroundColor: CAMERA_BAR }]} accessibilityLiveRegion="assertive" testID="camera-message">
          {message}
        </Text>
      ) : null}
      <View style={[styles.bottom, { backgroundColor: CAMERA_BAR }]}>
        <GalleryImportButton jobId={jobId} itemId={itemId} testID="camera-gallery" />
        <StageButtons value={stage} onChange={chooseStage} onDark testIDPrefix="camera-stage" />
        <View style={styles.shutterRow}>
          <View style={styles.side}>
            {last ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Last photo, taken ${formatTime(last.taken_at)}. Opens it`} onPress={() => router.push(`/jobs/${jobId}/photos/${last.id}`)} testID="camera-last" style={styles.lastBox}>
                <Image source={{ uri: store.files.uri(last.thumb_path ?? last.original_path) }} style={styles.lastImage} accessibilityIgnoresInvertColors />
                <Text style={styles.lastTime} testID="camera-last-time">
                  {formatTime(last.taken_at)}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={{ disabled: !ready }}
            disabled={!ready}
            onPress={() => void shoot()}
            testID="shutter"
            style={({ pressed }) => [styles.shutter, { opacity: !ready ? 0.5 : pressed ? 0.8 : 1 }]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.side} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 20, gap: 16, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700" },
  text: { fontSize: 18, lineHeight: 26 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12 },
  done: { minHeight: 56, minWidth: 96, justifyContent: "center" },
  doneText: { color: ON_CAMERA, fontSize: 20, fontWeight: "700" },
  counter: { color: ON_CAMERA, fontSize: 20, fontWeight: "700" },
  spacer: { flex: 1 },
  banner: { color: ON_CAMERA, fontSize: 18, fontWeight: "600", padding: 12, textAlign: "center" },
  bottom: { padding: 12, gap: 12 },
  shutterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  side: { width: 110, alignItems: "center" },
  shutter: { width: SHUTTER_SIZE, height: SHUTTER_SIZE, borderRadius: SHUTTER_SIZE / 2, borderWidth: 4, borderColor: ON_CAMERA, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: ON_CAMERA },
  lastBox: { alignItems: "center", minHeight: 56, minWidth: 56 },
  lastImage: { width: 56, height: 56, borderRadius: 6 },
  lastTime: { color: ON_CAMERA, fontSize: 14, fontWeight: "700" },
});
