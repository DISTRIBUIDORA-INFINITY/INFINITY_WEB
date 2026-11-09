/* ════════════════════════════════
   INFINITY GROUP — BACKEND
   Multi-marca: Infinity + Kohell
   Express + sesiones + JSON storage
   ════════════════════════════════ */

const express     = require('express');
const cookieParser = require('cookie-parser');
const fs          = require('fs').promises;
const fsSync      = require('fs');
const path        = require('path');
const crypto      = require('crypto');
const multer      = require('multer');
const sharp       = require('sharp');
const XLSX        = require('xlsx');
const PDFDocument = require('pdfkit');
const archiver    = require('archiver');
const zlib        = require('zlib');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'infinity-cambia-esta-clave-en-produccion';

const ROOT          = __dirname;
const FRONTEND_DIR  = path.join(ROOT, 'frontend');
const DATA_DIR      = path.join(ROOT, 'data');
const IMG_DIR       = path.join(ROOT, 'Imagenes');
const LOGOS_DIR     = path.join(ROOT, 'LOGOS');
const PEDIDOS_DIR   = path.join(ROOT, 'pedidos');
const VIDEOS_DIR    = path.join(ROOT, 'videos');

const BRANDS = ['infinity', 'kohell'];

// ════════════════════════════════
// HELPERS — Multi-marca
// ════════════════════════════════
function dataDir(brand)    { return path.join(DATA_DIR, brand); }
function imgDir(brand)     { return path.join(IMG_DIR, brand); }
function pedidosDir(brand) { return path.join(PEDIDOS_DIR, brand); }

function getBrand(req) {
  // Detecta /api/:brand/... o /api/:brand en la URL original
  // Usamos originalUrl porque req.path puede no incluir el prefijo /api/
  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/(infinity|kohell)(\/|$|\?)/);
  return m ? m[1] : null;
}

// Sanitiza el id de marca para que sólo pueda ser uno de los soportados
function safeBrand(brand) {
  if (!BRANDS.includes(brand)) {
    const err = new Error(`Marca inválida: ${brand}`);
    err.status = 400;
    throw err;
  }
  return brand;
}

// ════════════════════════════════
// CONSTANTES COMPARTIDAS
// ════════════════════════════════
const SIN_CATEGORIA_ID = 'sin-categoria';
const MAX_VIDEOS = 10;

// ════════════════════════════════
// INICIALIZACIÓN DE DATOS / CARPETAS
// ════════════════════════════════
async function initDataFiles() {
  try {
    // Carpetas raíz
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(IMG_DIR, { recursive: true });
    await fs.mkdir(PEDIDOS_DIR, { recursive: true });
    await fs.mkdir(VIDEOS_DIR, { recursive: true });

    // Subcarpetas por marca
    for (const b of BRANDS) {
      await fs.mkdir(dataDir(b), { recursive: true });
      await fs.mkdir(imgDir(b), { recursive: true });
      await fs.mkdir(path.join(imgDir(b), 'agotados'), { recursive: true });

      // JSONs por marca
      const brandFiles = {
        'categorias.json':   [],
        'productos.json':    []
      };
      for (const [file, value] of Object.entries(brandFiles)) {
        const fp = path.join(dataDir(b), file);
        try { await fs.access(fp); }
        catch {
          await fs.writeFile(fp, JSON.stringify(value, null, 2) + '\n', 'utf8');
          console.log(`[init] Creado data/${b}/${file} por defecto`);
        }
      }
    }

    // Archivos compartidos en data/
    const sharedFiles = {
      'contraseñas.json': { usuarios: [{ usuario: 'admin', contraseña: 'admin', rol: 'admin', permisos: [] }] },
      'sesiones.json':    [],
      'vendedores.json':  [],
      'redes.json':       [],
      'pedidos-meta.json': [],
      'clientes.json':    []
    };
    for (const [file, value] of Object.entries(sharedFiles)) {
      const fp = path.join(DATA_DIR, file);
      try { await fs.access(fp); }
      catch {
        await fs.writeFile(fp, JSON.stringify(value, null, 2) + '\n', 'utf8');
        console.log(`[init] Creado data/${file} por defecto`);
      }
    }
  } catch (err) {
    console.error('[init] Error inicializando datos:', err.message);
  }
}

// ════════════════════════════════
// MIDDLEWARES
// ════════════════════════════════
app.use(express.json());
app.use(cookieParser(SECRET));

// ════════════════════════════════
// COMPRESIÓN (gzip sin dependencias)
// ════════════════════════════════
app.use((req, res, next) => {
  const ae = String(req.headers['accept-encoding'] || '');
  if (!/gzip/.test(ae)) return next();

  const originalSend = res.send.bind(res);
  res.send = function (body) {
    try {
      const tipo = String(res.getHeader('Content-Type') || '');
      if (/json|html|css|javascript|text\//.test(tipo) && body !== undefined && body !== null) {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        if (buf.length > 1024) {
          const gz = zlib.gzipSync(buf, { level: 6 });
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.setHeader('Content-Length', gz.length);
          return res.end(gz);
        }
      }
    } catch (e) { /* si falla, seguimos sin comprimir */ }
    return originalSend(body);
  };
  next();
});

