/* ════════════════════════════════
   INFINITY — APP.JS
   Carga datos desde el backend (/api/*)
   ════════════════════════════════ */

// ════════════════════════════════
// ESTADO
// ════════════════════════════════
let categorias = [];
let productos  = [];

// Identifica la marca del catálogo actual (usado para taggear items del carrito)
const CURRENT_BRAND = 'infinity';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
let catActiva  = 'todos';
let subActiva  = [];   // [nivel0, nivel1, ...] — null = "Todos" en ese nivel
let busqueda   = '';
let cargando   = true;

// ════════════════════════════════
// CARGA DE DATOS
// ════════════════════════════════
async function cargarRedes() {
  try {
    const res = await fetch('/api/videos');
    const videos = await res.json();
    const grid = document.getElementById('redesGrid');
    if (videos.length === 0) { grid.innerHTML = ''; return; }

    grid.innerHTML = videos.map(v => `
      <div class="video-card">
        <video src="${v.url}" controls preload="metadata" playsinline></video>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error cargando videos:', err);
  }
}

async function cargarDatos() {
  try {
    const [resCats, resProds] = await Promise.all([
      fetch('/api/infinity/categorias'),
      fetch('/api/infinity/productos')
    ]);

    if (!resCats.ok)  throw new Error('No se pudieron cargar las categorías');
    if (!resProds.ok) throw new Error('No se pudieron cargar los productos');

    categorias = await resCats.json();
    productos  = await resProds.json();

    cargando = false;
    renderTags();
    renderProductos();
  } catch (err) {
    console.error('Error cargando datos:', err);
    cargando = false;
    const grid = document.getElementById('productos');
    const cont = document.getElementById('contador');
    cont.textContent = '';
    grid.innerHTML = `
      <div class="error-state">
        <p>😕 No pudimos cargar el catálogo</p>
        <p class="error-detalle">${err.message}</p>
        <button class="btn btn-primary" onclick="location.reload()">Reintentar</button>
      </div>`;
  }
}

// ════════════════════════════════
// HELPERS DE FILTRADO POR SUBRAMA
// ════════════════════════════════

// Devuelve los productos que matchean la rama actual (cat + sub[niveles anteriores])
// y cuyo sub[i] === id. Sirve para contar/mostrar subcats con productos.
function productosEnNivel(catId, nivelesPrevios, idNivel) {
  return productos.filter(p => {
    if (!p || p.cat !== catId) return false;
    if (p.img && p.img.startsWith('agotados/')) return false;
    // El sub del producto debe tener al menos la longitud de nivelesPrevios + 1
    const sub = Array.isArray(p.sub) ? p.sub : [];
    if (sub.length < nivelesPrevios.length + 1) return false;
    // Coincidir con los niveles previos
    for (let i = 0; i < nivelesPrevios.length; i++) {
      if (sub[i] !== nivelesPrevios[i]) return false;
    }
    // El nivel actual debe ser este id
    return sub[nivelesPrevios.length] === idNivel;
  });
}

// Devuelve el nodo del árbol (categoría o subcat) según el path
function getNodo(catId, niveles) {
  const cat = categorias.find(c => c.id === catId);
  if (!cat) return null;
  let nodo = cat;
  for (const id of niveles) {
    if (!Array.isArray(nodo.subcategorias)) return null;
    const sig = nodo.subcategorias.find(s => s.id === id);
    if (!sig) return null;
    nodo = sig;
  }
  return nodo;
}

// ════════════════════════════════
// RENDER TAGS FILTROS (multinivel)
// ════════════════════════════════
function renderTags() {
  const cont = document.getElementById('filtrosTags');
  cont.innerHTML = '';

  // ——— Nivel 0: Categorías ———
  const catsVisibles = categorias.filter(c => c.id !== 'sin-categoria');
  const nivel0 = document.createElement('div');
  nivel0.className = 'filtros-tags filtros-nivel';
  nivel0.innerHTML =
    `<button class="tag ${catActiva === 'todos' ? 'active' : ''}" data-nivel="0" data-id="todos">Todos</button>` +
    catsVisibles.map(cat => {
      const tieneSubcats = Array.isArray(cat.subcategorias) && cat.subcategorias.length > 0;
      // Solo mostrar la categoría como tag si tiene productos directos O tiene subcats con productos
      if (tieneSubcats) {
        // No renderizar la categoría como "hoja" — sus subcats la cubren
        // PERO si alguna subcat es hoja con productos, sí tiene sentido mostrarla igual
        // porque al hacer click se entra al nivel 1
      }
      return `<button class="tag ${catActiva === cat.id ? 'active' : ''}" data-nivel="0" data-id="${cat.id}">
        <span class="tag-icon">${cat.icono || '📦'}</span> ${cat.nombre}
      </button>`;
    }).join('');
  cont.appendChild(nivel0);

  // ——— Niveles 1+ : subcategorías (solo si catActiva está elegida) ———
  if (catActiva !== 'todos') {
    const cat = categorias.find(c => c.id === catActiva);
    if (cat && Array.isArray(cat.subcategorias) && cat.subcategorias.length > 0) {
      renderNivelSub(cont, cat, [], 1);
    }
  }

  // Wire click handlers
  cont.querySelectorAll('.tag').forEach(tag => {
    tag.addEventListener('click', () => onTagClick(parseInt(tag.dataset.nivel, 10), tag.dataset.id));
  });
}

// Renderiza un nivel de subcategorías. `previos` = niveles ya elegidos arriba.
function renderNivelSub(cont, nodo, previos, nivel) {
  if (!Array.isArray(nodo.subcategorias) || nodo.subcategorias.length === 0) return;

  // Subcats que tienen productos en este nivel o cuyas sub-subs tienen productos
  const subsVisibles = nodo.subcategorias.filter(s => {
    const tieneSubSub = Array.isArray(s.subcategorias) && s.subcategorias.length > 0;
    if (tieneSubSub) {
      // Esta subcat NO recibe productos directamente. Mostrar solo si ALGUNA
      // de sus sub-subs tiene productos.
      return s.subcategorias.some(ss =>
        productosEnNivel(catActiva, [...previos, s.id], ss.id).length > 0
      );
    } else {
      // Hoja: recibe productos. Mostrar si tiene al menos uno.
      return productosEnNivel(catActiva, [...previos], s.id).length > 0;
    }
  });

  if (subsVisibles.length === 0) return;

  const nivelEl = document.createElement('div');
  nivelEl.className = 'filtros-tags filtros-nivel';
  const idTodos = `__all_${nivel}`;
  nivelEl.innerHTML =
    `<span class="filtros-nivel-label">${escapeHtml(nodo.nombre || '')}</span>` +
    `<button class="tag ${subActiva[nivel - 1] == null ? 'active' : ''}" data-nivel="${nivel}" data-id="${idTodos}">Todos</button>` +
    subsVisibles.map(s => {
      const esActivo = subActiva[nivel - 1] === s.id;
      return `<button class="tag ${esActivo ? 'active' : ''}" data-nivel="${nivel}" data-id="${s.id}">
        <span class="tag-icon">${s.icono || '📂'}</span> ${escapeHtml(s.nombre)}
      </button>`;
    }).join('');
  cont.appendChild(nivelEl);

  // Si la subcat activa tiene sub-subs, renderizar el siguiente nivel
  if (subActiva[nivel - 1]) {
    const subActivaNodo = nodo.subcategorias.find(s => s.id === subActiva[nivel - 1]);
    if (subActivaNodo && Array.isArray(subActivaNodo.subcategorias) && subActivaNodo.subcategorias.length > 0) {
      renderNivelSub(cont, subActivaNodo, [...previos, subActiva[nivel - 1]], nivel + 1);
    }
  }
}

function onTagClick(nivel, id) {
  if (nivel === 0) {
    if (id === 'todos') {
      catActiva = 'todos';
    } else {
      catActiva = id;
    }
    subActiva = [];   // reset sub al cambiar categoría
  } else {
    if (id.startsWith('__all_')) {
      subActiva[nivel - 1] = null;
    } else {
      subActiva[nivel - 1] = id;
    }
    // Resetear niveles más profundos
    subActiva = subActiva.slice(0, nivel);
    // Rellenar con null hasta el nivel actual
    while (subActiva.length < nivel) subActiva.push(null);
  }
  renderTags();
  renderProductos();
}

function sincronizarTag(cat) {
  // Legacy — mantenido por compatibilidad, pero ya no se usa
  document.querySelectorAll('.tag').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === cat);
  });
}

// ════════════════════════════════
// RENDER PRODUCTOS
// ════════════════════════════════
function renderProductos() {
  const grid     = document.getElementById('productos');
  const empty    = document.getElementById('emptyState');
  const contador = document.getElementById('contador');

  let filtrados = productos.filter(p =>
    p.cat &&
    p.cat !== 'sin-categoria' &&
    (!p.img || !p.img.startsWith('agotados/'))
  );

  if (catActiva !== 'todos') {
    filtrados = filtrados.filter(p => {
      if (p.cat !== catActiva) return false;
      // Validar que la cadena de sub coincida
      const sub = Array.isArray(p.sub) ? p.sub : [];
      for (let i = 0; i < subActiva.length; i++) {
        if (subActiva[i] != null && sub[i] !== subActiva[i]) return false;
      }
      return true;
    });
  }

  if (busqueda.trim()) {
    const q = busqueda.toLowerCase();
    filtrados = filtrados.filter(p =>
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.desc   || '').toLowerCase().includes(q) ||
      (p.cat    || '').toLowerCase().includes(q) ||
      (p.ref    || '').toLowerCase().includes(q)
    );
  }

  contador.textContent = filtrados.length === 1
    ? 'Mostrando 1 producto'
    : `Mostrando ${filtrados.length} productos`;

  if (filtrados.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  grid.innerHTML = filtrados.map((p, i) => {
    const cat = categorias.find(c => c.id === p.cat);
    const nombre = p.nombre || p.ref || 'Sin nombre';
    const desc   = p.desc || '';
    const ref    = p.ref || '';
    const precio = (p.precio !== undefined && p.precio !== null && p.precio !== '')
      ? `$${Number(p.precio).toLocaleString('es-CO')}`
      : '—';
    const imgSrc = p.img
      ? (p.img.startsWith('/') ? p.img : (/^(infinity|kohell)\//.test(p.img) ? `/Imagenes/${p.img}` : `/Imagenes/infinity/${p.img}`))
      : '';
    const mostrarRef = Boolean(desc && ref);
    return `
      <article class="producto-card" style="animation-delay: ${i * 0.04}s">
        <div class="producto-img" data-img-open data-ref="${p.ref}">
          <span class="producto-cat">${cat ? cat.nombre : p.cat}</span>
          <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(nombre)}" loading="lazy"
               onerror="this.remove(); this.parentElement.classList.add('img-fallback');">
          <span class="producto-fallback">${cat ? cat.icono : '📦'}</span>
        </div>
        <div class="producto-info">
          <h3 class="producto-nombre">${escapeHtml(nombre)}</h3>
          ${desc ? `<p class="producto-desc">${escapeHtml(desc)}</p>` : ''}
          ${mostrarRef ? `<div class="producto-ref">${escapeHtml(ref)}</div>` : ''}
          <div class="producto-precio">${precio}</div>
          <div class="producto-card-add">
            <div class="qty-stepper producto-card-qty" data-ref="${p.ref}">
              <button type="button" class="qty-stepper-btn" data-qty-dec aria-label="Disminuir cantidad">−</button>
              <input type="number" class="qty-stepper-input" value="1" min="1" max="99" aria-label="Cantidad">
              <button type="button" class="qty-stepper-btn" data-qty-inc aria-label="Aumentar cantidad">+</button>
            </div>
            <button class="producto-card-add-btn" data-ref="${p.ref}"
                    data-nombre="${escapeHtml(nombre)}"
                    data-precio="${p.precio ?? ''}">
              + Agregar
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  wireAddToCart();
}

// ════════════════════════════════
// BUSCADOR
// ════════════════════════════════
function setupSearch() {
  const input = document.getElementById('searchInput');
  const clear = document.getElementById('searchClear');

  input.addEventListener('input', e => {
    busqueda = e.target.value;
    clear.style.display = busqueda ? 'flex' : 'none';
    renderProductos();
  });

  clear.addEventListener('click', () => {
    input.value = '';
    busqueda = '';
    clear.style.display = 'none';
    renderProductos();
    input.focus();
  });

  document.getElementById('btnLimpiar').addEventListener('click', () => {
    input.value = '';
    busqueda = '';
    catActiva = 'todos';
    sincronizarTag('todos');
    clear.style.display = 'none';
    renderProductos();
  });
}

// ════════════════════════════════
// NAVBAR MOBILE
// ════════════════════════════════
function setupNav() {
  const toggle = document.getElementById('navToggle');
  const links  = document.getElementById('navLinks');

  toggle.addEventListener('click', () => {
    links.classList.toggle('open');
  });

  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => links.classList.remove('open'));
  });
}

