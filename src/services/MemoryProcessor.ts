/**
 * 记忆处理器服务
 * 使用 AI 处理观察记录，生成摘要和提取概念
 */

import type { 
  SessionStore, 
  ObservationStore, 
  SummaryStore 
} from "../storage";
import type { Observation } from "../types";

interface AIClient {
  inference: (options: {
    model: string;
    messages: Array<{ role: string; content: string }>;
  }) => Promise<any>;
}

export class MemoryProcessor {
  private stores: {
    sessions: SessionStore;
    observations: ObservationStore;
    summaries: SummaryStore;
  };
  private aiClient: AIClient;
  private isProcessing: boolean = false;

  constructor(
    stores: {
      sessions: SessionStore;
      observations: ObservationStore;
      summaries: SummaryStore;
    },
    aiClient: AIClient
  ) {
    this.stores = stores;
    this.aiClient = aiClient;
  }

  /**
   * 启动后台处理循环
   */
  async start(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log("[ClaudeMem] Memory processor started");
    
    // 启动处理循环
    this.processLoop();
  }

  /**
   * 停止处理
   */
  stop(): void {
    this.isProcessing = false;
    console.log("[ClaudeMem] Memory processor stopped");
  }

  /**
   * 处理循环
   */
  private async processLoop(): Promise<void> {
    while (this.isProcessing) {
      try {
        // 获取未处理的观察记录
        const unprocessed = await this.stores.observations.getUnprocessed(10);
        
        if (unprocessed.length > 0) {
          for (const observation of unprocessed) {
            await this.processObservation(observation);
          }
        }
        
        // 等待一段时间后继续
        await this.sleep(5000);
      } catch (error) {
        console.error("[ClaudeMem] Processing error:", error);
        await this.sleep(10000);
      }
    }
  }

  /**
   * 处理单个观察记录
   */
  private async processObservation(observation: Observation): Promise<void> {
    try {
      // 构建处理提示
      const prompt = this.buildProcessingPrompt(observation);
      
      // 调用 AI 处理
      const response = await this.aiClient.inference({
        model: "claude-3-5-sonnet",
        messages: [{
          role: "user",
          content: prompt,
        }],
      });

      // 解析响应
      const result = this.parseProcessingResponse(response.content ?? response);

      // 更新观察记录
      await this.stores.observations.markAsProcessed(
        observation.id,
        result.summary,
        result.concepts,
        result.files,
        result.importance
      );

      console.log(`[ClaudeMem] Processed observation ${observation.id}`);
    } catch (error) {
      console.error(`[ClaudeMem] Failed to process observation ${observation.id}:`, error);
      // 标记为处理失败但继续
      await this.stores.observations.markAsProcessed(observation.id);
    }
  }

  /**
   * 生成会话摘要
   */
  async generateSessionSummary(sessionId: number): Promise<string | null> {
    try {
      // 获取会话的所有观察记录
      const observations = await this.stores.observations.getBySessionId(sessionId);
      
      if (observations.length === 0) {
        return null;
      }

      // 获取已处理的观察记录摘要
      const processed = observations.filter(o => o.processed && o.summary);
      
      if (processed.length === 0) {
        return null;
      }

      const prompt = `Based on the following AI tool observations from a coding session, 
generate a concise summary of what was accomplished:

${processed.map(o => `- ${o.tool}: ${o.summary}`).join('\n')}

Provide a brief summary (2-3 sentences) focusing on:
1. Main tasks completed
2. Key decisions made
3. Important files modified

Summary:`;

      const response = await this.aiClient.inference({
        model: "claude-3-5-sonnet",
        messages: [{
          role: "user",
          content: prompt,
        }],
      });

      const summary = (response.content ?? response).trim();

      // 保存摘要
      await this.stores.summaries.save(sessionId, summary, 'session');
      
      // 更新会话
      await this.stores.sessions.setFinalSummary(sessionId, summary);

      return summary;
    } catch (error) {
      console.error("[ClaudeMem] Failed to generate session summary:", error);
      return null;
    }
  }

  /**
   * 构建处理提示
   */
  private buildProcessingPrompt(observation: Observation): string {
    return `Analyze the following AI tool execution and extract key information:

Tool: ${observation.tool}
Input: ${observation.toolInput.substring(0, 1000)}
Output: ${observation.toolOutput.substring(0, 2000)}

Please provide:
1. A one-sentence summary of what was done
2. Key concepts/technologies involved (comma-separated)
3. Files modified or referenced (comma-separated)
4. Importance score (0.0-1.0, where 1.0 is critical)

Format your response as:
Summary: <one sentence summary>
Concepts: <concept1>, <concept2>, ...
Files: <file1>, <file2>, ...
Importance: <score>`;
  }

  /**
   * 解析处理响应
   */
  private parseProcessingResponse(response: string): {
    summary?: string;
    concepts?: string[];
    files?: string[];
    importance?: number;
  } {
    const result: {
      summary?: string;
      concepts?: string[];
      files?: string[];
      importance?: number;
    } = {};

    // 提取摘要
    const summaryMatch = response.match(/Summary:\s*(.+?)(?=\n|$)/i);
    if (summaryMatch) {
      result.summary = summaryMatch[1].trim();
    }

    // 提取概念
    const conceptsMatch = response.match(/Concepts:\s*(.+?)(?=\n|$)/i);
    if (conceptsMatch) {
      result.concepts = conceptsMatch[1]
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);
    }

    // 提取文件
    const filesMatch = response.match(/Files:\s*(.+?)(?=\n|$)/i);
    if (filesMatch) {
      result.files = filesMatch[1]
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0);
    }

    // 提取重要性
    const importanceMatch = response.match(/Importance:\s*(0?\.\d+|1\.0|1)/i);
    if (importanceMatch) {
      result.importance = parseFloat(importanceMatch[1]);
    }

    return result;
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
