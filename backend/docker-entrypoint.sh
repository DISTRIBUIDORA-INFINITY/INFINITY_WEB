#!/bin/sh
set -e

# Infinity Group — entrypoint multi-marca
# Crea la estructura de carpetas y JSONs por defecto para infinity + kohell
# y los archivos compartidos (usuarios, sesiones, vendedores, redes).

BRANDS="infinity kohell"

# Crear carpetas raíz (los volúmenes se montan en estos puntos)
mkdir -p /app/data
mkdir -p /app/Imagenes
mkdir -p /app/Imagenes/sin-categoria
mkdir -p /app/pedidos
mkdir -p /app/videos

# Por cada marca: carpetas + JSONs
for b in $BRANDS; do
  mkdir -p /app/data/$b
  mkdir -p /app/Imagenes/$b
  mkdir -p /app/Imagenes/$b/agotados

  # categorias.json
  [ -f /app/data/$b/categorias.json ]   || echo '[]' > /app/data/$b/categorias.json
  # productos.json
  [ -f /app/data/$b/productos.json ]    || echo '[]' > /app/data/$b/productos.json
done

# Videos unificados (Infinity Group) — una sola carpeta compartida
mkdir -p /app/videos

# Pedidos unificados (Infinity Group) — una sola carpeta compartida
mkdir -p /app/pedidos

# Archivos compartidos (en raíz de data/)
[ -f /app/data/contraseñas.json ]   || echo '{"usuarios":[{"usuario":"admin","contraseña":"admin","rol":"admin","permisos":[]}]}' > /app/data/contraseñas.json
[ -f /app/data/sesiones.json ]      || echo '[]' > /app/data/sesiones.json
[ -f /app/data/vendedores.json ]    || echo '[]' > /app/data/vendedores.json
[ -f /app/data/redes.json ]         || echo '[]' > /app/data/redes.json
[ -f /app/data/pedidos-meta.json ]  || echo '[]' > /app/data/pedidos-meta.json

echo "[entrypoint] ✅ Estructura multi-marca lista (infinity + kohell)"

# Permisos (best-effort)
chown -R node:node /app/data /app/Imagenes /app/pedidos /app/videos 2>/dev/null || true

exec "$@"
