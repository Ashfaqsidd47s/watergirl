import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TaskCard } from '@/components/TaskCard';
import { Button, Card, Empty, ErrorText, Icon, SectionTitle, text } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { useApi } from '@/lib/connection';
import { useAccounts, useApiMutation, useOverview } from '@/lib/queries';
import { colors, space } from '@/lib/theme';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const { data, refetch, isRefetching } = useOverview();
  const accounts = useAccounts();
  const removeRepo = useApiMutation((repoId: string) => api.removeRepo(repoId));
  const removeProject = useApiMutation(() => api.removeProject(id));

  const project = data?.projects.find((p) => p.id === id);
  const tasks = (data?.tasks ?? []).filter((t) => t.projectId === id);
  const login = (accountId: string) => accounts.data?.find((a) => a.id === accountId)?.login;

  if (!project) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.wrap}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
    >
      <Stack.Screen options={{ title: project.name }} />

      <SectionTitle
        title="Repos"
        count={project.repos.length}
        right={<Button title="Add" icon="add" kind="ghost" onPress={() => router.push(`/add-repo?projectId=${id}`)} />}
      />
      {project.repos.map((r) => (
        <Card key={r.id} style={styles.repo}>
          <Icon name="git-branch-outline" color={project.color} />
          <View style={{ flex: 1 }}>
            <Text style={text.h3}>{r.fullName}</Text>
            <Text style={text.small}>
              {r.defaultBranch} · via @{login(r.accountId) ?? '…'}
            </Text>
          </View>
          <Pressable accessibilityLabel={`New task in ${r.fullName}`} onPress={() => router.push(`/new-task?repoId=${r.id}`)} hitSlop={8}>
            <Icon name="add-circle" size={26} color={colors.accent} />
          </Pressable>
          <Pressable
            accessibilityLabel={`Remove ${r.fullName}`}
            hitSlop={8}
            onPress={() => confirm('Remove repo?', `${r.fullName} and its tasks will be removed from Water Girl (nothing changes on GitHub).`, () => removeRepo.mutate(r.id), 'Remove')}
          >
            <Icon name="trash-outline" size={18} color={colors.faint} />
          </Pressable>
        </Card>
      ))}
      {!project.repos.length ? (
        <Empty
          icon="git-network-outline"
          title="No repos in this project"
          body="Add one or more repos — they can come from different GitHub accounts."
          action={<Button title="Add a repo" icon="add" onPress={() => router.push(`/add-repo?projectId=${id}`)} />}
        />
      ) : null}
      <ErrorText error={removeRepo.error ?? removeProject.error} />

      {project.repos.length ? (
        <>
          <SectionTitle
            title="Tasks"
            count={tasks.length}
            right={<Button title="New" icon="add" kind="ghost" onPress={() => router.push(`/new-task?projectId=${id}`)} />}
          />
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} showProject={false} />
          ))}
          {!tasks.length ? <Text style={text.muted}>No tasks yet.</Text> : null}
        </>
      ) : null}

      <Button
        title="Delete project"
        kind="ghost"
        icon="trash-outline"
        style={{ marginTop: space.xl }}
        onPress={() =>
          confirm('Delete project?', `Removes ${project.name}, its repos and tasks from Water Girl. GitHub is not touched.`, () =>
            removeProject.mutate(undefined, { onSuccess: () => router.back() }),
          'Delete')
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  repo: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
