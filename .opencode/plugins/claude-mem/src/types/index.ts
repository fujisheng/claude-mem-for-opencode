/**
 * Claude-Mem for OpenCode - 类型定义
 * 与原版 claude-mem 兼容的数据结构
 */

// 会话数据
export interface Session {
  id: number;
  projectPath: string;
  startTime: number;
  endTime?: number;
  status: 'active' | 'completed' | 'error';
  initialContext?: string;
  finalSummary?: string;
}

// 观察记录（工具执行）
export interface Observation {
  id: number;
  sessionId: number;
  tool: string;
  toolInput: string;
  toolOutput: string;
  timestamp: number;
  processed: boolean;
  summary?: string;
  concepts?: string[];
  files?: string[];
  importance?: number;
}

// 摘要/学习记录
export interface Summary {
  id: number;
  sessionId: number;
  content: string;
  timestamp: number;
  type: 'session' | 'compaction' | 'manual';
  concepts?: string[];
  files?: string[];
}

// 用户提示
export interface UserPrompt {
  id: number;
  sessionId: number;
  content: string;
  timestamp: number;
}

// 搜索结果
export interface SearchResult {
  id: number;
  type: 'observation' | 'summary' | 'prompt';
  content: string;
  timestamp: number;
  sessionId: number;
  relevance: number;
  metadata?: Record<string, any>;
}

// 时间线结果
export interface TimelineResult {
  observation: Observation;
  before: Observation[];
  after: Observation[];
}

// 插件配置
export interface ClaudeMemConfig {
  dataDir: string;
  dbPath: string;
  workerPort: number;
  maxObservationsPerSession: number;
  contextInjectionLimit: number;
  autoCompact: boolean;
  compactionThreshold: number;
  excludedTools: string[];
  privateTags: string[];
}

// 默认配置
export const DEFAULT_CONFIG: ClaudeMemConfig = {
  dataDir: `${process.env.HOME}/.claude-mem-opencode`,
  dbPath: `${process.env.HOME}/.claude-mem-opencode/claude-mem.db`,
  workerPort: 37777,
  maxObservationsPerSession: 1000,
  contextInjectionLimit: 10,
  autoCompact: true,
  compactionThreshold: 50,
  excludedTools: ['mem-search', 'skill', 'session_search'],
  privateTags: ['<private>', '</private>', '<confidential>', '</confidential>'],
};

// 插件上下文
export interface PluginContext {
  project: {
    path: string;
    name: string;
  };
  directory: string;
  worktree: string;
}

// Worker 服务状态
export interface WorkerStatus {
  isRunning: boolean;
  port: number;
  pid?: number;
  startTime?: number;
  processedCount: number;
  errorCount: number;
}

// HTTP API 响应
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
}

// 搜索参数
export interface SearchParams {
  query?: string;
  type?: 'observation' | 'summary' | 'prompt' | 'all';
  sessionId?: number;
  projectPath?: string;
  startDate?: number;
  endDate?: number;
  concepts?: string[];
  files?: string[];
  limit?: number;
  offset?: number;
}

// 观察类型（用于分类）
export type ObservationType = 
  | 'code_edit' 
  | 'file_read' 
  | 'file_write' 
  | 'bash' 
  | 'git' 
  | 'search' 
  | 'test' 
  | 'debug' 
  | 'config' 
  | 'other';
