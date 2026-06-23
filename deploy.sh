#!/bin/bash
# -----------------------------------------------------------------------------
# Script de Despliegue Automatizado para NEXUS (365engine) en Ubuntu/Debian
# -----------------------------------------------------------------------------
set -e

REPO_URL="https://github.com/facugmz01/365engine.git"
CLONE_DIR="365engine"

echo -e "\n======================================================="
echo "Iniciando instalación automatizada de NEXUS"
echo "=======================================================\n"

# 1. Actualizar sistema
echo "[1/6] Actualizando el sistema operativo..."
sudo apt-get update -y

# 2. Instalar dependencias (Git, Curl, Node.js)
echo "[2/6] Instalando dependencias (Git, Curl, Node.js 20)..."
sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Instalar Docker y Docker Compose
echo "[3/6] Verificando e instalando Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
else
    echo "Docker ya está instalado."
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Instalando Docker Compose..."
    sudo apt-get install docker-compose-plugin -y || sudo apt-get install docker-compose -y
else
    echo "Docker Compose ya está instalado."
fi

# 4. Clonar el repositorio
echo "[4/6] Clonando el repositorio..."
# Verificamos si estamos dentro del directorio del repositorio o afuera
if [ -d ".git" ] && [ -f "docker-compose.yml" ]; then
    echo "Parece que ya estamos dentro del repositorio. Actualizando código..."
    git pull origin main || git pull origin master
elif [ -d "$CLONE_DIR" ]; then
    echo "El directorio $CLONE_DIR ya existe. Entrando y actualizando (git pull)..."
    cd $CLONE_DIR
    git pull origin main || git pull origin master
else
    git clone $REPO_URL $CLONE_DIR
    cd $CLONE_DIR
fi

# 5. Generar archivo .env
echo "[5/6] Configurando variables de entorno..."
if [ ! -f .env ]; then
    echo "No se encontró archivo .env. Generando uno aleatoriamente..."
    # Genera una contraseña aleatoria de 16 caracteres
    RANDOM_PASS=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 16)
    echo "DB_PASSWORD=$RANDOM_PASS" > .env
    echo "Se ha generado una contraseña segura para la base de datos automáticamente."
else
    echo "El archivo .env ya existe. Omitiendo la generación."
fi

# 6. Compilar frontend y levantar contenedores
echo "[6/6] Compilando el frontend (React) y levantando contenedores Docker..."
cd frontend
npm install
npm run build
cd ..

echo "Levantando servicios de Docker..."
if sudo docker compose version &> /dev/null; then
    sudo docker compose up -d --build
else
    sudo docker-compose up -d --build
fi

echo -e "\n======================================================="
echo "¡Despliegue Completado Exitosamente!"
echo "======================================================="
echo "La aplicación NEXUS ya debería estar ejecutándose en los contenedores."
echo "Puedes comprobar el estado con: sudo docker compose ps (o sudo docker-compose ps)"
echo "Para ver los logs en tiempo real: sudo docker compose logs -f (o sudo docker-compose logs -f)"
