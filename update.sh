#!/bin/bash
# -----------------------------------------------------------------------------
# Script de Actualización Automatizada para NEXUS (365engine)
# Este script descarga los últimos cambios de GitHub, recompila y reinicia
# -----------------------------------------------------------------------------
set -e

echo -e "\n======================================================="
echo "Iniciando proceso de actualización de NEXUS"
echo "=======================================================\n"

# 1. Obtener los últimos cambios de Git
echo "[1/3] Descargando los últimos cambios desde GitHub..."
git pull origin main || git pull origin master

# 2. Compilar el Frontend
echo "[2/3] Recompilando el frontend de React..."
cd frontend
npm install
npm run build
cd ..

# 3. Reconstruir y reiniciar los contenedores Docker
echo "[3/3] Reconstruyendo imágenes y reiniciando contenedores..."
# Usamos --build para asegurar que cualquier cambio en dependencias (requirements.txt) se aplique
if sudo docker compose version &> /dev/null; then
    sudo docker compose up -d --build
else
    sudo docker-compose up -d --build
fi

# Limpieza de imágenes huérfanas o viejas para no llenar el disco del servidor (Opcional pero recomendado)
echo "Limpiando imágenes antiguas de Docker para liberar espacio..."
sudo docker image prune -f

echo -e "\n======================================================="
echo "¡Actualización Completada Exitosamente!"
echo "======================================================="
echo "Los contenedores se han reiniciado con el nuevo código."
echo "Puedes comprobar el estado con: sudo docker compose ps (o sudo docker-compose ps)"
