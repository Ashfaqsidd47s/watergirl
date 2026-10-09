import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Api } from './api';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask for permission, get this phone's Expo push token and give it to the
 * server. Needs a development/production build with an EAS project id;
 * returns a human-readable reason when that isn't possible.
 */
export async function enablePush(api: Api): Promise<{ ok: boolean; message: string }> {
  if (Platform.OS === 'web') return { ok: false, message: 'Push works in the phone app, not the web preview.' };
  if (!Device.isDevice) return { ok: false, message: 'Push needs a real phone, not a simulator.' };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Water Girl',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return { ok: false, message: 'Notifications are turned off for Water Girl in system settings.' };

  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { ok: false, message: 'Run `npx eas-cli@latest init` once so the app has an EAS project id, then rebuild.' };
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPush(data);
    return { ok: true, message: 'Notifications are on. Water Girl will ping you when an agent needs you or finishes.' };
  } catch (e) {
    return { ok: false, message: `Couldn't get a push token: ${(e as Error).message}` };
  }
}
