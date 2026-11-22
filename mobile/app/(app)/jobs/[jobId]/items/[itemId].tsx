import { useLocalSearchParams } from "expo-router";
import { ItemScreen } from "../../../../../src/features/checklist/ItemScreen";

export default function ItemRoute() {
  const { jobId, itemId } = useLocalSearchParams<{ jobId: string; itemId: string }>();
  return <ItemScreen jobId={String(jobId)} itemId={String(itemId)} />;
}
