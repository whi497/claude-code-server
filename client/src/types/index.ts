export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'archived';

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  prompt: string;
  status: JobStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  result?: string;
  error?: string;
  costUsd?: number;
  tokenUsage?: { input: number; output: number };
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  type: 'text' | 'tool' | 'tool_result' | 'system' | 'error' | 'result';
  content: string;
  meta?: Record<string, unknown>;
}