// ════════════════════════════════
// IMÁGENES — helpers y miniaturas
// ════════════════════════════════
function escaparAtributoHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rutaRelativaImagen(img) {
  return String(img || '').replace(/^\/+/, '').replace(/^(infinity|kohell)\//, '');
}

function imagenUrl(brand, img) {
  if (!img) return '';
  const s = String(img);
  if (s.startsWith('/')) return s;
  const clean = s.replace(/^\/+/, '');
  if (/^(infinity|kohell)\//.test(clean)) return `/Imagenes/${clean}`;
  return `/Imagenes/${brand}/${clean}`;
}

// Miniaturas WebP generadas al vuelo y cacheadas en /Imagenes/.thumbs
app.get('/min/:brand/*', async (req, res) => {
  try {
    const brand = safeBrand(req.params.brand);
    const rel = String(req.params[0] || '').replace(/\\/g, '/');
    if (!rel || rel.includes('..')) return res.status(400).end();

    const base = imgDir(brand);
    const src = path.join(base, rel);
    if (!src.startsWith(base + path.sep)) return res.status(400).end();

    const w = Math.min(Math.max(parseInt(req.query.w, 10) || 600, 80), 1600);
    const thumbsRoot = path.join(IMG_DIR, '.thumbs', brand);
    const safeName = rel.replace(/[\\/]/g, '__');

    let stamp = '0';
    try { stamp = String(Math.floor((await fs.stat(src)).mtimeMs)); } catch { }

    const out = path.join(thumbsRoot, `${w}__${stamp}__${safeName}`);
    try { await fs.access(out); }
    catch {
      await fs.mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
      try { await fs.rename(tmp, out); }
      catch { try { await fs.unlink(tmp); } catch { } }
    }

    res.set('Cache-Control', 'public, max-age=604800');
    res.type('image/webp');
    res.sendFile(out);
  } catch (err) {
    res.status(404).end();
  }
});

// ════════════════════════════════
// CATÁLOGOS — fotos del hero elegidas en el servidor
// ════════════════════════════════
async function servirCatalogo(req, res, brand) {
  try {
    const file = path.join(FRONTEND_DIR, brand, 'index.html');
    let html = await fs.readFile(file, 'utf8');

    let picks = [];
    try {
      const productos = await getProductos(brand);
      const candidatos = (productos || []).filter(p => {
        if (!p || !p.img) return false;
        if (/agotados\//.test(String(p.img))) return false;
        const rel = rutaRelativaImagen(p.img);
        return rel && fsSync.existsSync(path.join(imgDir(brand), rel));
      });

      for (let i = candidatos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidatos[i], candidatos[j]] = [candidatos[j], candidatos[i]];
      }
      picks = candidatos.slice(0, 2);
    } catch (e) { /* sin fotos disponibles */ }

    const urls = picks.map(p => `/min/${brand}/${rutaRelativaImagen(p.img)}?w=900`);

    if (urls.length) {
      const preloads = urls
        .map(u => `<link rel="preload" as="image" href="${escaparAtributoHtml(u)}" fetchpriority="high">`)
        .join('\n  ');
      html = html.replace('</head>', `  ${preloads}\n</head>`);
    }

    for (let i = 0; i < 2; i++) {
      const p = picks[i];
      if (!p) continue;
      const viejo = `<img id="heroImg${i + 1}" alt="" loading="lazy">`;
      const nuevo = `<img id="heroImg${i + 1}" src="${escaparAtributoHtml(urls[i])}" alt="${escaparAtributoHtml(p.nombre || p.ref || '')}" fetchpriority="high" decoding="async">`;
      html = html.replace(viejo, nuevo);
    }

    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (err) {
    console.error('[catalogo] error:', err.message);
    res.sendFile(path.join(FRONTEND_DIR, brand, 'index.html'));
  }
}

app.get(['/infinity', '/infinity/'], (req, res) => servirCatalogo(req, res, 'infinity'));
app.get(['/kohell', '/kohell/'], (req, res) => servirCatalogo(req, res, 'kohell'));

// ════════════════════════════════
// SERVIR FRONTENDS ESTÁTICOS
// ════════════════════════════════
// Landing
app.use('/', express.static(path.join(FRONTEND_DIR, 'landing'), { index: 'index.html' }));

// Catálogos públicos
app.use('/infinity', express.static(path.join(FRONTEND_DIR, 'infinity'), { index: 'index.html' }));
app.use('/kohell',   express.static(path.join(FRONTEND_DIR, 'kohell'),   { index: 'index.html' }));

// Admin (compartido)
app.use('/infinity/admin', express.static(path.join(FRONTEND_DIR, 'infinity', 'administrativo'), { index: 'index.html' }));
app.use('/kohell/admin',   express.static(path.join(FRONTEND_DIR, 'infinity', 'administrativo'), { index: 'index.html' }));

// Imágenes por marca
app.use('/Imagenes/infinity', express.static(path.join(IMG_DIR, 'infinity'), { maxAge: '7d' }));
app.use('/Imagenes/kohell',   express.static(path.join(IMG_DIR, 'kohell'),   { maxAge: '7d' }));

// Pedidos unificados (Infinity Group) — una sola carpeta compartida
app.use('/pedidos', express.static(PEDIDOS_DIR));

// Videos unificados en Infinity Group (sin marca)
app.use('/videos', express.static(VIDEOS_DIR, { maxAge: '7d' }));

// Logos
app.use('/LOGOS', express.static(LOGOS_DIR, { maxAge: '7d' }));

// Assets de cada marca (logos, etc.) — servido desde el frontend
app.use('/infinity/assets', express.static(path.join(FRONTEND_DIR, 'infinity', 'assets')));
app.use('/kohell/assets',   express.static(path.join(FRONTEND_DIR, 'kohell',   'assets')));

// Evita el 404 de favicon.ico
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ════════════════════════════════
// HELPERS — JSON
// ════════════════════════════════
async function readJson(filepath) {
  const data = await fs.readFile(filepath, 'utf8');
  return JSON.parse(data);
}

async function writeJson(filepath, data) {
  await fs.writeFile(filepath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function readBrandJson(brand, file) {
  return await readJson(path.join(dataDir(brand), file));
}

async function writeBrandJson(brand, file, data) {
  await writeJson(path.join(dataDir(brand), file), data);
}

async function readSharedJson(file) {
  return await readJson(path.join(DATA_DIR, file));
}

async function writeSharedJson(file, data) {
  await writeJson(path.join(DATA_DIR, file), data);
}

// ════════════════════════════════
// HELPERS — Sesiones (compartidas)
// ════════════════════════════════
async function createSession(usuario) {
  const sesiones = await readSharedJson('sesiones.json');
  const token = crypto.randomBytes(32).toString('hex');
  sesiones.push({
    token,
    usuario: usuario.usuario,
    rol:    usuario.rol,
    createdAt: Date.now()
  });
  await writeSharedJson('sesiones.json', sesiones);
  return token;
}

async function destroySession(token) {
  const sesiones = await readSharedJson('sesiones.json');
  const filtradas = sesiones.filter(s => s.token !== token);
  await writeSharedJson('sesiones.json', filtradas);
}

async function getSessionUser(req) {
  const token = req.signedCookies.session;
  if (!token) return null;
  const sesiones = await readSharedJson('sesiones.json');
  return sesiones.find(s => s.token === token) || null;
}

async function getUserData(usuario) {
  try {
    const data = await readSharedJson('contraseñas.json');
    return (data.usuarios || []).find(u => u.usuario === usuario) || null;
  } catch {
    return null;
  }
}

// ════════════════════════════════
// HELPERS — Clientes (registro compartido entre marcas)
// ════════════════════════════════
const CLIENTE_COOKIE         = 'cliente';
const CLIENTE_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 días

async function getClientes() {
  try {
    const data = await readSharedJson('clientes.json');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normDocumento(doc) {
  return String(doc == null ? '' : doc).trim();
}

// Devuelve el cliente identificado en la cookie (si sigue existiendo)
async function getClienteSesion(req) {
  const id = req.signedCookies && req.signedCookies[CLIENTE_COOKIE];
  if (!id) return null;
  const clientes = await getClientes();
  return clientes.find(c => c.id === id) || null;
}

function setClienteCookie(res, cliente) {
  res.cookie(CLIENTE_COOKIE, cliente.id, {
    signed:   true,
    httpOnly: true,
    sameSite: 'lax',
    secure:   false,
    maxAge:   CLIENTE_COOKIE_MAX_AGE
  });
}

// ════════════════════════════════
// HELPERS — Categorías
// ════════════════════════════════
function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getCategorias(brand) {
  try {
    return await readBrandJson(brand, 'categorias.json');
  } catch {
    return [];
  }
}

async function saveCategorias(brand, categorias) {
  await writeBrandJson(brand, 'categorias.json', categorias);
}

function findInSubcats(subcats, id) {
  for (const s of subcats) {
    if (s.id === id) return s;
    if (Array.isArray(s.subcategorias) && s.subcategorias.length) {
      const found = findInSubcats(s.subcategorias, id);
      if (found) return found;
    }
  }
  return null;
}

function findSubcatRecursive(subcats, id) {
  if (!Array.isArray(subcats)) return null;
  for (const s of subcats) {
    if (s.id === id) return s;
    if (Array.isArray(s.subcategorias)) {
      const found = findSubcatRecursive(s.subcategorias, id);
      if (found) return found;
    }
  }
  return null;
}

function removeSubcatRecursive(subcats, id) {
  if (!Array.isArray(subcats)) return null;
  for (let i = 0; i < subcats.length; i++) {
    if (subcats[i].id === id) {
      const [removed] = subcats.splice(i, 1);
      return removed;
    }
    if (Array.isArray(subcats[i].subcategorias)) {
      const found = removeSubcatRecursive(subcats[i].subcategorias, id);
      if (found) return found;
    }
  }
  return null;
}

async function ensureSinCategoria(brand) {
  const categorias = await getCategorias(brand);
  if (!categorias.some(c => c.id === SIN_CATEGORIA_ID)) {
    categorias.push({ id: SIN_CATEGORIA_ID, nombre: 'Sin categoría', icono: '📦' });
    await saveCategorias(brand, categorias);
  }
  const dir = path.join(imgDir(brand), SIN_CATEGORIA_ID);
  try { await fs.access(dir); }
  catch { await fs.mkdir(dir, { recursive: true }); }
}

async function getProductos(brand) {
  try {
    return await readBrandJson(brand, 'productos.json');
  } catch {
    return [];
  }
}

async function saveProductos(brand, productos) {
  await writeBrandJson(brand, 'productos.json', productos);
}

// Helper: mover la imagen de un producto entre carpetas dentro de la marca.
async function moveProductImage(brand, oldImg, newCat, ref) {
  const newName = `${ref}.webp`;
  const newPath = path.join(imgDir(brand), newCat, newName);

  await fs.mkdir(path.join(imgDir(brand), newCat), { recursive: true });

  if (oldImg) {
    // oldImg puede venir como "bolsos/AF100-128.webp" o "infinity/bolsos/..."
    const cleanOld = oldImg.replace(/^(infinity|kohell)\//, '');
    const oldPath = path.join(imgDir(brand), cleanOld);
    try {
      await fs.rename(oldPath, newPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Origen no existe, igual devolvemos nueva ruta
      } else {
        try {
          await fs.copyFile(oldPath, newPath);
          await fs.unlink(oldPath);
        } catch (err2) {
          if (err2.code !== 'ENOENT') throw err2;
        }
      }
    }
  }

  return `${newCat}/${newName}`;
}

async function deleteProductImage(brand, img) {
  if (!img) return;
  const cleanImg = img.replace(/^(infinity|kohell)\//, '');
  const imgPath = path.join(imgDir(brand), cleanImg);
  try {
    await fs.unlink(imgPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// ════════════════════════════════
// MIDDLEWARES DE AUTENTICACIÓN
// ════════════════════════════════
async function requireAuth(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  req.user = session;
  next();
}

async function requireAdmin(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  if (user.rol !== 'admin') {
    return res.status(403).json({ error: 'Se requiere rol de administrador' });
  }
  req.user = user;
  next();
}

async function requireUserManagement(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const esAdmin = user.rol === 'admin';
  const tienePermiso = (user.permisos || []).includes('usuarios');
  if (!esAdmin && !tienePermiso) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar usuarios' });
  }
  req.user = user;
  next();
}

async function requireCategoriasManagement(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const esAdmin = user.rol === 'admin';
  const tienePermiso = (user.permisos || []).includes('categorias');
  if (!esAdmin && !tienePermiso) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar categorías' });
  }
  req.user = user;
  next();
}

async function requireProductosManagement(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const esAdmin = user.rol === 'admin';
  const tienePermiso = (user.permisos || []).includes('productos');
  if (!esAdmin && !tienePermiso) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar productos' });
  }
  req.user = user;
  next();
}

async function requirePedidosManagement(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const esAdmin = user.rol === 'admin';
  const tienePermiso = (user.permisos || []).includes('pedidos');
  if (!esAdmin && !tienePermiso) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar pedidos' });
  }
  req.user = user;
  next();
}

async function requireDescargasAccess(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const esAdmin = user.rol === 'admin';
  const tienePermiso = (user.permisos || []).includes('descargas');
  if (!esAdmin && !tienePermiso) {
    return res.status(403).json({ error: 'No tienes permiso para acceder a Descargas' });
  }
  req.user = user;
  next();
}

async function requireClientesManagement(req, res, next) {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autorizado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const esAdmin = user.rol === 'admin';
  const tienePermiso = (user.permisos || []).includes('clientes');
  if (!esAdmin && !tienePermiso) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar clientes' });
  }
  req.user = user;
  next();
}

// Helper: extrae la marca de la URL y la valida. Si no es válida, devuelve 404.
function brandFromReq(req, res) {
  const brand = getBrand(req);
  if (!brand) {
    res.status(404).json({ error: 'Endpoint no encontrado' });
    return null;
  }
  return safeBrand(brand);
}

// ════════════════════════════════
// RUTAS DE AUTENTICACIÓN (compartidas)
// ════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { usuario, contraseña } = req.body || {};
  if (!usuario || !contraseña) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  try {
    const data     = await readSharedJson('contraseñas.json');
    const usuarios = data.usuarios || [];
    const match    = usuarios.find(u => u.usuario === usuario && u.contraseña === contraseña);
    if (!match) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = await createSession(match);
    res.cookie('session', token, {
      signed:    true,
      httpOnly:  true,
      sameSite:  'lax',
      secure:    false,
      maxAge:    24 * 60 * 60 * 1000
    });
    res.json({ ok: true, usuario: match.usuario, rol: match.rol });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.signedCookies.session;
  if (token) await destroySession(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const session = await getSessionUser(req);
  if (!session) return res.status(401).json({ error: 'No autenticado' });
  const user = await getUserData(session.usuario);
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
  res.json({
    usuario:  user.usuario,
    rol:      user.rol,
    permisos: user.permisos || []
  });
});

app.put('/api/auth/password', requireAdmin, async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!actual || !nueva) {
    return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
  }
  if (nueva.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const data     = await readSharedJson('contraseñas.json');
    const usuarios = data.usuarios || [];
    const idx      = usuarios.findIndex(u => u.usuario === req.user.usuario);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (usuarios[idx].contraseña !== actual) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }
    usuarios[idx].contraseña = nueva;
    await writeSharedJson('contraseñas.json', { usuarios });
    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// ════════════════════════════════
// RUTAS PÚBLICAS POR MARCA
// ════════════════════════════════
app.get('/api/:brand/categorias', async (req, res) => {
  try {
    const brand = brandFromReq(req, res); if (!brand) return;
    await ensureSinCategoria(brand);
    const categorias = await getCategorias(brand);
    res.json(categorias);
  } catch {
    res.json([]);
  }
});

app.get('/api/:brand/productos', async (req, res) => {
  try {
    const brand = brandFromReq(req, res); if (!brand) return;
    const data = await readBrandJson(brand, 'productos.json');

    // El precio al por mayor solo se expone a:
    //   - clientes identificados con documento (cookie firmada), o
    //   - usuarios del panel administrativo (sesión iniciada)
    const cliente = await getClienteSesion(req);
    const sesionPanel = await getSessionUser(req);
    if (cliente || sesionPanel) return res.json(data);

    res.json(data.map(p => {
      if (!p || typeof p !== 'object') return p;
      const { precioMayor, ...resto } = p;
      return resto;
    }));
  } catch {
    res.json([]);
  }
});

// ════════════════════════════════
// GESTIÓN DE CATEGORÍAS POR MARCA
// ════════════════════════════════
app.post('/api/:brand/categorias', requireCategoriasManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const { nombre, icono } = req.body || {};
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  const id = slugify(nombre);
  if (!id) return res.status(400).json({ error: 'El nombre genera un ID inválido' });

  try {
    const categorias = await getCategorias(brand);
    const nombreNorm = nombre.trim().toLowerCase();
    if (categorias.some(c => c.id === id)) {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
    if (categorias.some(c => c.nombre.toLowerCase() === nombreNorm)) {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
    const dir = path.join(imgDir(brand), id);
    try { await fs.access(dir); }
    catch { await fs.mkdir(dir, { recursive: true }); }

    const nuevaCat = { id, nombre: nombre.trim(), icono: icono || '📦' };
    categorias.push(nuevaCat);
    await saveCategorias(brand, categorias);
    res.json({ ok: true, categoria: nuevaCat });
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

app.put('/api/:brand/categorias/:id', requireCategoriasManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const targetId = req.params.id;
  const { nombre, icono } = req.body || {};
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  try {
    const categorias = await getCategorias(brand);
    const idx = categorias.findIndex(c => c.id === targetId);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada' });
    if (targetId === SIN_CATEGORIA_ID) {
      return res.status(400).json({ error: 'No se puede editar la categoría del sistema' });
    }
    const nombreNorm = nombre.trim().toLowerCase();
    if (categorias.some((c, i) => i !== idx && c.nombre.toLowerCase() === nombreNorm)) {
      return res.status(409).json({ error: 'Ya existe otra categoría con ese nombre' });
    }
    categorias[idx].nombre = nombre.trim();
    if (icono) categorias[idx].icono = icono;
    await saveCategorias(brand, categorias);
    res.json({ ok: true, categoria: categorias[idx] });
  } catch (err) {
    console.error('Update category error:', err);
    res.status(500).json({ error: 'Error al actualizar la categoría' });
  }
});

app.delete('/api/:brand/categorias/:id', requireCategoriasManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const targetId = req.params.id;
  if (targetId === SIN_CATEGORIA_ID) {
    return res.status(400).json({ error: 'No se puede eliminar la categoría del sistema' });
  }
  try {
    const categorias = await getCategorias(brand);
    const idx = categorias.findIndex(c => c.id === targetId);
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada' });
    await ensureSinCategoria(brand);

    const productos = await getProductos(brand);
    const itemsAfectados = productos.filter(p => p.cat === targetId);

    if (itemsAfectados.length > 0) {
      const srcDir = path.join(imgDir(brand), targetId);
      const dstDir = path.join(imgDir(brand), SIN_CATEGORIA_ID);
      try {
        const files = await fs.readdir(srcDir);
        for (const file of files) {
          const srcFile = path.join(srcDir, file);
          const dstFile = path.join(dstDir, file);
          try { await fs.rename(srcFile, dstFile); }
          catch {
            await fs.copyFile(srcFile, dstFile);
            await fs.unlink(srcFile);
          }
        }
        try { await fs.rmdir(srcDir); } catch {}
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      for (const p of productos) {
        if (p.cat === targetId) {
          p.cat = SIN_CATEGORIA_ID;
          if (p.img) {
            const cleanImg = p.img.replace(/^(infinity|kohell)\//, '');
            if (cleanImg.startsWith(targetId + '/')) {
              p.img = `${SIN_CATEGORIA_ID}/${cleanImg.slice(targetId.length + 1)}`;
            }
          }
        }
      }
      await saveProductos(brand, productos);
    } else {
      const srcDir = path.join(imgDir(brand), targetId);
      try {
        const files = await fs.readdir(srcDir);
        for (const file of files) await fs.unlink(path.join(srcDir, file));
        await fs.rmdir(srcDir);
      } catch (err) {
        if (err.code !== 'ENOENT') console.error('Error borrando carpeta:', err);
      }
    }
    categorias.splice(idx, 1);
    await saveCategorias(brand, categorias);
    res.json({ ok: true, itemsMovidos: itemsAfectados.length });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Error al eliminar la categoría' });
  }
});

// ════════════════════════════════
// SUBCATEGORÍAS POR MARCA
// ════════════════════════════════
app.post('/api/:brand/categorias/:id/subcategorias', requireCategoriasManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const parentId = req.params.id;
  const { nombre, parentSubId } = req.body || {};
  if (!nombre || !String(nombre).trim() || String(nombre).length > 40) {
    return res.status(400).json({ error: 'Nombre inválido (1-40 caracteres)' });
  }
  if (parentId === SIN_CATEGORIA_ID) {
    return res.status(400).json({ error: 'No se pueden agregar subcategorías a "Sin categoría"' });
  }
  try {
    const categorias = await getCategorias(brand);
    const parent = categorias.find(c => c.id === parentId);
    if (!parent) return res.status(404).json({ error: 'Categoría padre no encontrada' });

    let targetArray;
    if (parentSubId) {
      const subParent = Array.isArray(parent.subcategorias)
        ? parent.subcategorias.find(s => s.id === parentSubId) : null;
      if (!subParent) return res.status(404).json({ error: 'Subcategoría padre no encontrada' });
      if (!Array.isArray(subParent.subcategorias)) subParent.subcategorias = [];
      targetArray = subParent.subcategorias;
    } else {
      if (!Array.isArray(parent.subcategorias)) parent.subcategorias = [];
      targetArray = parent.subcategorias;
    }

    const slug = slugify(nombre);
    if (!slug) return res.status(400).json({ error: 'Nombre inválido' });
    const idsHermanos = new Set(targetArray.map(s => s.id));
    if (idsHermanos.has(slug)) {
      return res.status(409).json({ error: `Ya existe una subcategoría "${slug}" aquí` });
    }
    targetArray.push({ id: slug, nombre: String(nombre).trim() });
    await saveCategorias(brand, categorias);
    res.json({ ok: true, subcategoria: { id: slug, nombre: String(nombre).trim() } });
  } catch (err) {
    console.error('Create subcategory error:', err);
    res.status(500).json({ error: 'Error al crear subcategoría' });
  }
});

app.put('/api/:brand/categorias/:id/subcategorias/:subId', requireCategoriasManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const { id: parentId, subId } = req.params;
  const { nombre } = req.body || {};
  if (!nombre || !String(nombre).trim() || String(nombre).length > 40) {
    return res.status(400).json({ error: 'Nombre inválido (1-40 caracteres)' });
  }
  try {
    const categorias = await getCategorias(brand);
    const parent = categorias.find(c => c.id === parentId);
    if (!parent) return res.status(404).json({ error: 'Categoría padre no encontrada' });
    const sub = findSubcatRecursive(parent.subcategorias, subId);
    if (!sub) return res.status(404).json({ error: 'Subcategoría no encontrada' });
    sub.nombre = String(nombre).trim();
    await saveCategorias(brand, categorias);
    res.json({ ok: true, subcategoria: { id: sub.id, nombre: sub.nombre } });
  } catch (err) {
    console.error('Edit subcategory error:', err);
    res.status(500).json({ error: 'Error al editar subcategoría' });
  }
});

app.delete('/api/:brand/categorias/:id/subcategorias/:subId', requireCategoriasManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const { id: parentId, subId } = req.params;
  try {
    const categorias = await getCategorias(brand);
    const parent = categorias.find(c => c.id === parentId);
    if (!parent) return res.status(404).json({ error: 'Categoría padre no encontrada' });
    const sub = findSubcatRecursive(parent.subcategorias, subId);
    if (!sub) return res.status(404).json({ error: 'Subcategoría no encontrada' });
    if (Array.isArray(sub.subcategorias) && sub.subcategorias.length) {
      return res.status(400).json({ error: 'Primero elimina las sub-subcategorías' });
    }

    removeSubcatRecursive(parent.subcategorias, subId);
    if (Array.isArray(parent.subcategorias) && parent.subcategorias.length === 0) {
      delete parent.subcategorias;
    }

    const productos = await getProductos(brand);
    let movidos = 0;
    for (const p of productos) {
      if (!Array.isArray(p.sub) || p.sub.length === 0) continue;
      const idx = p.sub.indexOf(subId);
      if (idx === -1) continue;
      const oldSub = [...p.sub];
      const newSub = oldSub.slice(0, idx);
      p.sub = newSub;
      if (p.img && !p.img.replace(/^(infinity|kohell)\//, '').startsWith('agotados/')) {
        const oldPathParts = [p.cat, ...oldSub];
        const newPathParts = [p.cat, ...newSub];
        const oldDir = oldPathParts.join('/');
        const newDir = newPathParts.join('/');
        const oldImgPath = path.join(imgDir(brand), oldDir, `${p.ref}.webp`);
        const newImgDir  = path.join(imgDir(brand), newDir);
        const newImgPath = path.join(newImgDir, `${p.ref}.webp`);
        try {
          await fs.mkdir(newImgDir, { recursive: true });
          await fs.rename(oldImgPath, newImgPath);
          p.img = `${newDir}/${p.ref}.webp`;
          movidos++;
        } catch (err) {
          if (err.code !== 'ENOENT') console.error(`Error moviendo imagen ${p.img}:`, err.message);
          p.img = `${newDir}/${p.ref}.webp`;
          movidos++;
        }
      } else {
        movidos++;
      }
    }
    await saveProductos(brand, productos);
    await saveCategorias(brand, categorias);
    res.json({ ok: true, movidos });
  } catch (err) {
    console.error('Delete subcategory error:', err);
    res.status(500).json({ error: 'Error al eliminar subcategoría' });
  }
});

// ════════════════════════════════
// GESTIÓN DE USUARIOS (compartida)
// ════════════════════════════════
app.get('/api/usuarios', requireUserManagement, async (req, res) => {
  try {
    const data     = await readSharedJson('contraseñas.json');
    const usuarios = (data.usuarios || []).map(u => ({
      usuario:  u.usuario,
      rol:      u.rol,
      permisos: u.permisos || []
    }));
    res.json(usuarios);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Error al cargar usuarios' });
  }
});

app.post('/api/usuarios', requireUserManagement, async (req, res) => {
  const { usuario, contraseña, rol, permisos } = req.body || {};
  if (!usuario || !contraseña || !rol) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  if (contraseña.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  if (!['admin', 'editor', 'vendedor'].includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  try {
    const data     = await readSharedJson('contraseñas.json');
    const usuarios = data.usuarios || [];
    if (usuarios.some(u => u.usuario === usuario)) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
    }
    const permisosFinal = rol === 'admin' ? [] : (Array.isArray(permisos) ? permisos : []);
    usuarios.push({ usuario, contraseña, rol, permisos: permisosFinal });
    await writeSharedJson('contraseñas.json', { usuarios });
    res.json({ ok: true });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

app.put('/api/usuarios/:usuario', requireUserManagement, async (req, res) => {
  const targetUsuario = req.params.usuario;
  const { contraseña, rol, permisos } = req.body || {};
  if (rol && !['admin', 'editor', 'vendedor'].includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  if (contraseña && contraseña.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const data     = await readSharedJson('contraseñas.json');
    const usuarios = data.usuarios || [];
    const idx      = usuarios.findIndex(u => u.usuario === targetUsuario);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (rol && rol !== 'admin' && usuarios[idx].rol === 'admin') {
      const admins = usuarios.filter(u => u.rol === 'admin');
      if (admins.length === 1) {
        return res.status(400).json({ error: 'No puedes degradar al único administrador' });
      }
    }
    if (contraseña) usuarios[idx].contraseña = contraseña;
    if (rol)        usuarios[idx].rol = rol;
    if (rol === 'admin') {
      usuarios[idx].permisos = [];
    } else if (Array.isArray(permisos)) {
      usuarios[idx].permisos = permisos;
    }
    await writeSharedJson('contraseñas.json', { usuarios });
    res.json({ ok: true });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

app.delete('/api/usuarios/:usuario', requireUserManagement, async (req, res) => {
  const targetUsuario = req.params.usuario;
  if (targetUsuario === req.user.usuario) {
    return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  }
  try {
    const data     = await readSharedJson('contraseñas.json');
    const usuarios = data.usuarios || [];
    const target   = usuarios.find(u => u.usuario === targetUsuario);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.rol === 'admin') {
      const admins = usuarios.filter(u => u.rol === 'admin');
      if (admins.length === 1) {
        return res.status(400).json({ error: 'No puedes eliminar al único administrador' });
      }
    }
    const filtrados = usuarios.filter(u => u.usuario !== targetUsuario);
    await writeSharedJson('contraseñas.json', { usuarios: filtrados });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// ════════════════════════════════
// SUBIDA MASIVA DE PRODUCTOS POR MARCA
// ════════════════════════════════
const MAX_FILES  = 50;
const MAX_SIZE   = 20 * 1024 * 1024;
const MAX_WIDTH  = 1200;
const WEBP_QUALITY = 80;
// Permite casi cualquier carácter excepto los peligrosos para el sistema de archivos o URLs.
const REF_VALID_RE = /^[^\\/:*?"<>|\s]+$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: MAX_FILES }
});

function parseFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  if (!base) return null;
  if (!REF_VALID_RE.test(base)) return null;
  return { ref: base };
}

app.post('/api/:brand/productos/upload', requireProductosManagement, upload.array('fotos', MAX_FILES), async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const categoria = (req.body.categoria || '').trim();
  const subRaw    = req.body.sub || '[]';
  const files     = req.files || [];

  if (!categoria) return res.status(400).json({ error: 'Selecciona una categoría' });
  if (files.length === 0) return res.status(400).json({ error: 'No se enviaron fotos' });

  let subPath;
  try {
    subPath = JSON.parse(subRaw);
    if (!Array.isArray(subPath)) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Subcategoría inválida' });
  }

  try {
    const categorias = await getCategorias(brand);
    const cat = categorias.find(c => c.id === categoria);
    if (!cat) return res.status(400).json({ error: 'La categoría no existe' });
    if (categoria === SIN_CATEGORIA_ID) {
      return res.status(400).json({ error: 'No se puede subir productos a la categoría del sistema' });
    }

    const catTieneSubcats = Array.isArray(cat.subcategorias) && cat.subcategorias.length > 0;
    if (catTieneSubcats && subPath.length === 0) {
      return res.status(400).json({ error: `"${cat.nombre}" tiene subcategorías, debes elegir una hoja` });
    }
    if (!catTieneSubcats && subPath.length > 0) {
      return res.status(400).json({ error: `"${cat.nombre}" no tiene subcategorías` });
    }

    let nivelActual = cat.subcategorias || [];
    for (let i = 0; i < subPath.length; i++) {
      const id = subPath[i];
      const nodo = nivelActual.find(s => s.id === id);
      if (!nodo) {
        return res.status(400).json({ error: `Subcategoría "${id}" no encontrada en nivel ${i + 1}` });
      }
      const esUltimo = i === subPath.length - 1;
      if (esUltimo) {
        if (Array.isArray(nodo.subcategorias) && nodo.subcategorias.length > 0) {
          return res.status(400).json({ error: `"${nodo.nombre}" tiene sub-subcategorías, debes elegir una de ellas` });
        }
      } else {
        if (!Array.isArray(nodo.subcategorias) || nodo.subcategorias.length === 0) {
          return res.status(400).json({ error: `"${nodo.nombre}" no tiene sub-subcategorías` });
        }
        nivelActual = nodo.subcategorias;
      }
    }

    const pathParts = [categoria, ...subPath];
    const relDir    = pathParts.join('/');
    const dstDir    = path.join(imgDir(brand), relDir);
    await fs.mkdir(dstDir, { recursive: true });

    const productos = await getProductos(brand);
    const existentes = new Set(productos.map(p => p.ref || p.id));

    const creados   = [];
    const saltados  = [];
    const ignorados = [];
    const errores   = [];

    for (const f of files) {
      const parsed = parseFilename(f.originalname);
      if (!parsed) {
        ignorados.push({ archivo: f.originalname, motivo: 'Nombre de archivo inválido' });
        continue;
      }
      const { ref } = parsed;
      if (existentes.has(ref)) {
        saltados.push({ ref, motivo: 'Ya existe un producto con esa referencia' });
        continue;
      }
      try {
        const outName = `${ref}.webp`;
        const outPath = path.join(dstDir, outName);
        await sharp(f.buffer)
          .rotate()
          .resize({ width: MAX_WIDTH, height: MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toFile(outPath);
        productos.push({
          id:   ref,
          ref:  ref,
          cat:  categoria,
          sub:  subPath,
          img:  `${relDir}/${outName}`,
          ventaMinima: 1
        });
        creados.push({ ref });
      } catch (err) {
        console.error(`Error procesando ${ref}:`, err.message);
        errores.push({ ref, motivo: 'Error al procesar la imagen' });
      }
    }
    await saveProductos(brand, productos);
    res.json({
      ok: true,
      resumen: {
        creados:   creados.length,
        creadosList:   creados,
        saltados:  saltados.length,
        saltadosList:  saltados,
        ignorados: ignorados.length,
        ignoradosList: ignorados,
        errores:   errores.length,
        erroresList:   errores
      }
    });
  } catch (err) {
    console.error('Upload productos error:', err);
    res.status(500).json({ error: 'Error al procesar la subida' });
  }
});

app.patch('/api/:brand/productos/:ref/venta-minima', requireProductosManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const ref = req.params.ref;
  const { ventaMinima } = req.body || {};

  const vm = parseInt(ventaMinima, 10);
  if (Number.isNaN(vm) || vm < 1) {
    return res.status(400).json({ error: 'La venta mínima debe ser un número entero mayor o igual a 1' });
  }

  try {
    const productos = await getProductos(brand);
    const idx = productos.findIndex(p => p.ref === ref);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });

    productos[idx].ventaMinima = vm;
    await saveProductos(brand, productos);
    res.json({ ok: true, ref, ventaMinima: vm });
  } catch (err) {
    console.error('Venta mínima error:', err);
    res.status(500).json({ error: 'Error al guardar la venta mínima' });
  }
});

// Edición manual de precios (detal y al por mayor)
app.patch('/api/:brand/productos/:ref/precios', requireProductosManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const ref = req.params.ref;
  const { precio, precioMayor } = req.body || {};

  const parseNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    return parsePrice(v);
  };

  const p   = parseNum(precio);
  const pM  = parseNum(precioMayor);

  if (p === null || p < 0) {
    return res.status(400).json({ error: 'El precio debe ser un número mayor o igual a 0' });
  }
  if (pM === null || pM < 0) {
    return res.status(400).json({ error: 'El precio al mayor debe ser un número mayor o igual a 0' });
  }

  try {
    const productos = await getProductos(brand);
    const idx = productos.findIndex(x => x.ref === ref);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });

    productos[idx].precio = p;
    // 0 = no se vende al mayor → mismo precio que al detal
    productos[idx].precioMayor = pM === 0 ? p : pM;

    await saveProductos(brand, productos);
    res.json({
      ok: true,
      ref,
      precio: productos[idx].precio,
      precioMayor: productos[idx].precioMayor
    });
  } catch (err) {
    console.error('Precios error:', err);
    res.status(500).json({ error: 'Error al guardar los precios' });
  }
});

app.post('/api/:brand/productos/:ref/agotar', requireProductosManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const ref = req.params.ref;
  try {
    const productos = await getProductos(brand);
    const idx = productos.findIndex(p => p.ref === ref);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    if (productos[idx].img && productos[idx].img.replace(/^(infinity|kohell)\//, '').startsWith('agotados/')) {
      return res.status(400).json({ error: 'El producto ya está agotado' });
    }
    const oldImg = productos[idx].img;
    const newImg = await moveProductImage(brand, oldImg, 'agotados', ref);
    productos[idx].img = newImg;
    await saveProductos(brand, productos);
    res.json({ ok: true, ref, img: newImg });
  } catch (err) {
    console.error('Agotar error:', err);
    res.status(500).json({ error: 'Error al marcar como agotado' });
  }
});

app.post('/api/:brand/productos/:ref/reactivar', requireProductosManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const ref = req.params.ref;
  try {
    const productos = await getProductos(brand);
    const idx = productos.findIndex(p => p.ref === ref);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    const cleanImg = productos[idx].img ? productos[idx].img.replace(/^(infinity|kohell)\//, '') : '';
    if (!cleanImg.startsWith('agotados/')) {
      return res.status(400).json({ error: 'El producto no está agotado' });
    }
    const targetCat = productos[idx].cat;
    if (!targetCat) return res.status(400).json({ error: 'El producto no tiene categoría original' });
    const categorias = await getCategorias(brand);
    let destCat = targetCat;
    if (!categorias.some(c => c.id === targetCat)) {
      await ensureSinCategoria(brand);
      destCat = SIN_CATEGORIA_ID;
      productos[idx].cat = SIN_CATEGORIA_ID;
    }
    const newImg = await moveProductImage(brand, productos[idx].img, destCat, ref);
    productos[idx].img = newImg;
    await saveProductos(brand, productos);
    res.json({ ok: true, ref, img: newImg, cat: destCat });
  } catch (err) {
    console.error('Reactivar error:', err);
    res.status(500).json({ error: 'Error al reactivar el producto' });
  }
});

app.delete('/api/:brand/productos/:ref', requireProductosManagement, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const ref = req.params.ref;
  try {
    const productos = await getProductos(brand);
    const idx = productos.findIndex(p => p.ref === ref);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    await deleteProductImage(brand, productos[idx].img);
    productos.splice(idx, 1);
    await saveProductos(brand, productos);
    res.json({ ok: true, ref });
  } catch (err) {
    console.error('Delete producto error:', err);
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
});

// ════════════════════════════════
// EXCEL/CSV POR MARCA
// ════════════════════════════════
function normHeader(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[$€£¥₹\s]/g, '');
  if (!s) return null;
  const isNegative = (s.startsWith('-') || (s.startsWith('(') && s.endsWith(')')));
  s = s.replace(/^[-()]/, '').replace(/\)$/, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot   = s.lastIndexOf('.');
  let normalized;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = s.replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (lastDot !== -1) {
    const afterLastDot = s.slice(lastDot + 1);
    if (s.split('.').length === 2 && afterLastDot.length === 3 && /^\d+$/.test(afterLastDot)) {
      normalized = s.replace(/\./g, '');
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }
  const num = parseFloat(normalized);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

app.post('/api/:brand/productos/excel', requireProductosManagement, excelUpload.single('archivo'), async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No se envió ningún archivo' });

  try {
    const wb = XLSX.read(file.buffer, { type: 'buffer', codepage: 65001 });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'El archivo no tiene hojas' });
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (rows.length === 0) return res.status(400).json({ error: 'El archivo está vacío' });

    const headersRaw = rows[0].map(h => normHeader(h));
    const expected = ['referencia', 'descripcion', 'precio', 'precio al mayor'];
    if (headersRaw.length < 4 ||
        headersRaw[0] !== expected[0] ||
        headersRaw[1] !== expected[1] ||
        headersRaw[2] !== expected[2] ||
        headersRaw[3] !== expected[3]) {
      return res.status(400).json({
        error: `Los encabezados deben ser exactamente: ${expected.join(' | ').toUpperCase()}. Encontrado: ${rows[0].map(h => String(h).trim() || '(vacío)').join(' | ').toUpperCase()}`
      });
    }

    const productos     = await getProductos(brand);
    const productosByRef = new Map(productos.map(p => [String(p.ref), p]));

    const actualizados   = [];
    const noEncontrados  = [];
    const errores        = [];
    const filasVacias    = [];
    let filasConDatos    = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const isEmpty = row.every(c => c === '' || c === null || c === undefined);
      if (isEmpty) { filasVacias.push(i + 1); continue; }

      const refRaw        = row[0] != null ? String(row[0]).trim() : '';
      const descRaw       = row[1] != null ? String(row[1]).trim() : '';
      const precioRaw     = row[2];
      const precioMayorRaw = row[3];

      if (!refRaw) { errores.push({ fila: i + 1, motivo: 'REFERENCIA vacía' }); continue; }
      const producto = productosByRef.get(refRaw);
      if (!producto) { noEncontrados.push(refRaw); continue; }

      let changed = false;
      if (descRaw) { producto.nombre = descRaw; changed = true; }
      if (precioRaw !== '' && precioRaw !== null && precioRaw !== undefined) {
        let precio;
        if (typeof precioRaw === 'number') precio = precioRaw;
        else precio = parsePrice(precioRaw);
        if (precio === null || isNaN(precio)) {
          errores.push({ fila: i + 1, ref: refRaw, motivo: `Precio inválido: "${precioRaw}"` });
          continue;
        }
        producto.precio = precio;
        changed = true;
      }

      // Precio al por mayor: obligatorio. 0 = no se vende al mayor → mismo precio que al detal.
      if (precioMayorRaw === '' || precioMayorRaw === null || precioMayorRaw === undefined) {
        errores.push({ fila: i + 1, ref: refRaw, motivo: 'PRECIO AL MAYOR vacío' });
        continue;
      }
      let precioMayor;
      if (typeof precioMayorRaw === 'number') precioMayor = precioMayorRaw;
      else precioMayor = parsePrice(precioMayorRaw);
      if (precioMayor === null || isNaN(precioMayor)) {
        errores.push({ fila: i + 1, ref: refRaw, motivo: `Precio al mayor inválido: "${precioMayorRaw}"` });
        continue;
      }
      producto.precioMayor = precioMayor === 0 ? (Number(producto.precio) || 0) : precioMayor;
      changed = true;

      if (changed) { actualizados.push({ ref: refRaw, fila: i + 1 }); filasConDatos++; }
    }

    // Asegurar que todos los productos tengan ventaMinima (default 1)
    productos.forEach(p => {
      if (p.ventaMinima === undefined || p.ventaMinima === null || p.ventaMinima === '') {
        p.ventaMinima = 1;
      }
    });

    await saveProductos(brand, productos);
    res.json({
      ok: true,
      resumen: {
        actualizados: actualizados.length,
        actualizadosList: actualizados,
        noEncontrados: noEncontrados.length,
        noEncontradosList: noEncontrados,
        errores: errores.length,
        erroresList: errores,
        filasVacias: filasVacias.length,
        filasVaciasList: filasVacias
      }
    });
  } catch (err) {
    console.error('Excel upload error:', err);
    res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')   return res.status(400).json({ error: `Cada archivo no puede superar ${MAX_SIZE / 1024 / 1024}MB` });
    if (err.code === 'LIMIT_FILE_COUNT')  return res.status(400).json({ error: `Máximo ${MAX_FILES} archivos por subida` });
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Campo de archivo inesperado' });
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// ════════════════════════════════
// FALLBACK SPA — admin
// ════════════════════════════════
const adminPath = path.join(FRONTEND_DIR, 'infinity', 'administrativo', 'index.html');
app.get('/infinity/admin',          (req, res) => res.sendFile(adminPath));
app.get('/infinity/admin/',         (req, res) => res.sendFile(adminPath));
app.get('/infinity/admin/*',        (req, res) => res.sendFile(adminPath));
app.get('/kohell/admin',            (req, res) => res.sendFile(adminPath));
app.get('/kohell/admin/',           (req, res) => res.sendFile(adminPath));
app.get('/kohell/admin/*',          (req, res) => res.sendFile(adminPath));

// ════════════════════════════════
// LIMPIEZA DE SESIONES A LAS 00:00 CO
// ════════════════════════════════
function msUntilNextMidnightBogota() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const hour   = parseInt(parts.hour === '24' ? '0' : parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);
  const msPassedToday = (hour * 3600 + minute * 60 + second) * 1000;
  return 24 * 3600 * 1000 - msPassedToday;
}

async function runSessionCleanup(logPrefix = '[cleanup]') {
  try {
    const sesiones = await readSharedJson('sesiones.json');
    if (sesiones.length === 0) {
      console.log(`${logPrefix} sesiones.json ya está vacío, nada que limpiar`);
      return { removed: 0 };
    }
    await writeSharedJson('sesiones.json', []);
    console.log(`${logPrefix} ✅ ${sesiones.length} sesión(es) cerrada(s) a las 00:00 CO`);
    return { removed: sesiones.length };
  } catch (err) {
    console.error(`${logPrefix} Error limpiando sesiones:`, err.message);
    return { removed: 0, error: err.message };
  }
}

function scheduleSessionCleanup() {
  const ms = msUntilNextMidnightBogota();
  const hours = (ms / 1000 / 60 / 60).toFixed(2);
  console.log(`[cleanup] Próxima limpieza de sesiones en ${hours}h (00:00 America/Bogota)`);
  setTimeout(() => {
    runSessionCleanup();
    setInterval(() => runSessionCleanup(), 24 * 60 * 60 * 1000);
  }, ms);
}

app.post('/api/admin/cleanup-sessions', requireAdmin, async (req, res) => {
  const result = await runSessionCleanup('[manual]');
  res.json({ ok: true, ...result });
});

// ════════════════════════════════
// PDF CATÁLOGO POR MARCA
// ════════════════════════════════
async function generarPDFCatalogo(req, res, brand) {
  const { seleccion, modoPrecios } = req.body || {};
  if (!Array.isArray(seleccion) || seleccion.length === 0) {
    return res.status(400).json({ error: 'Debes seleccionar al menos una categoría o subcategoría' });
  }
  const MODO_PRECIOS = ['detal', 'mayor', 'ambos'].includes(modoPrecios) ? modoPrecios : 'detal';
  try {
    const categorias = await getCategorias(brand);
    const productos  = await getProductos(brand);

    for (const item of seleccion) {
      if (!item || typeof item.cat !== 'string') {
        return res.status(400).json({ error: 'Selección inválida' });
      }
      const cat = categorias.find(c => c.id === item.cat);
      if (!cat) return res.status(400).json({ error: `Categoría "${item.cat}" no existe` });
      if (Array.isArray(item.sub) && item.sub.length > 0) {
        let nodo = cat;
        for (let i = 0; i < item.sub.length; i++) {
          const subs = Array.isArray(nodo.subcategorias) ? nodo.subcategorias : [];
          const sig = subs.find(s => s.id === item.sub[i]);
          if (!sig) return res.status(400).json({ error: `Subcategoría "${item.sub[i]}" no encontrada` });
          nodo = sig;
        }
      }
    }

    const productosFiltrados = productos.filter(p => {
      if (!p.cat || p.cat === SIN_CATEGORIA_ID) return false;
      if (!p.img) return false;
      const cleanImg = p.img.replace(/^(infinity|kohell)\//, '');
      if (cleanImg.startsWith('agotados/')) return false;
      return seleccion.some(sel => {
        if (p.cat !== sel.cat) return false;
        const pSub   = Array.isArray(p.sub)   ? p.sub   : [];
        const selSub = Array.isArray(sel.sub) ? sel.sub : [];
        if (selSub.length === 0) return true;
        if (pSub.length < selSub.length) return false;
        for (let i = 0; i < selSub.length; i++) if (pSub[i] !== selSub[i]) return false;
        return true;
      });
    });

    if (productosFiltrados.length === 0) {
      return res.status(400).json({ error: 'No hay productos disponibles en las hojas seleccionadas' });
    }

    productosFiltrados.sort((a, b) => {
      if (a.cat !== b.cat) return a.cat.localeCompare(b.cat);
      const aSub = (a.sub || []).join('›');
      const bSub = (b.sub || []).join('›');
      if (aSub !== bSub) return aSub.localeCompare(bSub);
      return String(a.ref).localeCompare(String(b.ref));
    });

    const brandLabel = brand === 'kohell' ? 'kohell' : 'infinity';
    const filename = `catalogo-${brandLabel}-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: { Title: `Catálogo ${brandLabel}`, Author: 'Infinity Group', Subject: 'Catálogo de productos' }
    });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const MARGIN_X = 50;
    const CARD_W = 240, CARD_H = 290, IMG_H = 180, GUTTER = 20;
    const TOP_Y = 110, BOTTOM_Y = pageH - 60;

    const PRIMARY = brand === 'kohell' ? '#d4a5b5' : '#f37e2e';
    const INK     = brand === 'kohell' ? '#2a1a1e' : '#1a1a2e';
    const SECONDARY = brand === 'kohell' ? '#e8d0d7' : '#fdba8c';

    const LOGO_FILES = { infinity: 'INFINITY.jpeg', kohell: 'KOHELL.jpeg' };
    const logoPath   = path.join(LOGOS_DIR, LOGO_FILES[brand] || LOGO_FILES.infinity);
    let logoBuffer   = null;
    try { logoBuffer = await sharp(await fs.readFile(logoPath)).resize({ height: 80 }).jpeg({ quality: 95 }).toBuffer(); }
    catch (err) { console.error('[PDF catálogo] logo no cargado:', err.message); }

    function getSeccionNombre(catObj, subArr) {
      const parts = [catObj.nombre];
      let nodo = catObj;
      for (const sid of subArr) {
        const subs = Array.isArray(nodo.subcategorias) ? nodo.subcategorias : [];
        const s = subs.find(x => x.id === sid);
        if (!s) break;
        parts.push(s.nombre);
        nodo = s;
      }
      return parts.join(' › ');
    }

    function drawSeccionHeader(titulo) {
      doc.fontSize(22).fillColor(PRIMARY).font('Helvetica-Bold')
         .text(titulo, MARGIN_X, 50, { width: pageW - 2 * MARGIN_X });
      doc.moveTo(MARGIN_X, 90).lineTo(pageW - MARGIN_X, 90)
         .strokeColor(PRIMARY).lineWidth(1.5).stroke();
    }

    function drawImagePlaceholder(x, y) {
      doc.rect(x, y, CARD_W, IMG_H).fillColor(SECONDARY).fill();
      doc.fontSize(11).fillColor('#8b8ba7').font('Helvetica')
         .text('Sin imagen', x, y + IMG_H / 2 - 6, { width: CARD_W, align: 'center' });
    }

    async function loadImageBuffer(imgRelPath) {
      const cleanImg = imgRelPath.replace(/^(infinity|kohell)\//, '');
      const imgPath = path.join(imgDir(brand), cleanImg);
      const buffer  = await fs.readFile(imgPath);
      return await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
    }

    function drawPageFooter() {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#8b8ba7').font('Helvetica')
           .text(`${i + 1} / ${range.count}`,
                 MARGIN_X, pageH - 40, { width: pageW - 2 * MARGIN_X, align: 'center' });
      }
    }

    // Portada
    if (logoBuffer) {
      const logoH = 80, logoW = 260;
      doc.image(logoBuffer, (pageW - logoW) / 2, 160, { fit: [logoW, logoH], align: 'center' });
    } else {
      doc.fontSize(80).fillColor(PRIMARY).font('Helvetica-Bold')
         .text('∞', 0, 180, { align: 'center', width: pageW });
      doc.fontSize(28).fillColor(INK).font('Helvetica-Bold')
         .text(brand === 'kohell' ? 'Kohell' : 'Infinity', 0, 290, { align: 'center', width: pageW });
    }
    doc.moveTo(200, 270).lineTo(pageW - 200, 270).strokeColor(PRIMARY).lineWidth(2).stroke();
    doc.fontSize(40).fillColor(INK).font('Helvetica-Bold')
       .text('Catálogo', 0, 320, { align: 'center', width: pageW });

    const fechaStr = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(13).fillColor('#4a4a68').font('Helvetica').text(fechaStr, 0, 450, { align: 'center', width: pageW });
    doc.fontSize(12).fillColor('#8b8ba7').font('Helvetica')
       .text(`${productosFiltrados.length} producto${productosFiltrados.length === 1 ? '' : 's'}`, 0, 510, { align: 'center', width: pageW });
    doc.fontSize(10).fillColor('#8b8ba7').font('Helvetica')
       .text('Generado el ' + new Date().toLocaleString('es-CO'), 0, pageH - 80, { align: 'center', width: pageW });

    const seccionesMap = new Map();
    for (const p of productosFiltrados) {
      const key = `${p.cat}|${(p.sub || []).join('|')}`;
      if (!seccionesMap.has(key)) {
        seccionesMap.set(key, { cat: p.cat, sub: p.sub || [], productos: [] });
      }
      seccionesMap.get(key).productos.push(p);
    }
    const secciones = Array.from(seccionesMap.values()).sort((a, b) => {
      if (a.cat !== b.cat) return a.cat.localeCompare(b.cat);
      return a.sub.join('|').localeCompare(b.sub.join('|'));
    });

    for (const sec of secciones) {
      const catObj = categorias.find(c => c.id === sec.cat);
      if (!catObj) continue;
      const titulo = getSeccionNombre(catObj, sec.sub);
      doc.addPage();
      drawSeccionHeader(titulo);

      const productosConBuffer = await Promise.all(
        sec.productos.map(async p => {
          try { return { prod: p, imgBuffer: await loadImageBuffer(p.img) }; }
          catch (err) {
            console.error('Error cargando imagen para PDF:', p.img, err.message);
            return { prod: p, imgBuffer: null };
          }
        })
      );

      let col = 0, y = TOP_Y;
      for (const { prod, imgBuffer } of productosConBuffer) {
        const x = MARGIN_X + col * (CARD_W + GUTTER);
        if (y + CARD_H > BOTTOM_Y) {
          doc.addPage();
          drawSeccionHeader(titulo);
          y = TOP_Y; col = 0;
        }
        if (imgBuffer) {
          try { doc.image(imgBuffer, x, y, { fit: [CARD_W, IMG_H], align: 'center', valign: 'center' }); }
          catch { drawImagePlaceholder(x, y); }
        } else { drawImagePlaceholder(x, y); }

        let textY = y + IMG_H + 8;
        doc.fontSize(8).fillColor('#8b8ba7').font('Helvetica')
           .text(`REF: ${prod.ref || '—'}`, x, textY, { width: CARD_W });
        textY += 12;
        doc.fontSize(11).fillColor(INK).font('Helvetica-Bold')
           .text(prod.nombre || prod.ref || 'Sin nombre', x, textY, { width: CARD_W, height: 50 });
        textY += 52;
        const fmtPrecio = (v) => (v !== undefined && v !== null && v !== '')
          ? `$${Number(v).toLocaleString('es-CO')}` : '—';
        const precioDetal  = fmtPrecio(prod.precio);
        const precioMayor  = (prod.precioMayor !== undefined && prod.precioMayor !== null && prod.precioMayor !== '')
          ? fmtPrecio(prod.precioMayor)
          : precioDetal;

        if (MODO_PRECIOS === 'ambos') {
          doc.fontSize(11).fillColor(INK).font('Helvetica')
             .text(`Detal: ${precioDetal}`, x, textY, { width: CARD_W });
          doc.fontSize(13).fillColor(PRIMARY).font('Helvetica-Bold')
             .text(`Mayor: ${precioMayor}`, x, textY + 15, { width: CARD_W });
        } else if (MODO_PRECIOS === 'mayor') {
          doc.fontSize(15).fillColor(PRIMARY).font('Helvetica-Bold')
             .text(precioMayor, x, textY, { width: CARD_W });
        } else {
          doc.fontSize(15).fillColor(PRIMARY).font('Helvetica-Bold')
             .text(precioDetal, x, textY, { width: CARD_W });
        }
        col++;
        if (col >= 2) { col = 0; y += CARD_H + 20; }
      }
    }
    drawPageFooter();
    doc.end();
  } catch (err) {
    console.error('PDF generation error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el PDF: ' + err.message });
  }
}

app.post('/api/:brand/descargas/pdf', requireDescargasAccess, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  await generarPDFCatalogo(req, res, brand);
});

// ════════════════════════════════
// ZIP DE FOTOS POR MARCA
// ════════════════════════════════
app.post('/api/:brand/descargas/fotos', requireDescargasAccess, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const { seleccion } = req.body || {};
  if (!Array.isArray(seleccion) || seleccion.length === 0) {
    return res.status(400).json({ error: 'Debes seleccionar al menos una categoría o subcategoría' });
  }
  try {
    const categorias = await getCategorias(brand);
    const productos  = await getProductos(brand);
    for (const item of seleccion) {
      if (!item || typeof item.cat !== 'string') {
        return res.status(400).json({ error: 'Selección inválida' });
      }
      const cat = categorias.find(c => c.id === item.cat);
      if (!cat) return res.status(400).json({ error: `Categoría "${item.cat}" no existe` });
      if (Array.isArray(item.sub) && item.sub.length > 0) {
        let nodo = cat;
        for (let i = 0; i < item.sub.length; i++) {
          const subs = Array.isArray(nodo.subcategorias) ? nodo.subcategorias : [];
          const sig = subs.find(s => s.id === item.sub[i]);
          if (!sig) return res.status(400).json({ error: `Subcategoría "${item.sub[i]}" no encontrada` });
          nodo = sig;
        }
      }
    }
    const productosFiltrados = productos.filter(p => {
      if (!p.cat || p.cat === SIN_CATEGORIA_ID) return false;
      if (!p.img) return false;
      const cleanImg = p.img.replace(/^(infinity|kohell)\//, '');
      if (cleanImg.startsWith('agotados/')) return false;
      return seleccion.some(sel => {
        if (p.cat !== sel.cat) return false;
        const pSub   = Array.isArray(p.sub)   ? p.sub   : [];
        const selSub = Array.isArray(sel.sub) ? sel.sub : [];
        if (selSub.length === 0) return true;
        if (pSub.length < selSub.length) return false;
        for (let i = 0; i < selSub.length; i++) if (pSub[i] !== selSub[i]) return false;
        return true;
      });
    });
    if (productosFiltrados.length === 0) {
      return res.status(400).json({ error: 'No hay productos disponibles en las hojas seleccionadas' });
    }
    const filename = `fotos-${brand}-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', err => {
      console.error('ZIP error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Error al generar el ZIP: ' + err.message });
      else res.end();
    });
    archive.pipe(res);
    for (const p of productosFiltrados) {
      const cleanImg = p.img.replace(/^(infinity|kohell)\//, '');
      const imgAbsPath = path.join(imgDir(brand), cleanImg);
      const ext = path.extname(cleanImg) || '.webp';
      const arcName = `${p.ref || 'producto'}${ext}`;
      try {
        await fs.access(imgAbsPath);
        archive.file(imgAbsPath, { name: arcName });
      } catch { console.warn(`[fotos] Imagen no encontrada: ${imgAbsPath}`); }
    }
    await archive.finalize();
  } catch (err) {
    console.error('Fotos ZIP generation error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el ZIP: ' + err.message });
  }
});

// ════════════════════════════════
// VENDEDORES (compartidos)
// ════════════════════════════════
async function getVendedores() {
  try { return await readSharedJson('vendedores.json'); }
  catch { return []; }
}

app.get('/api/vendedores', async (req, res) => {
  const vendedores = await getVendedores();
  res.json(vendedores);
});

app.post('/api/vendedores', requirePedidosManagement, async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre del vendedor es obligatorio' });
  }
  const vendedores = await getVendedores();
  const id = String(Date.now());
  vendedores.push({ id, nombre: nombre.trim() });
  await writeSharedJson('vendedores.json', vendedores);
  res.json(vendedores);
});

app.delete('/api/vendedores/:id', requirePedidosManagement, async (req, res) => {
  let vendedores = await getVendedores();
  vendedores = vendedores.filter(v => v.id !== req.params.id);
  await writeSharedJson('vendedores.json', vendedores);
  res.json(vendedores);
});

// ════════════════════════════════
// CLIENTES — registro compartido entre marcas
// data/clientes.json: [{ id, nombre, documento, creadoEn }]
// Los clientes solo se crean desde el panel. El público se identifica
// con su documento y recibe una cookie firmada por 7 días.
// ════════════════════════════════
app.get('/api/clientes', requireClientesManagement, async (req, res) => {
  try {
    const clientes = await getClientes();
    clientes.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    res.json(clientes);
  } catch (err) {
    console.error('Get clientes error:', err);
    res.status(500).json({ error: 'Error al cargar los clientes' });
  }
});

app.post('/api/clientes', requireClientesManagement, async (req, res) => {
  const { nombre, documento } = req.body || {};
  const nom = String(nombre || '').trim();
  const doc = normDocumento(documento);
  if (!nom) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!doc) return res.status(400).json({ error: 'El documento es obligatorio' });

  try {
    const clientes = await getClientes();
    if (clientes.some(c => normDocumento(c.documento) === doc)) {
      return res.status(409).json({ error: 'Ya existe un cliente con ese documento' });
    }
    const nuevo = { id: crypto.randomUUID(), nombre: nom, documento: doc, creadoEn: Date.now() };
    clientes.push(nuevo);
    await writeSharedJson('clientes.json', clientes);
    res.json({ ok: true, cliente: nuevo });
  } catch (err) {
    console.error('Create cliente error:', err);
    res.status(500).json({ error: 'Error al guardar el cliente' });
  }
});

app.put('/api/clientes/:id', requireClientesManagement, async (req, res) => {
  const { id } = req.params;
  const { nombre, documento } = req.body || {};
  const nom = String(nombre || '').trim();
  const doc = normDocumento(documento);
  if (!nom) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!doc) return res.status(400).json({ error: 'El documento es obligatorio' });

  try {
    const clientes = await getClientes();
    const idx = clientes.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (clientes.some(c => c.id !== id && normDocumento(c.documento) === doc)) {
      return res.status(409).json({ error: 'Ya existe un cliente con ese documento' });
    }
    clientes[idx].nombre = nom;
    clientes[idx].documento = doc;
    await writeSharedJson('clientes.json', clientes);
    res.json({ ok: true, cliente: clientes[idx] });
  } catch (err) {
    console.error('Update cliente error:', err);
    res.status(500).json({ error: 'Error al actualizar el cliente' });
  }
});

app.delete('/api/clientes/:id', requireClientesManagement, async (req, res) => {
  const { id } = req.params;
  try {
    const clientes = await getClientes();
    const filtrados = clientes.filter(c => c.id !== id);
    if (filtrados.length === clientes.length) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    await writeSharedJson('clientes.json', filtrados);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete cliente error:', err);
    res.status(500).json({ error: 'Error al eliminar el cliente' });
  }
});

// Validación pública: el cliente digita su documento
app.post('/api/clientes/validar', async (req, res) => {
  const doc = normDocumento((req.body || {}).documento);
  if (!doc) return res.status(400).json({ error: 'Escribe tu documento' });
  try {
    const clientes = await getClientes();
    const cliente = clientes.find(c => normDocumento(c.documento) === doc);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no registrado' });
    }
    setClienteCookie(res, cliente);
    res.json({ ok: true, cliente: { nombre: cliente.nombre, documento: cliente.documento } });
  } catch (err) {
    console.error('Validar cliente error:', err);
    res.status(500).json({ error: 'Error al validar el cliente' });
  }
});

app.get('/api/clientes/sesion', async (req, res) => {
  try {
    const cliente = await getClienteSesion(req);
    if (!cliente) return res.json({ cliente: null });
    res.json({ cliente: { nombre: cliente.nombre, documento: cliente.documento } });
  } catch {
    res.json({ cliente: null });
  }
});

app.post('/api/clientes/salir', async (req, res) => {
  res.clearCookie(CLIENTE_COOKIE, { signed: true });
  res.json({ ok: true });
});

// ════════════════════════════════
// PEDIDOS — multi-marca, archivo global
// Los pedidos se archivan en /pedidos/ raíz y /data/pedidos-meta.json (compartido).
// El PDF puede tener 1 o 2 secciones (una por marca) según los items.
// ════════════════════════════════
const PEDIDOS_META_FILE = 'pedidos-meta.json';

async function getPedidosMeta() {
  try { return await readSharedJson(PEDIDOS_META_FILE); }
  catch { return []; }
}

app.get('/api/pedidos', requirePedidosManagement, async (req, res) => {
  const { vendedor } = req.query;
  let pedidos = await getPedidosMeta();
  if (vendedor) pedidos = pedidos.filter(p => p.vendedor === vendedor);
  res.json(pedidos);
});

app.delete('/api/pedidos/:filename', requirePedidosManagement, async (req, res) => {
  const { filename } = req.params;
  if (!/^[\w.-]+\.pdf$/.test(filename)) {
    return res.status(400).json({ error: 'Nombre de archivo inválido' });
  }
  try {
    const filepath = path.join(PEDIDOS_DIR, filename);
    try { await fs.unlink(filepath); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
    const pedidosMeta = await getPedidosMeta();
    const nuevosMeta = pedidosMeta.filter(p => p.filename !== filename);
    if (nuevosMeta.length === pedidosMeta.length) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    await writeSharedJson(PEDIDOS_META_FILE, nuevosMeta);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete pedido error:', err);
    res.status(500).json({ error: 'Error al eliminar el pedido: ' + err.message });
  }
});

app.post('/api/pedidos/generar-pdf', async (req, res) => {
  const { items, cliente, vendedor } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
  }
  if (!cliente || !cliente.nombre || !cliente.ciudad || !cliente.telefono || !cliente.direccion) {
    return res.status(400).json({ error: 'Todos los datos del cliente son obligatorios' });
  }

  // Normalizar items: cada item lleva item.marca. Si no, asumir 'infinity'.
  const itemsNorm = items.map(i => ({
    ref:      i.ref,
    nombre:   i.nombre,
    precio:   i.precio,
    cantidad: i.cantidad,
    marca:    (i.marca === 'kohell' || i.marca === 'infinity') ? i.marca : 'infinity'
  }));

  // Agrupar por marca
  const grupos = { infinity: [], kohell: [] };
  for (const it of itemsNorm) grupos[it.marca].push(it);

  const marcasPresentes = ['infinity', 'kohell'].filter(m => grupos[m].length > 0);
  const esMulti = marcasPresentes.length > 1;

  // Colores por marca
  const COLORS = {
    infinity: { primary: '#f37e2e', ink: '#1a1a2e', name: 'Infinity', mark: 'Infinity' },
    kohell:   { primary: '#d4a5b5', ink: '#2a1a1e', name: 'Kohell',   mark: 'Kohell' }
  };

  try {
    const filename = `pedido-${Date.now()}.pdf`;
    const filepath = path.join(PEDIDOS_DIR, filename);
    await fs.mkdir(PEDIDOS_DIR, { recursive: true });

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: { Title: `Pedido - ${cliente.nombre}`, Author: 'Infinity Group', Subject: 'Pedido de productos' }
    });

    const writeStream = fsSync.createWriteStream(filepath);
    doc.pipe(writeStream);
    const pageW = doc.page.width, pageH = doc.page.height, MARGIN_X = 50;

    // ── Logos de las marcas presentes ──
    const logoFiles = {
      infinity: path.join(LOGOS_DIR, 'INFINITY.jpeg'),
      kohell:   path.join(LOGOS_DIR, 'KOHELL.jpeg')
    };
    const logoBuffers = {};
    for (const m of marcasPresentes) {
      try { logoBuffers[m] = await sharp(await fs.readFile(logoFiles[m])).resize({ height: 50 }).jpeg({ quality: 95 }).toBuffer(); }
      catch (err) { console.error(`[PDF pedido] logo ${m} no cargado:`, err.message); }
    }

    const headerY = 50;
    if (marcasPresentes.length === 1 && logoBuffers[marcasPresentes[0]]) {
      doc.image(logoBuffers[marcasPresentes[0]], MARGIN_X, headerY, { height: 50 });
    } else {
      let logoX = MARGIN_X;
      for (const m of marcasPresentes) {
        if (logoBuffers[m]) {
          doc.image(logoBuffers[m], logoX, headerY, { height: 50 });
          logoX += 140;
        } else {
          doc.fontSize(24).fillColor(COLORS[m].primary).font('Helvetica-Bold')
             .text(COLORS[m].mark, logoX, headerY + 10, { width: 120 });
          logoX += 140;
        }
      }
    }
    doc.moveTo(MARGIN_X, 115).lineTo(pageW - MARGIN_X, 115).strokeColor('#1a1a2e').lineWidth(1.5).stroke();
    doc.fontSize(22).fillColor('#1a1a2e').font('Helvetica-Bold')
       .text('Pedido', MARGIN_X, 120, { width: pageW - 2 * MARGIN_X });

    const fechaStr = new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    doc.fontSize(10).fillColor('#8b8ba7').font('Helvetica').text(fechaStr, MARGIN_X, 150, { width: pageW - 2 * MARGIN_X });
    if (vendedor) {
      doc.fontSize(10).fillColor('#f37e2e').font('Helvetica-Bold')
         .text(`Vendedor: ${vendedor}`, MARGIN_X, 168, { width: pageW - 2 * MARGIN_X });
    }
    doc.fontSize(14).fillColor('#1a1a2e').font('Helvetica-Bold')
       .text('Datos del cliente', MARGIN_X, vendedor ? 192 : 185, { width: pageW - 2 * MARGIN_X });

    const clientY0 = vendedor ? 217 : 210;
    const clientFields = [
      ['Nombre', cliente.nombre]
    ];
    if (cliente.documento) clientFields.push(['Documento', cliente.documento]);
    clientFields.push(['Ciudad', cliente.ciudad], ['Teléfono', cliente.telefono], ['Dirección', cliente.direccion]);
    let clientY = clientY0;
    doc.fontSize(11).fillColor('#4a4a68').font('Helvetica');
    for (const [label, value] of clientFields) {
      doc.text(`${label}:  `, MARGIN_X, clientY, { continued: true });
      doc.fillColor('#1a1a2e').text(value, { width: pageW - 2 * MARGIN_X });
      clientY += 18;
    }

    // Helper interno: dibuja una sección con su marca
    function drawSeccion(itemsMarca, marca, startY) {
      const color = COLORS[marca];
      let y = startY;

      // Título de la sección
      doc.moveTo(MARGIN_X, y).lineTo(pageW - MARGIN_X, y).strokeColor('#e8e6f0').lineWidth(0.5).stroke();
      y += 16;
      doc.fontSize(18).fillColor(color.primary).font('Helvetica-Bold')
         .text(color.mark, MARGIN_X, y, { width: pageW - 2 * MARGIN_X });
      y += 26;

      // Cabecera de la tabla
      doc.fontSize(9).fillColor('#8b8ba7').font('Helvetica-Bold');
      const colRef     = MARGIN_X;
      const colNombre  = MARGIN_X + 80;
      const colCant    = pageW - MARGIN_X - 180;
      const colPrecio  = pageW - MARGIN_X - 120;
      const colSubtotal = pageW - MARGIN_X - 60;
      doc.text('REF',      colRef,     y);
      doc.text('Producto', colNombre,  y);
      doc.text('Cant',     colCant,    y, { align: 'center', width: 40 });
      doc.text('Precio',   colPrecio,  y, { align: 'right',  width: 60 });
      doc.text('Total',    colSubtotal, y, { align: 'right',  width: 60 });
      y += 14;
      doc.moveTo(MARGIN_X, y).lineTo(pageW - MARGIN_X, y).strokeColor('#e8e6f0').lineWidth(0.3).stroke();
      y += 8;

      let totalSeccion = 0;
      for (const item of itemsMarca) {
        const subtotal = (item.precio || 0) * (item.cantidad || 1);
        totalSeccion += subtotal;
        if (y + 22 > pageH - 90) { doc.addPage(); y = 60; }
        y += 22;
        doc.fontSize(9).fillColor('#8b8ba7').font('Helvetica')
           .text(String(item.ref || '—'), colRef, y, { width: 76 });
        doc.fillColor(color.ink).font('Helvetica')
           .text(String(item.nombre || item.ref || '—'), colNombre, y, { width: colCant - colNombre - 10 });
        doc.fillColor(color.ink).font('Helvetica-Bold')
           .text(String(item.cantidad || 1), colCant, y, { align: 'center', width: 40 });
        doc.fillColor('#4a4a68').font('Helvetica')
           .text(`$${(item.precio || 0).toLocaleString('es-CO')}`, colPrecio, y, { align: 'right', width: 60 });
        doc.fillColor(color.primary).font('Helvetica-Bold')
           .text(`$${subtotal.toLocaleString('es-CO')}`, colSubtotal, y, { align: 'right', width: 60 });
      }
      y += 14;
      doc.moveTo(MARGIN_X, y).lineTo(pageW - MARGIN_X, y).strokeColor('#e8e6f0').lineWidth(0.5).stroke();
      y += 10;
      doc.fontSize(10).fillColor('#4a4a68').font('Helvetica');
      doc.text(`Subtotal ${color.name}:`, MARGIN_X, y, { continued: true });
      doc.fontSize(12).fillColor(color.primary).font('Helvetica-Bold')
         .text(`  $${totalSeccion.toLocaleString('es-CO')}`, { width: pageW - 2 * MARGIN_X });
      return { total: totalSeccion, nextY: y + 30 };
    }

    let cursorY = clientY + 20;
    let totalGeneral = 0;
    for (const marca of marcasPresentes) {
      const { total, nextY } = drawSeccion(grupos[marca], marca, cursorY);
      totalGeneral += total;
      cursorY = nextY;
    }

    // Total general al pie
    if (cursorY + 30 > pageH - 90) { doc.addPage(); cursorY = 60; }
    doc.moveTo(MARGIN_X, cursorY).lineTo(pageW - MARGIN_X, cursorY).strokeColor('#1a1a2e').lineWidth(1).stroke();
    cursorY += 14;
    doc.fontSize(13).fillColor('#1a1a2e').font('Helvetica');
    doc.text('Total pedido:', MARGIN_X, cursorY, { continued: true });
    doc.fontSize(20).fillColor('#f37e2e').font('Helvetica-Bold')
       .text(`  $${totalGeneral.toLocaleString('es-CO')}`, { width: pageW - 2 * MARGIN_X });

    // Footer con número de página
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#8b8ba7').font('Helvetica')
         .text(`${i + 1} / ${range.count}`, MARGIN_X, pageH - 40, { width: pageW - 2 * MARGIN_X, align: 'center' });
    }

    doc.end();
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Guardar meta
    const pedidosMeta = await getPedidosMeta();
    pedidosMeta.push({
      filename,
      fecha: new Date().toISOString(),
      cliente,
      items: itemsNorm.map(i => ({ ref: i.ref, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, marca: i.marca })),
      vendedor: vendedor || null,
      total: totalGeneral,
      marcas: marcasPresentes
    });
    await writeSharedJson(PEDIDOS_META_FILE, pedidosMeta);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filepath);
  } catch (err) {
    console.error('Pedido PDF error:', err);
    res.status(500).json({ error: 'Error al generar el pedido: ' + err.message });
  }
});