// ════════════════════════════════
// CARRITO DE COMPRAS
// ════════════════════════════════
const CARRITO_KEY = 'infinity_carrito';
let carrito = cargarCarrito(); // { ref, nombre, precio, cantidad }

function guardarCarrito() {
  try {
    localStorage.setItem(CARRITO_KEY, JSON.stringify(carrito));
  } catch (err) {
    console.error('Error guardando carrito:', err);
  }
}

function cargarCarrito() {
  try {
    const raw = localStorage.getItem(CARRITO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Compatibilidad: si un item no tiene marca, se asume 'infinity' (compat con carritos viejos)
    return parsed.filter(i => i && typeof i === 'object' && i.ref && i.nombre && typeof i.precio === 'number')
                 .map(i => ({ ...i, marca: (i.marca === 'kohell' || i.marca === 'infinity') ? i.marca : 'infinity' }));
  } catch (err) {
    console.error('Error cargando carrito:', err);
    return [];
  }
}

function limpiarCarrito() {
  carrito = [];
  guardarCarrito();
  actualizarBadge();
}

function actualizarBadge() {
  const total = carrito.reduce((s, i) => s + i.cantidad, 0);
  const badge = document.getElementById('cartBadge');
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
}

function actualizarTotal() {
  const total = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
  document.querySelector('#cartTotal strong').textContent =
    total > 0 ? `$${total.toLocaleString('es-CO')}` : '$0';
  document.getElementById('cartPdfBtn').disabled = carrito.length === 0;
}

function renderCarritoModal() {
  const body = document.getElementById('cartBody');
  if (carrito.length === 0) {
    body.innerHTML = '<p class="cart-empty">El carrito está vacío.</p>';
    actualizarTotal();
    return;
  }

  const totalGeneral = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);

  body.innerHTML = `<div class="cart-items">
    ${carrito.map((item, idx) => {
      const subtotal = item.precio * item.cantidad;
      const esInfinity = item.marca === 'infinity';
      const badgeClass = esInfinity ? 'cart-item-badge cart-item-badge-infinity' : 'cart-item-badge cart-item-badge-kohell';
      const badgeText  = esInfinity ? '∞ Infinity' : 'Kohell';
      return `<div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.nombre)}</div>
          <div class="cart-item-ref">${escapeHtml(item.ref)} — $${(item.precio || 0).toLocaleString('es-CO')} c/u</div>
        </div>
        <div class="cart-item-controls">
          <button class="cart-item-qty-btn" data-cart-dec="${idx}">−</button>
          <span class="cart-item-qty">${item.cantidad}</span>
          <button class="cart-item-qty-btn" data-cart-inc="${idx}">+</button>
        </div>
        <div class="cart-item-subtotal">$${subtotal.toLocaleString('es-CO')}</div>
        <span class="${badgeClass}" title="Marca del producto">${badgeText}</span>
        <button class="cart-item-remove" data-cart-remove="${idx}" title="Eliminar">✕</button>
      </div>`;
    }).join('')}
  </div>`;

  body.querySelectorAll('[data-cart-inc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.cartInc, 10);
      carrito[idx].cantidad++;
      guardarCarrito();
      renderCarritoModal();
      actualizarBadge();
    });
  });

  body.querySelectorAll('[data-cart-dec]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.cartDec, 10);
      if (carrito[idx].cantidad > 1) {
        carrito[idx].cantidad--;
      } else {
        carrito.splice(idx, 1);
      }
      guardarCarrito();
      renderCarritoModal();
      actualizarBadge();
    });
  });

  body.querySelectorAll('[data-cart-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.cartRemove, 10);
      carrito.splice(idx, 1);
      guardarCarrito();
      renderCarritoModal();
      actualizarBadge();
    });
  });

  actualizarTotal();
}

