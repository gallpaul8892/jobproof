import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { formatTime } from "@jobproof/shared";
import { STAGE_LABEL, type PhotoRow } from "../../db/photoRepo";
import { useLocalStore } from "../../db/localStore";
import { useAppBranding } from "../../theme/BrandingProvider";
import { DIVIDER, MUTED_TEXT } from "../../ui/colours";

export function photoLabel(p: Pick<PhotoRow, "stage" | "taken_at" | "source" | "caption">): string {
  const parts = [`${STAGE_LABEL[p.stage]} photo`, `taken ${formatTime(p.taken_at)}`];
  if (p.source === "gallery") parts.push("from gallery");
  if (p.caption) parts.push(`caption: ${p.caption}`);
  return parts.join(", ");
}

/** A thumbnail with its time, a "From gallery" tag and the caption under it. One 96 dp+ target that opens the full-screen view. */
export function PhotoThumb({ photo, onPress }: { photo: PhotoRow; onPress: () => void }) {
  const { theme } = useAppBranding();
  const store = useLocalStore();
  const uri = store ? store.files.uri(photo.thumb_path ?? photo.original_path) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={photoLabel(photo)}
      accessibilityHint="Opens the photo full screen"
      onPress={onPress}
      testID={`photo-${photo.id}`}
      style={[styles.item, { borderColor: DIVIDER }]}
    >
      {uri ? <Image source={{ uri }} style={styles.image} resizeMode="cover" importantForAccessibility="no" accessibilityIgnoresInvertColors /> : <View style={styles.image} />}
      <Text style={[styles.time, { color: theme.text }]} testID={`photo-time-${photo.id}`}>
        {formatTime(photo.taken_at)}
      </Text>
      {photo.source === "gallery" ? (
        <Text style={[styles.tag, { color: MUTED_TEXT }]} testID={`photo-gallery-${photo.id}`}>
          From gallery
        </Text>
      ) : null}
      {photo.recovered ? (
        <Text style={[styles.tag, { color: MUTED_TEXT }]} testID={`photo-recovered-${photo.id}`}>
          Recovered: check the stage
        </Text>
      ) : null}
      {photo.caption ? (
        <Text numberOfLines={2} style={[styles.caption, { color: theme.text }]} testID={`photo-caption-${photo.id}`}>
          {photo.caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { width: 112, minHeight: 112, gap: 2, borderWidth: 1, borderRadius: 8, padding: 4 },
  image: { width: 102, height: 102, borderRadius: 4, backgroundColor: DIVIDER },
  time: { fontSize: 16, fontWeight: "700" },
  tag: { fontSize: 14, fontWeight: "600" },
  caption: { fontSize: 14 },
});
