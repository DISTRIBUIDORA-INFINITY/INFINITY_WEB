FROM node:18-alpine
WORKDIR /app
# Instalar dependencias primero (mejor cache de capas)
COPY backend/package*.json ./
RUN npm install --production
# Copiar el código del backend
COPY backend/ ./
# Copiar el frontend empaquetado (no se monta como volumen en producción)
COPY frontend/ ./frontend/
# Sobrescribir los logos con las versiones oficiales de LOGOS/
# (LOGOS/ es la fuente de verdad de logos en el repo)
COPY LOGOS/INFINITY.jpeg ./frontend/infinity/assets/logo.jpeg
COPY LOGOS/KOHELL.jpeg   ./frontend/kohell/assets/logo.jpeg
# Script de entrada: crea datos/carpetas por defecto si no existen en el volumen
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
