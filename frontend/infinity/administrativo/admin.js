/* ════════════════════════════════
   INFINITY — ADMIN.JS
   Sistema escalable de permisos por pestañas
   ════════════════════════════════ */

// ════════════════════════════════
// TABS — fuente de verdad de permisos
// Para agregar una pestaña nueva: agrégala aquí y al HTML con data-view
// ════════════════════════════════
const TABS = [
  { id: 'productos',  label: 'Productos',  icon: '📦' },
  { id: 'agotados',   label: 'Agotados',   icon: '🚫' },
  { id: 'descargas',  label: 'Descargas',  icon: '⬇️' },
  { id: 'categorias', label: 'Categorías', icon: '🗂️' },
  { id: 'usuarios',   label: 'Usuarios',   icon: '👥' },
  { id: 'pedidos',    label: 'Pedidos',    icon: '📋' }
];

const ROLES = {
  admin:    'Administrador',
  editor:   'Editor',
  vendedor: 'Vendedor'
};

// Iconos disponibles para categorías
const CAT_ICONS = [
  '💄','👜','☕','🏠','👓','🧴','🕯️','🖼️',
  '💍','🧣','👒','🪞','🎁','🪴','🍵','📿',
  '🧸','🛍️','👗','📦','🎀','🕊️','✨','🌸'
];

let currentUser       = null;  // { usuario, rol, permisos: [] }
let editingUser       = null;  // nombre del usuario que se está editando
let deletingUser      = null;  // nombre del usuario a eliminar
let editingCategoria  = null;  // id de la categoría que se está editando
let deletingCategoria = null;  // id de la categoría que se va a eliminar
let currentView       = 'dashboard';
let cachedProductos   = [];    // cache de productos para contar items por categoría

// ════════════════════════════════
// MARCA ACTIVA — Infinity / Kohell
// El admin trabaja con una marca a la vez. El usuario puede alternar.
// Estado persistido en localStorage.
// ════════════════════════════════
const BRAND_KEY = 'infinity_group_brand';
let currentBrand = (typeof localStorage !== 'undefined' && (localStorage.getItem(BRAND_KEY) === 'kohell' || localStorage.getItem(BRAND_KEY) === 'infinity'))
  ? localStorage.getItem(BRAND_KEY)
  : 'infinity';

// Construye la URL de API con la marca activa: api('/categorias') → '/api/infinity/categorias'
// Rutas compartidas (sin marca): api('/auth/me') → '/api/auth/me'
function api(path) {
  // Rutas compartidas: /auth/*, /vendedores, /usuarios, /admin/*, /videos, /pedidos, /redes/proxy
  if (
    path.startsWith('/auth/') ||
    path === '/vendedores' ||
    path.startsWith('/vendedores/') ||
    path.startsWith('/usuarios') ||
    path.startsWith('/admin/') ||
    path === '/videos' ||
    path.startsWith('/videos/') ||
    path === '/pedidos' ||
    path.startsWith('/pedidos/') ||
    path === '/redes/proxy'
  ) {
    return `/api${path}`;
  }
  return `/api/${currentBrand}${path}`;
}

// Devuelve la URL pública de una imagen según su campo img del backend.
// El backend guarda rutas como 'infinity/bolsos/dama/aaa/REF.webp' o 'agotados/REF.webp'.
// El servidor expone /Imagenes/infinity/... y /Imagenes/kohell/..., así que hay que
// prefijar con la marca cuando img no la incluya (datos legacy o agotados sin marca).
function imgUrl(img) {
  if (!img) return '';
  if (img.startsWith('/')) return img;
  const brandPrefix = /^infinity\/|^kohell\//;
  const clean = img.replace(/^\/+/, '');
  if (brandPrefix.test(clean)) return `/Imagenes/${clean}`;
  return `/Imagenes/${currentBrand}/${clean}`;
}

// Sincroniza el selector visual con la marca actual y aplica clase al body
function syncBrandSwitcher() {
  document.querySelectorAll('.brand-switcher-btn').forEach(btn => {
    const active = btn.dataset.brand === currentBrand;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.body.classList.remove('brand-infinity', 'brand-kohell');
  document.body.classList.add(`brand-${currentBrand}`);
}

// Cambia de marca y recarga el estado (recarga la vista actual)
function switchBrand(brand) {
  if (brand !== 'infinity' && brand !== 'kohell') return;
  if (brand === currentBrand) return;
  currentBrand = brand;
  try { localStorage.setItem(BRAND_KEY, brand); } catch {}
  syncBrandSwitcher();
  // Re-renderizar la vista actual con los nombres de función correctos
  // (Los pedidos son globales: no se ven afectados por el switch de marca)
  if (currentView === 'productos')       cargarProductosDisponibles();
  else if (currentView === 'agotados')   cargarAgotados();
  else if (currentView === 'descargas')  cargarDescargas();
  else if (currentView === 'categorias') cargarCategorias();
  else if (currentView === 'dashboard')  { cargarEstadisticas(); cargarRedes(); }
  // pedidos: no se recarga (es global)
}

// ════════════════════════════════
// INIT
// ════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setupLoginForm();
  setupLogout();
  setupNavigation();
  setupSubtabs();
  setupModals();
  setupPermisosToggles();
  setupCategoriasModals();
  setupProductosUpload();
  setupProductosSearch();
  setupExcelUpload();
  setupBrandSwitcher();

  // Si entramos desde /kohell/admin/?brand=kohell, respetamos la marca de la URL
  const urlBrand = new URLSearchParams(window.location.search).get('brand');
  if (urlBrand === 'kohell' || urlBrand === 'infinity') {
    currentBrand = urlBrand;
    try { localStorage.setItem(BRAND_KEY, urlBrand); } catch {}
  }
  syncBrandSwitcher();

  await checkSession();
});

function setupBrandSwitcher() {
  document.querySelectorAll('.brand-switcher-btn').forEach(btn => {
    btn.addEventListener('click', () => switchBrand(btn.dataset.brand));
  });
}

// ════════════════════════════════
// SESIÓN
// ════════════════════════════════
async function checkSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) {
      const user = await res.json();
      currentUser = user;
      mostrarDashboard(user);
    } else {
      mostrarLogin();
    }
  } catch (err) {
    console.error('Error verificando sesión:', err);
    mostrarLogin();
  }
}

// ════════════════════════════════
// VISTAS
// ════════════════════════════════
function mostrarLogin() {
  currentUser = null;
  document.body.classList.remove('is-admin');
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('adminApp').style.display  = 'none';
}

function mostrarDashboard(user) {
  currentUser = user;
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('adminApp').style.display  = 'block';

  // Marcar el body según el rol
  document.body.classList.toggle('is-admin', user.rol === 'admin');

  // Saludo con el nombre del usuario
  document.getElementById('adminName').textContent = user.usuario;

  // Aplicar permisos (visibilidad de nav, subsección admin-only, etc.)
  aplicarPermisos();

  // Determinar vista inicial
  const esAdmin = user.rol === 'admin';
  const perms   = getPermisosEfectivos();
  let viewInicial;
  if (esAdmin || perms.includes('dashboard')) {
    viewInicial = 'dashboard';
  } else {
    // Primera vista visible según permisos
    viewInicial = perms[0] || 'descargas';
  }
  cambiarVista(viewInicial);

  cargarEstadisticas();
}

function cambiarVista(view) {
  // Check defensivo: si el usuario no tiene permiso para esta vista, redirige a la primera vista visible
  if (currentUser) {
    const esAdmin = currentUser.rol === 'admin';
    const perms   = getPermisosEfectivos();
    if (!esAdmin && !perms.includes(view)) {
      view = perms[0] || 'descargas';
    }
  }

  currentView = view;

  // Ocultar todas las vistas
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Mostrar la vista solicitada (si existe)
  const target = document.querySelector(`.view[data-view="${view}"]`);
  if (target) {
    target.classList.add('active');
  } else {
    document.querySelector('.view[data-view="dashboard"]').classList.add('active');
    view = 'dashboard';
  }

  // Actualizar nav items (excluir el de logout que no tiene data-view)
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Cargar datos específicos de la vista
  if (view === 'usuarios') {
    const esAdmin = currentUser.rol === 'admin';
    const puedeGestionar = esAdmin || (currentUser.permisos || []).includes('usuarios');
    if (puedeGestionar) {
      cargarUsuarios();
    }
  }

  if (view === 'categorias') {
    cargarCategorias();
  }

  if (view === 'productos') {
    cargarCategoriasEnUpload();
    cargarProductosDisponibles();
  }

  if (view === 'agotados') {
    cargarAgotados();
  }

  if (view === 'descargas') {
    cargarDescargas();
  }

  if (view === 'pedidos') {
    cargarPedidos();
  }
}

async function cargarEstadisticas() {
  try {
    const [resCats, resProds] = await Promise.all([
      fetch(api('/categorias'), { credentials: 'include' }),
      fetch(api('/productos'), { credentials: 'include' })
    ]);

    const categorias = await resCats.json();
    const productos  = await resProds.json();
    cachedProductos = productos;

    document.getElementById('statProductos').textContent  = productos.length;
    document.getElementById('statCategorias').textContent = categorias.length;
    cargarRedes(); // carga la sección de videos
  } catch (err) {
    console.error('Error cargando estadísticas:', err);
  }
}

// ════════════════════════════════
// PERMISOS — visibilidad según rol + permisos[]
// Vendedor: SIEMPRE ve 'descargas' (implícito) + lo que le hayan dado
// ════════════════════════════════
function getPermisosEfectivos() {
  if (!currentUser) return [];
  const permisos = currentUser.permisos || [];
  if (currentUser.rol === 'vendedor' && !permisos.includes('descargas')) {
    return ['descargas', ...permisos];
  }
  return permisos;
}

function aplicarPermisos() {
  if (!currentUser) return;

  const esAdmin  = currentUser.rol === 'admin';
  const perms    = getPermisosEfectivos();
  const puedeGestionarUsuarios = esAdmin || perms.includes('usuarios');

  // Mostrar/ocultar cada nav-item según permisos
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    const view = item.dataset.view;
    const visible = esAdmin || perms.includes(view);
    item.style.display = visible ? '' : 'none';
  });

  // Subsección "Mi contraseña" — SOLO admin
  const miPassSubsection = document.getElementById('miPasswordSubsection');
  if (miPassSubsection) {
    miPassSubsection.style.display = esAdmin ? '' : 'none';
  }

  // Subsección "Gestión de usuarios" — admin O permiso 'usuarios'
  const gestionSubsection = document.getElementById('gestionUsuariosSubsection');
  if (gestionSubsection) {
    gestionSubsection.style.display = puedeGestionarUsuarios ? '' : 'none';
  }
}

// ════════════════════════════════
// NAVEGACIÓN
// ════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      cambiarVista(item.dataset.view);
    });
  });
}

// ════════════════════════════════
// SUBTABS (dentro de la view 'descargas')
// ════════════════════════════════
function setupSubtabs() {
  document.querySelectorAll('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      // Activar solo este botón
      btn.parentElement.querySelectorAll('.subtab').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      // Mostrar solo el panel correspondiente
      document.querySelectorAll('.subtab-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.subtabPanel === subtab);
      });
    });
  });
}

// ════════════════════════════════
// DESCARGAS (vista + subtabs pdf / fotos)
// ════════════════════════════════
function cargarDescargas() {
  initGestores();
  pdfGestor.setup();
  fotosGestor.setup();
}

// ════════════════════════════════
// PERMISOS EN MODALES — render y lectura
// ════════════════════════════════
function renderPermisos(containerId, checkedPerms = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = TABS.map(t => `
    <label class="permission-check">
      <input type="checkbox" value="${t.id}" ${checkedPerms.includes(t.id) ? 'checked' : ''}>
      <span class="permission-icon">${t.icon}</span>
      <span class="permission-label">${t.label}</span>
    </label>
  `).join('');
}

function collectPermisos(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => cb.value);
}

