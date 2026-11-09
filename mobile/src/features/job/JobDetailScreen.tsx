import { useCallback, useState, type ReactNode } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ApiError,
  checklistItemStateLabel,
  checklistSummary,
  formatAddress,
  formatDate,
  formatTime,
  jobTypeLabel,
  useOperativeJob,
  type OperativeChecklistItem,
  type OperativeJob,
} from "@jobproof/shared";
import { useAppBranding } from "../../theme/BrandingProvider";
import { DIVIDER, ERROR_COLOUR, MUTED_TEXT, SKELETON } from "../../ui/colours";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { StatusBadge } from "../../ui/StatusBadge";
import { mapsUrl, notesNeedToggle, NOTES_COLLAPSED_LINES, telUrl } from "./links";

export const MSG = {
  unavailable: "This job isn't available.",
  notSaved: "This job's details weren't saved. Connect once to load it.",
  loadFailed: "Couldn't load this job. Check your signal.",
  offline: "Offline. Showing details saved on this phone.",
  noChecklist: "No checklist for this job. You can still take photos and submit.",
  noNotes: "No notes for this job.",
  noPhone: "No phone number for this contact.",
  cantCall: "Couldn't open the phone app.",
  cantMap: "Couldn't open a maps app.",
} as const;

function BackLink() {
  const { theme } = useAppBranding();
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back to my jobs" onPress={back} style={styles.back} testID="job-back">
      <Text style={[styles.backText, { color: theme.primary }]}>{"‹"} My jobs</Text>
    </Pressable>
  );
}

function Frame({ children, onRefresh, refreshing }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const { theme } = useAppBranding();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.body}
      testID="job-screen"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} colors={[theme.primary]} /> : undefined}
    >
      <BackLink />
      {children}
    </ScrollView>
  );
}

function Heading({ children }: { children: string }) {
  const { theme } = useAppBranding();
  return (
    <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
      {children}
    </Text>
  );
}