// Modales
function abrirModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

function setupCartModals() {
  // FAB → abrir carrito
  document.getElementById('cartFab').addEventListener('click', () => {
    renderCarritoModal();
    abrirModal('cartModal');
  });

  // Cerrar carrito
  document.querySelectorAll('[data-cart-close]').forEach(el => {
    el.addEventListener('click', () => cerrarModal('cartModal'));
  });

  // Cerrar pedido
  document.querySelectorAll('[data-order-close]').forEach(el => {
    el.addEventListener('click', () => cerrarModal('orderModal'));
  });

  // Vaciar carrito
  document.getElementById('cartClearBtn').addEventListener('click', () => {
    limpiarCarrito();
    renderCarritoModal();
  });

  // Generar PDF → abrir formulario
  document.getElementById('cartPdfBtn').addEventListener('click', async () => {
    cerrarModal('cartModal');
    document.getElementById('orderForm').reset();
    document.getElementById('orderError').classList.remove('show');

    // Cargar vendedores en el select
    const sel = document.getElementById('orderVendedor');
    sel.innerHTML = '<option value="">Selecciona un vendedor</option>';
    try {
      const res = await fetch('/api/vendedores');
      if (res.ok) {
        const vendedores = await res.json();
        vendedores.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.nombre;
          opt.textContent = v.nombre;
          sel.appendChild(opt);
        });
      }
    } catch {}

    abrirModal('orderModal');
  });

  // Enviar pedido
  document.getElementById('orderSubmitBtn').addEventListener('click', enviarPedido);

  // Enter en el formulario también envía
  document.getElementById('orderForm').addEventListener('submit', e => {
    e.preventDefault();
    enviarPedido();
  });
}