// Mostrar/ocultar la sección de permisos según el rol elegido en el <select>
function setupPermisosToggles() {
  const pairs = [
    { select: 'nuevoRol',  group: 'permisosGroupCrear',  note: 'permisosNoteCrear',  container: 'permisosCrear' },
    { select: 'editarRol', group: 'permisosGroupEditar', note: 'permisosNoteEditar', container: 'permisosEditar' }
  ];

  pairs.forEach(p => {
    const sel = document.getElementById(p.select);
    if (!sel) return;
    const update = () => {
      const isAdmin = sel.value === 'admin';
      document.getElementById(p.group).style.display = isAdmin ? 'none' : '';
      document.getElementById(p.note).style.display  = isAdmin ? 'flex' : 'none';
    };
    sel.addEventListener('change', update);
  });
}

// ════════════════════════════════
// LOGIN
// ════════════════════════════════
function setupLoginForm() {
  const form    = document.getElementById('loginForm');
  const errorEl = document.getElementById('formError');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.classList.remove('show');
    errorEl.textContent = '';

    const usuario    = document.getElementById('usuario').value.trim();
    const contraseña = document.getElementById('contraseña').value;

    if (!usuario || !contraseña) return;

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled    = true;
    btn.textContent = 'Verificando…';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ usuario, contraseña })
      });

      const data = await res.json();

      if (!res.ok) {
        mostrarError(data.error || 'Error al iniciar sesión');
        return;
      }

      // Re-fetch /me para obtener permisos actualizados
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      const me    = await meRes.json();
      mostrarDashboard({ usuario: me.usuario, rol: me.rol, permisos: me.permisos || [] });
    } catch (err) {
      console.error(err);
      mostrarError('Error de conexión. Intenta de nuevo.');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Ingresar';
    }
  });
}

function mostrarError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg;
  el.classList.add('show');
}

// ════════════════════════════════
// LOGOUT
// ════════════════════════════════
function setupLogout() {
  document.getElementById('btnLogout').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('Error en logout:', err);
    }
    document.getElementById('usuario').value    = '';
    document.getElementById('contraseña').value = '';
    mostrarLogin();
  });
}

// ════════════════════════════════
// USUARIOS (admin)
// ════════════════════════════════
async function cargarUsuarios() {
  const tbody = document.getElementById('usersListBody');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--ink-mute);">Cargando…</td></tr>';

  try {
    const res = await fetch('/api/usuarios', { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        mostrarLogin();
        return;
      }
      throw new Error('Error al cargar usuarios');
    }
    const usuarios = await res.json();
    renderUsuarios(usuarios);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--danger);">Error al cargar usuarios</td></tr>';
  }
}