app.post('/api/pedidos/:filename/excel', requirePedidosManagement, async (req, res) => {
  const { filename } = req.params;
  if (!/^pedido-[\w.-]+\.pdf$/.test(filename)) {
    return res.status(400).json({ error: 'Nombre de archivo inválido' });
  }
  try {
    const pedidosMeta = await getPedidosMeta();
    const pedido = pedidosMeta.find(p => p.filename === filename);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = Array.isArray(pedido.items) ? pedido.items : [];
    const cliente = pedido.cliente || {};
    const total = pedido.total || 0;
    const vendedor = pedido.vendedor || null;

    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Pedido', cliente.nombre || '—'],
      ['Fecha', pedido.fecha ? new Date(pedido.fecha).toLocaleString('es-CO') : '—'],
      ['Vendedor', vendedor || '—'],
      ['Ciudad', cliente.ciudad || '—'],
      ['Teléfono', cliente.telefono || '—'],
      ['Dirección', cliente.direccion || '—'],
      ['Total', total]
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Pedido');

    const prodRows = [['REF', 'Producto', 'Marca', 'Cantidad', 'Precio unitario', 'Subtotal']];
    for (const it of items) {
      const cantidad = it.cantidad || 1;
      const precio = it.precio || 0;
      prodRows.push([
        it.ref || '—',
        it.nombre || it.ref || '—',
        it.marca || 'infinity',
        cantidad,
        precio,
        cantidad * precio
      ]);
    }
    prodRows.push(['', '', '', '', 'TOTAL', total]);
    const prodWs = XLSX.utils.aoa_to_sheet(prodRows);
    XLSX.utils.book_append_sheet(wb, prodWs, 'Productos');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\.pdf$/i, '.xlsx')}"`);
    res.send(buf);
  } catch (err) {
    console.error('Excel pedido error:', err);
    res.status(500).json({ error: 'Error al generar el Excel: ' + err.message });
  }
});

