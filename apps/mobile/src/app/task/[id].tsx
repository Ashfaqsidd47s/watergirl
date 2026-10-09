import type { TaskEvent } from '@watergirl/shared';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventRow } from '@/components/EventRow';
import { Button, Card, ErrorText, Icon, StatusPill, text } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { useApi } from '@/lib/connection';
import { ago, money } from '@/lib/format';
import { usePr, useRefreshAll, useTaskLive } from '@/lib/queries';
import { colors, isActive, mono, radius, space } from '@/lib/theme';

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const refreshAll = useRefreshAll();
  const insets = useSafeAreaInsets();
  const { task, events, error, refresh, setTask } = useTaskLive(id);
  const pr = usePr(id, !!task?.prNumber && task.status !== 'merged');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const list = useRef<FlatList<TaskEvent>>(null);

  useEffect(() => {
    if (events.length) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [events.length]);

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setActionError(null);
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'status' in res) setTask(res as typeof task & object);
      await refresh();
      void refreshAll();
    } catch (e) {
      setActionError(e as Error);
    } finally {
      setBusy(null);
    }
  }

  if (!task) {
    return (
      <View style={styles.center}>
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    );
  }

  const running = isActive(task.status);
  const placeholder =
    task.status === 'needs_input'
      ? 'Answer the question…'
      : running
        ? 'Add a note — delivered after the current step'
        : task.status === 'merged'
          ? 'Merged — start a new task for more work'
          : 'Ask for changes or next steps…';

  const header = (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <View style={{ gap: 6 }}>
        <Text style={text.h2}>{task.title}</Text>
        <View style={styles.metaRow}>
          <StatusPill status={task.status} />
          {running ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          <Text style={text.small}>
            {task.projectName} · {task.repoFullName} · {ago(task.updatedAt)}
            {money(task.costUsd) ? ` · ${money(task.costUsd)}` : ''}
          </Text>
        </View>
        <Text style={[text.small, mono]} selectable>
          {task.branch} ← {task.baseBranch}
        </Text>
      </View>

      {task.status === 'needs_input' && task.question ? (
        <Card style={{ borderColor: colors.warning + '88', backgroundColor: colors.warning + '12' }}>
          <View style={styles.metaRow}>
            <Icon name="hand-left" color={colors.warning} />
            <Text style={[text.h3, { color: colors.warning }]}>The agent is asking</Text>
          </View>
          <Text style={text.body}>{task.question}</Text>
        </Card>
      ) : null}

      {task.status === 'failed' && task.error ? (
        <Card style={{ borderColor: colors.danger + '88', backgroundColor: colors.danger + '10' }}>
          <View style={styles.metaRow}>
            <Icon name="alert-circle" color={colors.danger} />
            <Text style={[text.h3, { color: colors.danger }]}>Stuck</Text>
          </View>
          <Text style={[text.body, mono, { fontSize: 13 }]}>{task.error}</Text>
          <Text style={text.muted}>Reply below with advice and it will try again in the same session.</Text>
        </Card>
      ) : null}

      {task.prNumber ? (
        <Card>
          <View style={styles.metaRow}>
            <Icon name={task.status === 'merged' ? 'git-merge' : 'git-pull-request'} color="#a78bfa" />
            <Text style={[text.h3, { flex: 1 }]}>Pull request #{task.prNumber}</Text>
            {pr.isFetching ? <ActivityIndicator size="small" color={colors.faint} /> : null}
          </View>
          {pr.data ? (
            <Text style={text.muted}>
              {pr.data.merged ? 'Merged' : pr.data.state === 'closed' ? 'Closed' : 'Open'}
              {pr.data.checks.total
                ? ` · checks ${pr.data.checks.passed}/${pr.data.checks.total} passing${pr.data.checks.failed ? `, ${pr.data.checks.failed} failing` : ''}${pr.data.checks.pending ? `, ${pr.data.checks.pending} running` : ''}`
                : ''}
              {pr.data.mergeable === false ? ' · has conflicts' : ''}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Open" icon="open-outline" kind="secondary" style={{ flex: 1 }} onPress={() => task.prUrl && void Linking.openURL(task.prUrl)} />
            {task.status !== 'merged' && !pr.data?.merged ? (
              <Button
                title="Merge"
                icon="git-merge"
                style={{ flex: 1 }}
                disabled={running || pr.data?.mergeable === false || pr.data?.state === 'closed'}
                loading={busy === 'merge'}
                onPress={() =>
                  confirm('Merge this PR?', `Squash-merge #${task.prNumber} into ${task.baseBranch} and clean up the workspace.`, () =>
                    void act('merge', () => api.merge(task.id)),
                  'Merge')
                }
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      <ErrorText error={actionError} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          title: task.repoFullName.split('/')[1],
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              {running ? (
                <Pressable accessibilityLabel="Stop agent" onPress={() => confirm('Stop the agent?', 'Work so far is kept and pushed.', () => void act('stop', () => api.stop(task.id)), 'Stop')}>
                  <Icon name="stop-circle-outline" size={24} color={colors.danger} />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityLabel="Archive task"
                  onPress={() =>
                    confirm('Archive this task?', 'It disappears from the board and its local workspace is deleted. The branch and PR stay on GitHub.', () =>
                      void act('archive', () => api.archive(task.id)).then(() => router.back()),
                    'Archive')
                  }
                >
                  <Icon name="archive-outline" size={22} color={colors.muted} />
                </Pressable>
              )}
            </View>
          ),
        }}
      />
      <FlatList
        ref={list}
        data={events}
        keyExtractor={(e) => String(e.id)}
        renderItem={({ item }) => <EventRow event={item} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
      />
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={task.status !== 'merged'}
        />
        <Pressable
          accessibilityLabel="Send"
          disabled={!draft.trim() || busy === 'send' || task.status === 'merged'}
          onPress={() => {
            const text = draft.trim();
            void act('send', () => api.send(task.id, text)).then(() => setDraft(''));
          }}
          style={[styles.send, (!draft.trim() || task.status === 'merged') && { opacity: 0.4 }]}
        >
          {busy === 'send' ? <ActivityIndicator color={colors.accentInk} /> : <Icon name="arrow-up" size={20} color={colors.accentInk} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: space.xl },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 140,
    minHeight: 42,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingTop: 10,
    paddingBottom: 10,
  },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