function renderUsuarios(usuarios) {
  const tbody  = document.getElementById('usersListBody');
  const esAdmin = currentUser.rol === 'admin';
  const puedeGestionar = esAdmin || (currentUser.permisos || []).includes('usuarios');

  // Ocultar/mostrar la columna "Acciones" (header + celdas)
  document.querySelectorAll('.users-table .users-actions-col, .users-table .users-actions')
    .forEach(el => el.style.display = puedeGestionar ? '' : 'none');

  if (usuarios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${puedeGestionar ? 3 : 2}" style="text-align:center;color:var(--ink-mute);padding:30px;">No hay usuarios aún</td></tr>`;
    return;
  }

  tbody.innerHTML = usuarios.map(u => {
    const isYou = u.usuario === currentUser.usuario;
    return `
      <tr>
        <td>
          <strong>${escapeHtml(u.usuario)}</strong>
          ${isYou ? '<span class="you-badge">tú</span>' : ''}
        </td>
        <td>
          <span class="rol-badge rol-${u.rol}">${ROLES[u.rol] || u.rol}</span>
        </td>
        ${puedeGestionar ? `
          <td class="users-actions">
            <button class="btn-icon" onclick="abrirEditarUsuario('${escapeAttr(u.usuario)}')" title="Editar" type="button">✏️</button>
            ${isYou
              ? '<span class="btn-icon-spacer"></span>'
              : `<button class="btn-icon btn-icon-danger" onclick="abrirEliminarUsuario('${escapeAttr(u.usuario)}')" title="Eliminar" type="button">🗑️</button>`}
          </td>
        ` : ''}
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

async function crearUsuario(usuario, contraseña, rol, permisos) {
  const res = await fetch('/api/usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ usuario, contraseña, rol, permisos })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al crear usuario');
  return true;
}

async function editarUsuario(targetUsuario, payload) {
  const res = await fetch(`/api/usuarios/${encodeURIComponent(targetUsuario)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al actualizar usuario');
  return true;
}

async function eliminarUsuario(targetUsuario) {
  const res = await fetch(`/api/usuarios/${encodeURIComponent(targetUsuario)}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al eliminar usuario');
  return true;
}

async function cambiarMiPassword(actual, nueva) {
  const res = await fetch('/api/auth/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ actual, nueva })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al cambiar contraseña');
  return true;
}

// ════════════════════════════════
// MODALES
// ════════════════════════════════
function setupModals() {
  // Cerrar modales con click en backdrop o botón
  document.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.closeModal;
      cerrarModal(id);
    });
  });

  // Crear usuario
  document.getElementById('btnCrearUsuario').addEventListener('click', () => {
    document.getElementById('crearUsuarioError').classList.remove('show');
    document.getElementById('crearUsuarioError').textContent = '';

    // Render checkboxes vacíos (nuevo editor sin permisos)
    renderPermisos('permisosCrear', []);

    // Asegurar que la sección de permisos sea visible (rol default = editor)
    document.getElementById('permisosGroupCrear').style.display = '';
    document.getElementById('permisosNoteCrear').style.display  = 'none';

    abrirModal('modalCrearUsuario');
  });

  document.getElementById('formCrearUsuario').addEventListener('submit', async e => {
    e.preventDefault();
    const usuario    = document.getElementById('nuevoUsuario').value.trim();
    const contraseña = document.getElementById('nuevoPassword').value;
    const rol        = document.getElementById('nuevoRol').value;
    const permisos   = rol === 'admin' ? [] : collectPermisos('permisosCrear');
    const errEl      = document.getElementById('crearUsuarioError');

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled    = true;
    btn.textContent = 'Creando…';

    try {
      await crearUsuario(usuario, contraseña, rol, permisos);
      cerrarModal('modalCrearUsuario');
      await cargarUsuarios();
      cargarEstadisticas();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Crear';
    }
  });

  // Editar usuario
  document.getElementById('formEditarUsuario').addEventListener('submit', async e => {
    e.preventDefault();
    if (!editingUser) return;

    const contraseña = document.getElementById('editarPassword').value;
    const rol        = document.getElementById('editarRol').value;
    const permisos   = rol === 'admin' ? [] : collectPermisos('permisosEditar');
    const errEl      = document.getElementById('editarUsuarioError');

    const payload = { rol, permisos };
    if (contraseña) payload.contraseña = contraseña;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled    = true;
    btn.textContent = 'Guardando…';

    try {
      await editarUsuario(editingUser, payload);
      editingUser = null;
      cerrarModal('modalEditarUsuario');
      await cargarUsuarios();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Guardar cambios';
    }
  });

  // Confirmar eliminar
  document.getElementById('btnConfirmarEliminar').addEventListener('click', async () => {
    if (!deletingUser) return;

    const errEl = document.getElementById('eliminarUsuarioError');
    const btn   = document.getElementById('btnConfirmarEliminar');
    btn.disabled    = true;
    btn.textContent = 'Eliminando…';

    try {
      await eliminarUsuario(deletingUser);
      deletingUser = null;
      cerrarModal('modalConfirmarEliminar');
      await cargarUsuarios();
      cargarEstadisticas();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Sí, eliminar';
    }
  });

  // Form inline de cambio de contraseña
  document.getElementById('formMiPassword').addEventListener('submit', async e => {
    e.preventDefault();
    const actual     = document.getElementById('miPassActual').value;
    const nueva      = document.getElementById('miPassNueva').value;
    const confirmar  = document.getElementById('miPassConfirmar').value;
    const errEl      = document.getElementById('miPassError');

    if (nueva !== confirmar) {
      errEl.textContent = 'Las contraseñas nuevas no coinciden';
      errEl.classList.add('show');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled    = true;
    btn.textContent = 'Guardando…';

    try {
      await cambiarMiPassword(actual, nueva);
      errEl.classList.remove('show');
      e.target.reset();

      btn.textContent = '✓ Guardado';
      btn.style.background = 'linear-gradient(135deg, #10b981, #34d399)';
      setTimeout(() => {
        btn.textContent = 'Guardar cambios';
        btn.style.background = '';
        btn.disabled = false;
      }, 2000);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
      btn.disabled    = false;
      btn.textContent = 'Guardar cambios';
    }
  });
}

function abrirEditarUsuario(usuario) {
  editingUser = usuario;
  document.getElementById('editarUsuarioNombre').value = usuario;
  document.getElementById('editarPassword').value      = '';

  // obtener datos actuales del usuario
  fetch('/api/usuarios', { credentials: 'include' })
    .then(r => r.json())
    .then(usuarios => {
      const u = usuarios.find(x => x.usuario === usuario);
      if (!u) return;

      document.getElementById('editarRol').value = u.rol;

      // Si es admin, ocultar checkboxes y mostrar nota
      const group = document.getElementById('permisosGroupEditar');
      const note  = document.getElementById('permisosNoteEditar');
      if (u.rol === 'admin') {
        group.style.display = 'none';
        note.style.display  = 'flex';
      } else {
        group.style.display = '';
        note.style.display  = 'none';
        renderPermisos('permisosEditar', u.permisos || []);
      }
    });

  document.getElementById('editarUsuarioError').classList.remove('show');
  document.getElementById('editarUsuarioError').textContent = '';
  abrirModal('modalEditarUsuario');
}

function abrirEliminarUsuario(usuario) {
  deletingUser = usuario;
  document.getElementById('eliminarUsuarioNombre').textContent = usuario;
  document.getElementById('eliminarUsuarioError').classList.remove('show');
  document.getElementById('eliminarUsuarioError').textContent = '';
  abrirModal('modalConfirmarEliminar');
}

function abrirModal(id) {
  const modal = document.getElementById(id);
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function cerrarModal(id) {
  const modal = document.getElementById(id);
  modal.style.display = 'none';
  document.body.style.overflow = '';

  const form = modal.querySelector('form');
  if (form) form.reset();

  modal.querySelectorAll('.form-error').forEach(el => {
    el.classList.remove('show');
    el.textContent = '';
  });
}

// Escape cierra modales
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal').forEach(m => {
      if (m.style.display === 'flex') m.style.display = 'none';
    });
    document.body.style.overflow = '';
  }
});

// ════════════════════════════════
// CATEGORÍAS (admin o permiso 'categorias')
// ════════════════════════════════
async function cargarCategorias() {
  const grid = document.getElementById('categoriasGrid');
  grid.innerHTML = '<p style="text-align:center;color:var(--ink-mute);padding:30px;">Cargando…</p>';

  try {
    const [resCats, resProds] = await Promise.all([
      fetch(api('/categorias')),
      fetch(api('/productos'))
    ]);

    if (!resCats.ok) {
      if (resCats.status === 401 || resCats.status === 403) {
        mostrarLogin();
        return;
      }
      throw new Error('Error al cargar categorías');
    }

    const categorias = await resCats.json();
    const productos  = resProds.ok ? await resProds.json() : [];
    cachedProductos = productos;

    renderCategorias(categorias, productos);
  } catch (err) {
    console.error(err);
    grid.innerHTML = '<p style="text-align:center;color:var(--danger);padding:30px;">Error al cargar categorías</p>';
  }
}

function renderCategorias(categorias, productos) {
  const grid = document.getElementById('categoriasGrid');

  if (categorias.length === 0) {
    grid.innerHTML = '<div class="categorias-empty">No hay categorías. Crea la primera con el botón "+ Crear categoría".</div>';
    return;
  }

  // Conteo por categoría
  const countByCat = {};
  productos.forEach(p => {
    countByCat[p.cat] = (countByCat[p.cat] || 0) + 1;
  });

  grid.innerHTML = categorias.map(c => {
    const count = countByCat[c.id] || 0;
    const isSistema = c.id === 'sin-categoria';
    const subcats = Array.isArray(c.subcategorias) ? c.subcategorias : [];
    const tieneSubcats = subcats.length > 0;

    return `
      <div class="categoria-card ${isSistema ? 'categoria-sistema' : ''}">
        <div class="categoria-header">
          <div class="categoria-icon">${c.icono || '📦'}</div>
          <div class="categoria-meta">
            <div class="categoria-nombre">${escapeHtml(c.nombre)}</div>
            <div class="categoria-id">${escapeHtml(c.id)}</div>
          </div>
          <div class="categoria-count">${count} item${count === 1 ? '' : 's'}</div>
          ${!isSistema ? `
            <div class="categoria-actions">
              <div class="menu-dropdown">
                <button class="btn-icon-tiny menu-toggle" type="button" aria-label="Más acciones" aria-haspopup="true" aria-expanded="false">⋯</button>
                <div class="menu-panel" hidden>
                  <div class="menu-header" title="${escapeAttr(c.nombre)}">${escapeHtml(c.nombre)}</div>
                  <button type="button" class="menu-item" data-action="add-sub-cat" data-id="${escapeAttr(c.id)}">
                    <span class="menu-icon">＋</span> Agregar subcategoría
                  </button>
                  <button type="button" class="menu-item" data-action="edit-cat" data-id="${escapeAttr(c.id)}">
                    <span class="menu-icon">✏️</span> Editar nombre e icono
                  </button>
                  <button type="button" class="menu-item menu-item-danger" data-action="delete-cat" data-id="${escapeAttr(c.id)}" data-name="${escapeAttr(c.nombre)}">
                    <span class="menu-icon">🗑️</span> Eliminar categoría
                  </button>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
        ${tieneSubcats ? `<div class="subcat-tree">${renderSubcatRows(subcats, [c.id])}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderIconPicker(selectedIcon) {
  const picker = document.getElementById('iconPicker');
  picker.innerHTML = CAT_ICONS.map(icon => `
    <button type="button" class="icon-option ${icon === selectedIcon ? 'selected' : ''}" data-icon="${icon}">${icon}</button>
  `).join('');

  picker.querySelectorAll('.icon-option').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.icon-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('catIcono').value = btn.dataset.icon;
    });
  });
}

// Abrir modal para CREAR categoría
function abrirCrearCategoria() {
  editingCategoria = null;
  document.getElementById('modalCategoriaTitulo').textContent = 'Crear categoría';
  document.getElementById('btnGuardarCategoria').textContent = 'Crear';
  document.getElementById('catNombre').value = '';
  document.getElementById('catIdHint').textContent = '';
  document.getElementById('categoriaError').classList.remove('show');
  document.getElementById('categoriaError').textContent = '';
  renderIconPicker('📦');
  abrirModal('modalCategoria');

  // Mostrar hint en vivo con el slug generado
  document.getElementById('catNombre').oninput = e => {
    const slug = slugifyLocal(e.target.value);
    document.getElementById('catIdHint').textContent = slug ? `ID: ${slug}` : '';
  };
}

// Abrir modal para EDITAR categoría
function abrirEditarCategoria(id) {
  fetch(api('/categorias'), { credentials: 'include' })
    .then(r => r.json())
    .then(categorias => {
      const c = categorias.find(x => x.id === id);
      if (!c) return;

      editingCategoria = id;
      document.getElementById('modalCategoriaTitulo').textContent = 'Editar categoría';
      document.getElementById('btnGuardarCategoria').textContent = 'Guardar cambios';
      document.getElementById('catNombre').value = c.nombre;
      document.getElementById('catIdHint').textContent = `ID: ${c.id} (no se puede cambiar)`;
      document.getElementById('categoriaError').classList.remove('show');
      document.getElementById('categoriaError').textContent = '';
      renderIconPicker(c.icono || '📦');
      abrirModal('modalCategoria');
    });
}

function abrirEliminarCategoria(id, nombre) {
  deletingCategoria = id;
  const count = cachedProductos.filter(p => p.cat === id).length;

  document.getElementById('eliminarCatNombre').textContent = nombre;
  document.getElementById('eliminarCatCount').textContent = count;
  document.getElementById('eliminarCatItemsMsg').style.display = count > 0 ? 'flex' : 'none';
  document.getElementById('eliminarCatError').classList.remove('show');
  document.getElementById('eliminarCatError').textContent = '';
  abrirModal('modalEliminarCategoria');
}

// Slugify en el frontend (mismo criterio que el backend)
function slugifyLocal(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function guardarCategoria(e) {
  e.preventDefault();
  const nombre = document.getElementById('catNombre').value.trim();
  const icono  = document.getElementById('catIcono').value;
  const errEl  = document.getElementById('categoriaError');
  const btn    = document.getElementById('btnGuardarCategoria');

  if (!nombre) return;

  btn.disabled    = true;
  btn.textContent = editingCategoria ? 'Guardando…' : 'Creando…';

  try {
    const url    = editingCategoria
      ? api(`/categorias/${encodeURIComponent(editingCategoria)}`)
      : api('/categorias');
    const method = editingCategoria ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nombre, icono })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    editingCategoria = null;
    cerrarModal('modalCategoria');
    await cargarCategorias();
    cargarEstadisticas();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled    = false;
    btn.textContent = editingCategoria ? 'Guardar cambios' : 'Crear';
  }
}

async function confirmarEliminarCategoria() {
  if (!deletingCategoria) return;

  const btn   = document.getElementById('btnConfirmarEliminarCategoria');
  const errEl = document.getElementById('eliminarCatError');
  btn.disabled    = true;
  btn.textContent = 'Eliminando…';

  try {
    const res = await fetch(api(`/categorias/${encodeURIComponent(deletingCategoria)}`), {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');

    deletingCategoria = null;
    cerrarModal('modalEliminarCategoria');
    await cargarCategorias();
    cargarEstadisticas();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sí, eliminar';
  }
}

// Setup de listeners para categorías (se llama desde setupModals)
function setupCategoriasModals() {
  document.getElementById('btnCrearCategoria').addEventListener('click', abrirCrearCategoria);
  document.getElementById('formCategoria').addEventListener('submit', guardarCategoria);
  document.getElementById('btnConfirmarEliminarCategoria').addEventListener('click', confirmarEliminarCategoria);
  document.getElementById('formSubcategoria').addEventListener('submit', guardarSubcategoria);
  document.getElementById('btnConfirmarEliminarSubcat').addEventListener('click', confirmarEliminarSubcategoria);
  setupKebabMenus();
}

// ════════════════════════════════
// MENÚ KEBAB (drop-down ⋯) — para categoría y subcats
// - Click en .menu-toggle → abre/cierra
// - Click en .menu-item → ejecuta acción, cierra
// - Click fuera / Escape → cierra todos
// - Al abrir, marca .menu-active en el contenedor para que no se oculte al perder hover
// ════════════════════════════════
function setupKebabMenus() {
  document.addEventListener('click', e => {
    // Click en el toggle ⋯
    const toggle = e.target.closest('.menu-toggle');
    if (toggle) {
      e.stopPropagation();
      const dropdown = toggle.parentElement;
      const panel    = dropdown.querySelector('.menu-panel');
      if (!panel) return;
      const wasOpen = !panel.hidden;
      closeAllKebabMenus();
      if (!wasOpen) {
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        // Marcar la card como host para que flote sobre los vecinos
        const card = dropdown.closest('.categoria-card');
        if (card) card.classList.add('menu-host');
      }
      return;
    }

    // Click en un item del menú
    const item = e.target.closest('.menu-item');
    if (item) {
      const action = item.dataset.action;
      closeAllKebabMenus();
      if      (action === 'add-sub-cat')     abrirCrearSubcategoria(item.dataset.id);
      else if (action === 'add-sub-sub-cat') abrirCrearSubcatHijo(item.dataset.cat, item.dataset.sub);
      else if (action === 'edit-subcat')     abrirEditarSubcategoria(item.dataset.cat, item.dataset.sub);
      else if (action === 'delete-subcat')   abrirEliminarSubcategoria(item.dataset.cat, item.dataset.sub, item.dataset.name);
      else if (action === 'edit-cat')        abrirEditarCategoria(item.dataset.id);
      else if (action === 'delete-cat')      abrirEliminarCategoria(item.dataset.id, item.dataset.name);
      return;
    }

    // Click fuera de cualquier dropdown
    if (!e.target.closest('.menu-dropdown')) {
      closeAllKebabMenus();
    }
  });

  // Escape cierra todos
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllKebabMenus();
  });
}

function closeAllKebabMenus() {
  document.querySelectorAll('.menu-panel').forEach(p => p.hidden = true);
  document.querySelectorAll('.menu-toggle').forEach(b => b.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('.categoria-card.menu-host')
    .forEach(c => c.classList.remove('menu-host'));
}

// ════════════════════════════════
// SUBCATEGORÍAS (CRUD sobre el árbol anidado)
// Estado: editingSubcat = { parentId, subId } cuando se está editando
//         deletingSubcat = { parentId, subId, nombre } cuando se va a eliminar
// ════════════════════════════════
let editingSubcat   = null;
let deletingSubcat  = null;

// Render recursivo de subcategorías como filas anidadas dentro de la card de la categoría
function renderSubcatRows(subcats, parentPath) {
  if (!Array.isArray(subcats) || subcats.length === 0) return '';
  // parentPath = [c.id]  → render nivel 2 (subs). El ＋ aparece (pueden tener sub-subs).
  // parentPath = [c.id, s.id] → render nivel 3 (sub-subs). El ＋ NO aparece (límite 3 niveles).
  const puedenTenerHijos = parentPath.length === 1;
  return subcats.map(s => {
    const path = [...parentPath, s.id];
    const tieneSubSub = Array.isArray(s.subcategorias) && s.subcategorias.length > 0;
    return `
      <div class="subcat-row" data-subcat-id="${escapeAttr(s.id)}">
        <div class="subcat-info">
          <span class="subcat-name">${escapeHtml(s.nombre)}</span>
          <span class="subcat-id">${escapeHtml(s.id)}</span>
        </div>
        <div class="subcat-actions">
          <div class="menu-dropdown">
            <button class="btn-icon-tiny menu-toggle" type="button" aria-label="Más acciones" aria-haspopup="true" aria-expanded="false">⋯</button>
            <div class="menu-panel" hidden>
              <div class="menu-header" title="${escapeAttr(s.nombre)}">${escapeHtml(s.nombre)}</div>
              ${puedenTenerHijos ? `<button type="button" class="menu-item" data-action="add-sub-sub-cat" data-cat="${escapeAttr(parentPath[0])}" data-sub="${escapeAttr(s.id)}">
                <span class="menu-icon">＋</span> Agregar sub-subcategoría
              </button>` : ''}
              <button type="button" class="menu-item" data-action="edit-subcat" data-cat="${escapeAttr(parentPath[0])}" data-sub="${escapeAttr(s.id)}">
                <span class="menu-icon">✏️</span> Editar nombre
              </button>
              <button type="button" class="menu-item menu-item-danger" data-action="delete-subcat" data-cat="${escapeAttr(parentPath[0])}" data-sub="${escapeAttr(s.id)}" data-name="${escapeAttr(s.nombre)}">
                <span class="menu-icon">🗑️</span> Eliminar subcategoría
              </button>
            </div>
          </div>
        </div>
      </div>
      ${tieneSubSub ? `<div class="subcat-children">${renderSubcatRows(s.subcategorias, path)}</div>` : ''}
    `;
  }).join('');
}

async function abrirCrearSubcategoria(parentId) {
  editingSubcat = null;
  document.getElementById('modalSubcategoriaTitulo').textContent = 'Crear subcategoría';
  document.getElementById('btnGuardarSubcategoria').textContent = 'Crear';
  document.getElementById('subcatNombre').value = '';
  document.getElementById('subcatIdHint').textContent = '';
  document.getElementById('subcategoriaError').classList.remove('show');
  document.getElementById('subcategoriaError').textContent = '';
  // Mostrar breadcrumb del padre (solo la categoría)
  const categorias = await fetch(api('/categorias'), { credentials: 'include' }).then(r => r.json());
  const parent = categorias.find(c => c.id === parentId);
  if (parent) {
    document.getElementById('subcatBreadcrumb').innerHTML =
      `<span class="bc-cat">${parent.icono || '📦'} ${escapeHtml(parent.nombre)}</span><span class="bc-arrow">›</span><span class="bc-new">Nueva subcategoría</span>`;
  }
  abrirModal('modalSubcategoria');

  document.getElementById('subcatNombre').oninput = e => {
    const slug = slugifyLocal(e.target.value);
    document.getElementById('subcatIdHint').textContent = slug ? `ID: ${slug}` : '';
  };

  // Guardar el parentId en el dataset del form para usarlo al enviar
  document.getElementById('formSubcategoria').dataset.parentId = parentId;
  document.getElementById('formSubcategoria').dataset.subId = '';
}

async function abrirCrearSubcatHijo(parentCatId, parentSubId) {
  // Para crear una sub-subcategoría, el "padre" es la subcategoría (no la categoría raíz)
  editingSubcat = null;
  document.getElementById('modalSubcategoriaTitulo').textContent = 'Crear sub-subcategoría';
  document.getElementById('btnGuardarSubcategoria').textContent = 'Crear';
  document.getElementById('subcatNombre').value = '';
  document.getElementById('subcatIdHint').textContent = '';
  document.getElementById('subcategoriaError').classList.remove('show');
  document.getElementById('subcategoriaError').textContent = '';

  const categorias = await fetch(api('/categorias'), { credentials: 'include' }).then(r => r.json());
  const path = getCategoryPathCliente(categorias, parentSubId);
  if (path) {
    const crumbs = path.map(n => `<span class="bc-cat">${n.icono || '📦'} ${escapeHtml(n.nombre)}</span><span class="bc-arrow">›</span>`).join('');
    document.getElementById('subcatBreadcrumb').innerHTML = crumbs + '<span class="bc-new">Nueva sub-subcategoría</span>';
  }
  abrirModal('modalSubcategoria');

  document.getElementById('subcatNombre').oninput = e => {
    const slug = slugifyLocal(e.target.value);
    document.getElementById('subcatIdHint').textContent = slug ? `ID: ${slug}` : '';
  };

  document.getElementById('formSubcategoria').dataset.parentId = parentCatId;
  document.getElementById('formSubcategoria').dataset.subId = parentSubId;
}

async function abrirEditarSubcategoria(parentCatId, subId) {
  const categorias = await fetch(api('/categorias'), { credentials: 'include' }).then(r => r.json());
  const sub = findSubcatCliente(categorias, subId);
  if (!sub) return;

  editingSubcat = { parentCatId, subId };
  document.getElementById('modalSubcategoriaTitulo').textContent = 'Editar subcategoría';
  document.getElementById('btnGuardarSubcategoria').textContent = 'Guardar cambios';
  document.getElementById('subcatNombre').value = sub.nombre;
  document.getElementById('subcatIdHint').textContent = `ID: ${sub.id} (no se puede cambiar)`;
  document.getElementById('subcategoriaError').classList.remove('show');
  document.getElementById('subcategoriaError').textContent = '';

  const path = getCategoryPathCliente(categorias, subId);
  if (path) {
    const crumbs = path.slice(0, -1).map(n => `<span class="bc-cat">${n.icono || '📦'} ${escapeHtml(n.nombre)}</span><span class="bc-arrow">›</span>`).join('');
    document.getElementById('subcatBreadcrumb').innerHTML = crumbs + `<span class="bc-cat">${escapeHtml(sub.nombre)}</span>`;
  }
  abrirModal('modalSubcategoria');

  document.getElementById('formSubcategoria').dataset.parentId = parentCatId;
  document.getElementById('formSubcategoria').dataset.subId = subId;
}

function abrirEliminarSubcategoria(parentCatId, subId, nombre) {
  deletingSubcat = { parentCatId, subId, nombre };
  document.getElementById('eliminarSubcatNombre').textContent = nombre;
  document.getElementById('eliminarSubcatError').classList.remove('show');
  document.getElementById('eliminarSubcatError').textContent = '';
  abrirModal('modalEliminarSubcategoria');
}

// Helpers cliente (espejo de los del backend)
function getCategoryPathCliente(categorias, id, trail = []) {
  for (const c of categorias) {
    const next = [...trail, c];
    if (c.id === id) return next;
    if (Array.isArray(c.subcategorias) && c.subcategorias.length) {
      const found = getCategoryPathCliente(c.subcategorias, id, next);
      if (found) return found;
    }
  }
  return null;
}
function findSubcatCliente(categorias, id) {
  for (const c of categorias) {
    if (Array.isArray(c.subcategorias)) {
      const found = findInSubcatsCliente(c.subcategorias, id);
      if (found) return found;
    }
  }
  return null;
}
function findInSubcatsCliente(subcats, id) {
  for (const s of subcats) {
    if (s.id === id) return s;
    if (Array.isArray(s.subcategorias) && s.subcategorias.length) {
      const found = findInSubcatsCliente(s.subcategorias, id);
      if (found) return found;
    }
  }
  return null;
}

async function guardarSubcategoria(e) {
  e.preventDefault();
  const nombre = document.getElementById('subcatNombre').value.trim();
  const errEl  = document.getElementById('subcategoriaError');
  const btn    = document.getElementById('btnGuardarSubcategoria');
  const form   = document.getElementById('formSubcategoria');
  const parentId = form.dataset.parentId;
  const subId    = form.dataset.subId;

  if (!nombre) return;

  btn.disabled    = true;
  btn.textContent = editingSubcat ? 'Guardando…' : 'Creando…';

  try {
    let url, method, body;

    if (editingSubcat) {
      // EDITAR: PUT /api/{brand}/categorias/:parentId/subcategorias/:subId
      url    = api(`/categorias/${encodeURIComponent(parentId)}/subcategorias/${encodeURIComponent(subId)}`);
      method = 'PUT';
      body   = { nombre };
    } else if (subId) {
      // CREAR sub-subcat: POST con parentSubId en el body
      url    = api(`/categorias/${encodeURIComponent(parentId)}/subcategorias`);
      method = 'POST';
      body   = { nombre, parentSubId: subId };
    } else {
      // CREAR subcat nivel 1: POST simple
      url    = api(`/categorias/${encodeURIComponent(parentId)}/subcategorias`);
      method = 'POST';
      body   = { nombre };
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    editingSubcat = null;
    cerrarModal('modalSubcategoria');
    await cargarCategorias();
    cargarEstadisticas();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled    = false;
    btn.textContent = editingSubcat ? 'Guardar cambios' : 'Crear';
  }
}

async function confirmarEliminarSubcategoria() {
  if (!deletingSubcat) return;

  const btn   = document.getElementById('btnConfirmarEliminarSubcat');
  const errEl = document.getElementById('eliminarSubcatError');
  btn.disabled    = true;
  btn.textContent = 'Eliminando…';

  try {
    const res = await fetch(
      api(`/categorias/${encodeURIComponent(deletingSubcat.parentCatId)}/subcategorias/${encodeURIComponent(deletingSubcat.subId)}`),
      { method: 'DELETE', credentials: 'include' }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');

    deletingSubcat = null;
    cerrarModal('modalEliminarSubcategoria');
    await cargarCategorias();
    cargarEstadisticas();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sí, eliminar';
  }
}

// ════════════════════════════════
// SUBIDA MASIVA DE PRODUCTOS
// ════════════════════════════════

const MAX_FILES_UPLOAD  = 50;
const MAX_SIZE_UPLOAD   = 20 * 1024 * 1024; // 20MB
const ACCEPTED_TYPES     = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
// Referencia = nombre completo antes de la extensión.
// Permite casi cualquier carácter excepto los peligrosos para el sistema de archivos o URLs.
const REF_VALID_CLIENTE = /^[^\\/:*?"<>|\s]+$/;
const SIN_CAT_ID         = 'sin-categoria';

let pendingFiles = []; // [{file, ref, num, isValid, motivo}]

function parseFilenameCliente(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  if (!base) return null;
  if (!REF_VALID_CLIENTE.test(base)) return null;
  return { ref: base, num: 1 };
}

async function cargarCategoriasEnUpload() {
  const select = document.getElementById('uploadCategoria');
  if (!select) {
    console.warn('[upload] Select #uploadCategoria no encontrado en el DOM');
    return;
  }
  try {
    const res = await fetch(api('/categorias'), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const categorias = await res.json();
    if (!Array.isArray(categorias)) throw new Error('Respuesta no es array');

    // Cachear el árbol completo (con subcategorías) en el módulo para la cascada
    uploadCategoriasTree = categorias;

    const seleccionPrevia = select.value;
    select.innerHTML = '<option value="">— Selecciona una categoría —</option>';
    categorias
      .filter(c => c.id !== SIN_CAT_ID)
      .forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.icono || '📦'}  ${c.nombre}`;
        select.appendChild(opt);
      });
    if (seleccionPrevia) select.value = seleccionPrevia;
  } catch (err) {
    console.error('[upload] Error cargando categorías:', err);
    const error = document.getElementById('uploadError');
    if (error) error.textContent = 'No se pudieron cargar las categorías. Recarga la página.';
  }
}

// Árbol completo cacheado para la cascada del upload
let uploadCategoriasTree = [];

// Se ejecuta cuando el usuario cambia la categoría
function onCategoriaChange() {
  const catId   = document.getElementById('uploadCategoria').value;
  const subGrp  = document.getElementById('uploadSubcatGroup');
  const subSel  = document.getElementById('uploadSubcategoria');
  const subSubGrp = document.getElementById('uploadSubSubcatGroup');
  const subSubSel = document.getElementById('uploadSubSubcategoria');

  // Reset
  subSel.innerHTML = '<option value="">— Selecciona una subcategoría —</option>';
  subSubSel.innerHTML = '<option value="">— Selecciona una sub-subcategoría —</option>';
  subGrp.style.display    = 'none';
  subSubGrp.style.display = 'none';

  if (!catId) {
    actualizarBreadcrumbDestino();
    updateSubmitButton();
    return;
  }

  const cat = uploadCategoriasTree.find(c => c.id === catId);
  if (!cat) return;

  if (Array.isArray(cat.subcategorias) && cat.subcategorias.length > 0) {
    subGrp.style.display = '';
    cat.subcategorias.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.icono || '📂'}  ${s.nombre}`;
      subSel.appendChild(opt);
    });
  }
  actualizarBreadcrumbDestino();
  updateSubmitButton();
}

// Se ejecuta cuando el usuario cambia la subcategoría
function onSubcategoriaChange() {
  const catId  = document.getElementById('uploadCategoria').value;
  const subId  = document.getElementById('uploadSubcategoria').value;
  const subSubGrp = document.getElementById('uploadSubSubcatGroup');
  const subSubSel = document.getElementById('uploadSubSubcategoria');

  subSubSel.innerHTML = '<option value="">— Selecciona una sub-subcategoría —</option>';
  subSubGrp.style.display = 'none';

  if (!catId || !subId) {
    actualizarBreadcrumbDestino();
    updateSubmitButton();
    return;
  }

  const cat = uploadCategoriasTree.find(c => c.id === catId);
  if (!cat || !Array.isArray(cat.subcategorias)) return;

  const sub = cat.subcategorias.find(s => s.id === subId);
  if (!sub) return;

  if (Array.isArray(sub.subcategorias) && sub.subcategorias.length > 0) {
    subSubGrp.style.display = '';
    sub.subcategorias.forEach(ss => {
      const opt = document.createElement('option');
      opt.value = ss.id;
      opt.textContent = `${ss.icono || '📂'}  ${ss.nombre}`;
      subSubSel.appendChild(opt);
    });
  }
  actualizarBreadcrumbDestino();
  updateSubmitButton();
}

// Muestra el breadcrumb del destino actual (cat > sub1 > sub2)
function actualizarBreadcrumbDestino() {
  const cont = document.getElementById('uploadDestino');
  const path = document.getElementById('uploadDestinoPath');
  if (!cont || !path) return;

  const catId   = document.getElementById('uploadCategoria').value;
  const subId   = document.getElementById('uploadSubcategoria').value;
  const subSubId= document.getElementById('uploadSubSubcategoria').value;

  if (!catId) { cont.style.display = 'none'; return; }

  const cat = uploadCategoriasTree.find(c => c.id === catId);
  if (!cat) { cont.style.display = 'none'; return; }

  const parts = [`${cat.icono || '📦'} ${cat.nombre}`];
  if (subId) {
    const sub = (cat.subcategorias || []).find(s => s.id === subId);
    if (sub) {
      parts.push(`${sub.icono || '📂'} ${sub.nombre}`);
      if (subSubId) {
        const subSub = (sub.subcategorias || []).find(s => s.id === subSubId);
        if (subSub) parts.push(`${subSub.icono || '📂'} ${subSub.nombre}`);
      }
    }
  }
  path.textContent = parts.join(' › ');
  cont.style.display = '';
}

// Devuelve el array `sub` que se enviará al backend (la cadena hasta la hoja)
function getSubPathActual() {
  const catId  = document.getElementById('uploadCategoria').value;
  const subId  = document.getElementById('uploadSubcategoria').value;
  const subSubId = document.getElementById('uploadSubSubcategoria').value;

  if (!catId) return [];
  const path = [];
  if (subId)     path.push(subId);
  if (subSubId)  path.push(subSubId);
  return path;
}

function setupProductosUpload() {
  const dropzone    = document.getElementById('dropzone');
  const inputFotos  = document.getElementById('inputFotos');
  const btnLimpiar  = document.getElementById('btnLimpiarPreview');
  const form        = document.getElementById('formUploadProductos');
  const select      = document.getElementById('uploadCategoria');
  const selectSub   = document.getElementById('uploadSubcategoria');
  const selectSubSub= document.getElementById('uploadSubSubcategoria');

  if (!dropzone || !inputFotos) return;

  // Click en dropzone abre el selector
  dropzone.addEventListener('click', () => inputFotos.click());

  // Drag & drop
  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
    });
  });
  dropzone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files || []);
    addFiles(files);
  });

  inputFotos.addEventListener('change', e => {
    addFiles(Array.from(e.target.files || []));
    inputFotos.value = ''; // permite re-seleccionar el mismo archivo
  });

  btnLimpiar.addEventListener('click', () => {
    pendingFiles = [];
    renderPreview();
  });

  // Cascada: categoría → subcategoría → sub-subcategoría
  select.addEventListener('change', onCategoriaChange);
  if (selectSub)    selectSub.addEventListener('change', onSubcategoriaChange);
  if (selectSubSub) selectSubSub.addEventListener('change', updateSubmitButton);

  form.addEventListener('submit', submitUpload);
}

