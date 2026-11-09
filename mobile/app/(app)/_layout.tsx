import { View } from "react-native";
import { Stack } from "expo-router";
import { UserBar } from "../../src/features/session/UserBar";

export default function AppGroupLayout() {
  return (
    <View style={{ flex: 1 }}>
      <UserBar />
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