async function enviarPedido() {
  const nombre    = document.getElementById('orderNombre').value.trim();
  const ciudad    = document.getElementById('orderCiudad').value.trim();
  const telefono  = document.getElementById('orderTelefono').value.trim();
  const direccion = document.getElementById('orderDireccion').value.trim();
  const vendedor  = document.getElementById('orderVendedor').value;
  const errEl     = document.getElementById('orderError');

  if (!nombre || !ciudad || !telefono || !direccion || !vendedor) {
    errEl.textContent = 'Todos los campos son obligatorios';
    errEl.classList.add('show');
    return;
  }

  errEl.classList.remove('show');

  const btn    = document.getElementById('orderSubmitBtn');
  const textEl = btn.querySelector('.btn-text');
  const spin   = btn.querySelector('.btn-spinner');
  btn.disabled = true;
  textEl.textContent = 'Generando…';
  spin.style.display = 'inline-block';

  try {
    const res = await fetch('/api/pedidos/generar-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: carrito.map(i => ({ ref: i.ref, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, marca: i.marca })),
        cliente: { nombre, ciudad, telefono, direccion },
        vendedor
      })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al generar el pedido');
    }

    // Descargar PDF
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;

    const dispo = res.headers.get('Content-Disposition') || '';
    const match = dispo.match(/filename="(.+)"/);
    a.download  = match ? match[1] : `pedido-${Date.now()}.pdf`;

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // Limpiar carrito y cerrar modal
    limpiarCarrito();
    cerrarModal('orderModal');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    textEl.textContent = '✅ Generar pedido';
    spin.style.display = 'none';
  }
}