function addFiles(files) {
  const total = pendingFiles.length + files.length;
  if (total > MAX_FILES_UPLOAD) {
    mostrarError(`Máximo ${MAX_FILES_UPLOAD} archivos. Has seleccionado ${files.length} y ya tenías ${pendingFiles.length}.`);
    return;
  }

  for (const f of files) {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      pendingFiles.push({ file: f, ref: null, num: null, isValid: false, motivo: 'Tipo no permitido' });
      continue;
    }
    if (f.size > MAX_SIZE_UPLOAD) {
      pendingFiles.push({ file: f, ref: null, num: null, isValid: false, motivo: 'Supera 20MB' });
      continue;
    }
    const parsed = parseFilenameCliente(f.name);
    if (!parsed) {
      pendingFiles.push({ file: f, ref: null, num: null, isValid: false, motivo: 'Nombre inválido' });
      continue;
    }
    pendingFiles.push({ file: f, ref: parsed.ref, num: parsed.num, isValid: true, motivo: null });
  }
  renderPreview();
}

function renderPreview() {
  const section = document.getElementById('previewSection');
  const grid    = document.getElementById('previewGrid');
  const counter = document.getElementById('previewCount');

  counter.textContent = pendingFiles.length;

  if (pendingFiles.length === 0) {
    section.style.display = 'none';
    updateSubmitButton();
    return;
  }
  section.style.display = 'block';

  grid.innerHTML = '';
  pendingFiles.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'preview-item' + (item.isValid ? '' : ' is-invalid');

    const url = URL.createObjectURL(item.file);
    const img = document.createElement('img');
    img.src = url;
    img.alt = item.file.name;
    img.onload = () => URL.revokeObjectURL(url);
    div.appendChild(img);

    const info = document.createElement('div');
    info.className = 'preview-info';
    if (item.isValid) {
      info.innerHTML = `<strong>${escapeHtml(item.ref)}</strong><span>1 producto</span>`;
    } else {
      info.innerHTML = `<strong>${escapeHtml(item.file.name)}</strong><span>${escapeHtml(item.motivo)}</span>`;
    }
    div.appendChild(info);

    if (!item.isValid) {
      const tag = document.createElement('div');
      tag.className = 'preview-invalid-tag';
      tag.textContent = 'Inválido';
      div.appendChild(tag);
    }

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'preview-remove';
    btnRemove.innerHTML = '✕';
    btnRemove.setAttribute('aria-label', 'Quitar');
    btnRemove.addEventListener('click', () => {
      pendingFiles.splice(idx, 1);
      renderPreview();
    });
    div.appendChild(btnRemove);

    grid.appendChild(div);
  });

  updateSubmitButton();
}

