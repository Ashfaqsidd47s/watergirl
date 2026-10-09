import type { Task } from '@watergirl/shared';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TaskCard } from '@/components/TaskCard';
import { Button, Card, Empty, ErrorText, Icon, SectionTitle, text } from '@/components/ui';
import { greeting } from '@/lib/format';
import { useOverview } from '@/lib/queries';
import { colors, radius, space, statusInfo } from '@/lib/theme';

function Section({ title, tasks }: { title: string; tasks: Task[] }) {
  if (!tasks.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle title={title} count={tasks.length} />
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} />
      ))}
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function TodayScreen() {
  const { data, error, isLoading, refetch, isRefetching } = useOverview();
  const tasks = data?.tasks ?? [];
  const pick = (...s: Task['status'][]) => tasks.filter((t) => s.includes(t.status));
  const hasRepos = (data?.projects ?? []).some((p) => p.repos.length);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={text.muted}>{greeting()}</Text>
            <Text style={text.h1}>Here's the day</Text>
          </View>
          <View style={styles.avatar}>
            <Icon name="water" size={24} color={colors.accent} />
          </View>
        </View>

        <ErrorText error={error} />

        {data ? (
          <Card style={styles.standup}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="chatbubble-ellipses" size={16} color={colors.accent} />
              <Text style={[text.h3, { color: colors.accent }]}>Water Girl</Text>
            </View>
            {data.standup.map((line, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
                <Text style={{ color: colors.accent }}>•</Text>
                <Text style={[text.body, { flex: 1 }]}>{line}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {data ? (
          <View style={styles.stats}>
            <Stat label="agents busy" value={`${data.limits.running}/${data.limits.maxParallel}`} color={statusInfo.working.color} />
            <Stat label="need you" value={String(pick('needs_input', 'failed').length)} color={statusInfo.needs_input.color} />
            <Stat label="to review" value={String(pick('review').length)} color={statusInfo.review.color} />
          </View>
        ) : null}

        {data && !hasRepos ? (
          <Empty
            icon="git-network-outline"
            title="Let's set up your first project"
            body="Connect a GitHub account, create a project (like Nucleus) and add its repos. Then just tell Water Girl what to build."
            action={<Button title="Go to Projects" icon="folder-open" onPress={() => router.push('/projects')} />}
          />
        ) : null}

        <Section title="Needs you" tasks={pick('needs_input', 'failed')} />
        <Section title="Working on it" tasks={pick('working', 'queued')} />
        <Section title="Ready for review" tasks={pick('review')} />
        <Section title="Recently finished" tasks={pick('done', 'merged', 'stopped').slice(0, 8)} />

        {data && hasRepos && !tasks.length && !isLoading ? (
          <Empty icon="sparkles-outline" title="Nothing running" body="Tap + and describe what you want built." />
        ) : null}
      </ScrollView>

      {hasRepos ? (
        <Pressable accessibilityLabel="New task" style={styles.fab} onPress={() => router.push('/new-task')}>
          <Icon name="add" size={30} color={colors.accentInk} />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.md, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xs },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent + '1f',
    borderWidth: 1,
    borderColor: colors.accent + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  standup: { borderColor: colors.accent + '44', backgroundColor: '#0f1d33' },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { color: colors.faint, fontSize: 12, marginTop: 2 },
  fab: {
    position: 'absolute',
    right: space.xl,
    bottom: space.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
