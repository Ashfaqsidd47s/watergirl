import type { TaskStatus } from '@watergirl/shared';

export const colors = {
  bg: '#0b1220',
  surface: '#121a2b',
  surfaceHigh: '#1a2438',
  border: '#22304a',
  text: '#e6edf7',
  muted: '#8b9bb4',
  faint: '#5b6b85',
  accent: '#38bdf8',
  accentInk: '#04131f',
  danger: '#f87171',
  warning: '#fbbf24',
  success: '#34d399',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

export const mono = { fontFamily: 'Menlo, Consolas, monospace' } as const;

export const statusInfo: Record<TaskStatus, { label: string; color: string; icon: string }> = {
  needs_input: { label: 'Needs you', color: '#fbbf24', icon: 'hand-left' },
  working: { label: 'Working', color: '#38bdf8', icon: 'sync' },
  queued: { label: 'Queued', color: '#94a3b8', icon: 'time' },
  review: { label: 'Ready for review', color: '#a78bfa', icon: 'git-pull-request' },
  failed: { label: 'Stuck', color: '#f87171', icon: 'alert-circle' },
  done: { label: 'Done', color: '#34d399', icon: 'checkmark-circle' },
  merged: { label: 'Merged', color: '#2dd4bf', icon: 'git-merge' },
  stopped: { label: 'Stopped', color: '#94a3b8', icon: 'stop-circle' },
};

export const isActive = (s: TaskStatus) => s === 'working' || s === 'queued';
