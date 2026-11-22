import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  checklistItemStateLabel,
  checklistSummary,
  isFinishedJob,
  validateJobNotes,
  type OperativeChecklistItem,
  type OperativeJob,
} from "@jobproof/shared";
import { useJobPhotos, useLocalStore, useReportEditable } from "../../db/localStore";
import { ReportLockedError } from "../../db/draftRepo";
import { photoCount } from "../../capture/messages";
import { useAppBranding } from "../../theme/BrandingProvider";
import { DIVIDER, MUTED_TEXT } from "../../ui/colours";
import { TextField } from "../../ui/TextField";
import { useOwnerId } from "../capture/useOwner";
import { PhotoThumb } from "../capture/PhotoThumb";
import { CHECKLIST_MSG } from "./messages";
import { useAutosave } from "./useAutosave";
import { useLocalView, type LocalView } from "./localView";

const ITEM_ICON = { open: "☐", done: "✓", not_done: "✕" } as const;

/** Can the operative still change this job's report on this phone? */
export function useCanEdit(serverJob: OperativeJob): boolean {
  const localEditable = useReportEditable(serverJob.id);
  return localEditable && !isFinishedJob(serverJob) && serverJob.report?.state !== "submitted";
}

function ChecklistRow({ serverJob, item, number, total, editable, photos }: { serverJob: OperativeJob; item: OperativeChecklistItem; number: number; total: number; editable: boolean; photos: number }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  const store = useLocalStore();
  const owner = useOwnerId();
  const state = checklistItemStateLabel(item);
  const incomplete = item.status === "not_done" && (item.note ?? "").trim() === "";
  const serverItem = serverJob.checklist.find((i) => i.id === item.id) ?? item;

  function toggle() {
    if (!store || !owner || !editable) return;
    try {
      // A tap ticks the item; a tap on a ticked item unticks it. Anything else ("Not done") becomes done.
      store.drafts.setItem(owner, serverJob.id, item.id, { status: item.status === "done" ? "open" : "done" }, { status: serverItem.status, note: serverItem.note });
    } catch (e) {
      if (!(e instanceof ReportLockedError)) throw e;
    }
  }

  const photoText = photos > 0 ? photoCount(photos) : null;
  return (
    <View style={[styles.item, { borderColor: DIVIDER }]} testID={`checklist-item-${item.id}`}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.status === "done", disabled: !editable }}
        accessibilityLabel={`Item ${number} of ${total}. ${item.label}. ${state}.${photoText ? ` ${photoText}.` : ""}`}
        accessibilityHint={editable ? "Double tap to tick or untick" : undefined}
        onPress={toggle}
        style={styles.toggle}
        testID={`checklist-toggle-${item.id}`}
      >
        <Text style={[styles.itemIcon, { color: theme.text }]} importantForAccessibility="no" accessibilityElementsHidden>
          {ITEM_ICON[item.status]}
        </Text>
        <View style={styles.itemText}>
          <Text style={[styles.value, { color: theme.text }]}>{item.label}</Text>
          <Text style={[styles.itemState, { color: incomplete ? theme.text : MUTED_TEXT, fontWeight: incomplete ? "700" : "400" }]} testID={`checklist-state-${item.id}`}>
            {state}
          </Text>
          {item.note && item.status !== "not_done" ? (
            <Text style={[styles.itemState, { color: MUTED_TEXT }]} testID={`checklist-note-${item.id}`}>
              {item.note}
            </Text>
          ) : null}
          {photoText ? (
            <Text style={[styles.itemState, { color: MUTED_TEXT }]} testID={`checklist-photos-${item.id}`}>
              {photoText}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Details for ${item.label}`}
        accessibilityHint="Opens notes and photos for this item"
        onPress={() => router.push(`/jobs/${serverJob.id}/items/${item.id}`)}
        style={styles.details}
        testID={`checklist-open-${item.id}`}
      >
        <Text style={[styles.detailsText, { color: theme.primary }]}>Details {"›"}</Text>
      </Pressable>
    </View>
  );
}

/** Items removed by the office after the operative recorded something on them, and what is left of it (nothing is lost). */
function OtherItems({ view, jobId }: { view: LocalView; jobId: string }) {
  const { theme } = useAppBranding();
  const router = useRouter();
  const photos = useJobPhotos(jobId);
  const known = new Set(view.job.checklist.filter((i) => !i.removed).map((i) => i.id));
  const entries = new Map<string, { id: string; label: string; note: string | null }>();
  for (const i of view.job.checklist) if (i.removed) entries.set(i.id, { id: i.id, label: i.label, note: i.note });
  for (const o of view.orphans) if (!entries.has(o.item_id)) entries.set(o.item_id, { id: o.item_id, label: CHECKLIST_MSG.removedItem, note: o.note });
  for (const p of photos) {
    if (p.checklist_item_id && !known.has(p.checklist_item_id) && !entries.has(p.checklist_item_id)) entries.set(p.checklist_item_id, { id: p.checklist_item_id, label: CHECKLIST_MSG.removedItem, note: null });
  }
  if (entries.size === 0) return null;
  return (
    <View style={styles.group} testID="checklist-other">
      <Text accessibilityRole="header" style={[styles.subheading, { color: theme.text }]}>
        {CHECKLIST_MSG.otherHeading}
      </Text>
      <Text style={[styles.itemState, { color: MUTED_TEXT }]}>{CHECKLIST_MSG.otherHelp}</Text>
      {[...entries.values()].map((e) => {
        const mine = photos.filter((p) => p.checklist_item_id === e.id);
        return (
          <View key={e.id} style={[styles.otherItem, { borderColor: DIVIDER }]} testID={`checklist-other-${e.id}`}>
            <Text style={[styles.value, { color: theme.text, fontWeight: "600" }]}>{e.label}</Text>
            {e.note ? (
              <Text style={[styles.value, { color: theme.text }]} testID={`checklist-other-note-${e.id}`}>
                {e.note}
              </Text>
            ) : null}
            {mine.length > 0 ? (
              <View style={styles.grid}>
                {mine.map((p) => (
                  <PhotoThumb key={p.id} photo={p} onPress={() => router.push(`/jobs/${jobId}/photos/${p.id}`)} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function JobNotesField({ serverJob, view, editable }: { serverJob: OperativeJob; view: LocalView; editable: boolean }) {
  const { theme } = useAppBranding();
  const store = useLocalStore();
  const owner = useOwnerId();
  const { text, error, onChange, flush } = useAutosave({
    stored: view.notes,
    validate: validateJobNotes,
    commit: (value) => {
      if (store && owner) store.drafts.setNotes(owner, serverJob.id, value, serverJob.report?.notes ?? null);
    },
  });
  if (!editable) {
    return view.notes ? (
      <Text style={[styles.value, { color: theme.text }]} testID="report-notes-text">
        {view.notes}
      </Text>
    ) : null;
  }
  return (
    <TextField
      label={CHECKLIST_MSG.jobNotesLabel}
      value={text}
      onChangeText={onChange}
      onBlur={flush}
      error={error}
      multiline
      textAlignVertical="top"
      autoCapitalize="sentences"
      testID="report-notes-input"
    />
  );
}

/** The job screen's checklist (T-003d, T-003f): tick rows, "N of M done", details per item, report notes, other photos and notes. */
export function ChecklistSection({ serverJob }: { serverJob: OperativeJob }) {
  const { theme } = useAppBranding();
  const view = useLocalView(serverJob);
  const editable = useCanEdit(serverJob);
  const items = view.job.checklist.filter((i) => !i.removed);
  const photos = useJobPhotos(serverJob.id);
  return (
    <>
      {items.length === 0 ? (
        <Text style={[styles.value, { color: theme.text }]} testID="checklist-empty">
          {CHECKLIST_MSG.noChecklist}
        </Text>
      ) : (
        <View style={styles.group} testID="checklist">
          <Text style={[styles.value, { color: theme.text, fontWeight: "600" }]} testID="checklist-summary" accessibilityLiveRegion="polite">
            {checklistSummary(view.job)}
          </Text>
          {items.map((item, i) => (
            <ChecklistRow key={item.id} serverJob={serverJob} item={item} number={i + 1} total={items.length} editable={editable} photos={photos.filter((p) => p.checklist_item_id === item.id).length} />
          ))}
        </View>
      )}
      <OtherItems view={view} jobId={serverJob.id} />
      {editable || view.notes ? (
        <>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
            {CHECKLIST_MSG.reportNotesHeading}
          </Text>
          <JobNotesField serverJob={serverJob} view={view} editable={editable} />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  heading: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  subheading: { fontSize: 18, fontWeight: "700", marginTop: 8 },
  value: { fontSize: 18 },
  item: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1 },
  toggle: { flex: 1, flexDirection: "row", gap: 12, minHeight: 56, paddingVertical: 10, alignItems: "flex-start" },
  itemIcon: { fontSize: 24, width: 28, textAlign: "center" },
  itemText: { flex: 1, gap: 2 },
  itemState: { fontSize: 16 },
  details: { minWidth: 72, minHeight: 56, justifyContent: "center", alignItems: "flex-end", paddingLeft: 8 },
  detailsText: { fontSize: 16, fontWeight: "700" },
  otherItem: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
