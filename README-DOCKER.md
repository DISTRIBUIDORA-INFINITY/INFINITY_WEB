# Infinity Group — Catálogo web multi-marca

Catálogo web con dos marcas (**Infinity** y **Kohell**) servidas desde el mismo backend Express. La landing en `/` muestra un selector de marca. Cada marca tiene su propio catálogo público, productos y categorías. Los pedidos y videos son globales. Los usuarios y vendedores son compartidos (es la misma empresa).

## Marcas

| Marca    | Catálogo                | Temática                                       | Paleta     |
|----------|-------------------------|------------------------------------------------|------------|
| Infinity | `/infinity/`            | Bolsos, termos, canecas, accesorios, mercancía | Morado/violeta |
| Kohell   | `/kohell/`              | Extensiones y cabello sintético                | Rosa/durazno   |
| Admin    | `/infinity/admin/`      | Panel único con selector Infinity / Kohell     | Mixto        |

## Estructura del proyecto

```
.
├── backend/                  # Código del servidor Node.js/Express
│   ├── Dockerfile
│   ├── docker-entrypoint.sh  # Crea subcarpetas y JSONs por marca
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── landing/              # Selector de marca (/)
│   ├── infinity/             # Catálogo Infinity
│   │   ├── assets/logo.jpeg
│   │   └── administrativo/   # Panel admin (compartido)
│   └── kohell/               # Catálogo Kohell
│       └── assets/logo.jpeg
├── data/                     # JSONs persistentes
│   ├── contraseñas.json      # Compartido
│   ├── sesiones.json         # Compartido
│   ├── vendedores.json       # Compartido
│   ├── redes.json            # Compartido
│   ├── pedidos-meta.json     # Compartido
│   ├── infinity/             # Datos de la marca Infinity
│   │   ├── categorias.json
│   │   └── productos.json
│   └── kohell/               # Datos de la marca Kohell
│       ├── categorias.json
│       └── productos.json
├── Imagenes/                 # Fotos de productos por marca
│   ├── infinity/
│   │   ├── agotados/
│   │   └── ...
│   └── kohell/
├── pedidos/                  # PDFs de pedidos (compartido)
├── videos/                   # Videos del catálogo (compartido)
├── docker-compose.yml
└── README-DOCKER.md
```

## Requisitos en el PC destino

- Docker instalado y corriendo.
- Docker Compose (viene con Docker Desktop; en Linux el plugin `docker compose`).
- Git (para clonar desde Gitea).

## Pasos para ponerlo a correr en otro PC

### 1. Clonar el repositorio desde Gitea

```bash
git clone https://TU_GITEA/TU_USUARIO/infinity.git
cd infinity
```

### 2. Levantar el contenedor

```bash
docker compose up --build -d
```

- Construye la imagen con el backend y los 3 frontales (landing, infinity, kohell) empaquetados.
- Expone la aplicación en: http://localhost:6060
- Persiste `data/`, `Imagenes/`, `pedidos/` y `videos/` en el host.

### 3. Abrir en el navegador

- **Landing** (selector de marca): http://localhost:6060
- **Infinity**: http://localhost:6060/infinity/
- **Kohell**: http://localhost:6060/kohell/
- **Admin** (compartido): http://localhost:6060/infinity/admin/  ó  http://localhost:6060/kohell/admin/
  - El admin tiene un selector arriba a la derecha para alternar entre Infinity y Kohell.
  - También respeta el parámetro `?brand=infinity|kohell` al cargar.

## Usuario por defecto (solo si no existe `data/contraseñas.json`)

| Campo      | Valor |
|------------|-------|
| Usuario    | admin |
| Contraseña | admin |

> Cambia esta contraseña desde el panel administrativo lo antes posible.

## Flujo de trabajo: editar en este PC y actualizar el otro

1. Haces los cambios en el código/frontend.
2. Subes a Gitea:
   ```bash
   git add .
   git commit -m "descripción del cambio"
   git push origin main
   ```
3. En el otro PC:
   ```bash
   cd infinity
   git pull
   docker compose down
   docker compose up --build -d
   ```

Con eso se actualiza el backend y los tres frontales (landing, infinity, kohell, admin).

## Credenciales por defecto

Las credenciales actuales se encuentran en `data/contraseñas.json`. A modo de referencia, los usuarios configurados son:

| Usuario | Contraseña | Rol | Permisos |
|---|---|---|---|
| `admin` | `123` | admin | Acceso total |
| `juan` | `123456` | editor | productos, agotados |
| `juan carlos` | `123456` | vendedor | descargas |

> Cambia estas contraseñas desde el panel de usuarios lo antes posible. Actualmente se almacenan en texto plano; está previsto migrar a bcrypt.

## Datos importantes: qué se guarda y qué no

Lo que **sí** se conserva al reconstruir el contenedor (está en volúmenes):

- `data/` → JSONs (productos, categorías, usuarios, sesiones, vendedores, redes, pedidos-meta)
- `Imagenes/` → fotos subidas (organizadas por marca)
- `pedidos/` → PDFs generados (compartido)
- `videos/` → videos subidos (compartido)

Lo que **no** se conserva (va dentro de la imagen):

- El código del frontend y backend. Si lo actualizas, hay que hacer `docker compose up --build -d`.

## Endpoints principales

