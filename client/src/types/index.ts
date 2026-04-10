export type JobStatus = 'queued' | 'running' | 'idle' | 'completed' | 'failed' | 'archived';

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  archived?: boolean;
  archivedAt?: string;
  importedFrom?: 'local';
}

export type EffortLevel = 'low' | 'medium' | 'high';

export type ThinkingConfig =
  | { type: 'disabled' }
  | { type: 'enabled'; budgetTokens: number; effort?: EffortLevel };

export type AttachmentMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface Attachment {
  id: string;
  filename: string;
  mediaType: AttachmentMediaType;
  size: number;        // bytes, before base64 encoding
  data: string;        // base64 (no data URI prefix)
}

export interface Job {
  id: string;
  projectId: string;
  name?: string;
  prompt: string;
  attachments?: Attachment[];
  status: JobStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string;  // ISO timestamp — updated on every user input (create / continue)
  result?: string;
  error?: string;
  costUsd?: number;
  tokenUsage?: { input: number; output: number };
  mode?: 'job' | 'session';
  thinking?: ThinkingConfig;
  idleDeadline?: string;   // ISO timestamp — when idle grace period expires (auto-complete)
  forkedFrom?: {
    jobId: string;
    turnIndex: number;      // which assistant turn was forked after (0-based)
  };
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
export type ApprovalStatus = 'pending' | 'answered' | 'approved' | 'rejected' | 'expired' | 'discarded';

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

// ── Import types ────────────────────────────────────────────────
export interface LocalSession {
  fileName: string;
  sessionId: string;
  slug?: string;
  firstPrompt?: string;
  messageCount: number;
  startedAt?: string;
  lastActivity?: string;
  alreadyImported?: boolean;
}

export interface LocalProject {
  dirName: string;
  realPath: string;
  projectName: string;
  sessionCount: number;
  lastActivity?: string;
  existingProjectId?: string;
  sessions: LocalSession[];
}

export interface ImportProgress {
  importId: string;
  current: number;
  total: number;
  currentProject?: string;
  status: 'running' | 'complete' | 'error';
}

export interface ImportResult {
  importId: string;
  projectsCreated: number;
  jobsCreated: number;
  skipped: number;
  errors: number;
}
