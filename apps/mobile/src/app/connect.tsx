import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText, Field, Icon, text } from '@/components/ui';
import { createApi, normalizeUrl } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { colors, space } from '@/lib/theme';

export default function ConnectScreen() {
  const { connect } = useConnection();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function onConnect() {
    setBusy(true);
    setError(null);
    const conn = { url: normalizeUrl(url), token: token.trim() };
    try {
      const api = createApi(conn);
      await api.health();
      await api.overview(); // proves the token is right
      await connect(conn);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <View style={styles.logo}>
            <Icon name="water" size={44} color={colors.accent} />
          </View>
          <Text style={[text.h1, { textAlign: 'center' }]}>Water Girl</Text>
          <Text style={[text.muted, { textAlign: 'center', marginBottom: space.lg }]}>
            Your coding agents, all your repos, one place.{'\n'}Connect to your Water Girl server to start.
          </Text>

          <Field
            label="Server address"
            placeholder="https://watergirl.example.com"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint="Where you run `npm run server` — a VPS, or your PC via Tailscale."
          />
          <Field
            label="Access token"
            placeholder="Printed by the server when it starts"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            secureTextEntry
          />
          <ErrorText error={error} />
          <Button title="Connect" icon="link" onPress={onConnect} loading={busy} disabled={!url.trim() || !token.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.lg, flexGrow: 1, justifyContent: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  logo: {
    alignSelf: 'center',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accent + '1f',
    borderWidth: 1,
    borderColor: colors.accent + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
