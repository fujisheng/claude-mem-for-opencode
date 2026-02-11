const http = require('http');
const url = require('url');
const path = require('path');
const os = require('os');
const { Database } = require('bun:sqlite');

const WORKER_HOST = process.env.CLAUDE_MEM_WORKER_HOST || '127.0.0.1';
const WORKER_PORT = Number(process.env.CLAUDE_MEM_WORKER_PORT || '37777');
const PROXY_HOST = process.env.CLAUDE_MEM_PROXY_HOST || '127.0.0.1';
const PROXY_PORT = Number(process.env.CLAUDE_MEM_PROXY_PORT || '37778');

const DATA_DIR = process.env.CLAUDE_MEM_DATA_DIR || path.join(os.homedir(), '.claude-mem');
const DB_PATH = path.join(DATA_DIR, 'claude-mem.db');

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseSearchText(payload) {
  const text = payload?.content?.[0]?.text;
  return typeof text === 'string' ? text : '';
}

function shouldFallbackToLocal(text) {
  if (!text) {
    return true;
  }
  // 上游返回无结果或语义搜索不可用时才回退本地
  if (text.includes('No results found')) {
    return true;
  }
  if (text.includes('Vector search failed') || text.includes('semantic search unavailable')) {
    return true;
  }
  return false;
}

function formatDate(epoch) {
  if (!epoch) {
    return '';
  }
  const date = new Date(Number(epoch));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildSearchResponse(query, rows) {
  if (!rows.length) {
    return {
      content: [{ type: 'text', text: `No results found matching "${query}"` }]
    };
  }

  const lines = [];
  lines.push(`Found ${rows.length} observation(s) matching "${query}"`);
  lines.push('');
  lines.push('| ID | Date | T | Title | Project |');
  lines.push('|----|------|---|-------|---------|');
  for (const row of rows) {
    const title = row.title || row.subtitle || '(untitled)';
    const type = row.type || '-';
    const date = formatDate(row.created_at_epoch);
    const project = row.project || '-';
    lines.push(`| #${row.id} | ${date} | ${type} | ${title} | ${project} |`);
  }
  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}

function searchObservations(query, params) {
  const limit = Math.min(Math.max(Number(params.limit || 20), 1), 100);
  const project = params.project;

  const db = new Database(DB_PATH, { readonly: true });
  const filters = [];
  const values = [];
  if (project) {
    filters.push('o.project = ?');
    values.push(project);
  }

  const whereClause = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const safeQuery = `"${query.replace(/"/g, '""')}"`;
  let rows = [];

  try {
    const sql = `
      SELECT o.id, o.title, o.subtitle, o.type, o.project, o.created_at_epoch
      FROM observations_fts fts
      JOIN observations o ON o.id = fts.rowid
      WHERE observations_fts MATCH ? ${whereClause}
      ORDER BY bm25(observations_fts) ASC, o.created_at_epoch DESC
      LIMIT ?
    `;
    rows = db.prepare(sql).all(safeQuery, ...values, limit);
  } catch {
    rows = [];
  }

  if (!rows.length) {
    const likeClause = [
      'o.title LIKE ?',
      'o.subtitle LIKE ?',
      'o.narrative LIKE ?',
      'o.text LIKE ?',
      'o.facts LIKE ?',
      'o.concepts LIKE ?'
    ].join(' OR ');
    const sql = `
      SELECT o.id, o.title, o.subtitle, o.type, o.project, o.created_at_epoch
      FROM observations o
      WHERE (${likeClause}) ${whereClause}
      ORDER BY o.created_at_epoch DESC
      LIMIT ?
    `;
    const likeValue = `%${query}%`;
    const likeValues = Array(6).fill(likeValue);
    rows = db.prepare(sql).all(...likeValues, ...values, limit);
  }

  db.close();
  return buildSearchResponse(query, rows);
}

function fetchUpstreamSearch(reqUrl) {
  return new Promise((resolve, reject) => {
    const target = new url.URL(reqUrl, `http://${WORKER_HOST}:${WORKER_PORT}`);
    const options = {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: 'GET'
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => { data += chunk; });
      proxyRes.on('end', () => {
        try {
          const payload = JSON.parse(data);
          resolve({ statusCode: proxyRes.statusCode || 500, payload });
        } catch (err) {
          reject(err);
        }
      });
    });

    proxyReq.on('error', (err) => reject(err));
    proxyReq.end();
  });
}

function forwardRequest(req, res) {
  const target = new url.URL(req.url, `http://${WORKER_HOST}:${WORKER_PORT}`);
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: req.method,
    headers: req.headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    sendJson(res, 502, { error: `Proxy error: ${err.message}` });
  });

  req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: 'Missing URL' });
    return;
  }

  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/api/search' && req.method === 'GET') {
    const query = String(parsed.query.query || '').trim();
    if (!query) {
      sendJson(res, 400, { error: 'Missing query parameter' });
      return;
    }
    const upstreamUrl = req.url;
    fetchUpstreamSearch(upstreamUrl)
      .then(({ statusCode, payload }) => {
        const text = parseSearchText(payload);
        if (!shouldFallbackToLocal(text)) {
          sendJson(res, statusCode, payload);
          return;
        }

        const local = searchObservations(query, parsed.query);
        sendJson(res, 200, local);
      })
      .catch(() => {
        const local = searchObservations(query, parsed.query);
        sendJson(res, 200, local);
      });
    return;
  }

  forwardRequest(req, res);
});

server.listen(PROXY_PORT, PROXY_HOST, () => {
  console.error(`[mem-search-proxy] listening on http://${PROXY_HOST}:${PROXY_PORT}`);
});
