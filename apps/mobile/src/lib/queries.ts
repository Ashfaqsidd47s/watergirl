import type { Task, TaskEvent } from '@watergirl/shared';
import { useIsFocused } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './connection';
import { isActive } from './theme';

export function useOverview() {
  const api = useApi();
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: focused ? 4000 : false,
  });
}

export function useAccounts() {
  const api = useApi();
  return useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
}

export function useGithubRepos(accountId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['github-repos', accountId],
    queryFn: () => api.githubRepos(accountId!),
    enabled: !!accountId,
    staleTime: 60_000,
  });
}

export function usePr(taskId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ['pr', taskId], queryFn: () => api.pr(taskId), enabled, refetchInterval: 20_000 });
}

/** Invalidate everything that lists tasks/projects after a change. */
export function useRefreshAll() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries(), [qc]);
}

export function useApiMutation<A, R>(fn: (a: A) => Promise<R>) {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: fn, onSuccess: () => void refresh() });
}

/**
 * Live task view: polls `/api/tasks/:id?after=<last event>` and appends,
 * so long agent runs don't re-download the whole timeline.
 */
export function useTaskLive(id: string) {
  const api = useApi();
  const focused = useIsFocused();
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const d = await api.task(id, lastId.current);
      setTask(d.task);
      if (d.events.length) {
        lastId.current = d.events[d.events.length - 1].id;
        setEvents((prev) => [...prev, ...d.events]);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
    }
  }, [api, id]);

  useEffect(() => {
    lastId.current = 0;
    setEvents([]);
    setTask(null);
  }, [id]);

  const active = task ? isActive(task.status) : true;
  useEffect(() => {
    if (!focused) return;
    void poll();
    const t = setInterval(poll, active ? 1500 : 5000);
    return () => clearInterval(t);
  }, [poll, focused, active]);

  return { task, events, error, refresh: poll, setTask };
}
