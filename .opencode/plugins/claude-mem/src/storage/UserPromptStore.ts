/**
 * UserPrompt 存储管理
 */

import type { Database } from "bun:sqlite";
import type { UserPrompt, SearchParams } from "../types";

export class UserPromptStore {
  constructor(private db: Database) {}

  /**
   * 保存用户提示
   */
  async save(sessionId: number, content: string): Promise<UserPrompt> {
    const result = this.db.query(
      `INSERT INTO user_prompts (session_id, content, timestamp)
       VALUES (?, ?, ?)
       RETURNING *`
    ).get(sessionId, content, Date.now()) as UserPrompt;

    return this.mapFromDb(result);
  }

  /**
   * 根据 ID 获取提示
   */
  async getById(id: number): Promise<UserPrompt | null> {
    const result = this.db.query(
      "SELECT * FROM user_prompts WHERE id = ?"
    ).get(id) as UserPrompt | undefined;

    return result ? this.mapFromDb(result) : null;
  }

  /**
   * 获取会话的所有提示
   */
  async getBySessionId(sessionId: number): Promise<UserPrompt[]> {
    const results = this.db.query(
      `SELECT * FROM user_prompts 
       WHERE session_id = ?
       ORDER BY timestamp ASC`
    ).all(sessionId) as UserPrompt[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 搜索提示
   */
  async search(params: SearchParams): Promise<UserPrompt[]> {
    if (params.query) {
      // 使用 FTS5 搜索
      const ftsResults = this.db.query(
        `SELECT rowid FROM prompts_fts 
         WHERE prompts_fts MATCH ?
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
        `SELECT * FROM user_prompts WHERE id IN (${ids.join(',')})`
      ).all() as UserPrompt[];

      return results.map(r => this.mapFromDb(r));
    }

    // 普通查询
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.sessionId) {
      conditions.push("session_id = ?");
      values.push(params.sessionId);
    }

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(" AND ")}` 
      : "";

    values.push(params.limit ?? 50);
    values.push(params.offset ?? 0);

    const results = this.db.query(
      `SELECT * FROM user_prompts ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...values) as UserPrompt[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 删除提示
   */
  async delete(id: number): Promise<void> {
    this.db.run("DELETE FROM user_prompts WHERE id = ?", [id]);
  }

  /**
   * 从数据库映射到 UserPrompt 对象
   */
  private mapFromDb(row: any): UserPrompt {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      timestamp: row.timestamp,
    };
  }
}
