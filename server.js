const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

let pg = null;
try { pg = require('pg'); } catch (error) { pg = null; }

const port = process.env.PORT || 3000;
const publicDir = __dirname;
const dataFile = path.join(__dirname, 'data.json');
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl && pg ? new pg.Pool({ connectionString: databaseUrl }) : null;

const seed = {
  products: [
    { id: 'env-001', name: 'Cajas cartón 12 un.', code: 'ENV-001', area: 'Envasado', stock: 320, unit: 'unidades', minimum: 120, replenishDays: 25, lastReplenished: daysAgo(8), lastMovement: daysAgo(2) },
    { id: 'agr-004', name: 'Fertilizante foliar', code: 'AGR-004', area: 'Agrícola', stock: 18, unit: 'litros', minimum: 20, replenishDays: 20, lastReplenished: daysAgo(33), lastMovement: daysAgo(5) },
    { id: 'bod-011', name: 'Film palletizador', code: 'BOD-011', area: 'Bodega', stock: 42, unit: 'rollos', minimum: 12, replenishDays: 45, lastReplenished: daysAgo(11), lastMovement: daysAgo(1) }
  ],
  movements: [],
  recipes: []
};

function daysAgo(days) { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString(); }
function uuid() { return randomUUID(); }
function isLegacyMixedProduct(product) {
  const name = String(product?.name || '');
  const code = String(product?.code || '');
  const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const legacyCode = /^bidons+(c/e|s/e)$/i.test(code.trim());
  const startsAsLegacyContainer = /^(bidon|botella)/.test(normalized);
  const describesWine = /(sin etiqueta|cabernet|tinto|blanco|pipeno|pipeño|las casas|baron|tio lucas|saavedra|yo claudio)/.test(normalized);
  return legacyCode || (startsAsLegacyContainer && describesWine && !/^BIDON-d+(?:_5)?L-(ROJO|VERDE|NEGRO)$/.test(code));
}

function normalizeState(state) {
  const products = Array.isArray(state.products) ? state.products.filter(product => !isLegacyMixedProduct(product)) : [];
  return {
    products,
    movements: Array.isArray(state.movements) ? state.movements : [],
    recipes: Array.isArray(state.recipes) ? state.recipes : []
  };
}

async function ensureDatabase() {
  if (!pool) return;
  await pool.query('CREATE TABLE IF NOT EXISTS stock_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const result = await pool.query('SELECT id FROM stock_state WHERE id = 1');
  if (result.rowCount === 0) await pool.query('INSERT INTO stock_state (id, data) VALUES (1, $1)', [seed]);
}

async function readState() {
  if (pool) {
    await ensureDatabase();
    const result = await pool.query('SELECT data FROM stock_state WHERE id = 1');
    return normalizeState(result.rows[0]?.data || seed);
  }
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify(seed, null, 2));
  return normalizeState(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
}

async function writeState(state) {
  const clean = normalizeState(state);
  if (pool) {
    await ensureDatabase();
    await pool.query('UPDATE stock_state SET data = $1, updated_at = NOW() WHERE id = 1', [clean]);
    return clean;
  }
  fs.writeFileSync(dataFile, JSON.stringify(clean, null, 2));
  return clean;
}

function sendJson(res, status, payload) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 1000000) { req.destroy(); reject(new Error('Solicitud demasiado grande')); } }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('JSON inválido')); } }); req.on('error', reject); }); }

