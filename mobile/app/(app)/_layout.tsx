import { View } from "react-native";
import { Stack } from "expo-router";
import { PersistedQueries } from "../../src/features/jobs/PersistedQueries";
import { UserBar } from "../../src/features/session/UserBar";

export default function AppGroupLayout() {
  return (
    <View style={{ flex: 1 }}>
      <UserBar />
      <PersistedQueries>
        <Stack screenOptions={{ headerShown: false }} />
      </PersistedQueries>
    </View>
  );
}
