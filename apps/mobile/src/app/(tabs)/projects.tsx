import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Empty, ErrorText, Field, Icon, text } from '@/components/ui';
import { useApi } from '@/lib/connection';
import { useAccounts, useApiMutation, useOverview } from '@/lib/queries';
import { colors, space, statusInfo } from '@/lib/theme';
import type { TaskStatus } from '@watergirl/shared';

const SHOWN: TaskStatus[] = ['needs_input', 'working', 'queued', 'review', 'failed'];

export default function ProjectsScreen() {
  const api = useApi();
  const { data, error, refetch, isRefetching } = useOverview();
  const accounts = useAccounts();
  const [name, setName] = useState('');
  const addProject = useApiMutation((n: string) => api.addProject(n));

  const noAccounts = accounts.data && accounts.data.length === 0;

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      keyboardShouldPersistTaps="handled"
    >
      {noAccounts ? (
        <Card style={{ borderColor: colors.warning + '66' }}>
          <Text style={text.h3}>First, connect GitHub</Text>
          <Text style={text.muted}>Water Girl needs access to your repos. You can connect as many GitHub accounts as you like.</Text>
          <Button title="Connect a GitHub account" icon="logo-github" onPress={() => router.push('/add-account')} />
        </Card>
      ) : null}

      <ErrorText error={error} />

      {data?.projects.map((p) => (
        <Pressable key={p.id} onPress={() => router.push(`/project/${p.id}`)} style={({ pressed }) => pressed && { opacity: 0.85 }}>
          <Card>
            <View style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: p.color }]} />
              <Text style={[text.h2, { flex: 1 }]}>{p.name}</Text>
              <Icon name="chevron-forward" color={colors.faint} />
            </View>
            <Text style={text.muted}>
              {p.repos.length ? p.repos.map((r) => r.fullName).join('  ·  ') : 'No repos yet — tap to add one'}
            </Text>
            <View style={styles.counts}>
              {SHOWN.filter((s) => p.counts[s]).map((s) => (
                <Text key={s} style={[styles.count, { color: statusInfo[s].color }]}>
                  {p.counts[s]} {statusInfo[s].label.toLowerCase()}
                </Text>
              ))}
            </View>
          </Card>
        </Pressable>
      ))}

      {data && !data.projects.length ? (
        <Empty icon="folder-open-outline" title="No projects yet" body="A project groups related repos — e.g. Nucleus with its API and app repos." />
      ) : null}

      <Card>
        <Text style={text.h3}>New project</Text>
        <Field placeholder="e.g. Nucleus" value={name} onChangeText={setName} onSubmitEditing={() => name.trim() && addProject.mutate(name.trim(), { onSuccess: () => setName('') })} />
        <ErrorText error={addProject.error} />
        <Button
          title="Create project"
          icon="add"
          kind="secondary"
          disabled={!name.trim()}
          loading={addProject.isPending}
          onPress={() => addProject.mutate(name.trim(), { onSuccess: (p) => { setName(''); router.push(`/project/${p.id}`); } })}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 12, height: 12, borderRadius: 4 },
  counts: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  count: { fontSize: 13, fontWeight: '600' },
});
