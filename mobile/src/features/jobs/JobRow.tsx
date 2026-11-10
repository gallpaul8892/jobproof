import { Pressable, StyleSheet, Text, View } from "react-native";
import { isFinishedJob, jobTypeLabel, operativeJobStatusLabel, type OperativeJob } from "@jobproof/shared";
import { useHasLocalDraft } from "../../db/localStore";
import { useAppBranding } from "../../theme/BrandingProvider";
import { DIVIDER, MUTED_TEXT } from "../../ui/colours";
import { StatusBadge } from "../../ui/StatusBadge";

/** "Bristol, BS6 5QA" */
export function townAndPostcode(job: Pick<OperativeJob, "site_address">): string {
  return [job.site_address.town, job.site_address.postcode].filter(Boolean).join(", ");
}

/**
 * One job in the list. The whole row is one 48 dp+ target and reads as one TalkBack stop:
 * title, place, type, then status. Finished jobs are greyed, still above 4.5:1.
 */
export function JobRow({ job: serverJob, onPress }: { job: OperativeJob; onPress: () => void }) {
  const { theme } = useAppBranding();
  // Photos taken on this phone already make a "To do" job "In progress".
  const startedHere = useHasLocalDraft(serverJob.id);
  const job = startedHere && serverJob.status === "to_do" ? { ...serverJob, status: "in_progress" as const } : serverJob;
  const finished = isFinishedJob(job);
  const secondary = finished ? MUTED_TEXT : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.title}. ${townAndPostcode(job)}. ${jobTypeLabel(job.job_type)}. ${operativeJobStatusLabel(job)}`}
      accessibilityHint="Opens the job"
      onPress={onPress}
      testID={`job-row-${job.id}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: finished ? theme.background : theme.surface, borderColor: DIVIDER, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text numberOfLines={3} ellipsizeMode="tail" style={[styles.title, { color: finished ? MUTED_TEXT : theme.text }]} testID={`job-title-${job.id}`}>
        {job.title}
      </Text>
      <Text style={[styles.line, { color: secondary }]}>{townAndPostcode(job)}</Text>
      <Text style={[styles.line, { color: secondary }]}>{jobTypeLabel(job.job_type)}</Text>
      <View style={styles.status}>
        <StatusBadge job={job} muted={finished} testID={`job-status-${job.id}`} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 72, borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  title: { fontSize: 18, fontWeight: "700" },
  line: { fontSize: 16 },
  status: { marginTop: 4 },
});
