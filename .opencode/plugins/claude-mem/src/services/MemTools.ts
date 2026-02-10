/**
 * MCP 工具实现
 * 与原版 claude-mem 的 MCP 工具兼容
 */

import type { 
  SessionStore, 
  ObservationStore, 
  SummaryStore, 
  UserPromptStore 
} from "../storage";
import type { SearchParams, SearchResult } from "../types";

export class MemTools {
  constructor(
    private stores: {
      sessions: SessionStore;
      observations: ObservationStore;
      summaries: SummaryStore;
      prompts: UserPromptStore;
    }
  ) {}

  /**
   * 搜索记忆
   * 对应原版: search
   */
  async search(args: {
    query: string;
    type?: 'observation' | 'summary' | 'prompt' | 'all';
    limit?: number;
  }): Promise<SearchResult[]> {
    const limit = args.limit ?? 10;
    const results: SearchResult[] = [];

    if (args.type === 'all' || args.type === 'observation' || !args.type) {
      const observations = await this.stores.observations.search({
        query: args.query,
        limit,
      });
      
      results.push(...observations.map(o => ({
        id: o.id,
        type: 'observation' as const,
        content: o.summary ?? o.toolOutput.substring(0, 200),
        timestamp: o.timestamp,
        sessionId: o.sessionId,
        relevance: o.importance ?? 0.5,
        metadata: {
          tool: o.tool,
          processed: o.processed,
        },
      })));
    }

    if (args.type === 'all' || args.type === 'summary') {
      const summaries = await this.stores.summaries.search({
        query: args.query,
        limit,
      });
      
      results.push(...summaries.map(s => ({
        id: s.id,
        type: 'summary' as const,
        content: s.content,
        timestamp: s.timestamp,
        sessionId: s.sessionId,
        relevance: 0.8,
        metadata: {
          summaryType: s.type,
        },
      })));
    }

    if (args.type === 'all' || args.type === 'prompt') {
      const prompts = await this.stores.prompts.search({
        query: args.query,
        limit,
      });
      
      results.push(...prompts.map(p => ({
        id: p.id,
        type: 'prompt' as const,
        content: p.content,
        timestamp: p.timestamp,
        sessionId: p.sessionId,
        relevance: 0.6,
        metadata: {},
      })));
    }

    // 按相关性排序
    return results.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }

  /**
   * 获取时间线上下文
   * 对应原版: timeline
   */
  async timeline(args: {
    id: number;
    window?: number;
  }): Promise<{
    observation: any;
    before: any[];
    after: any[];
  } | null> {
    return this.stores.observations.getTimeline(args.id, args.window ?? 5);
  }

  /**
   * 获取观察记录详情
   * 对应原版: get_observations
   */
  async getObservations(args: {
    ids: number[];
  }): Promise<any[]> {
    const observations = [];
    
    for (const id of args.ids) {
      const obs = await this.stores.observations.getById(id);
      if (obs) {
        observations.push(obs);
      }
    }
    
    return observations;
  }

  /**
   * 保存手动记忆
   * 对应原版: save_memory
   */
  async saveMemory(args: {
    text: string;
    title?: string;
    sessionId?: number;
  }): Promise<{ id: number; success: boolean }> {
    // 如果没有指定会话ID，获取最近的活动会话
    let sessionId = args.sessionId;
    
    if (!sessionId) {
      // 获取最近的一个会话
      const sessions = await this.stores.sessions.list({ limit: 1 });
      if (sessions.length > 0) {
        sessionId = sessions[0].id;
      } else {
        throw new Error("No active session found");
      }
    }

    const content = args.title 
      ? `# ${args.title}\n\n${args.text}`
      : args.text;

    const summary = await this.stores.summaries.save(
      sessionId,
      content,
      'manual'
    );

    return {
      id: summary.id,
      success: true,
    };
  }

  /**
   * 获取最近的记忆
   */
  async getRecent(args: {
    projectPath?: string;
    limit?: number;
  }): Promise<SearchResult[]> {
    const observations = await this.stores.observations.getRecent(
      args.projectPath,
      args.limit ?? 20
    );

    return observations.map(o => ({
      id: o.id,
      type: 'observation' as const,
      content: o.summary ?? o.toolOutput.substring(0, 200),
      timestamp: o.timestamp,
      sessionId: o.sessionId,
      relevance: o.importance ?? 0.5,
      metadata: {
        tool: o.tool,
      },
    }));
  }

  /**
   * 获取会话列表
   */
  async getSessions(args: {
    projectPath?: string;
    limit?: number;
  }): Promise<any[]> {
    return this.stores.sessions.list({
      projectPath: args.projectPath,
      limit: args.limit ?? 50,
    });
  }
}
