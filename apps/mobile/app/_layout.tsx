import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConnectChip } from "../src/components/ConnectChip";
import { AppProvider } from "../src/state/AppProvider";
import { theme } from "../src/theme";

/* An invite link opens straight onto the join screen; keep the problem list
 * beneath it, so back and "done" land somewhere. */
export const unstable_settings = { initialRouteName: "index" };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AppProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.panel },
              headerTintColor: theme.text,
              headerTitleStyle: { fontWeight: "600" },
              contentStyle: { backgroundColor: theme.bg },
              /* The board connection is app-wide, so it lives in every header. */
              headerRight: () => <ConnectChip />,
            }}
          />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
