import { Alert, Platform } from 'react-native';

/** Yes/no prompt that also works in the web preview. */
export function confirm(title: string, message: string, onYes: () => void, yes = 'Yes') {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: yes, style: 'destructive', onPress: onYes },
  ]);
}
