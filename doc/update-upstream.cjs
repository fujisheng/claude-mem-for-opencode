#!/usr/bin/env node
/**
 * Claude-Mem 上游更新脚本
 * 
 * 使用方法:
 *   node update-upstream.js
 *   node update-upstream.js --tag v10.0.1
 * 
 * 功能:
 *   1. 拉取上游最新代码（或切换到指定 tag）
 *   2. 更新依赖
 *   3. 重新构建
 *   4. 验证更新
 *   5. 提醒重启服务
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  upstreamPath: path.join(__dirname, '..', 'vendor', 'claude-mem'),
  versionFilePath: path.join(__dirname, '..', '.upstream-version'),
};

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const tagIndex = args.indexOf('--tag');
  const tag = tagIndex !== -1 && args[tagIndex + 1] ? args[tagIndex + 1] : null;
  return { tag };
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  switch (level) {
    case 'success': console.log(`${colors.green}[${timestamp}] ✅ ${message}${colors.reset}`); break;
    case 'warn': console.warn(`${colors.yellow}[${timestamp}] ⚠️ ${message}${colors.reset}`); break;
    case 'error': console.error(`${colors.red}[${timestamp}] ❌ ${message}${colors.reset}`); break;
    default: console.log(`${colors.blue}[${timestamp}] ℹ️ ${message}${colors.reset}`);
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
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = parseArgs();
  
  console.log('\n' + '='.repeat(60));
  console.log('  Claude-Mem 上游更新脚本');
  console.log('='.repeat(60) + '\n');
  
  // 检查上游目录是否存在
  if (!fs.existsSync(CONFIG.upstreamPath)) {
    log('上游目录不存在，请先运行安装脚本', 'error');
    console.log('\n运行: node install-upstream.js\n');
    process.exit(1);
  }
  
  // 获取当前版本
  const currentVersion = exec('git describe --tags --always', { 
    cwd: CONFIG.upstreamPath, 
    silent: true 
  }).output?.trim() || 'unknown';
  log(`当前版本: ${currentVersion}`);
  
  // 步骤 1: 拉取/切换到指定版本
  if (args.tag) {
    log(`\n步骤 1/4: 切换到指定 tag: ${args.tag}...`);
    exec('git fetch --tags', { cwd: CONFIG.upstreamPath, silent: true });
    const checkoutResult = exec(`git checkout ${args.tag}`, { cwd: CONFIG.upstreamPath });
    
    if (!checkoutResult.success) {
      log(`切换到 tag ${args.tag} 失败`, 'error');
      process.exit(1);
    }
    
    // 记录版本
    fs.writeFileSync(CONFIG.versionFilePath, args.tag, 'utf8');
    log(`已记录版本: ${args.tag}`, 'success');
  } else {
    log('\n步骤 1/4: 拉取上游最新代码...');
    exec('git fetch origin', { cwd: CONFIG.upstreamPath, silent: true });
    const result = exec('git pull origin main', { cwd: CONFIG.upstreamPath });
    
    if (!result.success) {
      log('拉取失败，尝试强制更新...', 'warn');
      exec('git reset --hard origin/main', { cwd: CONFIG.upstreamPath, silent: true });
    }
  }
  
  const newVersion = exec('git describe --tags --always', { 
    cwd: CONFIG.upstreamPath, 
    silent: true 
  }).output?.trim() || 'unknown';
  
  if (currentVersion === newVersion) {
    log('已经是最新版本，无需更新', 'success');
  } else {
    log(`更新到版本: ${newVersion}`, 'success');
  }
  
  // 步骤 2: 更新依赖
  log('\n步骤 2/4: 更新依赖...');
  const installResult = exec('npm install', { cwd: CONFIG.upstreamPath, timeout: 120000 });
  if (installResult.success) {
    log('依赖更新成功', 'success');
  } else {
    log('依赖更新失败', 'error');
    process.exit(1);
  }
  
  // 步骤 3: 重新构建
  log('\n步骤 3/4: 重新构建项目...');
  const buildResult = exec('npm run build', { cwd: CONFIG.upstreamPath, timeout: 180000 });
  if (buildResult.success) {
    log('构建成功', 'success');
  } else {
    log('构建失败，尝试清理后重试...', 'warn');
    exec('rm -rf node_modules package-lock.json', { cwd: CONFIG.upstreamPath, silent: true });
    exec('npm install', { cwd: CONFIG.upstreamPath, timeout: 180000 });
    const retry = exec('npm run build', { cwd: CONFIG.upstreamPath, timeout: 180000 });
    if (retry.success) {
      log('重新构建成功', 'success');
    } else {
      log('重新构建失败', 'error');
      process.exit(1);
    }
  }
  
  // 步骤 4: 验证
  log('\n步骤 4/4: 验证更新...');
  const requiredFiles = [
    'plugin/scripts/worker-service.cjs',
    'plugin/scripts/worker-wrapper.cjs',
    'plugin/scripts/mcp-server.cjs',
  ];
  
  let allGood = true;
  for (const file of requiredFiles) {
    const fullPath = path.join(CONFIG.upstreamPath, file);
    if (fs.existsSync(fullPath)) {
      log(`  ✅ ${file}`);
    } else {
      log(`  ❌ ${file} 缺失`, 'error');
      allGood = false;
    }
  }
  
  if (!allGood) {
    process.exit(1);
  }
  
  // 完成
  const finalVersion = exec('git describe --tags --always', { 
    cwd: CONFIG.upstreamPath, 
    silent: true 
  }).output?.trim() || 'unknown';
  
  console.log('\n' + '='.repeat(60));
  console.log('  ✅ 更新完成！');
  console.log(`  当前版本: ${finalVersion}`);
  console.log('='.repeat(60) + '\n');
  
  console.log(`${colors.yellow}⚠️  重要提示：${colors.reset}`);
  console.log('  更新后需要重启 MCP 服务器才能生效！');
  console.log('');
  console.log('  重启步骤：');
  console.log('    1. 关闭当前 Opencode 会话');
  console.log('    2. 重新启动 Opencode');
  console.log('    3. 测试工具: __IMPORTANT()');
  console.log('');
}

main().catch(err => {
  log(`错误: ${err.message}`, 'error');
  process.exit(1);
});
