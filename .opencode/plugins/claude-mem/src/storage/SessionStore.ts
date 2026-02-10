/**
 * Session 存储管理
 * 与原版 claude-mem 的 SessionStore 兼容
 */

import type { Database } from "bun:sqlite";
import type { Session } from "../types";

export class SessionStore {
  constructor(private db: Database) {}

  /**
   * 创建新会话
   */
  async create(projectPath: string, initialContext?: string): Promise<Session> {
    const result = this.db.query(
      `INSERT INTO sessions (project_path, start_time, status, initial_context)
       VALUES (?, ?, 'active', ?)
       RETURNING *`
    ).get(projectPath, Date.now(), initialContext ?? null) as Session;

    return this.mapFromDb(result);
  }

  /**
   * 根据 ID 获取会话
   */
  async getById(id: number): Promise<Session | null> {
    const result = this.db.query(
      "SELECT * FROM sessions WHERE id = ?"
    ).get(id) as Session | undefined;

    return result ? this.mapFromDb(result) : null;
  }

  /**
   * 获取项目的活动会话
   */
  async getActiveSession(projectPath: string): Promise<Session | null> {
    const result = this.db.query(
      `SELECT * FROM sessions 
       WHERE project_path = ? AND status = 'active'
       ORDER BY start_time DESC
       LIMIT 1`
    ).get(projectPath) as Session | undefined;

    return result ? this.mapFromDb(result) : null;
  }

  /**
   * 获取项目的最近会话
   */
  async getRecentSessions(
    projectPath: string, 
    limit: number = 10
  ): Promise<Session[]> {
    const results = this.db.query(
      `SELECT * FROM sessions 
       WHERE project_path = ?
       ORDER BY start_time DESC
       LIMIT ?`
    ).all(projectPath, limit) as Session[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 更新会话状态
   */
  async updateStatus(
    id: number, 
    status: Session['status']
  ): Promise<void> {
    const updates: string[] = ["status = ?"];
    const values: any[] = [status];

    if (status === 'completed' || status === 'error') {
      updates.push("end_time = ?");
      values.push(Date.now());
    }

    values.push(id);

    this.db.run(
      `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }

  /**
   * 设置最终摘要
   */
  async setFinalSummary(id: number, summary: string): Promise<void> {
    this.db.run(
      "UPDATE sessions SET final_summary = ? WHERE id = ?",
      [summary, id]
    );
  }

  /**
   * 获取会话列表
   */
  async list(
    options: {
      projectPath?: string;
      status?: Session['status'];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<Session[]> {
    const conditions: string[] = [];
    const values: any[] = [];

    if (options.projectPath) {
      conditions.push("project_path = ?");
      values.push(options.projectPath);
    }

    if (options.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(" AND ")}` 
      : "";

    values.push(options.limit ?? 50);
    values.push(options.offset ?? 0);

    const results = this.db.query(
      `SELECT * FROM sessions 
       ${whereClause}
       ORDER BY start_time DESC
       LIMIT ? OFFSET ?`
    ).all(...values) as Session[];

    return results.map(r => this.mapFromDb(r));
  }

  /**
   * 删除会话
   */
  async delete(id: number): Promise<void> {
    this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }

  /**
   * 从数据库映射到 Session 对象
   */
  private mapFromDb(row: any): Session {
    return {
      id: row.id,
      projectPath: row.project_path,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      initialContext: row.initial_context,
      finalSummary: row.final_summary,
    };
  }
}
