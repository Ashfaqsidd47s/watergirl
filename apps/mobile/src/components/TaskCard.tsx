import type { Task } from '@watergirl/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ago } from '@/lib/format';
import { colors, radius, space, statusInfo } from '@/lib/theme';
import { Icon, StatusPill } from './ui';

export function TaskCard({ task, showProject = true }: { task: Task; showProject?: boolean }) {
  const info = statusInfo[task.status];
  const line =
    task.status === 'needs_input'
      ? task.question
      : task.status === 'failed'
        ? task.error
        : (task.summary ?? task.prompt);

  return (
    <Pressable
      onPress={() => router.push(`/task/${task.id}`)}
      style={({ pressed }) => [styles.card, { borderLeftColor: info.color }, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={2}>
          {task.title}
        </Text>
        <StatusPill status={task.status} small />
      </View>
      {line ? (
        <Text style={[styles.line, task.status === 'needs_input' && { color: colors.warning }]} numberOfLines={2}>
          {line.split('\n').find((l) => l.trim())}
        </Text>
      ) : null}
      <View style={styles.meta}>
        {showProject ? <Text style={styles.metaText}>{task.projectName}</Text> : null}
        <Text style={styles.metaText} numberOfLines={1}>
          {task.repoFullName}
        </Text>
        {task.prNumber ? (
          <View style={styles.pr}>
            <Icon name="git-pull-request" size={12} color={colors.faint} />
            <Text style={styles.metaText}>#{task.prNumber}</Text>
          </View>
        ) : null}
        <Text style={[styles.metaText, { marginLeft: 'auto' }]}>{ago(task.updatedAt)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    padding: space.md,
    gap: 6,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  line: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  metaText: { color: colors.faint, fontSize: 12 },
  pr: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
