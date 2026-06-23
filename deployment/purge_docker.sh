#!/bin/bash
set -e

# ==========================================================
# Script para limpiar completamente Docker del sistema
# WARNING: ESTO BORRARÁ TODOS LOS CONTENEDORES, IMÁGENES,
# VOLÚMENES Y REDES DE DOCKER EN ESTE SERVIDOR.
# ==========================================================

if [ "$EUID" -ne 0 ]; then
  echo "Por favor, ejecuta el script como root (sudo bash purge_docker.sh)"
  exit 1
fi

echo ">>> Docker Purge Script <<<"
echo "ADVERTENCIA: Este script detendrá y ELIMINARÁ todos los contenedores,"
echo "imágenes, volúmenes y redes de Docker en este servidor."
echo "¿Estás seguro de que quieres continuar? (Escribe 'YES' o 'Y' para continuar)"
read -r CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    echo "Operación cancelada."
    exit 0
fi

echo "[1/4] Deteniendo todos los contenedores en ejecución..."
if [ "$(docker ps -q)" ]; then
    docker stop $(docker ps -aq)
else
    echo "No hay contenedores en ejecución."
fi

echo "[2/4] Eliminando todos los contenedores..."
if [ "$(docker ps -aq)" ]; then
    docker rm -f $(docker ps -aq)
else
    echo "No hay contenedores para eliminar."
fi

echo "[3/4] Eliminando todas las imágenes, volúmenes y redes no utilizadas..."
docker system prune -a --volumes -f

echo "[4/4] Limpieza completada con éxito."
echo "Si además quieres desinstalar el programa de Docker del servidor por completo, puedes ejecutar:"
echo "sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras"
echo "sudo rm -rf /var/lib/docker /var/lib/containerd"
