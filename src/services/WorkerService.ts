/**
 * Worker Service HTTP API 兼容层
 * 兼容原版 claude-mem 的 HTTP API
 */

import type { Database } from "bun:sqlite";
import type { 
  SessionStore, 
  ObservationStore, 
  SummaryStore, 
  UserPromptStore 
} from "../storage";
import type { SearchParams, ApiResponse, WorkerStatus } from "../types";

export class WorkerService {
  private server: any;
  private port: number;
  private stores: {
    sessions: SessionStore;
    observations: ObservationStore;
    summaries: SummaryStore;
    prompts: UserPromptStore;
  };
  private status: WorkerStatus = {
    isRunning: false,
    port: 37777,
    processedCount: 0,
    errorCount: 0,
  };

  constructor(
    port: number,
    stores: {
      sessions: SessionStore;
      observations: ObservationStore;
      summaries: SummaryStore;
      prompts: UserPromptStore;
    }
  ) {
    this.port = port;
    this.stores = stores;
    this.status.port = port;
  }

  /**
   * 启动 HTTP 服务
   */
  async start(): Promise<void> {
    // 动态导入 Hono（轻量级 Web 框架）
    const { Hono } = await import("hono");
    const { serve } = await import("bun");

    const app = new Hono();

    // 健康检查
    app.get("/health", (c) => {
      return c.json({
        success: true,
        data: {
          status: this.status,
          timestamp: Date.now(),
        },
      });
    });

    // API 路由
    this.setupRoutes(app);

    // 启动服务器
    this.server = serve({
      port: this.port,
      fetch: app.fetch,
    });

    this.status.isRunning = true;
    this.status.startTime = Date.now();

    console.log(`[ClaudeMem] Worker service started on port ${this.port}`);
  }

  /**
   * 停止 HTTP 服务
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    this.status.isRunning = false;
    console.log("[ClaudeMem] Worker service stopped");
  }

  /**
   * 设置 API 路由
   */
  private setupRoutes(app: any): void {
    // 搜索观察记录
    app.get("/api/search/observations", async (c: any) => {
      try {
        const query = c.req.query("query");
        const sessionId = c.req.query("sessionId");
        const limit = parseInt(c.req.query("limit") ?? "50");
        const offset = parseInt(c.req.query("offset") ?? "0");

        const params: SearchParams = {
          query,
          sessionId: sessionId ? parseInt(sessionId) : undefined,
          limit,
          offset,
        };

        const results = await this.stores.observations.search(params);

        return c.json({
          success: true,
          data: results,
          meta: { total: results.length, limit, offset },
        } as ApiResponse);
      } catch (error) {
        this.status.errorCount++;
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ApiResponse, 500);
      }
    });

    // 搜索摘要
    app.get("/api/search/summaries", async (c: any) => {
      try {
        const query = c.req.query("query");
        const limit = parseInt(c.req.query("limit") ?? "50");

        const results = await this.stores.summaries.search({
          query,
          limit,
        });

        return c.json({
          success: true,
          data: results,
        } as ApiResponse);
      } catch (error) {
        this.status.errorCount++;
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ApiResponse, 500);
      }
    });

    // 获取单个观察记录
    app.get("/api/observation/:id", async (c: any) => {
      try {
        const id = parseInt(c.req.param("id"));
        const observation = await this.stores.observations.getById(id);

        if (!observation) {
          return c.json({
            success: false,
            error: "Observation not found",
          } as ApiResponse, 404);
        }

        return c.json({
          success: true,
          data: observation,
        } as ApiResponse);
      } catch (error) {
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ApiResponse, 500);
      }
    });

    // 获取时间线上下文
    app.get("/api/timeline/:id", async (c: any) => {
      try {
        const id = parseInt(c.req.param("id"));
        const window = parseInt(c.req.query("window") ?? "5");

        const timeline = await this.stores.observations.getTimeline(id, window);

        if (!timeline) {
          return c.json({
            success: false,
            error: "Observation not found",
          } as ApiResponse, 404);
        }

        return c.json({
          success: true,
          data: timeline,
        } as ApiResponse);
      } catch (error) {
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ApiResponse, 500);
      }
    });

    // 获取会话列表
    app.get("/api/sessions", async (c: any) => {
      try {
        const projectPath = c.req.query("projectPath");
        const limit = parseInt(c.req.query("limit") ?? "50");

        const results = await this.stores.sessions.list({
          projectPath,
          limit,
        });

        return c.json({
          success: true,
          data: results,
        } as ApiResponse);
      } catch (error) {
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ApiResponse, 500);
      }
    });

    // 获取最近的观察记录
    app.get("/api/observations/recent", async (c: any) => {
      try {
        const projectPath = c.req.query("projectPath");
        const limit = parseInt(c.req.query("limit") ?? "50");

        const results = await this.stores.observations.getRecent(projectPath, limit);

        return c.json({
          success: true,
          data: results,
        } as ApiResponse);
      } catch (error) {
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ApiResponse, 500);
      }
    });

    // 获取会话详情
    app.get("/api/session/:id", async (c: any) => {
      try {
        const id = parseInt(c.req.param("id"));
        const session = await this.stores.sessions.getById(id);

        if (!session) {
          return c.json({
            success: false,
            error: "Session not found",
          } as ApiResponse, 404);
        }

        const observations = await this.stores.observations.getBySessionId(id);
        const summaries = await this.stores.summaries.getBySessionId(id);

        return c.json({
          success: true,
          data: {
            ...session,
            observations,
            summaries,
          },
        } as ApiResponse);
      } catch (error) {
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        } as ApiResponse, 500);
      }
    });
  }

  /**
   * 获取服务状态
   */
  getStatus(): WorkerStatus {
    return { ...this.status };
  }

  /**
   * 增加处理计数
   */
  incrementProcessed(): void {
    this.status.processedCount++;
  }
}
