import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatTime, validateCaption } from "@jobproof/shared";
import { useLocalPhoto, useLocalStore, useReportEditable } from "../../db/localStore";
import { PhotoLockedError, STAGE_LABEL, type Stage } from "../../db/photoRepo";
import { CAPTURE_MSG } from "../../capture/messages";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { MUTED_TEXT } from "../../ui/colours";
import { TextField } from "../../ui/TextField";
import { StageButtons } from "./StageButtons";
import { ZoomableImage } from "./ZoomableImage";
import { useOwnerId } from "./useOwner";

/**
 * One photo, full screen (T-003e scenarios 7 to 9): pinch to zoom, its stage, time and caption,
 * and, while the report is not submitted, changing the stage, the caption and Delete photo.
 * There is deliberately no crop, rotate, filter or draw anywhere (P3): the picture is evidence.
 */
export function PhotoViewerScreen({ jobId, photoId }: { jobId: string; photoId: string }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  const store = useLocalStore();
  const owner = useOwnerId();
  const photo = useLocalPhoto(photoId);
  const editable = useReportEditable(jobId);
  const [caption, setCaption] = useState<string | undefined>();
  const [captionError, setCaptionError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const back = () => (router.canGoBack() ? router.back() : router.replace(`/jobs/${jobId}`));

  // A photo is only ever shown under the job it belongs to, and only to its owner.
  if (!store || !owner || !photo || photo.job_id !== jobId) {
    return (
      <View style={[styles.body, { backgroundColor: theme.background, flex: 1 }]} testID="photo-unavailable">
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {CAPTURE_MSG.notAvailable}
        </Text>
        <Button label="Back to the job" onPress={back} testID="photo-unavailable-back" />
      </View>
    );
  }

  const shownCaption = caption ?? photo.caption ?? "";
  const dirty = shownCaption !== (photo.caption ?? "");

  function changeStage(stage: Stage) {
    try {
      store!.photos.setStage(owner!, photo!.id, stage);
      store!.photos.setLastStage(owner!, stage);
      setProblem(undefined);
    } catch (e) {
      setProblem(e instanceof PhotoLockedError ? e.message : CAPTURE_MSG.saveFailed);
    }
  }

  function saveCaption() {
    const result = validateCaption(shownCaption);
    if (!result.ok) {
      setCaptionError(result.message); // the text stays exactly as typed
      return;
    }
    try {
      store!.photos.setCaption(owner!, photo!.id, result.value);
      setCaption(undefined);
      setCaptionError(undefined);
    } catch (e) {
      setProblem(e instanceof PhotoLockedError ? e.message : CAPTURE_MSG.saveFailed);
    }
  }

  async function remove() {
    setConfirming(false);
    try {
      await store!.capture.deletePhoto(owner!, photo!.id);
      back();
    } catch (e) {
      setProblem(e instanceof PhotoLockedError ? e.message : CAPTURE_MSG.saveFailed);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.body} testID="photo-screen">
      <Pressable accessibilityRole="button" accessibilityLabel="Back to the job" onPress={back} style={styles.back} testID="photo-back">
        <Text style={[styles.backText, { color: theme.primary }]}>{"‹"} Job</Text>
      </Pressable>
      <ZoomableImage uri={store.files.uri(photo.original_path)} label={`${STAGE_LABEL[photo.stage]} photo taken ${formatTime(photo.taken_at)}`} />
      <View accessible accessibilityLabel={`Stage: ${STAGE_LABEL[photo.stage]}. Taken ${formatTime(photo.taken_at)}${photo.source === "gallery" ? ". From gallery" : ""}`} style={styles.facts} testID="photo-facts">
        <Text style={[styles.title, { color: theme.text }]} testID="photo-stage-text">
          {STAGE_LABEL[photo.stage]}
        </Text>
        <Text style={[styles.value, { color: theme.text }]} testID="photo-time">
          {formatTime(photo.taken_at)}
        </Text>
        {photo.source === "gallery" ? (
          <Text style={[styles.value, { color: MUTED_TEXT }]} testID="photo-from-gallery">
            From gallery
          </Text>
        ) : null}
        {photo.recovered ? (
          <Text style={[styles.value, { color: MUTED_TEXT }]} testID="photo-recovered">
            {CAPTURE_MSG.recovered}
          </Text>
        ) : null}
        {!editable && photo.caption ? (
          <Text style={[styles.value, { color: theme.text }]} testID="photo-caption-text">
            {photo.caption}
          </Text>
        ) : null}
      </View>
      {problem ? (
        <Text style={[styles.value, { color: theme.text }]} accessibilityLiveRegion="polite" testID="photo-problem">
          {problem}
        </Text>
      ) : null}
      {editable ? (
        <>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
            Stage
          </Text>
          <StageButtons value={photo.stage} onChange={changeStage} testIDPrefix="photo-stage" />
          <TextField
            label="Caption (optional)"
            value={shownCaption}
            onChangeText={(t) => {
              setCaption(t);
              setCaptionError(undefined);
            }}
            error={captionError}
            testID="photo-caption-input"
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={saveCaption}
          />
          <Button label="Save caption" onPress={saveCaption} disabled={!dirty} testID="photo-caption-save" />
          <Button label="Delete photo" variant="secondary" onPress={() => setConfirming(true)} testID="photo-delete" />
        </>
      ) : (
        <Text style={[styles.value, { color: MUTED_TEXT }]} testID="photo-locked">
          This report has been submitted, so this photo can't be changed.
        </Text>
      )}
      <ConfirmDialog
        testID="photo-delete-confirm"
        visible={confirming}
        title="Delete photo"
        message={CAPTURE_MSG.deleteMessage}
        actions={[
          { label: "Keep photo", onPress: () => setConfirming(false), testID: "photo-delete-cancel", isDefault: true },
          { label: "Delete photo", onPress: () => void remove(), testID: "photo-delete-yes" },
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14 },
  back: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  backText: { fontSize: 18, fontWeight: "700" },
  facts: { gap: 2 },
  title: { fontSize: 22, fontWeight: "700" },
  heading: { fontSize: 20, fontWeight: "700" },
  value: { fontSize: 18 },
});
