// Servidor estático mínimo para a prévia: node tests/preview/serve.mjs  (porta 8080)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const root = process.cwd();
createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  try { const b = await readFile(join(root, p || 'index.html')); res.writeHead(200, { 'Content-Type': T[extname(p)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('404'); }
}).listen(8080, () => console.log('ok :8080'));
