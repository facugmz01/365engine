#!/bin/bash
set -e

# Este script instala Docker, Docker Compose y levanta el entorno de la aplicación.
# Se asume que este script se ejecuta en un servidor Ubuntu fresco como usuario root o con sudo.

echo "========================================"
echo " Iniciando instalación del Entorno..."
echo "========================================"

# 1. Actualizar sistema e instalar dependencias previas
echo "[1/4] Actualizando paquetes del sistema..."
apt-get update
apt-get install -y apt-transport-https ca-certificates curl software-properties-common git

# 2. Instalar Docker
echo "[2/4] Instalando Docker..."
if ! command -v docker &> /dev/null
then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo "Docker ya está instalado."
fi

# Asegurar que el servicio de Docker esté corriendo
systemctl start docker
systemctl enable docker

# 3. Instalar Docker Compose (si no está incluido en el plugin docker-compose)
echo "[3/4] Instalando Docker Compose Plugin..."
apt-get install -y docker-compose-plugin

# 4. Compilar y levantar la aplicación
echo "[4/4] Levantando los servicios con Docker Compose..."
# Asume que te encuentras en el directorio raíz de la aplicación donde están el docker-compose.yml y Dockerfile
if [ -f "docker-compose.yml" ]; then
    # Opcional: Configurar variables de entorno iniciales si no existen
    if [ ! -f ".env" ]; then
        echo "DB_PASSWORD=SecurePassword123!" > .env
    fi

    echo "Descargando imágenes, construyendo la app y arrancando contenedores en background..."
    docker compose up -d --build

    echo "========================================"
    echo " ¡Instalación Completada Exitosamente!"
    echo "========================================"
    echo "Servicios levantados:"
    echo " - FastAPI App: http://$(curl -s ifconfig.me):8000"
    echo " - MySQL y Redis están corriendo en segundo plano."
    echo ""
    echo "Para ver los logs de la app en vivo usa:"
    echo "docker compose logs -f api"
else
    echo "ERROR: No se encontró el archivo docker-compose.yml."
    echo "Asegúrate de ejecutar este script desde la carpeta raíz del proyecto."
fi