async function handleApi(req, res) {
  try {
    if (req.method === 'GET' && req.url === '/api/state') { sendJson(res, 200, await readState()); return true; }
    if (req.method === 'GET' && req.url === '/api/info') { sendJson(res, 200, { storage: pool ? 'postgres' : 'local-file' }); return true; }
    if (req.method === 'POST' && req.url === '/api/products') {
      const data = await readBody(req); const state = await readState(); const stock = Number(data.stock || 0); const now = new Date().toISOString();
      const product = { id: uuid(), name: String(data.name || '').trim(), code: String(data.code || '').trim(), area: String(data.area || 'Bodega'), stock, unit: String(data.unit || 'unidades'), minimum: Number(data.minimum || 0), replenishDays: Number(data.replenishDays || 30), lastReplenished: stock > 0 ? now : null, lastMovement: stock > 0 ? now : null };
      if (!product.name || !product.code) { sendJson(res, 400, { error: 'Faltan nombre o código.' }); return true; }
      state.products.push(product); await writeState(state); sendJson(res, 201, state); return true;
    }
    if (req.method === 'PUT' && req.url.startsWith('/api/products/')) {
      const productId = decodeURIComponent(req.url.split('/').pop());
      const data = await readBody(req);
      const state = await readState();
      const product = state.products.find(item => item.id === productId);

      if (!product) {
        sendJson(res, 404, { error: 'Producto no encontrado.' });
        return true;
      }

      const name = String(data.name || '').trim();
      const code = String(data.code || '').trim();
      const area = String(data.area || '').trim();
      const unit = String(data.unit || '').trim();
      const minimum = Number(data.minimum);
      const replenishDays = Number(data.replenishDays);

      if (!name || !code || !area || !unit || Number.isNaN(minimum) || Number.isNaN(replenishDays) || replenishDays < 1) {
        sendJson(res, 400, { error: 'Datos del producto inválidos.' });
        return true;
      }

      product.name = name;
      product.code = code;
      product.area = area;
      product.unit = unit;
      product.minimum = minimum;
      product.replenishDays = replenishDays;

      state.movements.forEach(movement => {
        if (movement.productId === product.id) {
          movement.productName = product.name;
          movement.unit = product.unit;
        }
      });

      await writeState(state);
      sendJson(res, 200, state);
      return true;
    }

    if (req.method === 'POST' && req.url === '/api/movements') {
      const data = await readBody(req); const state = await readState(); const product = state.products.find(item => item.id === data.productId); const quantity = Number(data.quantity);
      if (!product || !quantity || quantity <= 0) { sendJson(res, 400, { error: 'Producto o cantidad inválida.' }); return true; }
      if (data.type === 'Salida' && product.stock < quantity) { sendJson(res, 400, { error: 'No hay stock suficiente para esa salida.' }); return true; }
      if (data.type === 'Entrada') product.stock += quantity; if (data.type === 'Salida') product.stock -= quantity; if (data.type === 'Ajuste') product.stock = quantity;
      const now = new Date().toISOString(); product.lastMovement = now; if (data.type === 'Entrada') product.lastReplenished = now;
      state.movements.unshift({ id: uuid(), productId: product.id, productName: product.name, type: data.type, quantity, unit: product.unit, source: data.source || 'Sin dato', note: data.note || '', date: now });
      await writeState(state); sendJson(res, 201, state); return true;
    }
    if (req.method === 'PUT' && req.url.startsWith('/api/recipes/')) {
      const recipeId = decodeURIComponent(req.url.split('/').pop());
      const data = await readBody(req);
      const state = await readState();
      const components = Array.isArray(data.components) ? data.components.map(item => ({
        kind: String(item.kind || '').trim(),
        code: String(item.code || '').trim(),
        qty: Number(item.qty || 1)
      })).filter(item => item.kind && item.code && item.qty > 0) : [];

      if (!recipeId || components.length !== 3) {
        sendJson(res, 400, { error: 'Receta invalida.' });
        return true;
      }

      const recipe = {
        id: recipeId,
        components,
        updatedAt: new Date().toISOString()
      };
      const index = state.recipes.findIndex(item => item.id === recipeId);
      if (index >= 0) state.recipes[index] = recipe;
      else state.recipes.push(recipe);
      await writeState(state);
      sendJson(res, 200, state);
      return true;
    }
    if (req.url.startsWith('/api/')) { sendJson(res, 404, { error: 'Ruta no encontrada.' }); return true; }
    return false;
  } catch (error) { sendJson(res, 500, { error: error.message || 'Error interno.' }); return true; }
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  const cleanUrl = decodeURIComponent(req.url.split('?')[0]); const requested = cleanUrl === '/' ? '/index.html' : cleanUrl; const filePath = path.join(publicDir, requested);
  if (!filePath.startsWith(publicDir)) { res.writeHead(403); res.end('Acceso denegado'); return; }
  fs.readFile(filePath, (error, content) => { if (error) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Archivo no encontrado'); return; } const ext = path.extname(filePath).toLowerCase(); res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(content); });
});
server.listen(port, () => console.log('Stock Campo disponible en puerto ' + port + (pool ? ' con base de datos compartida' : ' con archivo local')));
