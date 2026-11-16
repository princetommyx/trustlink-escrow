/**
 * Local preview server. Serves the project folder and applies the same page
 * rewrites as vercel.json, so /login.html and /login both open pages/login.html.
 * It does NOT run the /api functions (use `vercel dev` for those).
 *
 *   npm run dev            -> http://127.0.0.1:5500
 *   PORT=8080 npm run dev
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5500;
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

function resolve(urlPath) {
    let p = decodeURIComponent(urlPath.split('?')[0]);
    if (p === '/') return '/pages/index.html';
    const m = p.match(/^\/([a-z-]+)(\.html)?$/);
    if (m && fs.existsSync(path.join(ROOT, 'pages', m[1] + '.html'))) return '/pages/' + m[1] + '.html';
    return p;
}

http.createServer((req, res) => {
    const file = path.normalize(path.join(ROOT, resolve(req.url)));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(file).pipe(res);
    });
}).listen(PORT, '127.0.0.1', () => console.log('TrustLink preview: http://127.0.0.1:' + PORT));
