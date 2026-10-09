import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Chip, ErrorText, Field, text } from '@/components/ui';
import { useApi } from '@/lib/connection';
import { useApiMutation, useOverview } from '@/lib/queries';
import { colors, space } from '@/lib/theme';

export default function NewTaskScreen() {
  const params = useLocalSearchParams<{ repoId?: string; projectId?: string }>();
  const api = useApi();
  const { data } = useOverview();
  const [repoId, setRepoId] = useState<string | null>(params.repoId ?? null);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [model, setModel] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const create = useApiMutation(api.createTask);

  const projects = (data?.projects ?? []).filter((p) => p.repos.length && (!params.projectId || p.id === params.projectId));
  const allRepos = projects.flatMap((p) => p.repos);

  // Preselect when there's only one sensible choice.
  useEffect(() => {
    if (!repoId && allRepos.length === 1) setRepoId(allRepos[0].id);
  }, [repoId, allRepos]);

  const repo = allRepos.find((r) => r.id === repoId);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Where</Text>
        {projects.map((p) => (
          <View key={p.id} style={{ gap: space.sm }}>
            <Text style={text.small}>{p.name}</Text>
            <View style={styles.chips}>
              {p.repos.map((r) => (
                <Chip key={r.id} label={r.fullName} color={p.color} selected={r.id === repoId} onPress={() => setRepoId(r.id)} />
              ))}
            </View>
          </View>
        ))}
        {!projects.length ? <Text style={text.muted}>Add a repo to a project first.</Text> : null}

        <Field
          label="What should the agent do?"
          placeholder={'Talk to it like a teammate, e.g.\n"Build order management: list, detail and cancel endpoints with tests. Follow the existing payments module style."'}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          autoFocus
          hint="Tip: use your keyboard's mic to dictate. The agent works on its own branch and opens a PR when done."
        />

        {advanced ? (
          <View style={{ gap: space.md }}>
            <Field label="Title (optional)" placeholder="Short name for the board" value={title} onChangeText={setTitle} />
            <Field
              label="Base branch"
              placeholder={repo?.defaultBranch ?? 'main'}
              value={baseBranch}
              onChangeText={setBaseBranch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label="Model (optional)"
              placeholder="Server default"
              value={model}
              onChangeText={setModel}
              autoCapitalize="none"
              autoCorrect={false}
              hint="An alias like opus or sonnet, or a full model name."
            />
          </View>
        ) : (
          <Button title="More options" kind="ghost" icon="options-outline" onPress={() => setAdvanced(true)} />
        )}

        <ErrorText error={create.error} />
        <Button
          title="Start agent"
          icon="rocket"
          disabled={!repoId || !prompt.trim()}
          loading={create.isPending}
          onPress={() =>
            create.mutate(
              { repoId: repoId!, prompt: prompt.trim(), title: title.trim() || undefined, baseBranch: baseBranch.trim() || undefined, model: model.trim() || undefined },
              { onSuccess: (t) => router.replace(`/task/${t.id}`) },
            )
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
