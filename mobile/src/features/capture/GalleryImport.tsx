import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalStore } from "../../db/localStore";
import { useJobPhotos } from "../../db/localStore";
import { STAGE_LABEL, type Stage } from "../../db/photoRepo";
import type { PickedAsset } from "../../capture/gallery";
import { photoCount } from "../../capture/messages";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { SCRIM } from "../../ui/colours";
import { StageButtons } from "./StageButtons";
import { useOwnerId } from "./useOwner";

export type ImportNote = { kind: "info" | "error"; text: string };

/**
 * "Choose from gallery" (T-003e scenarios 5, 6, 12): the system picker, then ONE stage for every
 * picked photo, then each file is copied into the app. The result is written out ("4 photos
 * added", "1 file couldn't be added"). Closing the picker or the stage dialog adds nothing.
 */
export function GalleryImportButton({ jobId, itemId, variant = "secondary", testID = "gallery-import", onResult }: { jobId: string; itemId?: string | null; variant?: "primary" | "secondary"; testID?: string; onResult?: (note: ImportNote) => void }) {
  const { theme } = useAppBranding();
  const store = useLocalStore();
  const owner = useOwnerId();
  useJobPhotos(jobId); // keeps the note below in step with the photo count
  const [pending, setPending] = useState<PickedAsset[] | undefined>();
  const [stage, setStage] = useState<Stage>("before");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ImportNote | undefined>();

  if (!store || !owner) return null;
  const say = (n: ImportNote) => {
    setNote(n);
    onResult?.(n);
  };

  async function begin() {
    if (!store || !owner || busy) return;
    setNote(undefined);
    const room = store.capture.room({ ownerUserId: owner, jobId, stage, itemId });
    if (!room.ok) return say({ kind: "error", text: room.message });
    setBusy(true);
    try {
      const picked = await store.picker.pick({ selectionLimit: room.remaining });
      if (picked && picked.length > 0) {
        setStage(store.photos.lastStage(owner));
        setPending(picked);
      }
    } catch {
      say({ kind: "error", text: "Couldn't open the gallery." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const assets = pending;
    if (!store || !owner || !assets) return;
    setPending(undefined);
    setBusy(true);
    try {
      const summary = await store.capture.importAssets({ ownerUserId: owner, jobId, stage, itemId }, assets);
      say({ kind: summary.added === 0 && (summary.skipped > 0 || summary.limit) ? "error" : "info", text: summary.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Button label="Choose from gallery" onPress={() => void begin()} variant={variant} disabled={busy} testID={testID} />
      {note ? (
        note.kind === "error" ? (
          <Notice kind="error" message={note.text} testID={`${testID}-result`} />
        ) : (
          <Text style={[styles.info, { color: theme.text }]} accessibilityLiveRegion="polite" testID={`${testID}-result`}>
            {note.text}
          </Text>
        )
      ) : null}
      <Modal visible={pending !== undefined} transparent animationType="fade" onRequestClose={() => setPending(undefined)} accessibilityViewIsModal>
        <View style={[styles.scrim, { backgroundColor: SCRIM }]}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.card, { backgroundColor: theme.background }]} testID="gallery-stage-dialog" accessibilityViewIsModal>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
                Which stage?
              </Text>
              <Text style={[styles.message, { color: theme.text }]} testID="gallery-stage-message">
                {`Add ${photoCount(pending?.length ?? 0)} as ${STAGE_LABEL[stage]}.`}
              </Text>
              <StageButtons value={stage} onChange={setStage} testIDPrefix="gallery-stage" />
              <Button label={`Add ${photoCount(pending?.length ?? 0)}`} onPress={() => void confirm()} testID="gallery-stage-add" />
              <Button label="Cancel" onPress={() => setPending(undefined)} variant="secondary" testID="gallery-stage-cancel" />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  info: { fontSize: 18, fontWeight: "600" },
  scrim: { flex: 1, justifyContent: "center" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  card: { borderRadius: 12, padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  message: { fontSize: 18, lineHeight: 26 },
});
