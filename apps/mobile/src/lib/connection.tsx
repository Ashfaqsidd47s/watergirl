import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { createApi, type Api, type Connection } from './api';

const KEY = 'watergirl.connection';

// SecureStore is native-only; the web build (handy for testing) uses localStorage.
const storage = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(KEY);
  },
  async set(value: string | null) {
    if (Platform.OS === 'web') {
      try {
        if (value === null) globalThis.localStorage?.removeItem(KEY);
        else globalThis.localStorage?.setItem(KEY, value);
      } catch {
        // private mode etc. — the app still works for this session
      }
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, value);
  },
};

interface ConnectionState {
  ready: boolean;
  connection: Connection | null;
  api: Api | null;
  connect: (c: Connection) => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<ConnectionState | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);

  useEffect(() => {
    storage
      .get()
      .then((raw) => setConnection(raw ? (JSON.parse(raw) as Connection) : null))
      .catch(() => setConnection(null))
      .finally(() => setReady(true));
  }, []);

  const connect = useCallback(async (c: Connection) => {
    await storage.set(JSON.stringify(c));
    setConnection(c);
  }, []);

  const disconnect = useCallback(async () => {
    await storage.set(null);
    setConnection(null);
  }, []);

  const api = useMemo(() => (connection ? createApi(connection) : null), [connection]);

  return <Ctx.Provider value={{ ready, connection, api, connect, disconnect }}>{children}</Ctx.Provider>;
}

export function useConnection() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConnection outside ConnectionProvider');
  return ctx;
}

/** The API client; only call from screens that render after connecting. */
export function useApi(): Api {
  const { api } = useConnection();
  if (!api) throw new Error('Not connected to a Water Girl server');
  return api;
}
