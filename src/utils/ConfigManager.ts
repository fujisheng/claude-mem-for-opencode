/**
 * 配置管理器
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { ClaudeMemConfig } from "../types";
import { DEFAULT_CONFIG } from "../types";

export class ConfigManager {
  private configPath: string;
  private config: ClaudeMemConfig;

  constructor(configPath?: string) {
    this.configPath = configPath ?? `${process.env.HOME}/.claude-mem-opencode/settings.json`;
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * 加载配置
   */
  async load(): Promise<ClaudeMemConfig> {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, "utf-8");
        const userConfig = JSON.parse(content);
        this.config = { ...DEFAULT_CONFIG, ...userConfig };
      } catch (error) {
        console.error("[ClaudeMem] Failed to load config:", error);
      }
    } else {
      // 首次运行，创建默认配置
      await this.save();
    }

    // 确保数据目录存在
    const dataDir = dirname(this.config.dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    return this.config;
  }

  /**
   * 保存配置
   */
  async save(): Promise<void> {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      "utf-8"
    );
  }

  /**
   * 获取配置
   */
  get(): ClaudeMemConfig {
    return this.config;
  }

  /**
   * 更新配置
   */
  update(updates: Partial<ClaudeMemConfig>): void {
    this.config = { ...this.config, ...updates };
    this.save();
  }

  /**
   * 获取配置路径
   */
  getConfigPath(): string {
    return this.configPath;
  }
}
