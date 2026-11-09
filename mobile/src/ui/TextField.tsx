import { forwardRef, type ComponentRef, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useAppBranding } from "../theme/BrandingProvider";
import { ERROR_COLOUR } from "./colours";

export type TextFieldInstance = ComponentRef<typeof TextInput>;

interface Props extends TextInputProps {
  label: string;
  error?: string | undefined;
  testID: string;
  /** Rendered on the label row, right-aligned (e.g. Show/Hide). */
  labelAction?: ReactNode;
}

/** Visible label above a growing input (no fixed heights, so large system text stays readable). */
export const TextField = forwardRef<TextFieldInstance, Props>(function TextField({ label, error, testID, labelAction, ...input }, ref) {
  const { theme } = useAppBranding();
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        {labelAction}
      </View>
      <TextInput
        ref={ref}
        testID={testID}
        accessibilityLabel={label}
        style={[styles.input, { color: theme.text, borderColor: error ? ERROR_COLOUR : theme.text, backgroundColor: theme.surface }]}
        {...input}
      />
      {error ? (
        <Text style={[styles.error, { color: ERROR_COLOUR }]} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: 6 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  label: { fontSize: 16, fontWeight: "600" },
  input: { minHeight: 56, borderWidth: 2, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18 },
  error: { fontSize: 16, fontWeight: "600" },
});
