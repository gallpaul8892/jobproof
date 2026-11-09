import { useLocalSearchParams } from "expo-router";
import { JobDetailScreen } from "../../../../src/features/job/JobDetailScreen";

export default function JobDetail() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  return <JobDetailScreen jobId={String(jobId)} />;
}
