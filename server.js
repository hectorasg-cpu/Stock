const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const publicDir = __dirname;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const cleanUrl = decodeURIComponent(req.url.split('?')[0]);
  const requested = cleanUrl === '/' ? '/index.html' : cleanUrl;
  const filePath = path.join(publicDir, requested);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(port, () => {
  console.log('Stock Campo disponible en puerto ' + port);
});
