import { useCallback, useEffect, useState } from "react";
import { useIsRestoring } from "@tanstack/react-query";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import {
  ApiError,
  formatTime,
  orderJobsForDisplay,
  useOperativeJobs,
  type OperativeJob,
  type OperativeJobList,
} from "@jobproof/shared";
import { useAppBranding } from "../../theme/BrandingProvider";
import { DIVIDER, SKELETON } from "../../ui/colours";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { JobRow } from "./JobRow";

export const MSG = {
  empty: "No jobs today. Pull down to refresh.",
  noneToday: "No jobs today.",
  loadFailed: "Couldn't load jobs. Check your signal.",
  offline: (time: string) => `Offline. Showing jobs from ${time}.`,
  updated: (time: string) => `Updated ${time}`,
} as const;

function isJobList(v: unknown): v is OperativeJobList {
  const l = v as Partial<OperativeJobList> | undefined;
  return !!l && Array.isArray(l.jobs_today) && Array.isArray(l.earlier_unfinished);
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

function Skeleton() {
  return (
    <View accessible accessibilityLabel="Loading jobs" accessibilityRole="progressbar" style={styles.group} testID="jobs-skeleton">
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.skeletonRow, { backgroundColor: SKELETON }]} />
      ))}
    </View>
  );
}

function Section({ title, jobs, testID, onOpen }: { title: string; jobs: OperativeJob[]; testID: string; onOpen: (id: string) => void }) {
  const { theme } = useAppBranding();
  return (
    <View style={styles.group} testID={testID}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        {title}
      </Text>
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} onPress={() => onOpen(job.id)} />
      ))}
    </View>
  );
}

/**
 * My jobs (T-003c). Reads the query cache (restored from the phone's store), so the last list is
 * always shown when there is one; a failed refresh adds a notice above it and never blanks it.
 */
export function JobsScreen() {
  const { theme } = useAppBranding();
  const router = useRouter();
  const query = useOperativeJobs();
  const [refreshing, setRefreshing] = useState(false);
  const restoring = useIsRestoring();

  // Opening the app always asks the server once (even for a list saved minutes ago), so "no
  // signal" is noticed at once and the Offline notice shows, instead of a stale list that looks live.
  const { refetch } = query;
  useEffect(() => {
    if (!restoring) void refetch({ cancelRefetch: false });
  }, [restoring, refetch]);

  // A stored list from some other build could have a different shape: treat it as no list.
  const data: OperativeJobList | undefined = isJobList(query.data) ? query.data : undefined;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  const open = useCallback((id: string) => router.push(`/jobs/${id}`), [router]);

  const offline = query.isError && isNetworkFailure(query.error);
  const asOf = data ? formatTime(data.as_of) : undefined;
  const today = data ? orderJobsForDisplay(data.jobs_today) : [];
  const earlier = data ? orderJobsForDisplay(data.earlier_unfinished) : [];

  let body;
  if (!data && query.isError) {
    body = (
      <Notice kind="error" message={MSG.loadFailed} onRetry={() => void query.refetch()} testID="jobs-error" />
    );
  } else if (!data) {
    body = <Skeleton />;
  } else {
    body = (
      <>
        {query.isError ? (
          offline ? (
            <Notice kind="offline" message={MSG.offline(asOf ?? "")} onRetry={() => void query.refetch()} testID="jobs-offline" />
          ) : (
            <Notice kind="error" message={MSG.loadFailed} onRetry={() => void query.refetch()} testID="jobs-error" />
          )
        ) : null}
        {today.length === 0 && earlier.length === 0 ? (
          <Text style={[styles.empty, { color: theme.text }]} testID="jobs-empty">
            {MSG.empty}
          </Text>
        ) : (
          <>
            {today.length > 0 ? (
              <Section title="Today" jobs={today} testID="jobs-today" onOpen={open} />
            ) : (
              <View style={styles.group}>
                <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
                  Today
                </Text>
                <Text style={[styles.empty, { color: theme.text }]} testID="jobs-none-today">
                  {MSG.noneToday}
                </Text>
              </View>
            )}
            {earlier.length > 0 ? <Section title="Earlier, not finished" jobs={earlier} testID="jobs-earlier" onOpen={open} /> : null}
          </>
        )}
      </>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.body}
      testID="my-jobs-screen"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[theme.primary]} />}
    >
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          My jobs
        </Text>
        {data && !query.isError ? (
          <Text style={[styles.updated, { color: theme.text }]} testID="jobs-updated">
            {query.isFetching && !refreshing ? "Updating…" : MSG.updated(asOf ?? "")}
          </Text>
        ) : null}
      </View>
      {body}
      <View style={[styles.footer, { borderColor: DIVIDER }]}>
        <Link href="/settings" accessibilityRole="link" style={[styles.link, { color: theme.primary }]} testID="open-settings">
          Settings
        </Link>
        {data || query.isError ? <Button label="Refresh" variant="secondary" onPress={() => void refresh()} testID="jobs-refresh" /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 16 },
  titleRow: { gap: 4 },
  title: { fontSize: 24, fontWeight: "700" },
  updated: { fontSize: 16 },
  group: { gap: 10 },
  heading: { fontSize: 20, fontWeight: "700", paddingVertical: 4 },
  empty: { fontSize: 18, paddingVertical: 8 },
  skeletonRow: { height: 96, borderRadius: 8 },
  footer: { borderTopWidth: 1, paddingTop: 12, gap: 12 },
  link: { fontSize: 18, fontWeight: "700", minHeight: 48, paddingVertical: 12 },
});