function updateSubmitButton() {
  const btn    = document.getElementById('btnSubirProductos');
  const catId  = document.getElementById('uploadCategoria').value;
  const validos = pendingFiles.filter(p => p.isValid).length;
  if (!catId || validos === 0) {
    btn.disabled = true;
    return;
  }
  // Validar que la cadena llegue a una hoja
  const cat = uploadCategoriasTree.find(c => c.id === catId);
  if (!cat) { btn.disabled = true; return; }
  const catTieneSubcats = Array.isArray(cat.subcategorias) && cat.subcategorias.length > 0;
  if (catTieneSubcats) {
    const subId = document.getElementById('uploadSubcategoria').value;
    if (!subId) { btn.disabled = true; return; }
    const sub = cat.subcategorias.find(s => s.id === subId);
    if (!sub) { btn.disabled = true; return; }
    if (Array.isArray(sub.subcategorias) && sub.subcategorias.length > 0) {
      const subSubId = document.getElementById('uploadSubSubcategoria').value;
      if (!subSubId) { btn.disabled = true; return; }
    }
  }
  btn.disabled = false;
}

async function submitUpload(e) {
  e.preventDefault();
  const select = document.getElementById('uploadCategoria');
  const btn    = document.getElementById('btnSubirProductos');
  const error  = document.getElementById('uploadError');
  const summary= document.getElementById('uploadSummary');

  error.textContent = '';
  summary.style.display = 'none';
  summary.innerHTML = '';

  const validos = pendingFiles.filter(p => p.isValid);
  if (!select.value) {
    error.textContent = 'Selecciona una categoría';
    return;
  }
  if (validos.length === 0) {
    error.textContent = 'No hay fotos válidas para subir';
    return;
  }

  // Lock UI
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Subiendo…';
  btn.querySelector('.btn-spinner').style.display = 'inline-block';

  const subPath = getSubPathActual();

  const fd = new FormData();
  fd.append('categoria', select.value);
  fd.append('sub', JSON.stringify(subPath));
  validos.forEach(item => fd.append('fotos', item.file, item.file.name));

  try {
    const res  = await fetch(api('/productos/upload'), { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en la subida');

    renderSummary(data.resumen, validos);

    // Limpiar lo que se subió bien
    const refsSubidos = new Set((data.resumen.creadosList || []).map(c => c.ref));
    if (refsSubidos.size > 0) {
      pendingFiles = pendingFiles.filter(p => !p.isValid || !refsSubidos.has(p.ref));
      renderPreview();
      // refrescar stats
      if (typeof cargarEstadisticas === 'function') cargarEstadisticas();
    }
  } catch (err) {
    error.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Subir fotos';
    btn.querySelector('.btn-spinner').style.display = 'none';
    updateSubmitButton();
  }
}

function renderSummary(r, validos) {
  const cont = document.getElementById('uploadSummary');
  cont.innerHTML = '';

  if (r.creados > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-success';
    row.innerHTML = `
      <span class="icon">✅</span>
      <div class="text">
        <strong>${r.creados} producto(s) creado(s)</strong>
        <ul>${r.creadosList.map(c => `<li><code>${escapeHtml(c.ref)}</code></li>`).join('')}</ul>
      </div>
    `;
    cont.appendChild(row);
  }

  if (r.saltados > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-warning';
    row.innerHTML = `
      <span class="icon">⏭️</span>
      <div class="text">
        <strong>${r.saltados} referencia(s) ya existían — no se sobrescribieron</strong>
        <ul>${r.saltadosList.map(s => `<li><code>${escapeHtml(s.ref)}</code> — ${escapeHtml(s.motivo)}</li>`).join('')}</ul>
      </div>
    `;
    cont.appendChild(row);
  }

  if (r.ignorados > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-warning';
    row.innerHTML = `
      <span class="icon">⚠️</span>
      <div class="text">
        <strong>${r.ignorados} archivo(s) con nombre inválido — no se procesaron</strong>
        <ul>${r.ignoradosList.map(i => `<li><code>${escapeHtml(i.archivo)}</code> — ${escapeHtml(i.motivo)}</li>`).join('')}</ul>
      </div>
    `;
    cont.appendChild(row);
  }

  if (r.errores > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-error';
    row.innerHTML = `
      <span class="icon">❌</span>
      <div class="text">
        <strong>${r.errores} error(es) al procesar</strong>
        <ul>${r.erroresList.map(e => `<li><code>${escapeHtml(e.ref)}</code> — ${escapeHtml(e.motivo)}</li>`).join('')}</ul>
      </div>
    `;
    cont.appendChild(row);
  }

  if (cont.children.length === 0) {
    cont.innerHTML = `<div class="upload-summary-row is-warning"><span class="icon">ℹ️</span><div class="text"><strong>Nada se subió</strong></div></div>`;
  }

  cont.style.display = 'flex';
}

// ════════════════════════════════
// PRODUCTOS DISPONIBLES (lista en vista Productos)
// Solo se muestran los productos que NO están agotados
// (img no empieza con "agotados/").
// ════════════════════════════════
let deletingProductoRef = null;
let busquedaProductos   = '';   // texto de la barra de búsqueda
let productosCache      = [];   // últimos productos cargados (para filtrar en cliente)
let categoriasCache     = [];   // últimas categorías cargadas (para iconos)

async function guardarVentaMinima(ref, inputId) {
  const input = document.getElementById(inputId);
  const btn   = document.querySelector(`button[data-vm-btn="${escapeAttr(ref)}"]`);
  if (!input) return;

  let vm = parseInt(input.value, 10);
  if (Number.isNaN(vm) || vm < 1) vm = 1;
  input.value = vm;

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
  }

  try {
    const res  = await fetch(api(`/productos/${encodeURIComponent(ref)}/venta-minima`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ventaMinima: vm }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    // Actualizar cache local
    const p = productosCache.find(x => x.ref === ref);
    if (p) p.ventaMinima = vm;

    if (btn) {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '💾'; btn.disabled = false; }, 1200);
    }
  } catch (err) {
    alert('Error guardando venta mínima: ' + err.message);
    if (btn) {
      btn.textContent = '💾';
      btn.disabled = false;
    }
  }
}

