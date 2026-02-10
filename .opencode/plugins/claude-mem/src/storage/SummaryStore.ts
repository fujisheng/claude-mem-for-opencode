/**
 * Summary 存储管理
 */

import type { Database } from "bun:sqlite";
import type { Summary, SearchParams } from "../types";

export class SummaryStore {
  constructor(private db: Database) {}

  /**
   * 保存摘要
   */
  async save(
    sessionId: number,
    content: string,
    type: Summary['type'] = 'session',
    concepts?: string[],
    files?: string[]
  ): Promise<Summary> {
    const result = this.db.query(
      `INSERT INTO summaries (session_id, content, timestamp, type, concepts, files)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    ).get(
      sessionId,
      content,
      Date.now(),
      type,
      concepts ? JSON.stringify(concepts) : null,
      files ? JSON.stringify(files) : null
    ) as Summary;

    return this.mapFromDb(result);
  }

  /**
   * 根据 ID 获取摘要
   */
  async getById(id: number): Promise<Summary | null> {
    const result = this.db.query(
      "SELECT * FROM summaries WHERE id = ?"
    ).get(id) as Summary | undefined;

    return result ? this.mapFromDb(result) : null;
  }

  /**
   * 获取会话的所有摘要
   */
  async getBySessionId(sessionId: number): Promise<Summary[]> {
    const results = this.db.query(
      `SELECT * FROM summaries 
       WHERE session_id = ?
       ORDER BY timestamp DESC`
    ).all(sessionId) as Summary[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 搜索摘要
   */
  async search(params: SearchParams): Promise<Summary[]> {
    if (params.query) {
      // 使用 FTS5 搜索
      const ftsResults = this.db.query(
        `SELECT rowid FROM summaries_fts 
         WHERE summaries_fts MATCH ?
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
      const results = this.db.query(
        `SELECT * FROM summaries WHERE id IN (${ids.join(',')})`
      ).all() as Summary[];

      return results.map(r => this.mapFromDb(r));
    }

    // 普通查询
    const conditions: string[] = [];
    const values: any[] = [];

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

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(" AND ")}` 
      : "";

    values.push(params.limit ?? 50);
    values.push(params.offset ?? 0);

    const results = this.db.query(
      `SELECT * FROM summaries ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...values) as Summary[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 删除摘要
   */
  async delete(id: number): Promise<void> {
    this.db.run("DELETE FROM summaries WHERE id = ?", [id]);
  }

  /**
   * 从数据库映射到 Summary 对象
   */
  private mapFromDb(row: any): Summary {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      timestamp: row.timestamp,
      type: row.type,
      concepts: row.concepts ? JSON.parse(row.concepts) : undefined,
      files: row.files ? JSON.parse(row.files) : undefined,
    };
  }
}
