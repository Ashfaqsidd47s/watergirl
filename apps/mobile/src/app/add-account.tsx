import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Card, ErrorText, Field, text } from '@/components/ui';
import { useApi } from '@/lib/connection';
import { useApiMutation } from '@/lib/queries';
import { colors, space } from '@/lib/theme';

export default function AddAccountScreen() {
  const api = useApi();
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const add = useApiMutation(({ token, label }: { token: string; label?: string }) => api.addAccount(token, label));

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={text.h3}>How this works</Text>
        <Text style={text.muted}>
          Each GitHub account gets its own token, so work and personal repos live side by side — no logging out and in. Tokens are encrypted on
          your server and never sent back to the app.
        </Text>
        <Text style={text.muted}>
          Create a fine-grained token with access to the repos you want, and these repository permissions:{'\n'}• Contents: read & write{'\n'}•
          Pull requests: read & write{'\n'}• Metadata: read{'\n'}• Checks / Commit statuses: read (optional, for CI status)
        </Text>
        <Button
          title="Create a token on GitHub"
          icon="open-outline"
          kind="secondary"
          onPress={() => void Linking.openURL('https://github.com/settings/personal-access-tokens/new')}
        />
      </Card>

      <Field label="Token" placeholder="github_pat_…" value={token} onChangeText={setToken} autoCapitalize="none" secureTextEntry />
      <Field label="Name (optional)" placeholder="e.g. Work, Personal" value={label} onChangeText={setLabel} />
      <ErrorText error={add.error} />
      <Button
        title="Connect"
        icon="logo-github"
        disabled={!token.trim()}
        loading={add.isPending}
        onPress={() => add.mutate({ token: token.trim(), label: label.trim() || undefined }, { onSuccess: () => router.back() })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl, backgroundColor: colors.bg },
});