async function cargarProductosDisponibles() {
  const grid = document.getElementById('productosListGrid');
  if (!grid) return;
  grid.innerHTML = '<p style="text-align:center;color:var(--ink-mute);padding:24px;grid-column:1/-1;">Cargando…</p>';

  try {
    const [resProds, resCats] = await Promise.all([
      fetch(api('/productos'), { credentials: 'include' }),
      fetch(api('/categorias'),  { credentials: 'include' })
    ]);
    if (!resProds.ok) {
      if (resProds.status === 401 || resProds.status === 403) { mostrarLogin(); return; }
      throw new Error('Error al cargar productos');
    }
    const productos  = await resProds.json();
    const categorias = resCats.ok ? await resCats.json() : [];
    cachedProductos  = productos;
    productosCache   = productos;
    categoriasCache  = categorias;

    renderProductosDisponibles();
  } catch (err) {
    console.error(err);
    grid.innerHTML = '<p style="text-align:center;color:var(--danger);padding:24px;grid-column:1/-1;">Error al cargar productos</p>';
  }
}

function renderProductosDisponibles() {
  const grid  = document.getElementById('productosListGrid');
  const count = document.getElementById('productosDisponiblesCount');
  if (!grid) return;

  // Solo productos disponibles: img NO empieza con "agotados/"
  // (y descartamos sin-categoria para mantener consistencia con el catálogo público)
  let disponibles = productosCache.filter(p =>
    p.cat && p.cat !== 'sin-categoria' && (!p.img || !p.img.startsWith('agotados/'))
  );
  const total = disponibles.length;

  // Filtro por referencia (case-insensitive, match parcial)
  const q = busquedaProductos.trim().toLowerCase();
  if (q) {
    disponibles = disponibles.filter(p => String(p.ref || '').toLowerCase().includes(q));
  }

  // Contador: "X items" o "X / Y items" cuando hay filtro
  if (count) {
    if (q) {
      count.textContent = `${disponibles.length} / ${total} item${total === 1 ? '' : 's'}`;
    } else {
      count.textContent = `${total} item${total === 1 ? '' : 's'}`;
    }
  }

  if (total === 0) {
    grid.innerHTML = '<div class="productos-empty">No hay productos disponibles aún. Sube fotos en el formulario de arriba.</div>';
    return;
  }

  if (disponibles.length === 0) {
    grid.innerHTML = `<div class="productos-empty">No se encontraron productos con la referencia "<strong>${escapeHtml(busquedaProductos)}</strong>".</div>`;
    return;
  }

  // Ordenar por ref para tener un orden estable
  disponibles.sort((a, b) => String(a.ref).localeCompare(String(b.ref)));

  const categorias = categoriasCache;
  grid.innerHTML = disponibles.map(p => {
    const cat = categorias.find(c => c.id === p.cat);
    const icon = cat ? cat.icono : '📦';
    const imgSrc = imgUrl(p.img);
    const vm = (p.ventaMinima && !Number.isNaN(parseInt(p.ventaMinima, 10)) && parseInt(p.ventaMinima, 10) >= 1)
      ? parseInt(p.ventaMinima, 10)
      : 1;
    const inputId = `vm-${escapeAttr(p.ref)}`;
    return `
      <div class="producto-item">
        <div class="producto-thumb-wrap">
          <img class="producto-thumb" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(p.ref)}" loading="lazy"
               onerror="this.classList.add('is-broken')">
          <span class="producto-thumb-fallback">${icon}</span>
        </div>
        <div class="producto-info">
          <div class="producto-ref">${escapeHtml(p.ref)}</div>
          <div class="producto-cat-tag">${icon} ${escapeHtml(cat ? cat.nombre : p.cat)}</div>
          <div class="producto-venta-minima">
            <label for="${inputId}">Venta mínima</label>
            <input type="number" id="${inputId}" value="${vm}" min="1" max="999" step="1"
                   onchange="guardarVentaMinima('${escapeAttr(p.ref)}', '${inputId}')"
                   onkeydown="if(event.key==='Enter') guardarVentaMinima('${escapeAttr(p.ref)}', '${inputId}')">
            <button type="button" class="btn-icon btn-icon-save" data-vm-btn="${escapeAttr(p.ref)}"
                    onclick="guardarVentaMinima('${escapeAttr(p.ref)}', '${inputId}')"
                    title="Guardar venta mínima">💾</button>
          </div>
        </div>
        <div class="producto-actions">
          <button class="btn-icon btn-icon-danger" onclick="abrirAgotarProducto('${escapeAttr(p.ref)}')" title="Marcar como agotado" type="button">🚫</button>
        </div>
      </div>
    `;
  }).join('');
}

// Hook de la barra de búsqueda — se ejecuta una sola vez al cargar el DOM.
function setupProductosSearch() {
  const input = document.getElementById('productosSearch');
  const clear = document.getElementById('productosSearchClear');
  if (!input || !clear) return;

  input.addEventListener('input', e => {
    busquedaProductos = e.target.value;
    clear.style.display = busquedaProductos ? 'flex' : 'none';
    renderProductosDisponibles();
  });

  clear.addEventListener('click', () => {
    input.value = '';
    busquedaProductos = '';
    clear.style.display = 'none';
    renderProductosDisponibles();
    input.focus();
  });
}

// ════════════════════════════════
// EXCEL/CSV — asignar nombre + precio por referencia
// ════════════════════════════════
function setupExcelUpload() {
  const input   = document.getElementById('excelArchivo');
  const hint    = document.getElementById('excelArchivoHint');
  const form    = document.getElementById('formExcelUpload');
  const btn     = document.getElementById('btnProcesarExcel');
  const selBtn  = document.getElementById('btnSeleccionarExcel');
  if (!input || !form) return;

  selBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (f) {
      const sizeKB = (f.size / 1024).toFixed(1);
      hint.textContent = `📄 ${f.name} · ${sizeKB} KB`;
    } else {
      hint.textContent = 'Ningún archivo seleccionado';
    }
    btn.disabled = !f;
  });

  form.addEventListener('submit', submitExcelUpload);
}

