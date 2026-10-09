import { router } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorText, Icon, SectionTitle, text } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { useApi, useConnection } from '@/lib/connection';
import { enablePush } from '@/lib/notifications';
import { useAccounts, useApiMutation } from '@/lib/queries';
import { colors, space } from '@/lib/theme';

export default function SettingsScreen() {
  const api = useApi();
  const { connection, disconnect } = useConnection();
  const accounts = useAccounts();
  const remove = useApiMutation((id: string) => api.removeAccount(id));
  const [push, setPush] = useState<{ ok: boolean; message: string } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <SectionTitle title="GitHub accounts" />
      <Card>
        {accounts.data?.map((a) => (
          <View key={a.id} style={styles.row}>
            {a.avatarUrl ? <Image source={{ uri: a.avatarUrl }} style={styles.avatar} /> : <Icon name="logo-github" size={28} color={colors.text} />}
            <View style={{ flex: 1 }}>
              <Text style={text.h3}>{a.label}</Text>
              <Text style={text.small}>@{a.login}</Text>
            </View>
            <Button
              title="Remove"
              kind="ghost"
              onPress={() => confirm('Remove account?', `Water Girl will forget the token for @${a.login}.`, () => remove.mutate(a.id))}
            />
          </View>
        ))}
        {accounts.data?.length === 0 ? <Text style={text.muted}>No accounts yet.</Text> : null}
        <ErrorText error={remove.error ?? accounts.error} />
        <Button title="Connect another account" icon="logo-github" kind="secondary" onPress={() => router.push('/add-account')} />
      </Card>

      <SectionTitle title="Notifications" />
      <Card>
        <Text style={text.muted}>Get a ping when an agent needs you, gets stuck, or has a PR ready.</Text>
        {push ? <Text style={{ color: push.ok ? colors.success : colors.warning }}>{push.message}</Text> : null}
        <Button
          title="Turn on notifications"
          icon="notifications"
          kind="secondary"
          loading={pushBusy}
          onPress={async () => {
            setPushBusy(true);
            setPush(await enablePush(api).catch((e: Error) => ({ ok: false, message: e.message })));
            setPushBusy(false);
          }}
        />
        <Text style={text.small}>No custom build yet? Set WG_NTFY_URL on the server and use the free ntfy app instead.</Text>
      </Card>

      <SectionTitle title="Server" />
      <Card>
        <Text style={text.body}>{connection?.url}</Text>
        <Button title="Disconnect" kind="danger" icon="log-out-outline" onPress={() => confirm('Disconnect?', 'You can reconnect any time with the server address and token.', () => void disconnect())} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  avatar: { width: 32, height: 32, borderRadius: 16 },
});
