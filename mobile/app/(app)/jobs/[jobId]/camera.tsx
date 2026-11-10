import { useLocalSearchParams } from "expo-router";
import { CameraScreen } from "../../../../src/features/capture/CameraScreen";

export default function Camera() {
  const { jobId, itemId } = useLocalSearchParams<{ jobId: string; itemId?: string }>();
  return <CameraScreen jobId={String(jobId)} itemId={itemId ? String(itemId) : undefined} />;
}
