export type JobStatus = 'queued' | 'running' | 'idle' | 'completed' | 'failed' | 'archived';

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  name?: string;
  prompt: string;
  status: JobStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  result?: string;
  error?: string;
  costUsd?: number;
  tokenUsage?: { input: number; output: number };
  mode?: 'job' | 'session';
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  type: 'text' | 'tool' | 'tool_result' | 'system' | 'error' | 'result' | 'user';
  content: string;
  meta?: Record<string, unknown>;
}

// ── Approval types ──────────────────────────────────────────────
export type ApprovalType = 'question' | 'plan_exit';
export type ApprovalStatus = 'pending' | 'answered' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: string;
  jobId: string;
  projectId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  content: string;
  toolInput: Record<string, unknown>;
  options?: Array<{ label: string; description?: string }>;
  response?: string;
  respondedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalResponse {
  action: 'answer' | 'approve' | 'reject';
  text?: string;
}
