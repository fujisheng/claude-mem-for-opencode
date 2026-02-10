/**
 * SQLite + FTS5 存储层
 * 兼容原版 claude-mem 的数据库架构
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { 
  Session, 
  Observation, 
  Summary, 
  UserPrompt, 
  SearchResult, 
  SearchParams,
  ClaudeMemConfig 
} from "../types";

export class SQLiteStorage {
  private db: Database | null = null;
  private config: ClaudeMemConfig;

  constructor(config: ClaudeMemConfig) {
    this.config = config;
  }

  /**
   * 初始化数据库连接和表结构
   */
  async initialize(): Promise<void> {
    // 确保数据目录存在
    const dataDir = dirname(this.config.dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // 打开数据库
    this.db = new Database(this.config.dbPath);
    
    // 启用外键和 WAL 模式
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("PRAGMA journal_mode = WAL");

    // 运行迁移
    await this.runMigrations();
  }

  /**
   * 运行数据库迁移
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // 创建迁移表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )
    `);

    // 获取当前版本
    const currentVersion = this.db.query(
      "SELECT MAX(version) as version FROM migrations"
    ).get() as { version: number | null };

    const version = currentVersion?.version ?? 0;

    // 版本 1: 初始表结构
    if (version < 1) {
      this.createInitialSchema();
      this.recordMigration(1);
    }

    // 版本 2: FTS5 搜索表
    if (version < 2) {
      this.createFTSTables();
      this.recordMigration(2);
    }

    // 版本 3: 索引优化
    if (version < 3) {
      this.createIndexes();
      this.recordMigration(3);
    }
  }

  /**
   * 记录迁移
   */
  private recordMigration(version: number): void {
    if (!this.db) return;
    this.db.run(
      "INSERT INTO migrations (version, applied_at) VALUES (?, ?)",
      [version, Date.now()]
    );
  }

  /**
   * 创建初始表结构
   */
  private createInitialSchema(): void {
    if (!this.db) return;

    // 会话表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        initial_context TEXT,
        final_summary TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )
    `);

    // 观察记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        tool TEXT NOT NULL,
        tool_input TEXT NOT NULL,
        tool_output TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        concepts TEXT,
        files TEXT,
        importance REAL DEFAULT 0.5,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // 摘要表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'session',
        concepts TEXT,
        files TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // 用户提示表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);
  }

  /**
   * 创建 FTS5 虚拟表（全文搜索）
   */
  private createFTSTables(): void {
    if (!this.db) return;

    // 观察记录 FTS5 表
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        content,
        tool,
        session_id UNINDEXED,
        tokenize='porter unicode61'
      )
    `);

    // 摘要 FTS5 表
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
        content,
        session_id UNINDEXED,
        tokenize='porter unicode61'
      )
    `);

    // 用户提示 FTS5 表
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
        content,
        session_id UNINDEXED,
        tokenize='porter unicode61'
      )
    `);

    // 创建触发器保持 FTS 表同步
    this.createFTSTriggers();
  }

  /**
   * 创建 FTS 触发器
   */
  private createFTSTriggers(): void {
    if (!this.db) return;

    // Observations 触发器
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS observations_fts_insert 
      AFTER INSERT ON observations
      BEGIN
        INSERT INTO observations_fts(rowid, content, tool, session_id)
        VALUES (new.id, new.tool_output, new.tool, new.session_id);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS observations_fts_delete
      AFTER DELETE ON observations
      BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, content, tool, session_id)
        VALUES ('delete', old.id, old.tool_output, old.tool, old.session_id);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS observations_fts_update
      AFTER UPDATE ON observations
      BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, content, tool, session_id)
        VALUES ('delete', old.id, old.tool_output, old.tool, old.session_id);
        INSERT INTO observations_fts(rowid, content, tool, session_id)
        VALUES (new.id, new.tool_output, new.tool, new.session_id);
      END
    `);

    // Summaries 触发器
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS summaries_fts_insert
      AFTER INSERT ON summaries
      BEGIN
        INSERT INTO summaries_fts(rowid, content, session_id)
        VALUES (new.id, new.content, new.session_id);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS summaries_fts_delete
      AFTER DELETE ON summaries
      BEGIN
        INSERT INTO summaries_fts(summaries_fts, rowid, content, session_id)
        VALUES ('delete', old.id, old.content, old.session_id);
      END
    `);

    // Prompts 触发器
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS prompts_fts_insert
      AFTER INSERT ON user_prompts
      BEGIN
        INSERT INTO prompts_fts(rowid, content, session_id)
        VALUES (new.id, new.content, new.session_id);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS prompts_fts_delete
      AFTER DELETE ON user_prompts
      BEGIN
        INSERT INTO prompts_fts(prompts_fts, rowid, content, session_id)
        VALUES ('delete', old.id, old.content, old.session_id);
      END
    `);
  }

  /**
   * 创建索引
   */
  private createIndexes(): void {
    if (!this.db) return;

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_processed ON observations(processed)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_tool ON observations(tool)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_prompts_session ON user_prompts(session_id)`);
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * 获取原始数据库实例
   */
  getDatabase(): Database {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  /**
   * 执行原始 SQL
   */
  exec(sql: string, params?: any[]): any {
    if (!this.db) throw new Error("Database not initialized");
    return this.db.query(sql).all(...(params ?? []));
  }
}
