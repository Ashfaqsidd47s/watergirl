import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectionProvider, useConnection } from '@/lib/connection';
import '@/lib/notifications';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 2000 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider>
          <StatusBar style="light" />
          <Gate />
        </ConnectionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Tapping a notification opens the task it is about. */
function useNotificationTaps(enabled: boolean) {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const taskId = res.notification.request.content.data?.taskId;
      if (typeof taskId === 'string') router.push(`/task/${taskId}`);
    });
    return () => sub.remove();
  }, [enabled]);
}

function Gate() {
  const { ready, connection } = useConnection();
  useNotificationTaps(!!connection);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!!connection}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: '' }} />
        <Stack.Screen name="project/[id]" options={{ title: '' }} />
        <Stack.Screen name="new-task" options={{ title: 'New task', presentation: 'modal' }} />
        <Stack.Screen name="add-account" options={{ title: 'Connect GitHub', presentation: 'modal' }} />
        <Stack.Screen name="add-repo" options={{ title: 'Add a repo', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!connection}>
        <Stack.Screen name="connect" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