// Wire add-to-cart buttons después de renderizar productos
function agregarProductoAlCarrito(ref, nombre, precio, cantidad = 1) {
  if (!cantidad || cantidad < 1) return false;

  if (!precio || isNaN(precio)) {
    return false;
  }

  const existente = carrito.find(i => i.ref === ref);
  if (existente) {
    existente.cantidad += cantidad;
  } else {
    carrito.push({ ref, nombre, precio, cantidad, marca: CURRENT_BRAND });
  }

  guardarCarrito();
  actualizarBadge();
  return true;
}

function wireAddToCart() {
  document.querySelectorAll('.producto-card .qty-stepper').forEach(stepper => {
    if (stepper.dataset.qtyWired) return;
    stepper.dataset.qtyWired = '1';

    const input = stepper.querySelector('.qty-stepper-input');
    const decBtn = stepper.querySelector('[data-qty-dec]');
    const incBtn = stepper.querySelector('[data-qty-inc]');

    const clamp = () => {
      let v = parseInt(input.value, 10) || 1;
      if (v < 1) v = 1;
      if (v > 99) v = 99;
      input.value = v;
    };

    decBtn.addEventListener('click', () => {
      let v = parseInt(input.value, 10) || 1;
      if (v > 1) input.value = v - 1;
    });

    incBtn.addEventListener('click', () => {
      let v = parseInt(input.value, 10) || 1;
      if (v < 99) input.value = v + 1;
    });

    input.addEventListener('change', clamp);
    input.addEventListener('blur', clamp);
  });

  document.querySelectorAll('.producto-card-add-btn').forEach(btn => {
    if (btn.dataset.cartWired) return;
    btn.dataset.cartWired = '1';

    btn.addEventListener('click', () => {
      const ref     = btn.dataset.ref;
      const nombre  = btn.dataset.nombre;
      const precio  = parseFloat(btn.dataset.precio);
      const stepper = btn.closest('.producto-card-add')?.querySelector('.qty-stepper');
      const input   = stepper ? stepper.querySelector('.qty-stepper-input') : null;
      const cantidad = input ? parseInt(input.value, 10) : 1;

      const ok = agregarProductoAlCarrito(ref, nombre, precio, cantidad);
      if (!ok) {
        const orig = btn.textContent;
        btn.textContent = '⚠ Sin precio';
        btn.style.opacity = '0.7';
        setTimeout(() => { btn.textContent = orig; btn.style.opacity = '1'; }, 1500);
        return;
      }

      if (input) input.value = 1;
      const original = btn.textContent;
      btn.textContent = '✓ Agregado';
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
  });
}

let currentImageModalProduct = null;

function setupImageModal() {
  const modal      = document.getElementById('imageModal');
  const img        = document.getElementById('imageModalImg');
  const catEl      = document.getElementById('imageModalCat');
  const nameEl     = document.getElementById('imageModalName');
  const descEl     = document.getElementById('imageModalDesc');
  const priceEl    = document.getElementById('imageModalPrice');
  const qtyInput   = document.getElementById('imageModalQty');
  const addBtn     = document.getElementById('imageModalAddBtn');

  document.querySelectorAll('[data-image-close]').forEach(el => {
    el.addEventListener('click', () => cerrarModal('imageModal'));
  });

  document.getElementById('productos').addEventListener('click', e => {
    const opener = e.target.closest('[data-img-open]');
    if (!opener) return;

    const ref = opener.dataset.ref;
    const p = productos.find(x => x.ref === ref);
    if (!p) return;

    currentImageModalProduct = p;
    const cat = categorias.find(c => c.id === p.cat);
    const nombre = p.nombre || p.ref || 'Sin nombre';
    const desc   = p.desc || '';
    const precio = (p.precio !== undefined && p.precio !== null && p.precio !== '')
      ? `$${Number(p.precio).toLocaleString('es-CO')}`
      : '—';
    const imgSrc = p.img
      ? (p.img.startsWith('/') ? p.img : (/^(infinity|kohell)\//.test(p.img) ? `/Imagenes/${p.img}` : `/Imagenes/infinity/${p.img}`))
      : '';

    img.src = escapeHtml(imgSrc);
    img.alt = escapeHtml(nombre);
    catEl.textContent = cat ? cat.nombre : (p.cat || '');
    nameEl.textContent = nombre;
    descEl.textContent = desc;
    descEl.style.display = desc ? 'block' : 'none';
    priceEl.textContent = precio;
    qtyInput.value = 1;

    addBtn.disabled = !p.precio;
    addBtn.textContent = p.precio ? '+ Agregar al carrito' : 'Sin precio';

    abrirModal('imageModal');
  });

  const qtyDec = document.getElementById('imageModalQtyStepper')?.querySelector('[data-qty-dec]');
  const qtyInc = document.getElementById('imageModalQtyStepper')?.querySelector('[data-qty-inc]');

  const clampQty = () => {
    let v = parseInt(qtyInput.value, 10) || 1;
    if (v < 1) v = 1;
    if (v > 99) v = 99;
    qtyInput.value = v;
  };

  qtyDec?.addEventListener('click', () => {
    let v = parseInt(qtyInput.value, 10) || 1;
    if (v > 1) qtyInput.value = v - 1;
  });

  qtyInc?.addEventListener('click', () => {
    let v = parseInt(qtyInput.value, 10) || 1;
    if (v < 99) qtyInput.value = v + 1;
  });

  qtyInput.addEventListener('change', clampQty);
  qtyInput.addEventListener('blur', clampQty);

  addBtn.addEventListener('click', () => {
    if (!currentImageModalProduct) return;
    const p = currentImageModalProduct;
    const cantidad = parseInt(qtyInput.value, 10) || 1;
    const ok = agregarProductoAlCarrito(p.ref, p.nombre || p.ref, parseFloat(p.precio), cantidad);
    if (ok) {
      qtyInput.value = 1;
      const original = addBtn.textContent;
      addBtn.textContent = '✓ Agregado';
      setTimeout(() => { addBtn.textContent = original; }, 1200);
    }
  });
}

// ════════════════════════════════
// INIT
// ════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  setupSearch();
  setupNav();
  setupCartModals();
  setupImageModal();
  cargarDatos();
  cargarRedes();
});