| Endpoint                          | Descripción                                      | Auth |
|-----------------------------------|--------------------------------------------------|------|
| `GET  /`                          | Landing (selector de marca)                      | —    |
| `GET  /infinity/`                 | Catálogo Infinity                                | —    |
| `GET  /kohell/`                   | Catálogo Kohell                                  | —    |
| `GET  /infinity/admin/`           | Panel admin (selector de marca)                  | —    |
| `POST /api/auth/login`            | Login                                            | —    |
| `POST /api/auth/logout`           | Logout                                           | Sí   |
| `GET  /api/auth/me`               | Datos de la sesión activa                        | Sí   |
| `GET  /api/{brand}/categorias`    | Categorías de la marca                           | —    |
| `GET  /api/{brand}/productos`     | Productos de la marca                            | —    |
| `GET  /api/vendedores`            | Vendedores (compartido)                          | —    |
| `POST /api/pedidos/generar-pdf`   | Generar PDF de pedido (público)                  | —    |
| `GET  /api/pedidos`               | Listar pedidos                                   | Permiso `pedidos` |
| `POST /api/{brand}/productos/upload` | Subir fotos masivamente                      | Permiso `productos` |
| `POST /api/{brand}/productos/:ref/agotar`   | Marcar agotado                       | Permiso `productos` |
| `POST /api/{brand}/productos/:ref/reactivar`| Reactivar agotado                     | Permiso `productos` |
| `DELETE /api/{brand}/productos/:ref`        | Eliminar definitivamente              | Permiso `productos` |
| `POST /api/{brand}/productos/excel`| Importar nombres y precios desde Excel/CSV     | Permiso `productos` |
| `POST /api/{brand}/descargas/pdf`  | Generar PDF del catálogo                        | Permiso `descargas` |
| `POST /api/{brand}/descargas/fotos`| ZIP de fotos                                     | Permiso `descargas` |
| `GET/POST/DELETE/PUT /api/{brand}/categorias[/:id[/subcategorias]]` | CRUD | Permiso `categorias` |
| `GET/POST/DELETE/PUT /api/videos[/...]` | Gestión de videos (compartido)          | admin |
| `GET/POST/DELETE/PUT /api/{brand}/redes[/...]` | Redes sociales (Instagram, FB)  | admin |
| `GET/POST/DELETE/PUT /api/usuarios[/...]`      | Gestión de usuarios (compartido) | Permiso `usuarios` |

`{brand}` = `infinity` o `kohell`.

## Comandos útiles

| Acción | Comando |
|--------|---------|
| Ver logs | `docker compose logs -f web` |
| Reiniciar | `docker compose restart web` |
| Apagar | `docker compose down` |
| Borrar TODO (incluidos datos locales) | `docker compose down -v` ⚠️ |
| Ver estado | `docker compose ps` |

## Solución de problemas

### "Cannot GET /" o pantalla en blanco

1. Verifica que el contenedor esté corriendo:
   ```bash
   docker compose ps
   ```
2. Mira los logs:
   ```bash
   docker compose logs -f web
   ```
3. Asegúrate de haber usado `--build` después de `git pull`.

### El admin no entra

- Si la carpeta `data/` estaba vacía, se crea automáticamente el usuario `admin`/`admin`.
- Si ya existe `data/contraseñas.json`, ese archivo tiene prioridad. Las credenciales reales son las que figuren allí.
- Las sesiones se limpian a las 00:00 hora Colombia; si entras después de medianoche, te pedirá login de nuevo.

### Pantalla en blanco después de desplegar cambios

Si una página se queda en blanco tras desplegar cambios, revisa que las versiones `?v=...` de `app.js`, `admin.js` y `admin.css` estén actualizadas en los `index.html`. Las actuales son:

- `frontend/infinity/index.html` → `app.js?v=18`
- `frontend/kohell/index.html` → `app.js?v=3`
- `frontend/infinity/administrativo/index.html` → `admin.css?v=25`, `admin.js?v=27`

### Las imágenes o pedidos no aparecen

- Confirma que `data/`, `Imagenes/`, `pedidos/` y `videos/` están en la misma ubicación que `docker-compose.yml`.
- En Windows con Docker Desktop, activa **Settings → Resources → File sharing** para la unidad donde esté el proyecto.

### Kohell no muestra productos

- Kohell arranca con `data/kohell/productos.json = []`. Hay que entrar al admin y subir productos con la marca "Kohell" seleccionada en el selector.

### Categorías que no aparecen

- Una categoría se oculta automáticamente cuando se queda sin productos o cuando todos sus productos están agotados.
- Un producto se considera agotado cuando su imagen está ubicada en la carpeta `agotados/` de la marca.

### Venta mínima

- Cada producto puede tener un valor de **venta mínima** (`ventaMinima`).
- El catálogo y el carrito respetan este valor: se incrementa/decrementa en múltiplos de la venta mínima, y no se permite una cantidad inferior.

## Notas de seguridad

- Cambia `SESSION_SECRET` en `docker-compose.yml` por algo aleatorio y largo si vas a exponer el sitio a internet.
- Las contraseñas se almacenan en texto plano en `data/contraseñas.json`. Está previsto migrar a bcrypt.
- El proyecto está pensado para red local / catálogo interno. No expongas el puerto 6060 a internet sin un reverse proxy (nginx/traefik) y HTTPS.

## ¿Por qué se empaqueta el frontend dentro de la imagen?

Así, cuando subes cambios a Gitea y haces `git pull` + `--build` en el otro PC, los 3 frontales (landing, infinity, kohell) se actualizan automáticamente. Si se montara `frontend/` como volumen, el contenedor usaría siempre los archivos antiguos que ya estuvieran en el disco.
