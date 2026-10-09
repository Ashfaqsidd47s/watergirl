import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Chip, ErrorText, Field, Icon, text } from '@/components/ui';
import { useApi } from '@/lib/connection';
import { useAccounts, useApiMutation, useGithubRepos, useOverview } from '@/lib/queries';
import { colors, radius, space } from '@/lib/theme';

export default function AddRepoScreen() {
  const params = useLocalSearchParams<{ projectId?: string }>();
  const api = useApi();
  const accounts = useAccounts();
  const { data } = useOverview();
  const [projectId, setProjectId] = useState<string | null>(params.projectId ?? null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const repos = useGithubRepos(accountId);
  const add = useApiMutation(api.addRepo);

  useEffect(() => {
    if (!accountId && accounts.data?.length) setAccountId(accounts.data[0].id);
  }, [accountId, accounts.data]);

  const project = data?.projects.find((p) => p.id === projectId);
  const already = new Set(project?.repos.map((r) => r.fullName.toLowerCase()) ?? []);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (repos.data ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q));
  }, [repos.data, search]);

  if (accounts.data && !accounts.data.length) {
    return (
      <View style={styles.wrap}>
        <Text style={text.muted}>Connect a GitHub account first.</Text>
        <Button title="Connect GitHub" icon="logo-github" onPress={() => router.replace('/add-account')} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.wrap}>
        {!params.projectId ? (
          <View style={styles.chips}>
            {data?.projects.map((p) => (
              <Chip key={p.id} label={p.name} color={p.color} selected={p.id === projectId} onPress={() => setProjectId(p.id)} />
            ))}
          </View>
        ) : (
          <Text style={text.muted}>
            Adding to <Text style={{ color: colors.text, fontWeight: '600' }}>{project?.name}</Text>
          </Text>
        )}
        {(accounts.data?.length ?? 0) > 1 ? (
          <View style={styles.chips}>
            {accounts.data!.map((a) => (
              <Chip key={a.id} label={`@${a.login}`} selected={a.id === accountId} onPress={() => setAccountId(a.id)} />
            ))}
          </View>
        ) : null}
        <Field placeholder="Search repos" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />
        <ErrorText error={add.error ?? repos.error} />
      </View>

      {repos.isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.xl }} /> : null}
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.fullName}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const added = already.has(item.fullName.toLowerCase());
          return (
            <Pressable
              disabled={added || !projectId || add.isPending}
              onPress={() =>
                add.mutate({ projectId: projectId!, accountId: accountId!, fullName: item.fullName }, { onSuccess: () => router.back() })
              }
              style={({ pressed }) => [styles.repo, pressed && { opacity: 0.8 }, (added || !projectId) && { opacity: 0.5 }]}
            >
              <Icon name={item.private ? 'lock-closed-outline' : 'globe-outline'} size={16} />
              <View style={{ flex: 1 }}>
                <Text style={text.h3}>{item.fullName}</Text>
                <Text style={text.small}>{item.defaultBranch}</Text>
              </View>
              {added ? <Text style={text.small}>added</Text> : <Icon name="add-circle-outline" color={colors.accent} size={22} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  repo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
});