// ════════════════════════════════
// REDES SOCIALES POR MARCA
// ════════════════════════════════
const REDES_FILE = 'redes.json';
async function getRedes() {
  try { return await readSharedJson(REDES_FILE); }
  catch { return []; }
}

function extraerPlataforma(url) {
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com/i.test(url))  return 'facebook';
  return null;
}

// Público: solo activas (sin filtro por marca aquí; se filtra en front si aplica)
app.get('/api/:brand/redes', async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const todas = await getRedes();
  res.json(todas.filter(r => r.activo && (r.brand === brand || !r.brand)).sort((a, b) => a.orden - b.orden));
});

app.get('/api/:brand/redes/admin', requireAdmin, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const todas = await getRedes();
  res.json(todas.filter(r => r.brand === brand || !r.brand).sort((a, b) => a.orden - b.orden));
});

app.post('/api/:brand/redes', requireAdmin, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const { url } = req.body || {};
  if (!url || !url.trim()) return res.status(400).json({ error: 'La URL es obligatoria' });
  const plataforma = extraerPlataforma(url);
  if (!plataforma) return res.status(400).json({ error: 'La URL debe ser de Instagram o Facebook' });
  const todas = await getRedes();
  const orden = todas.filter(r => r.brand === brand).length;
  todas.push({ id: String(Date.now()), url: url.trim(), plataforma, activo: true, orden, brand });
  await writeSharedJson(REDES_FILE, todas);
  res.json(todas);
});

