import { useLocalSearchParams } from "expo-router";
import { PhotoViewerScreen } from "../../../../../src/features/capture/PhotoViewerScreen";

export default function PhotoRoute() {
  const { jobId, photoId } = useLocalSearchParams<{ jobId: string; photoId: string }>();
  return <PhotoViewerScreen jobId={String(jobId)} photoId={String(photoId)} />;
}
