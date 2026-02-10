const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Determine base directory - works from any location
function getBaseDir() {
  // Try to find the claude-mem-for-opencode plugin directory
  const possiblePaths = [
    // When running from project root
    path.join(process.cwd(), '.opencode', 'plugins', 'claude-mem-for-opencode', 'vendor', 'claude-mem', 'plugin', 'scripts'),
    // When running from .opencode/skills/mem-search
    path.join(process.cwd(), '..', '..', 'plugins', 'claude-mem-for-opencode', 'vendor', 'claude-mem', 'plugin', 'scripts'),
    // When running from .opencode/plugins/claude-mem-for-opencode/.opencode
    path.join(process.cwd(), '..', '..', 'vendor', 'claude-mem', 'plugin', 'scripts'),
  ];
  
  for (const testPath of possiblePaths) {
    const normalizedPath = path.normalize(testPath);
    if (fs.existsSync(normalizedPath)) {
      return normalizedPath;
    }
  }
  
  // Fallback to current working directory + relative path
  return path.join(process.cwd(), '.opencode', 'plugins', 'claude-mem-for-opencode', 'vendor', 'claude-mem', 'plugin', 'scripts');
}

const BASE_DIR = getBaseDir();
const WORKER_SERVICE_SCRIPT = path.join(BASE_DIR, 'worker-service.cjs');
const MCP_SCRIPT = path.join(BASE_DIR, 'mcp-server.cjs');
const WORKER_PORT = process.env.CLAUDE_MEM_WORKER_PORT || '37777';
const WORKER_HOST = process.env.CLAUDE_MEM_WORKER_HOST || '127.0.0.1';

// Logging helper (to stderr so it doesn't break MCP JSON-RPC on stdout)
function log(msg) {
  console.error(`[mem-bootstrap] ${msg}`);
}

// Wait for worker to be ready
function waitForWorker(timeout = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 500;
    
    const check = () => {
      const req = http.get(`http://${WORKER_HOST}:${WORKER_PORT}/health`, (res) => {
        if (res.statusCode === 200) {
          log('Worker is ready!');
          resolve();
        } else {
          retry();
        }
      });
      
      req.on('error', () => {
        retry();
      });
      
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    
    const retry = () => {
      if (Date.now() - startTime > timeout) {
        reject(new Error('Worker failed to start within timeout'));
        return;
      }
      setTimeout(check, checkInterval);
    };
    
    check();
  });
}

async function main() {
  log('Initializing...');
  log(`Base directory: ${BASE_DIR}`);
  
  // Verify scripts exist
  if (!fs.existsSync(WORKER_SERVICE_SCRIPT)) {
    log(`ERROR: Worker script not found: ${WORKER_SERVICE_SCRIPT}`);
    log('Please run install-upstream.cjs first');
    process.exit(1);
  }
  
  if (!fs.existsSync(MCP_SCRIPT)) {
    log(`ERROR: MCP script not found: ${MCP_SCRIPT}`);
    log('Please run install-upstream.cjs first');
    process.exit(1);
  }
  
  // 1. Start Worker Service (directly, bypassing wrapper to avoid console window)
  log(`Spawning worker: ${WORKER_SERVICE_SCRIPT}`);
  log(`Working directory: ${BASE_DIR}`);
  const worker = spawn('bun', [WORKER_SERVICE_SCRIPT], {
    cwd: BASE_DIR,
    stdio: ['ignore', 'ignore', 'ignore'], 
    env: { 
      ...process.env,
      CLAUDE_MEM_WORKER_PORT: WORKER_PORT,
      CLAUDE_MEM_WORKER_HOST: WORKER_HOST
    },
    windowsHide: true
  });

  worker.on('error', (err) => {
    log(`Worker spawn error: ${err.message}`);
  });

  worker.on('exit', (code, signal) => {
    log(`Worker exited with code ${code} and signal ${signal}`);
  });

  // Wait for worker to be ready
  try {
    log('Waiting for worker to be ready...');
    await waitForWorker();
  } catch (err) {
    log(`Worker failed to start: ${err.message}`);
    worker.kill();
    process.exit(1);
  }

  // 2. Start the MCP Server
  log(`Spawning MCP server: ${MCP_SCRIPT}`);
  const mcp = spawn('bun', [MCP_SCRIPT], {
    cwd: BASE_DIR,
    stdio: 'inherit',
    env: { 
      ...process.env,
      CLAUDE_MEM_WORKER_PORT: WORKER_PORT,
      CLAUDE_MEM_WORKER_HOST: WORKER_HOST
    },
    windowsHide: true
  });

  mcp.on('error', (err) => {
    log(`MCP server spawn error: ${err.message}`);
    worker.kill();
    process.exit(1);
  });

  mcp.on('exit', (code) => {
    log(`MCP server exited with code ${code}`);
    worker.kill();
    process.exit(code || 0);
  });

  // Handle termination signals to clean up
  process.on('SIGINT', () => {
    worker.kill();
    mcp.kill();
    process.exit();
  });

  process.on('SIGTERM', () => {
    worker.kill();
    mcp.kill();
    process.exit();
  });
}

main().catch(err => {
  log(`Bootstrap error: ${err.message}`);
  process.exit(1);
});
