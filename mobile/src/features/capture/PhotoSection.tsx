import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useJobPhotos, useLocalStore } from "../../db/localStore";
import { STAGES, STAGE_LABEL, type Stage } from "../../db/photoRepo";
import { CAPTURE_MSG, photoCount } from "../../capture/messages";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { GalleryImportButton } from "./GalleryImport";
import { PhotoThumb } from "./PhotoThumb";
import { useOwnerId } from "./useOwner";

/**
 * Photos on the job screen (T-003e): Take photo, Choose from gallery, and the Before / During /
 * After groups. Everything shown is read from this phone's database, so it works with no signal.
 * `submitted` hides the add buttons (the report is closed).
 */
export function PhotoSection({ jobId, submitted = false }: { jobId: string; submitted?: boolean }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  const store = useLocalStore();
  const owner = useOwnerId();
  const photos = useJobPhotos(jobId);
  const [refusal, setRefusal] = useState<string | undefined>();
  if (!store || !owner) return null;

  const storage = store.capture.storageStatus();
  const locked = submitted || store.photos.reportState(owner, jobId) === "submitted";

  function takePhoto() {
    const room = store!.capture.room({ ownerUserId: owner!, jobId, stage: store!.photos.lastStage(owner!) });
    if (!room.ok) {
      setRefusal(room.message);
      return;
    }
    setRefusal(undefined);
    router.push(`/jobs/${jobId}/camera`);
  }

  const byStage = (s: Stage) => photos.filter((p) => p.stage === s);

  return (
    <View style={styles.section} testID="photo-section">
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Photos
      </Text>
      <Text style={[styles.count, { color: theme.text }]} testID="photo-count" accessibilityLiveRegion="polite">
        {photoCount(photos.length)}
      </Text>
      {storage !== "ok" ? <Notice kind={storage === "full" ? "error" : "offline"} message={storage === "full" ? CAPTURE_MSG.storageFull : CAPTURE_MSG.storageLow} testID="storage-banner" /> : null}
      {locked ? (
        <Text style={[styles.count, { color: theme.text }]} testID="photos-locked">
          {CAPTURE_MSG.locked}
        </Text>
      ) : (
        <>
          <Button label="Take photo" onPress={takePhoto} testID="take-photo" />
          <GalleryImportButton jobId={jobId} />
          {refusal ? <Notice kind="error" message={refusal} testID="photo-refusal" /> : null}
        </>
      )}
      {STAGES.map((s) => {
        const list = byStage(s);
        return (
          <View key={s} style={styles.group} testID={`photo-group-${s}`}>
            <Text accessibilityRole="header" style={[styles.groupTitle, { color: theme.text }]} testID={`photo-group-title-${s}`}>
              {`${STAGE_LABEL[s]} (${list.length})`}
            </Text>
            {list.length === 0 ? (
              <Text style={[styles.empty, { color: theme.text }]} testID={`photo-group-empty-${s}`}>
                {`No ${STAGE_LABEL[s].toLowerCase()} photos yet.`}
              </Text>
            ) : (
              <View style={styles.grid}>
                {list.map((p) => (
                  <PhotoThumb key={p.id} photo={p} onPress={() => router.push(`/jobs/${jobId}/photos/${p.id}`)} />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  heading: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  count: { fontSize: 18, fontWeight: "600" },
  group: { gap: 8 },
  groupTitle: { fontSize: 18, fontWeight: "700" },
  empty: { fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
