import { Pressable, StyleSheet, Text, View } from "react-native";
import { STAGES, STAGE_LABEL, type Stage } from "../../db/photoRepo";
import { useAppBranding } from "../../theme/BrandingProvider";
import { CAMERA_BG, ON_CAMERA } from "../../ui/colours";

/**
 * Before / During / After as three large buttons, never a dropdown (T-003e scenario 2). One is
 * always selected. `onDark` draws them for the camera overlay.
 */
export function StageButtons({ value, onChange, onDark = false, testIDPrefix = "stage" }: { value: Stage; onChange: (s: Stage) => void; onDark?: boolean; testIDPrefix?: string }) {
  const { theme } = useAppBranding();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Stage">
      {STAGES.map((s) => {
        const selected = s === value;
        const bg = selected ? (onDark ? ON_CAMERA : theme.primary) : onDark ? CAMERA_BG : theme.background;
        const fg = selected ? (onDark ? CAMERA_BG : theme.onPrimary) : onDark ? ON_CAMERA : theme.primary;
        const border = onDark ? ON_CAMERA : theme.primary;
        return (
          <Pressable
            key={s}
            accessibilityRole="radio"
            accessibilityLabel={STAGE_LABEL[s]}
            accessibilityState={{ selected, checked: selected }}
            onPress={() => onChange(s)}
            testID={`${testIDPrefix}-${s}`}
            style={[styles.button, { backgroundColor: bg, borderColor: border }]}
          >
            <Text style={[styles.label, { color: fg }]}>{selected ? "✓ " : ""}{STAGE_LABEL[s]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minHeight: 56, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  label: { fontSize: 18, fontWeight: "700", textAlign: "center" },
});
