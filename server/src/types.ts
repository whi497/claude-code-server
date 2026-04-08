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

export type LogType = 'text' | 'tool' | 'tool_result' | 'thinking' | 'system' | 'error' | 'result' | 'user';

export interface LogEntry {
  timestamp: string;
  type: LogType;
  content: string;
  meta?: {
    input?: unknown;                // tool input (for type='tool')
    tool_use_id?: string;           // for tool/tool_result pairing
    parent_tool_use_id?: string;    // for subagent nesting
    block_type?: string;            // for streaming partials
    is_error?: boolean;             // for tool_result errors
    // Subagent lifecycle
    subagent_task_id?: string;      // Agent SDK task ID
    subagent_status?: 'started' | 'progress' | 'completed' | 'failed';
    subagent_usage?: { input_tokens?: number; output_tokens?: number };
    [key: string]: unknown;
  };
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
