import { Tabs } from 'expo-router/js-tabs';
import { Icon } from '@/components/ui';
import { useOverview } from '@/lib/queries';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  const { data } = useOverview();
  const needsYou = data?.tasks.filter((t) => t.status === 'needs_input' || t.status === 'failed').length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.faint,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          headerShown: false,
          tabBarBadge: needsYou || undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, color: '#1a1300' },
          tabBarIcon: ({ color, size }) => <Icon name="water" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: 'Projects', tabBarIcon: ({ color, size }) => <Icon name="folder-open" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Icon name="settings" color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
