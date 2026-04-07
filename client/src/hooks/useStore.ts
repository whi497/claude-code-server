import { useEffect, useRef, useCallback, useState } from 'react';
import type { Project, Job, LogEntry } from '../types';

type WSEvent =
  | { event: 'init'; data: { projects: Project[]; jobs: Job[] } }
  | { event: 'project:created'; data: Project }
  | { event: 'job:created'; data: Job }
  | { event: 'job:updated'; data: Job }
  | { event: 'job:log'; data: { jobId: string; log: LogEntry } };

interface StoreState {
  projects: Project[];
  jobs: Job[];
  jobLogs: Record<string, LogEntry[]>;
  connected: boolean;
}

export function useStore() {
  const [state, setState] = useState<StoreState>({
    projects: [],
    jobs: [],
    jobLogs: {},
    connected: false,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<any>(null);

  const connect = useCallback(() => {
    // Close any existing connection and prevent its onclose from reconnecting
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    clearTimeout(reconnectTimer.current);

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setState(s => ({ ...s, connected: true }));
    ws.onclose = () => {
      // Only reconnect if this is still the active connection
      if (wsRef.current !== ws) return;
      setState(s => ({ ...s, connected: false }));
      reconnectTimer.current = setTimeout(connect, 2000);
    };
    ws.onmessage = (e) => {
      // Ignore messages from stale connections
      if (wsRef.current !== ws) return;
      const msg = JSON.parse(e.data) as WSEvent;
      setState(s => {
        switch (msg.event) {
          case 'init':
            return { ...s, projects: msg.data.projects, jobs: msg.data.jobs, jobLogs: {} };
          case 'project:created':
            if (s.projects.some(p => p.id === msg.data.id)) return s;
            return { ...s, projects: [...s.projects, msg.data] };
          case 'job:created':
            if (s.jobs.some(j => j.id === msg.data.id)) return s;
            return { ...s, jobs: [...s.jobs, msg.data] };
          case 'job:updated': {
            const updated = msg.data;
            return { ...s, jobs: s.jobs.map(j => j.id === updated.id ? { ...j, ...updated, logs: j.logs } : j) };
          }
          case 'job:log': {
            const { jobId, log } = msg.data;
            const existing = s.jobLogs[jobId] ?? [];
            return { ...s, jobLogs: { ...s.jobLogs, [jobId]: [...existing, log] } };
          }
          default:
            return s;
        }
      });
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on cleanup
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return state;
}