app.delete('/api/:brand/redes/:id', requireAdmin, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  let todas = await getRedes();
  todas = todas.filter(r => r.id !== req.params.id);
  await writeSharedJson(REDES_FILE, todas);
  res.json(todas);
});

app.put('/api/:brand/redes/:id', requireAdmin, async (req, res) => {
  const brand = brandFromReq(req, res); if (!brand) return;
  const todas = await getRedes();
  const idx = todas.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  const { activo } = req.body || {};
  if (typeof activo === 'boolean') todas[idx].activo = activo;
  await writeSharedJson(REDES_FILE, todas);
  res.json(todas);
});

// ════════════════════════════════
// VIDEOS UNIFICADOS (Infinity Group)
// Los videos son transversales a las dos marcas.
// ════════════════════════════════
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: VIDEOS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp4';
      cb(null, `video-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

app.get('/api/videos', async (req, res) => {
  try {
    await fs.mkdir(VIDEOS_DIR, { recursive: true });
    const files = await fs.readdir(VIDEOS_DIR);
    const videos = files
      .filter(f => f.startsWith('video-'))
      .sort().reverse()
      .map(f => ({ filename: f, url: `/videos/${f}` }));
    res.json(videos);
  } catch (err) {
    console.error('Error listing videos:', err);
    res.status(500).json({ error: 'Error al listar videos' });
  }
});

app.post('/api/videos', requireAdmin, videoUpload.single('video'), async (req, res) => {
  try {
    await fs.mkdir(VIDEOS_DIR, { recursive: true });
    const files = await fs.readdir(VIDEOS_DIR);
    const videoFiles = files.filter(f => f.startsWith('video-'));
    if (videoFiles.length > MAX_VIDEOS) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: `Máximo ${MAX_VIDEOS} videos. Elimina uno antes de subir otro.` });
    }
    const videos = videoFiles.sort().reverse().map(f => ({ filename: f, url: `/videos/${f}` }));
    res.json(videos);
  } catch (err) {
    console.error('Error uploading video:', err);
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: 'Error al subir video' });
  }
});

app.delete('/api/videos/:filename', requireAdmin, async (req, res) => {
  const { filename } = req.params;
  if (!filename.startsWith('video-')) {
    return res.status(400).json({ error: 'Nombre de archivo inválido' });
  }
  try {
    await fs.unlink(path.join(VIDEOS_DIR, filename));
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Video no encontrado' });
    console.error('Error deleting video:', err);
    res.status(500).json({ error: 'Error al eliminar video' });
  }
});

// Proxy para embeds (no requiere marca)
app.get('/api/redes/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Falta url' });
  let embedUrl;
  if (url.includes('instagram.com/p/')) {
    const match = url.match(/instagram\.com\/p\/([^/?]+)/);
    if (!match) return res.status(400).json({ error: 'URL de Instagram inválida' });
    embedUrl = `https://www.instagram.com/p/${match[1]}/embed`;
  } else if (url.includes('facebook.com')) {
    embedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=true`;
  } else {
    return res.status(400).json({ error: 'Solo se admiten URLs de Instagram y Facebook' });
  }
  try {
    const response = await fetch(embedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfinityBot)' } });
    const html = await response.text();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Frame-Options', '');
    res.send(html);
  } catch (err) {
    console.error('Redes proxy error:', err);
    res.status(502).send('Error al cargar el contenido');
  }
});

// ════════════════════════════════
// START
// ════════════════════════════════
(async () => {
  await initDataFiles();
  app.listen(PORT, () => {
    console.log(`∞ Infinity Group server corriendo en http://localhost:${PORT}`);
    console.log(`  Landing:      /`);
    console.log(`  Infinity:     /infinity/`);
    console.log(`  Kohell:       /kohell/`);
    console.log(`  Admin:        /infinity/admin/  (también en /kohell/admin/)`);
    scheduleSessionCleanup();
  });
})();
