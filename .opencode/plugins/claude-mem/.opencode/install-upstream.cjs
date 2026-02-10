#!/usr/bin/env node
/**
 * Claude-Mem 自动安装脚本
 * 用于 AI 自动集成上游 claude-mem
 * 
 * 使用方法:
 *   node install-upstream.js
 * 
 * 功能:
 *   1. 检查系统依赖
 *   2. 克隆上游仓库
 *   3. 安装依赖并构建
 *   4. 验证安装
 *   5. 配置 MCP
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  upstreamRepo: 'https://github.com/thedotmack/claude-mem.git',
  installPath: path.join(__dirname, '..', 'vendor', 'claude-mem'),
  mcpConfigPath: path.join(__dirname, '..', '..', '..', 'skills', 'mem-search', 'mcp.json'),
  bootstrapScript: path.join(__dirname, '..', '..', '..', 'skills', 'mem-search', 'bootstrap.cjs'),
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = `[${timestamp}]`;
  
  switch (level) {
    case 'error':
      console.error(`${colors.red}${prefix} [ERROR] ${message}${colors.reset}`);
      break;
    case 'warn':
      console.warn(`${colors.yellow}${prefix} [WARN] ${message}${colors.reset}`);
      break;
    case 'success':
      console.log(`${colors.green}${prefix} [SUCCESS] ${message}${colors.reset}`);
      break;
    case 'info':
    default:
      console.log(`${colors.blue}${prefix} [INFO] ${message}${colors.reset}`);
  }
}

function exec(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout || 60000,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message, code: error.status };
  }
}

// 检查命令是否存在
function checkCommand(command) {
  const result = exec(`${command} --version`, { silent: true });
  return result.success;
}

// 步骤 1: 检查依赖
async function checkDependencies() {
  log('步骤 1/5: 检查系统依赖...', 'info');
  
  const deps = [
    { name: 'Node.js', command: 'node', required: true },
    { name: 'Git', command: 'git', required: true },
    { name: 'Bun', command: 'bun', required: false },
  ];
  
  let allGood = true;
  
  for (const dep of deps) {
    if (checkCommand(dep.command)) {
      const version = exec(`${dep.command} --version`, { silent: true }).output?.trim();
      log(`  ✅ ${dep.name}: ${version}`, 'success');
    } else {
      if (dep.required) {
        log(`  ❌ ${dep.name}: 未安装（必需）`, 'error');
        allGood = false;
      } else {
        log(`  ⚠️ ${dep.name}: 未安装（推荐安装以获得更好性能）`, 'warn');
      }
    }
  }
  
  if (!allGood) {
    log('\n请先安装必需的依赖:', 'error');
    log('  - Node.js: https://nodejs.org/', 'info');
    log('  - Git: https://git-scm.com/', 'info');
    process.exit(1);
  }
  
  return true;
}

// 步骤 2: 克隆或更新上游代码
async function cloneOrUpdateUpstream() {
  log('\n步骤 2/5: 拉取上游代码...', 'info');
  
  if (fs.existsSync(CONFIG.installPath)) {
    log('  检测到已存在的上游代码，执行更新...', 'info');
    const result = exec('git pull origin main', { 
      cwd: CONFIG.installPath,
      timeout: 60000 
    });
    
    if (result.success) {
      log('  ✅ 上游代码已更新到最新版本', 'success');
    } else {
      log(`  ⚠️ 更新失败，尝试强制重置...`, 'warn');
      exec('git fetch origin', { cwd: CONFIG.installPath, silent: true });
      exec('git reset --hard origin/main', { cwd: CONFIG.installPath, silent: true });
      log('  ✅ 上游代码已强制更新', 'success');
    }
  } else {
    log('  首次安装，克隆上游仓库...', 'info');
    fs.mkdirSync(path.dirname(CONFIG.installPath), { recursive: true });
    
    const result = exec(
      `git clone ${CONFIG.upstreamRepo} "${CONFIG.installPath}"`,
      { timeout: 120000 }
    );
    
    if (result.success) {
      log('  ✅ 上游代码克隆成功', 'success');
    } else {
      log(`  ❌ 克隆失败: ${result.error}`, 'error');
      process.exit(1);
    }
  }
  
  return true;
}

// 步骤 3: 安装依赖
async function installDependencies() {
  log('\n步骤 3/5: 安装上游依赖...', 'info');
  
  log('  运行 npm install，这可能需要几分钟...', 'info');
  const result = exec('npm install', { 
    cwd: CONFIG.installPath,
    timeout: 180000  // 3分钟
  });
  
  if (result.success) {
    log('  ✅ 依赖安装成功', 'success');
  } else {
    log(`  ❌ 依赖安装失败: ${result.error}`, 'error');
    process.exit(1);
  }
  
  return true;
}

// 步骤 4: 构建项目
async function buildProject() {
  log('\n步骤 4/5: 构建上游项目...', 'info');
  
  log('  运行 npm run build，这可能需要几分钟...', 'info');
  const result = exec('npm run build', { 
    cwd: CONFIG.installPath,
    timeout: 180000  // 3分钟
  });
  
  if (result.success) {
    log('  ✅ 项目构建成功', 'success');
  } else {
    log(`  ❌ 构建失败: ${result.error}`, 'error');
    log('\n尝试强制重新构建:', 'warn');
    
    // 尝试清理后重新构建
    exec('rm -rf node_modules package-lock.json', { cwd: CONFIG.installPath, silent: true });
    exec('npm install', { cwd: CONFIG.installPath, timeout: 180000 });
    const retry = exec('npm run build', { cwd: CONFIG.installPath, timeout: 180000 });
    
    if (retry.success) {
      log('  ✅ 强制重新构建成功', 'success');
    } else {
      log('  ❌ 重新构建也失败了', 'error');
      process.exit(1);
    }
  }
  
  return true;
}

// 步骤 5: 验证安装
async function verifyInstallation() {
  log('\n步骤 5/5: 验证安装...', 'info');
  
  const requiredFiles = [
    'plugin/scripts/worker-service.cjs',
    'plugin/scripts/worker-wrapper.cjs',
    'plugin/scripts/mcp-server.cjs',
  ];
  
  let allExist = true;
  
  for (const file of requiredFiles) {
    const fullPath = path.join(CONFIG.installPath, file);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      log(`  ✅ ${file} (${(stats.size / 1024).toFixed(1)} KB)`, 'success');
    } else {
      log(`  ❌ ${file} 不存在`, 'error');
      allExist = false;
    }
  }
  
  if (!allExist) {
    log('\n❌ 验证失败：部分构建产物缺失', 'error');
    process.exit(1);
  }
  
  // 检查 MCP 配置
  if (fs.existsSync(CONFIG.mcpConfigPath)) {
    log(`  ✅ MCP 配置存在: ${CONFIG.mcpConfigPath}`, 'success');
  } else {
    log(`  ⚠️ MCP 配置不存在，需要手动配置: ${CONFIG.mcpConfigPath}`, 'warn');
  }
  
  return true;
}

// 主函数
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  Claude-Mem 上游自动安装脚本');
  console.log('  版本: 1.0.0');
  console.log('='.repeat(60) + '\n');
  
  try {
    await checkDependencies();
    await cloneOrUpdateUpstream();
    await installDependencies();
    await buildProject();
    await verifyInstallation();
    
    console.log('\n' + '='.repeat(60));
    console.log('  ✅ 安装完成！');
    console.log('='.repeat(60) + '\n');
    
    console.log('下一步操作：');
    console.log('  1. 重启 Opencode MCP 服务器以加载新配置');
    console.log('  2. 测试工具: __IMPORTANT()');
    console.log('  3. 测试搜索: search(query="test")');
    console.log('');
    console.log('更新上游代码时，重新运行此脚本即可。');
    console.log('');
    
  } catch (error) {
    log(`\n❌ 安装过程中出现错误: ${error.message}`, 'error');
    process.exit(1);
  }
}

// 运行
main();
