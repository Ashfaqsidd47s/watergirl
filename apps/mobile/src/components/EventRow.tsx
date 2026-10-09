import type { TaskEvent } from '@watergirl/shared';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { clock } from '@/lib/format';
import { colors, mono, radius, space } from '@/lib/theme';
import { Icon } from './ui';

/** One line of the task timeline, styled like a chat with the agent. */
export const EventRow = memo(function EventRow({ event }: { event: TaskEvent }) {
  switch (event.kind) {
    case 'user':
      return (
        <View style={[styles.bubble, styles.mine]}>
          <Text style={styles.mineText}>{event.text}</Text>
          <Text style={[styles.time, { color: colors.accentInk + 'aa' }]}>{clock(event.ts)}</Text>
        </View>
      );
    case 'assistant':
    case 'result':
      return (
        <View style={[styles.bubble, styles.theirs, event.kind === 'result' && styles.result]}>
          {event.kind === 'result' ? <Text style={styles.resultLabel}>Agent summary</Text> : null}
          <Text style={styles.theirsText}>{event.text}</Text>
          <Text style={styles.time}>{clock(event.ts)}</Text>
        </View>
      );
    case 'tool': {
      const warn = event.text.startsWith('⚠');
      return (
        <View style={styles.tool}>
          <Icon name={warn ? 'warning-outline' : 'construct-outline'} size={13} color={warn ? colors.warning : colors.faint} />
          <Text style={[styles.toolText, mono]} numberOfLines={2}>
            {warn ? event.text.replace(/^⚠\s*/, '') : event.text}
          </Text>
        </View>
      );
    }
    case 'git':
      return (
        <View style={styles.note}>
          <Icon name="git-branch-outline" size={14} color="#a78bfa" />
          <Text style={[styles.noteText, { color: '#c4b5fd' }]}>{event.text}</Text>
        </View>
      );
    case 'error':
      return (
        <View style={[styles.note, styles.errorBox]}>
          <Icon name="alert-circle" size={14} color={colors.danger} />
          <Text style={[styles.noteText, { color: colors.danger }]}>{event.text}</Text>
        </View>
      );
    default:
      return (
        <View style={styles.note}>
          <Icon name="water-outline" size={13} color={colors.accent} />
          <Text style={styles.noteText}>{event.text}</Text>
        </View>
      );
  }
});

const styles = StyleSheet.create({
  bubble: { maxWidth: '88%', borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  mineText: { color: colors.accentInk, fontSize: 15, lineHeight: 21 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surfaceHigh, borderBottomLeftRadius: 4 },
  theirsText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  result: { borderWidth: 1, borderColor: colors.accent + '55', backgroundColor: colors.surface },
  resultLabel: { color: colors.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  time: { color: colors.faint, fontSize: 10, alignSelf: 'flex-end' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm },
  toolText: { color: colors.muted, fontSize: 12, flex: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: space.md, maxWidth: '95%' },
  noteText: { color: colors.muted, fontSize: 12, textAlign: 'center', flexShrink: 1 },
  errorBox: { backgroundColor: colors.danger + '15', borderRadius: radius.sm, paddingVertical: 6 },
});