async function submitExcelUpload(e) {
  e.preventDefault();
  const input = document.getElementById('excelArchivo');
  const btn   = document.getElementById('btnProcesarExcel');
  const errEl = document.getElementById('excelError');
  const summ  = document.getElementById('excelSummary');
  const f     = input.files && input.files[0];

  errEl.textContent = '';
  errEl.classList.remove('show');
  summ.style.display = 'none';
  summ.innerHTML = '';

  if (!f) {
    errEl.textContent = 'Selecciona un archivo';
    errEl.classList.add('show');
    return;
  }

  // Lock UI
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Procesando…';
  btn.querySelector('.btn-spinner').style.display = 'inline-block';

  const fd = new FormData();
  fd.append('archivo', f, f.name);

  try {
    const res  = await fetch(api('/productos/excel'), { method: 'POST', body: fd, credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar el archivo');

    renderExcelSummary(data.resumen);

    // Refrescar lista de productos disponibles (para que se vean los nuevos nombres)
    if (currentView === 'productos' && typeof cargarProductosDisponibles === 'function') {
      cargarProductosDisponibles();
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Procesar archivo';
    btn.querySelector('.btn-spinner').style.display = 'none';
  }
}

function renderExcelSummary(r) {
  const cont = document.getElementById('excelSummary');
  cont.innerHTML = '';

  if (r.actualizados > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-success';
    const items = (r.actualizadosList || []).slice(0, 10).map(a =>
      `<li><code>${escapeHtml(a.ref)}</code>${a.fila ? ` <span style="opacity:0.7">(fila ${a.fila})</span>` : ''}</li>`
    ).join('');
    const more = r.actualizadosList && r.actualizadosList.length > 10
      ? `<li style="opacity:0.7">…y ${r.actualizadosList.length - 10} más</li>` : '';
    row.innerHTML = `
      <span class="icon">✅</span>
      <div class="text">
        <strong>${r.actualizados} producto(s) actualizado(s)</strong>
        <ul>${items}${more}</ul>
      </div>
    `;
    cont.appendChild(row);
  }

  if (r.noEncontrados > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-warning';
    const items = (r.noEncontradosList || []).slice(0, 10).map(ref =>
      `<li><code>${escapeHtml(ref)}</code> <span style="opacity:0.7">(no existe en el catálogo)</span></li>`
    ).join('');
    const more = r.noEncontradosList && r.noEncontradosList.length > 10
      ? `<li style="opacity:0.7">…y ${r.noEncontradosList.length - 10} más</li>` : '';
    row.innerHTML = `
      <span class="icon">⚠️</span>
      <div class="text">
        <strong>${r.noEncontrados} referencia(s) no encontrada(s) — no se crearon productos nuevos</strong>
        <ul>${items}${more}</ul>
      </div>
    `;
    cont.appendChild(row);
  }

  if (r.errores > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-error';
    const items = (r.erroresList || []).slice(0, 10).map(e =>
      `<li><code>${escapeHtml(e.ref || ('Fila ' + e.fila))}</code> — ${escapeHtml(e.motivo)}</li>`
    ).join('');
    const more = r.erroresList && r.erroresList.length > 10
      ? `<li style="opacity:0.7">…y ${r.erroresList.length - 10} más</li>` : '';
    row.innerHTML = `
      <span class="icon">❌</span>
      <div class="text">
        <strong>${r.errores} error(es) al procesar</strong>
        <ul>${items}${more}</ul>
      </div>
    `;
    cont.appendChild(row);
  }

  if (r.filasVacias > 0) {
    const row = document.createElement('div');
    row.className = 'upload-summary-row is-warning';
    row.innerHTML = `
      <span class="icon">ℹ️</span>
      <div class="text">
        <strong>${r.filasVacias} fila(s) vacía(s) ignorada(s)</strong>
      </div>
    `;
    cont.appendChild(row);
  }

  if (cont.children.length === 0) {
    cont.innerHTML = `<div class="upload-summary-row is-warning"><span class="icon">ℹ️</span><div class="text"><strong>Nada se actualizó</strong></div></div>`;
  }

  cont.style.display = 'flex';
}

function abrirAgotarProducto(ref) {
  if (!confirm(`¿Marcar el producto "${ref}" como agotado?\n\nSu imagen se moverá a la carpeta "agotados" y dejará de mostrarse en el catálogo público. Podrás reactivarlo después desde la pestaña "Agotados".`)) return;
  agotarProducto(ref);
}

async function agotarProducto(ref) {
  try {
    const res = await fetch(api(`/productos/${encodeURIComponent(ref)}/agotar`), {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al agotar el producto');

    // Refrescar vistas relacionadas
    await Promise.all([
      cargarProductosDisponibles(),
      cargarEstadisticas()
    ]);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ════════════════════════════════
// AGOTADOS (vista dedicada)
// ════════════════════════════════
async function cargarAgotados() {
  const grid = document.getElementById('agotadosGrid');
  if (!grid) return;
  grid.innerHTML = '<p style="text-align:center;color:var(--ink-mute);padding:24px;grid-column:1/-1;">Cargando…</p>';

  try {
    const [resProds, resCats] = await Promise.all([
      fetch(api('/productos'), { credentials: 'include' }),
      fetch(api('/categorias'),  { credentials: 'include' })
    ]);
    if (!resProds.ok) {
      if (resProds.status === 401 || resProds.status === 403) { mostrarLogin(); return; }
      throw new Error('Error al cargar productos');
    }
    const productos  = await resProds.json();
    const categorias = resCats.ok ? await resCats.json() : [];
    cachedProductos = productos;

    renderAgotados(productos, categorias);
  } catch (err) {
    console.error(err);
    grid.innerHTML = '<p style="text-align:center;color:var(--danger);padding:24px;grid-column:1/-1;">Error al cargar agotados</p>';
  }
}

function renderAgotados(productos, categorias) {
  const grid = document.getElementById('agotadosGrid');
  if (!grid) return;

  // Solo agotados: img empieza con "agotados/"
  const agotados = productos.filter(p => p.img && p.img.startsWith('agotados/'));

  if (agotados.length === 0) {
    grid.innerHTML = '<div class="agotados-empty">No hay productos agotados. Cuando un producto se agote, aparecerá aquí.</div>';
    return;
  }

  // Ordenar por ref
  agotados.sort((a, b) => String(a.ref).localeCompare(String(b.ref)));

  grid.innerHTML = agotados.map(p => {
    const cat = categorias.find(c => c.id === p.cat);
    const imgSrc = imgUrl(p.img);
    return `
      <div class="agotado-card">
        <div class="agotado-img-wrap">
          <span class="agotado-badge">Agotado</span>
          <img class="agotado-img" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(p.ref)}" loading="lazy"
               onerror="this.remove(); this.parentElement.classList.add('img-fallback');">
          <span class="agotado-fallback">${cat ? cat.icono : '🚫'}</span>
        </div>
        <div class="agotado-info">
          <div class="agotado-ref">${escapeHtml(p.ref)}</div>
          <div class="agotado-cat">${cat ? cat.icono : '📦'} ${escapeHtml(cat ? cat.nombre : p.cat)}</div>
        </div>
        <div class="agotado-actions">
          <button class="btn btn-ghost btn-sm" onclick="reactivarProducto('${escapeAttr(p.ref)}')" type="button" title="Volver a disponible">↩ Reactivar</button>
          <button class="btn btn-danger btn-sm" onclick="abrirEliminarProductoDef('${escapeAttr(p.ref)}')" type="button" title="Eliminar definitivamente">🗑 Eliminar</button>
        </div>
      </div>
    `;
  }).join('');
}

async function reactivarProducto(ref) {
  if (!confirm(`¿Reactivar el producto "${ref}"?\n\nSu imagen volverá a su categoría original y volverá a mostrarse en el catálogo público.`)) return;
  try {
    const res = await fetch(api(`/productos/${encodeURIComponent(ref)}/reactivar`), {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al reactivar');

    // Refrescar vistas
    await Promise.all([
      cargarAgotados(),
      cargarEstadisticas()
    ]);
    // Si la lista de productos está visible (cargada), refrescarla también
    const grid = document.getElementById('productosListGrid');
    if (grid && currentView === 'productos') {
      cargarProductosDisponibles();
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function abrirEliminarProductoDef(ref) {
  deletingProductoRef = ref;
  document.getElementById('eliminarProdRef').textContent = ref;
  document.getElementById('eliminarProdError').classList.remove('show');
  document.getElementById('eliminarProdError').textContent = '';
  abrirModal('modalEliminarProductoDef');
}

async function confirmarEliminarProductoDef() {
  if (!deletingProductoRef) return;

  const btn   = document.getElementById('btnConfirmarEliminarProdDef');
  const errEl = document.getElementById('eliminarProdError');
  btn.disabled    = true;
  btn.textContent = 'Eliminando…';

  try {
    const res = await fetch(api(`/productos/${encodeURIComponent(deletingProductoRef)}`), {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');

    deletingProductoRef = null;
    cerrarModal('modalEliminarProductoDef');
    await cargarAgotados();
    cargarEstadisticas();
    // Si la lista de productos está visible, refrescarla
    const grid = document.getElementById('productosListGrid');
    if (grid && currentView === 'productos') {
      cargarProductosDisponibles();
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sí, eliminar';
  }
}

// Hook al botón de confirmación del modal de eliminación definitiva
// (se ejecuta al cargar el DOM junto con el resto de setupModals)
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnConfirmarEliminarProdDef');
  if (btn) btn.addEventListener('click', confirmarEliminarProductoDef);
});

// ════════════════════════════════
// PEDIDOS — vendedores + listado de pedidos
// ════════════════════════════════
async function cargarPedidos() {
  console.log('[pedidos] cargando…');
  setupVendedores();
  setupPedidosFiltro();
  try { await actualizarSelectVendedores(); } catch (e) { console.error('[pedidos] select error:', e); }
  await Promise.all([
    cargarVendedores().catch(e => console.error('[pedidos] vendedores error:', e)),
    cargarListadoPedidos().catch(e => console.error('[pedidos] listado error:', e))
  ]);
}

// ─── VENDEDORES ───
async function cargarVendedores() {
  const listEl = document.getElementById('vendedoresList');
  const errEl  = document.getElementById('vendedorError');
  errEl.classList.remove('show');

  try {
    const res = await fetch('/api/vendedores', { credentials: 'include' });
    if (!res.ok) throw new Error('Error al cargar vendedores');
    const vendedores = await res.json();

    if (vendedores.length === 0) {
      listEl.innerHTML = '<p class="pedidos-empty" style="text-align:left;padding:8px 0">No hay vendedores. Agrega el primero.</p>';
    } else {
      listEl.innerHTML = vendedores.map(v => `
        <div class="vendedor-item" data-id="${v.id}">
          <span class="vendedor-nombre">${escapeHtml(v.nombre)}</span>
          <button class="vendedor-remove" data-id="${v.id}" title="Eliminar vendedor">✕</button>
        </div>
      `).join('');
    }

    // Wire delete
    listEl.querySelectorAll('.vendedor-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          const delRes = await fetch(`/api/vendedores/${id}`, {
            method: 'DELETE',
            credentials: 'include'
          });
          if (!delRes.ok) throw new Error('Error al eliminar');
          await cargarVendedores();
          actualizarSelectVendedores();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.add('show');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="pedidos-empty" style="text-align:left;padding:8px 0">Error: ${err.message}</p>`;
  }
}

async function actualizarSelectVendedores() {
  // Actualiza el select del modal público y el filtro de pedidos
  try {
    const res = await fetch('/api/vendedores');
    const vendedores = await res.json();
    const selects = ['pedidosFilterVendedor'];
    selects.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const actual = sel.value;
      sel.innerHTML = '<option value="">Todos los vendedores</option>' +
        vendedores.map(v => `<option value="${escapeHtml(v.nombre)}">${escapeHtml(v.nombre)}</option>`).join('');
      if (actual) sel.value = actual;
    });
  } catch {}
}

function setupVendedores() {
  const btn  = document.getElementById('btnAgregarVendedor');
  const input = document.getElementById('vendedorInput');
  const errEl = document.getElementById('vendedorError');

  if (!btn || btn.dataset.vendWired) return;
  btn.dataset.vendWired = '1';

  async function agregar() {
    const nombre = input.value.trim();
    if (!nombre) {
      errEl.textContent = 'Escribe un nombre de vendedor';
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');
    try {
      const res = await fetch('/api/vendedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nombre })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al agregar');
      }
      input.value = '';
      await cargarVendedores();
      await actualizarSelectVendedores();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    }
  }

  btn.addEventListener('click', agregar);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') agregar(); });
}

// ─── LISTADO DE PEDIDOS ───
async function cargarListadoPedidos() {
  const tbody   = document.getElementById('pedidosListBody');
  const filter  = document.getElementById('pedidosFilterVendedor');
  const vendedor = filter ? filter.value : '';

  try {
    let url = api('/pedidos');
    if (vendedor) url += `?vendedor=${encodeURIComponent(vendedor)}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="pedidos-empty">No autorizado</td></tr>';
      return;
    }
    const pedidos = await res.json();

    // Ordenar por fecha descendente
    pedidos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    if (pedidos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="pedidos-empty">No hay pedidos aún.</td></tr>';
      return;
    }

    const renderedRows = pedidos.map(p => {
      const fecha = new Date(p.fecha).toLocaleDateString('es-CO', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      const itemsCount = Array.isArray(p.items) ? p.items.reduce((s, i) => s + (i.cantidad || 1), 0) : 0;
      const total = p.total || 0;
      const clienteNombre = p.cliente ? p.cliente.nombre : '—';
      const vendedorNombre = p.vendedor || '—';
      return `<tr>
        <td>${escapeHtml(fecha)}</td>
        <td>${escapeHtml(clienteNombre)}</td>
        <td>${escapeHtml(vendedorNombre)}</td>
        <td>${itemsCount}</td>
        <td class="pedidos-total">$${total.toLocaleString('es-CO')}</td>
        <td>
          <span class="pedidos-actions-group">
            <a href="/pedidos/${p.filename}" class="btn btn-ghost btn-sm" target="_blank" download>📄 Ver PDF</a>
            <button type="button" class="btn btn-secondary btn-sm pedido-excel" data-filename="${p.filename}" title="Generar Excel">📊 Excel</button>
            <button type="button" class="btn btn-danger btn-sm pedido-delete" data-filename="${p.filename}" title="Eliminar pedido">Eliminar</button>
          </span>
        </td>
      </tr>`;
    });
    tbody.innerHTML = renderedRows.join('');

    // Wire delete buttons
    tbody.querySelectorAll('.pedido-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const filename = btn.dataset.filename;
        if (!confirm(`¿Eliminar el pedido "${filename}"? Esta acción no se puede deshacer.`)) return;
        try {
          const res = await fetch(api(`/pedidos/${encodeURIComponent(filename)}`), {
            method: 'DELETE',
            credentials: 'include'
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Error al eliminar');
          }
          await cargarListadoPedidos();
        } catch (err) {
          alert('Error: ' + err.message);
        }
      });
    });

    // Wire Excel buttons
    tbody.querySelectorAll('.pedido-excel').forEach(btn => {
      btn.addEventListener('click', async () => {
        const filename = btn.dataset.filename;
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          const res = await fetch(api(`/pedidos/${encodeURIComponent(filename)}/excel`), {
            method: 'POST',
            credentials: 'include'
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Error al generar Excel');
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename.replace(/\.pdf$/i, '.xlsx');
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (err) {
          alert('Error: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = '📊 Excel';
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="pedidos-empty">Error: ${err.message}</td></tr>`;
  }
}

function setupPedidosFiltro() {
  const filter = document.getElementById('pedidosFilterVendedor');
  if (!filter || filter.dataset.pedWired) return;
  filter.dataset.pedWired = '1';
  filter.addEventListener('change', cargarListadoPedidos);
}

// ════════════════════════════════
// DESCARGAS — gestor genérico de árbol de selección
// Usado por los subtabs PDF y Fotos.
// ════════════════════════════════
function isSafari() {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

function createDescargaGestor(config) {
  const {
    selectorId, summaryId, summaryCountId, summaryLeavesId,
    btnGenerateId, btnAllId, btnNoneId, errorId,
    generateUrl, generateBtnText, fallbackFilename,
    extractZipOnNonSafari = false
  } = config;

  const state = {
    arbol: [],
    productos: [],
    seleccionHojas: new Set()
  };

  function contarProductosEnRama(catId, subArr) {
    return state.productos.filter(p => {
      if (!p.cat || p.cat === 'sin-categoria') return false;
      if (!p.img) return false;
      if (p.img.startsWith('agotados/')) return false;
      if (p.cat !== catId) return false;
      const pSub = Array.isArray(p.sub) ? p.sub : [];
      if (subArr.length === 0) return true;
      if (pSub.length < subArr.length) return false;
      for (let i = 0; i < subArr.length; i++) {
        if (pSub[i] !== subArr[i]) return false;
      }
      return true;
    }).length;
  }

  function renderNodoHtml(nodo, pathArr) {
    const key         = pathArr.join('|');
    const catId       = pathArr[0];
    const subArr      = pathArr.slice(1);
    const tieneHijos  = Array.isArray(nodo.subcategorias) && nodo.subcategorias.length > 0;

    const count = tieneHijos
      ? nodo.subcategorias.reduce(
          (sum, s) => sum + contarProductosEnRama(catId, [...subArr, s.id]),
          0
        )
      : contarProductosEnRama(catId, subArr);

    const isLeaf    = !tieneHijos;
    const disabled  = count === 0 ? 'disabled' : '';
    const countCls  = count === 0 ? 'is-zero' : '';

    let html = `
      <div class="pdf-node">
        <label class="pdf-check">
          <input type="checkbox"
                 data-key="${escapeAttr(key)}"
                 data-has-children="${tieneHijos ? '1' : '0'}"
                 data-leaf="${isLeaf ? '1' : '0'}"
                 ${disabled}>
        </label>
        <span class="pdf-node-label">
          <span class="pdf-node-icon">${nodo.icono || '📦'}</span>
          <span class="pdf-node-name">${escapeHtml(nodo.nombre)}</span>
          <span class="pdf-node-count ${countCls}">${count}</span>
        </span>
      </div>
    `;

    if (tieneHijos) {
      const childrenHtml = nodo.subcategorias
        .map(s => renderNodoHtml(s, [...pathArr, s.id]))
        .join('');
      html += `<div class="pdf-node-children">${childrenHtml}</div>`;
    }

    return html;
  }

  async function cargarArbol() {
    const cont = document.getElementById(selectorId);
    cont.innerHTML = '<p class="pdf-selector-loading">Cargando categorías…</p>';

    try {
      const [resCats, resProds] = await Promise.all([
        fetch(api('/categorias'), { credentials: 'include' }),
        fetch(api('/productos'),   { credentials: 'include' })
      ]);
      if (!resCats.ok)  throw new Error('Error al cargar categorías');
      if (!resProds.ok) throw new Error('Error al cargar productos');

      state.arbol     = await resCats.json();
      state.productos = await resProds.json();
      state.seleccionHojas = new Set();

      renderArbol();
    } catch (err) {
      console.error(`[${selectorId}] Error cargando datos:`, err);
      cont.innerHTML = '<p class="pdf-selector-empty">Error al cargar. Recarga la pestaña.</p>';
    }
  }

  function renderArbol() {
    const cont = document.getElementById(selectorId);
    const catsVisibles = state.arbol.filter(c => c.id !== 'sin-categoria');

    if (catsVisibles.length === 0) {
      cont.innerHTML = '<p class="pdf-selector-empty">No hay categorías para mostrar.</p>';
      return;
    }

    cont.innerHTML = catsVisibles.map(cat => renderNodoHtml(cat, [cat.id])).join('');

    cont.querySelectorAll('.pdf-check input').forEach(input => {
      input.addEventListener('change', onCheckChange);
    });

    actualizarResumen();
  }

  function onCheckChange(e) {
    const input       = e.target;
    const key         = input.dataset.key;
    const hasChildren = input.dataset.hasChildren === '1';
    const isChecked   = input.checked;

    if (input.disabled) {
      input.checked = false;
      return;
    }

    if (hasChildren) {
      setDescendantsChecked(key, isChecked);
    } else {
      if (isChecked) {
        state.seleccionHojas.add(key);
      } else {
        state.seleccionHojas.delete(key);
      }
    }

    input.indeterminate = false;
    updateAncestorsState();
    actualizarResumen();
  }

  function setDescendantsChecked(parentKey, isChecked) {
    const cont   = document.getElementById(selectorId);
    const inputs = cont.querySelectorAll(`.pdf-check input[data-key^="${CSS.escape(parentKey)}|"]`);

    inputs.forEach(child => {
      if (child.disabled) return;
      child.checked       = isChecked;
      child.indeterminate = false;
      if (child.dataset.leaf === '1') {
        if (isChecked) {
          state.seleccionHojas.add(child.dataset.key);
        } else {
          state.seleccionHojas.delete(child.dataset.key);
        }
      }
    });
  }

  function updateAncestorsState() {
    const cont   = document.getElementById(selectorId);
    const inputs = cont.querySelectorAll('.pdf-check input[data-has-children="1"]');

    inputs.forEach(input => {
      const key        = input.dataset.key;
      const leafInputs = cont.querySelectorAll(
        `.pdf-check input[data-leaf="1"][data-key^="${CSS.escape(key)}|"]`
      );

      let checked = 0, total = 0;
      leafInputs.forEach(leaf => {
        if (leaf.disabled) return;
        total++;
        if (leaf.checked) checked++;
      });

      input.checked       = total > 0 && checked === total;
      input.indeterminate = checked > 0 && checked < total;
    });
  }

  function marcarTodo() {
    const cont = document.getElementById(selectorId);
    cont.querySelectorAll('.pdf-check input').forEach(input => {
      if (input.disabled) return;
      input.checked       = true;
      input.indeterminate = false;
      if (input.dataset.leaf === '1') {
        state.seleccionHojas.add(input.dataset.key);
      }
    });
    updateAncestorsState();
    actualizarResumen();
  }

  function desmarcarTodo() {
    state.seleccionHojas.clear();
    const cont = document.getElementById(selectorId);
    cont.querySelectorAll('.pdf-check input').forEach(input => {
      input.checked       = false;
      input.indeterminate = false;
    });
    actualizarResumen();
  }

  function actualizarResumen() {
    const summary  = document.getElementById(summaryId);
    const countEl  = document.getElementById(summaryCountId);
    const leavesEl = document.getElementById(summaryLeavesId);

    let totalProductos = 0;
    for (const key of state.seleccionHojas) {
      const parts  = key.split('|');
      const catId  = parts[0];
      const subArr = parts.slice(1);
      totalProductos += contarProductosEnRama(catId, subArr);
    }

    if (state.seleccionHojas.size === 0) {
      summary.style.display = 'none';
    } else {
      summary.style.display = '';
      countEl.textContent  = totalProductos;
      leavesEl.textContent = state.seleccionHojas.size;
    }

    const btn = document.getElementById(btnGenerateId);
    if (btn) btn.disabled = state.seleccionHojas.size === 0;
  }

  async function generar() {
    const btn    = document.getElementById(btnGenerateId);
    const errEl  = document.getElementById(errorId);
    errEl.textContent = '';
    errEl.classList.remove('show');

    if (state.seleccionHojas.size === 0) {
      errEl.textContent = 'Selecciona al menos una hoja';
      errEl.classList.add('show');
      return;
    }

    const seleccion = Array.from(state.seleccionHojas).map(key => {
      const parts = key.split('|');
      return { cat: parts[0], sub: parts.slice(1) };
    });

    btn.disabled = true;
    const spinner = btn.querySelector('.btn-spinner');
    const btnText = btn.querySelector('.btn-text');
    btnText.textContent = 'Generando…';
    if (spinner) spinner.style.display = 'inline-block';

    try {
      const res = await fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ seleccion })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al generar la descarga');
      }

      const blob = await res.blob();

      if (extractZipOnNonSafari && !isSafari()) {
        const zip      = await JSZip.loadAsync(blob);
        const entries  = [];
        zip.forEach((relPath, zipEntry) => entries.push({ relPath, zipEntry }));
        btnText.textContent = `Extrayendo ${entries.length} foto(s)…`;
        for (const { relPath, zipEntry } of entries) {
          const imgBlob = await zipEntry.async('blob');
          const imgUrl  = URL.createObjectURL(imgBlob);
          const a       = document.createElement('a');
          a.href        = imgUrl;
          a.download    = relPath;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(imgUrl);
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        const dispo = res.headers.get('Content-Disposition') || '';
        const match = dispo.match(/filename="(.+)"/);
        const url   = URL.createObjectURL(blob);
        const a     = document.createElement('a');
        a.href      = url;
        a.download  = match ? match[1] : fallbackFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btnText.textContent = generateBtnText;
      if (spinner) spinner.style.display = 'none';
      actualizarResumen();
    }
  }

  function setup() {
    const btnGen  = document.getElementById(btnGenerateId);
    const btnAll  = document.getElementById(btnAllId);
    const btnNone = document.getElementById(btnNoneId);

    if (btnGen && !btnGen.dataset.wired) {
      btnGen.addEventListener('click', generar);
      btnGen.dataset.wired = '1';
    }
    if (btnAll && !btnAll.dataset.wired) {
      btnAll.addEventListener('click', marcarTodo);
      btnAll.dataset.wired = '1';
    }
    if (btnNone && !btnNone.dataset.wired) {
      btnNone.addEventListener('click', desmarcarTodo);
      btnNone.dataset.wired = '1';
    }

    cargarArbol();
  }

  return { setup, state, marcarTodo, desmarcarTodo, generar };
}

// Instancias del gestor para cada subtab
let pdfGestor;
let fotosGestor;

// Inicialización diferida en cargarDescargas()
function initGestores() {
  if (pdfGestor) return;
  pdfGestor = createDescargaGestor({
    selectorId:       'pdfSelector',
    summaryId:        'pdfSummary',
    summaryCountId:   'pdfSummaryCount',
    summaryLeavesId:  'pdfSummaryLeaves',
    btnGenerateId:    'btnPdfGenerar',
    btnAllId:         'btnPdfMarcarTodo',
    btnNoneId:        'btnPdfDesmarcarTodo',
    errorId:          'pdfError',
    generateUrl:      api('/descargas/pdf'),
    generateBtnText:  '📄 Generar PDF',
    fallbackFilename: `catalogo-${currentBrand}.pdf`
  });

  fotosGestor = createDescargaGestor({
    selectorId:            'fotosSelector',
    summaryId:             'fotosSummary',
    summaryCountId:        'fotosSummaryCount',
    summaryLeavesId:       'fotosSummaryLeaves',
    btnGenerateId:         'btnFotosGenerar',
    btnAllId:              'btnFotosMarcarTodo',
    btnNoneId:             'btnFotosDesmarcarTodo',
    errorId:               'fotosError',
    generateUrl:           api('/descargas/fotos'),
    generateBtnText:       '🖼️ Descargar fotos',
    fallbackFilename:      `fotos-${currentBrand}.zip`,
    extractZipOnNonSafari: true
  });
}

// cargarDescargas() ahora usa los gestores
// (definido arriba en la sección DESCARGAS)

// ════════════════════════════════
// VIDEOS — gestión desde Dashboard
// ════════════════════════════════
async function cargarRedes() {
  await cargarListadoVideos();
  setupVideosForm();
}

async function cargarListadoVideos() {
  const listEl = document.getElementById('videosList');
  const errEl  = document.getElementById('videosError');
  errEl.classList.remove('show');
  try {
    const res = await fetch(api('/videos'));
    const videos = await res.json();
    if (videos.length === 0) {
      listEl.innerHTML = '<p class="pedidos-empty" style="margin:0">No hay videos. Sube el primero.</p>';
      return;
    }
    listEl.innerHTML = videos.map(v => `
      <div class="video-item">
        <video src="${v.url}" controls preload="metadata" style="width:200px;border-radius:8px;max-height:120px;background:#000"></video>
        <span class="video-filename" title="${escapeHtml(v.filename)}">${escapeHtml(v.filename)}</span>
        <button type="button" class="video-delete" data-filename="${v.filename}" title="Eliminar">✕</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.video-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este video?')) return;
        try {
          const res = await fetch(api(`/videos/${btn.dataset.filename}`), {
            method: 'DELETE',
            credentials: 'include'
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Error al eliminar');
          }
          await cargarListadoVideos();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.add('show');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="pedidos-empty" style="margin:0">Error: ${err.message}</p>`;
  }
}

function setupVideosForm() {
  const btn     = document.getElementById('btnSubirVideo');
  const input   = document.getElementById('videoFileInput');
  const errEl   = document.getElementById('videosError');
  const selBtn  = document.getElementById('btnSeleccionarVideo');
  const nameEl  = document.getElementById('videoFileName');
  if (!btn || btn.dataset.vidWired) return;
  btn.dataset.vidWired = '1';

  selBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    nameEl.textContent = input.files[0] ? input.files[0].name : 'Ningún archivo seleccionado';
  });

  async function subir() {
    const file = input.files[0];
    if (!file) {
      errEl.textContent = 'Selecciona un archivo de video';
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = '⏳ Subiendo…';
    try {
      const fd = new FormData();
      fd.append('video', file);
      const res = await fetch(api('/videos'), {
        method: 'POST',
        credentials: 'include',
        body: fd
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al subir');
      }
      input.value = '';
      nameEl.textContent = 'Ningún archivo seleccionado';
      await cargarListadoVideos();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = '+ Subir video';
    }
  }

  btn.addEventListener('click', subir);
}
