/**
 * Observation 存储管理
 * 与原版 claude-mem 的 ObservationStore 兼容
 */

import type { Database } from "bun:sqlite";
import type { Observation, SearchParams, TimelineResult } from "../types";

export class ObservationStore {
  constructor(private db: Database) {}

  /**
   * 保存观察记录
   */
  async save(
    sessionId: number,
    tool: string,
    toolInput: string,
    toolOutput: string
  ): Promise<Observation> {
    // 截断过长的输出
    const truncatedInput = this.truncate(toolInput, 10000);
    const truncatedOutput = this.truncate(toolOutput, 10000);

    const result = this.db.query(
      `INSERT INTO observations 
       (session_id, tool, tool_input, tool_output, timestamp, processed)
       VALUES (?, ?, ?, ?, ?, 0)
       RETURNING *`
    ).get(
      sessionId,
      tool,
      truncatedInput,
      truncatedOutput,
      Date.now()
    ) as Observation;

    return this.mapFromDb(result);
  }

  /**
   * 根据 ID 获取观察记录
   */
  async getById(id: number): Promise<Observation | null> {
    const result = this.db.query(
      "SELECT * FROM observations WHERE id = ?"
    ).get(id) as Observation | undefined;

    return result ? this.mapFromDb(result) : null;
  }

  /**
   * 获取会话的所有观察记录
   */
  async getBySessionId(sessionId: number): Promise<Observation[]> {
    const results = this.db.query(
      `SELECT * FROM observations 
       WHERE session_id = ?
       ORDER BY timestamp ASC`
    ).all(sessionId) as Observation[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 获取未处理的观察记录
   */
  async getUnprocessed(limit: number = 100): Promise<Observation[]> {
    const results = this.db.query(
      `SELECT * FROM observations 
       WHERE processed = 0
       ORDER BY timestamp ASC
       LIMIT ?`
    ).all(limit) as Observation[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 标记观察记录为已处理
   */
  async markAsProcessed(
    id: number,
    summary?: string,
    concepts?: string[],
    files?: string[],
    importance?: number
  ): Promise<void> {
    this.db.run(
      `UPDATE observations 
       SET processed = 1, 
           summary = ?,
           concepts = ?,
           files = ?,
           importance = ?
       WHERE id = ?`,
      [
        summary ?? null,
        concepts ? JSON.stringify(concepts) : null,
        files ? JSON.stringify(files) : null,
        importance ?? 0.5,
        id,
      ]
    );
  }

  /**
   * 获取会话的观察记录数量
   */
  async getCountBySession(sessionId: number): Promise<number> {
    const result = this.db.query(
      "SELECT COUNT(*) as count FROM observations WHERE session_id = ?"
    ).get(sessionId) as { count: number };

    return result.count;
  }

  /**
   * 搜索观察记录
   */
  async search(params: SearchParams): Promise<Observation[]> {
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.query) {
      // 使用 FTS5 搜索
      const ftsResults = this.db.query(
        `SELECT rowid FROM observations_fts 
         WHERE observations_fts MATCH ?
         ORDER BY rank
         LIMIT ? OFFSET ?`
      ).all(
        params.query,
        params.limit ?? 50,
        params.offset ?? 0
      ) as { rowid: number }[];

      if (ftsResults.length === 0) {
        return [];
      }

      const ids = ftsResults.map(r => r.rowid);
      conditions.push(`id IN (${ids.join(',')})`);
    }

    if (params.sessionId) {
      conditions.push("session_id = ?");
      values.push(params.sessionId);
    }

    if (params.startDate) {
      conditions.push("timestamp >= ?");
      values.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push("timestamp <= ?");
      values.push(params.endDate);
    }

    if (params.concepts && params.concepts.length > 0) {
      const conceptConditions = params.concepts.map(() => "concepts LIKE ?").join(" OR ");
      conditions.push(`(${conceptConditions})`);
      params.concepts.forEach(c => values.push(`%"${c}"%`));
    }

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(" AND ")}` 
      : "";

    if (!params.query) {
      values.push(params.limit ?? 50);
      values.push(params.offset ?? 0);
    }

    const query = params.query
      ? `SELECT * FROM observations ${whereClause} ORDER BY timestamp DESC`
      : `SELECT * FROM observations ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;

    const results = this.db.query(query).all(...values) as Observation[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 获取时间线上下文
   */
  async getTimeline(
    observationId: number,
    contextWindow: number = 5
  ): Promise<TimelineResult | null> {
    const observation = await this.getById(observationId);
    if (!observation) return null;

    // 获取前后的观察记录
    const before = this.db.query(
      `SELECT * FROM observations 
       WHERE session_id = ? AND id < ?
       ORDER BY id DESC
       LIMIT ?`
    ).all(observation.sessionId, observationId, contextWindow) as Observation[];

    const after = this.db.query(
      `SELECT * FROM observations 
       WHERE session_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`
    ).all(observation.sessionId, observationId, contextWindow) as Observation[];

    return {
      observation,
      before: before.map(r => this.mapFromDb(r)).reverse(),
      after: after.map(r => this.mapFromDb(r)),
    };
  }

  /**
   * 获取最近的观察记录
   */
  async getRecent(
    projectPath?: string,
    limit: number = 50
  ): Promise<Observation[]> {
    let query = `SELECT o.* FROM observations o`;
    const values: any[] = [];

    if (projectPath) {
      query += ` JOIN sessions s ON o.session_id = s.id WHERE s.project_path = ?`;
      values.push(projectPath);
    }

    query += ` ORDER BY o.timestamp DESC LIMIT ?`;
    values.push(limit);

    const results = this.db.query(query).all(...values) as Observation[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 删除观察记录
   */
  async delete(id: number): Promise<void> {
    this.db.run("DELETE FROM observations WHERE id = ?", [id]);
  }

  /**
   * 删除会话的所有观察记录
   */
  async deleteBySession(sessionId: number): Promise<void> {
    this.db.run("DELETE FROM observations WHERE session_id = ?", [sessionId]);
  }

  /**
   * 截断字符串
   */
  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + "... [truncated]";
  }

  /**
   * 从数据库映射到 Observation 对象
   */
  private mapFromDb(row: any): Observation {
    return {
      id: row.id,
      sessionId: row.session_id,
      tool: row.tool,
      toolInput: row.tool_input,
      toolOutput: row.tool_output,
      timestamp: row.timestamp,
      processed: row.processed === 1,
      summary: row.summary,
      concepts: row.concepts ? JSON.parse(row.concepts) : undefined,
      files: row.files ? JSON.parse(row.files) : undefined,
      importance: row.importance,
    };
  }
}