/** Small caption + value pair read as one TalkBack stop. */
function Fact({ label, value, testID }: { label: string; value: string; testID: string }) {
  const { theme } = useAppBranding();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.fact} testID={testID}>
      <Text style={[styles.caption, { color: MUTED_TEXT }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function LinkRow({
  caption,
  value,
  action,
  onPress,
  failed,
  testID,
}: {
  caption: string;
  value: string;
  action: string;
  onPress: () => void;
  failed: string | undefined;
  testID: string;
}) {
  const { theme } = useAppBranding();
  return (
    <View style={styles.fact}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${caption}: ${value}. ${action}`}
        onPress={onPress}
        style={styles.linkRow}
        testID={testID}
      >
        <Text style={[styles.caption, { color: MUTED_TEXT }]}>{caption}</Text>
        <Text style={[styles.value, styles.link, { color: theme.primary }]}>{value}</Text>
      </Pressable>
      {failed ? (
        <Text style={[styles.failed, { color: ERROR_COLOUR }]} accessibilityLiveRegion="polite" testID={`${testID}-failed`}>
          {failed}
        </Text>
      ) : null}
    </View>
  );
}

function Notes({ notes }: { notes: string | null }) {
  const { theme } = useAppBranding();
  const [expanded, setExpanded] = useState(false);
  if (!notes || notes.trim() === "") {
    return (
      <Text style={[styles.value, { color: theme.text }]} testID="job-notes-empty">
        {MSG.noNotes}
      </Text>
    );
  }
  const toggle = notesNeedToggle(notes);
  return (
    <View style={styles.fact}>
      <Text
        numberOfLines={toggle && !expanded ? NOTES_COLLAPSED_LINES : undefined}
        style={[styles.value, { color: theme.text }]}
        testID="job-notes"
      >
        {notes}
      </Text>
      {toggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show less" : "Show more"}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((e) => !e)}
          style={styles.toggle}
          testID="job-notes-toggle"
        >
          <Text style={[styles.toggleText, { color: theme.primary }]}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const ITEM_ICON = { open: "☐", done: "✓", not_done: "✕" } as const;

function ChecklistRow({ item, number, total }: { item: OperativeChecklistItem; number: number; total: number }) {
  const { theme } = useAppBranding();
  const state = checklistItemStateLabel(item);
  const removed = item.removed ? " Removed by the office." : "";
  return (
    <View
      accessible
      accessibilityLabel={`Item ${number} of ${total}. ${item.label}. ${state}.${removed}`}
      style={[styles.item, { borderColor: DIVIDER }]}
      testID={`checklist-item-${item.id}`}
    >
      <Text style={[styles.itemIcon, { color: theme.text }]} importantForAccessibility="no" accessibilityElementsHidden>
        {ITEM_ICON[item.status]}
      </Text>
      <View style={styles.itemText}>
        <Text style={[styles.value, { color: theme.text }]}>{item.label}</Text>
        <Text style={[styles.itemState, { color: MUTED_TEXT }]}>{item.removed ? `${state} (removed by the office)` : state}</Text>
      </View>
    </View>
  );
}

function Checklist({ job }: { job: OperativeJob }) {
  const { theme } = useAppBranding();
  const items = job.checklist;
  if (items.length === 0) {
    return (
      <Text style={[styles.value, { color: theme.text }]} testID="checklist-empty">
        {MSG.noChecklist}
      </Text>
    );
  }
  return (
    <View style={styles.group} testID="checklist">
      <Text style={[styles.value, { color: theme.text, fontWeight: "600" }]} testID="checklist-summary">
        {checklistSummary(job)}
      </Text>
      {items.map((item, i) => (
        <ChecklistRow key={item.id} item={item} number={i + 1} total={items.length} />
      ))}
    </View>
  );
}

function SubmittedLine({ job }: { job: OperativeJob }) {
  const { theme } = useAppBranding();
  const report = job.report;
  if (!report || report.state !== "submitted" || !report.submitted_at) return null;
  return (
    <View accessible accessibilityLabel={`Submitted ${formatTime(report.submitted_at)}${report.reviewed_by ? `. Reviewed by ${report.reviewed_by.name}` : ""}`} style={styles.group} testID="job-submitted">
      <Text style={[styles.value, { color: theme.text, fontWeight: "700" }]}>Submitted {formatTime(report.submitted_at)}</Text>
      {report.reviewed_by ? <Text style={[styles.value, { color: theme.text }]}>Reviewed by {report.reviewed_by.name}</Text> : null}
    </View>
  );
}

function useOpen(failure: string) {
  const [failed, setFailed] = useState<string | undefined>();
  const open = useCallback(
    (url: string) => {
      setFailed(undefined);
      Linking.openURL(url).catch(() => setFailed(failure));
    },
    [failure],
  );
  return { failed, open };
}

function Skeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading job" style={styles.group} testID="job-skeleton">
      {[120, 72, 72, 160].map((h, i) => (
        <View key={i} style={{ height: h, borderRadius: 8, backgroundColor: SKELETON }} />
      ))}
    </View>
  );
}

function Unavailable() {
  const { theme } = useAppBranding();
  const router = useRouter();
  return (
    <Frame>
      <View style={styles.group} testID="job-unavailable">
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
          {MSG.unavailable}
        </Text>
        <Button label="Back to my jobs" onPress={() => router.replace("/")} testID="job-unavailable-back" />
      </View>
    </Frame>
  );
}

/**
 * Job detail (T-003d), read only. Reads the job from the cache the list filled, so it opens with
 * no signal; a refresh only replaces the server's fields (nothing the operative did on the phone
 * lives in this cache).
 */
export function JobDetailScreen({ jobId }: { jobId: string }) {
  const { theme } = useAppBranding();
  const query = useOperativeJob(jobId);
  const [refreshing, setRefreshing] = useState(false);
  const call = useOpen(MSG.cantCall);
  const map = useOpen(MSG.cantMap);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  const error = query.error;
  if (error instanceof ApiError && error.status === 404) return <Unavailable />;

  const job = query.data;
  if (!job) {
    if (query.isError) {
      const network = error instanceof ApiError && error.status === 0;
      return (
        <Frame>
          <Notice
            kind={network ? "offline" : "error"}
            message={network ? MSG.notSaved : MSG.loadFailed}
            onRetry={() => void query.refetch()}
            testID="job-error"
          />
        </Frame>
      );
    }
    return (
      <Frame>
        <Skeleton />
      </Frame>
    );
  }

  const offline = query.isError && error instanceof ApiError && error.status === 0;
  const phone = job.contact?.phone ?? null;
  const tel = phone ? telUrl(phone) : null;
  const address = formatAddress(job.site_address);

  return (
    <Frame onRefresh={() => void refresh()} refreshing={refreshing}>
      {offline ? <Notice kind="offline" message={MSG.offline} testID="job-offline" /> : null}
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} testID="job-title">
        {job.title}
      </Text>
      <StatusBadge job={job} testID="job-status" />
      <SubmittedLine job={job} />
      <Fact label="Reference" value={job.reference} testID="job-reference" />
      <Fact label="Job type" value={jobTypeLabel(job.job_type)} testID="job-type" />
      <Fact label="Scheduled" value={formatDate(job.scheduled_start)} testID="job-date" />

      <Heading>Site</Heading>
      <LinkRow caption="Address" value={address} action="Opens in a maps app" onPress={() => map.open(mapsUrl(job.site_address))} failed={map.failed} testID="job-address" />

      <Heading>Contact</Heading>
      {job.contact ? (
        <>
          <Fact label="Name" value={job.contact.name} testID="job-contact-name" />
          {phone && tel ? (
            <LinkRow caption="Phone" value={phone} action="Opens the phone app with the number ready" onPress={() => call.open(tel)} failed={call.failed} testID="job-contact-phone" />
          ) : (
            <Text style={[styles.value, { color: theme.text }]} testID="job-contact-nophone">
              {MSG.noPhone}
            </Text>
          )}
        </>
      ) : (
        <Text style={[styles.value, { color: theme.text }]} testID="job-contact-none">
          No contact for this job.
        </Text>
      )}

      <Heading>Notes</Heading>
      <Notes notes={job.notes} />

      <Heading>Checklist</Heading>
      <Checklist job={job} />
    </Frame>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14 },
  back: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  backText: { fontSize: 18, fontWeight: "700" },
  title: { fontSize: 24, fontWeight: "700" },
  heading: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  group: { gap: 10 },
  fact: { gap: 2 },
  caption: { fontSize: 14, fontWeight: "600" },
  value: { fontSize: 18 },
  link: { textDecorationLine: "underline", fontWeight: "600" },
  linkRow: { minHeight: 48, justifyContent: "center", gap: 2 },
  failed: { fontSize: 16, fontWeight: "600" },
  toggle: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  toggleText: { fontSize: 18, fontWeight: "700" },
  item: { flexDirection: "row", gap: 12, minHeight: 48, paddingVertical: 10, borderBottomWidth: 1, alignItems: "flex-start" },
  itemIcon: { fontSize: 22, width: 28, textAlign: "center" },
  itemText: { flex: 1, gap: 2 },
  itemState: { fontSize: 16 },
});
