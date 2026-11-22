import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, checklistItemStateLabel, useOperativeJob, validateItemNote, type OperativeJob } from "@jobproof/shared";
import { CAPTURE_MSG, photoCount } from "../../capture/messages";
import { ReportLockedError } from "../../db/draftRepo";
import { useJobPhotos, useLocalStore } from "../../db/localStore";
import { ItemFullError, PhotoLockedError, type PhotoRow } from "../../db/photoRepo";
import { useAppBranding } from "../../theme/BrandingProvider";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { MUTED_TEXT } from "../../ui/colours";
import { TextField } from "../../ui/TextField";
import { GalleryImportButton } from "../capture/GalleryImport";
import { PhotoThumb } from "../capture/PhotoThumb";
import { useOwnerId } from "../capture/useOwner";
import { useCanEdit } from "./ChecklistSection";
import { ItemPicker } from "./ItemPicker";
import { useLocalView } from "./localView";
import { CHECKLIST_MSG } from "./messages";
import { useAutosave } from "./useAutosave";

function Frame({ jobId, children }: { jobId: string; children: React.ReactNode }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/jobs/${jobId}`));
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.body} testID="item-screen" keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" accessibilityLabel="Back to the job" onPress={back} style={styles.back} testID="item-back">
        <Text style={[styles.backText, { color: theme.primary }]}>{"‹"} Job</Text>
      </Pressable>
      {children}
    </ScrollView>
  );
}

function Unavailable({ jobId }: { jobId: string }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  return (
    <Frame jobId={jobId}>
      <View style={styles.group} testID="item-unavailable">
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {CHECKLIST_MSG.unavailable}
        </Text>
        <Button label="Back to the job" onPress={() => router.replace(`/jobs/${jobId}`)} testID="item-unavailable-back" />
      </View>
    </Frame>
  );
}

/** The note field. Keyed by item and kind, so it starts from the stored text for the item it is shown for. */
function NoteField({ serverJob, itemId, notDone, stored, editable }: { serverJob: OperativeJob; itemId: string; notDone: boolean; stored: string | null; editable: boolean }) {
  const store = useLocalStore();
  const owner = useOwnerId();
  const { theme } = useAppBranding();
  const serverItem = serverJob.checklist.find((i) => i.id === itemId)!;
  const { text, error, onChange, flush } = useAutosave({
    stored,
    validate: validateItemNote,
    commit: (value) => {
      if (store && owner) store.drafts.setItem(owner, serverJob.id, itemId, { note: value }, { status: serverItem.status, note: serverItem.note });
    },
  });
  if (!editable) {
    return stored ? (
      <Text style={[styles.value, { color: theme.text }]} testID="item-note-text">
        {stored}
      </Text>
    ) : null;
  }
  return (
    <View style={styles.group}>
      <TextField
        label={notDone ? CHECKLIST_MSG.reasonLabel : CHECKLIST_MSG.noteLabel}
        value={text}
        onChangeText={onChange}
        onBlur={flush}
        error={error}
        multiline
        textAlignVertical="top"
        autoCapitalize="sentences"
        testID="item-note-input"
      />
      {notDone && text.trim() === "" ? (
        <Text style={[styles.hint, { color: theme.text }]} testID="item-reason-help">
          {CHECKLIST_MSG.reasonHelp}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One checklist item (T-003f): Done, "Can't do this" with a reason, a note (500), its photos and
 * "Add photo". Everything is saved to the phone as it is typed or tapped; the sync engine sends it.
 */
export function ItemScreen({ jobId, itemId }: { jobId: string; itemId: string }) {
  const query = useOperativeJob(jobId);
  const job = query.data;
  if (!job) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return gone || !query.isPending ? <Unavailable jobId={jobId} /> : <Frame jobId={jobId}><Text testID="item-loading">Loading…</Text></Frame>;
  }
  return <ItemBody job={job} itemId={itemId} />;
}

function ItemBody({ job, itemId }: { job: OperativeJob; itemId: string }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  const store = useLocalStore();
  const owner = useOwnerId();
  const view = useLocalView(job);
  const editable = useCanEdit(job);
  const allPhotos = useJobPhotos(job.id);
  const [moving, setMoving] = useState<PhotoRow | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

  const serverItem = job.checklist.find((i) => i.id === itemId);
  const item = view.job.checklist.find((i) => i.id === itemId);
  if (!store || !owner || !serverItem || !item) return <Unavailable jobId={job.id} />;

  const live = view.job.checklist.filter((i) => !i.removed);
  const number = live.findIndex((i) => i.id === itemId) + 1;
  const photos = allPhotos.filter((p) => p.checklist_item_id === itemId);
  const base = { status: serverItem.status, note: serverItem.note };

  function setStatus(status: "done" | "not_done") {
    try {
      store!.drafts.setItem(owner!, job.id, itemId, { status: item!.status === status ? "open" : status }, base);
      setProblem(undefined);
    } catch (e) {
      setProblem(e instanceof ReportLockedError ? CHECKLIST_MSG.locked : CHECKLIST_MSG.saveFailed);
    }
  }

  function addPhoto() {
    const room = store!.capture.room({ ownerUserId: owner!, jobId: job.id, stage: store!.photos.lastStage(owner!), itemId });
    if (!room.ok) {
      setProblem(room.message);
      return;
    }
    setProblem(undefined);
    router.push(`/jobs/${job.id}/camera?itemId=${itemId}`);
  }

  function move(target: string | null) {
    const photo = moving;
    setMoving(undefined);
    if (!photo) return;
    try {
      store!.photos.setItem(owner!, photo.id, target);
      setProblem(undefined);
    } catch (e) {
      setProblem(e instanceof ItemFullError ? CAPTURE_MSG.itemFull : e instanceof PhotoLockedError ? e.message : CAPTURE_MSG.saveFailed);
    }
  }

  const stateText = checklistItemStateLabel(item);
  return (
    <Frame jobId={job.id}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} testID="item-title">
        {item.label}
      </Text>
      <Text style={[styles.value, { color: MUTED_TEXT }]} testID="item-position">
        {item.removed ? "Removed by the office" : `Item ${number} of ${live.length}`}
      </Text>
      <Text
        style={[styles.value, { color: theme.text, fontWeight: "600" }]}
        accessibilityLiveRegion="polite"
        testID="item-state"
      >
        {stateText}
      </Text>
      {item.removed ? <Notice kind="offline" message={CHECKLIST_MSG.removedByOffice} testID="item-removed" /> : null}
      {editable && !item.removed ? (
        <View style={styles.group}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.status === "done" }}
            accessibilityLabel="Done"
            onPress={() => setStatus("done")}
            style={[styles.choice, { borderColor: theme.primary, backgroundColor: item.status === "done" ? theme.primary : theme.background }]}
            testID="item-done"
          >
            <Text style={[styles.choiceText, { color: item.status === "done" ? theme.onPrimary : theme.primary }]}>{item.status === "done" ? "✓ Done" : "Done"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.status === "not_done" }}
            accessibilityLabel="Can't do this"
            onPress={() => setStatus("not_done")}
            style={[styles.choice, { borderColor: theme.primary, backgroundColor: item.status === "not_done" ? theme.primary : theme.background }]}
            testID="item-cant-do"
          >
            <Text style={[styles.choiceText, { color: item.status === "not_done" ? theme.onPrimary : theme.primary }]}>
              {item.status === "not_done" ? "✕ Can't do this" : "Can't do this"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <NoteField key={itemId} serverJob={job} itemId={itemId} notDone={item.status === "not_done"} stored={item.note} editable={editable} />
      {problem ? <Notice kind="error" message={problem} testID="item-problem" /> : null}

      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Photos
      </Text>
      <Text style={[styles.value, { color: theme.text }]} testID="item-photo-count" accessibilityLiveRegion="polite">
        {photoCount(photos.length)}
      </Text>
      {editable ? (
        <>
          <Button label="Add photo" onPress={addPhoto} testID="item-add-photo" />
          <GalleryImportButton jobId={job.id} itemId={itemId} testID="item-gallery" />
        </>
      ) : null}
      <View style={styles.group}>
        {photos.map((p) => (
          <View key={p.id} style={styles.photoRow} testID={`item-photo-${p.id}`}>
            <PhotoThumb photo={p} onPress={() => router.push(`/jobs/${job.id}/photos/${p.id}`)} />
            {editable ? <Button label="Move to another item" variant="secondary" onPress={() => setMoving(p)} testID={`item-move-${p.id}`} /> : null}
          </View>
        ))}
      </View>
      <ItemPicker visible={moving !== undefined} items={view.job.checklist} currentItemId={itemId} onPick={move} onCancel={() => setMoving(undefined)} />
    </Frame>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14 },
  back: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  backText: { fontSize: 18, fontWeight: "700" },
  group: { gap: 10 },
  title: { fontSize: 24, fontWeight: "700" },
  heading: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  value: { fontSize: 18 },
  hint: { fontSize: 16 },
  choice: { minHeight: 56, borderWidth: 2, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  choiceText: { fontSize: 18, fontWeight: "700" },
  photoRow: { flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" },
});
