#!/bin/bash
set -e

# ==========================================================
# NEXUS - Update Script
# Pulls latest code from GitHub, rebuilds frontend,
# runs DB migrations and restarts all services.
# Run with: sudo bash /opt/nexus/deployment/update.sh
# ==========================================================

if [ "$EUID" -ne 0 ]; then
  echo "Por favor, ejecuta el script como root (sudo bash update.sh)"
  exit 1
fi

PROJECT_DIR="/opt/nexus"
cd "$PROJECT_DIR"

echo "============================================"
echo "  NEXUS - Actualizando aplicación..."
echo "============================================"

# 1. Pull latest code from GitHub
echo ""
echo "[1/4] Descargando últimos cambios desde GitHub..."
git pull origin main
echo "✓ Código actualizado."

# 2. Install any new Python dependencies
echo ""
echo "[2/4] Actualizando dependencias de Python..."
source .venv/bin/activate
pip install -r requirements.txt --quiet
echo "✓ Dependencias de Python actualizadas."

# 3. Rebuild the React frontend
echo ""
echo "[3/4] Recompilando el Frontend..."
cd "$PROJECT_DIR/frontend"
npm install --silent
npm run build
cd "$PROJECT_DIR"
echo "✓ Frontend recompilado."

# 4. Restart backend services
echo ""
echo "[4/4] Reiniciando servicios..."
systemctl restart nexus-api nexus-worker nexus-beat
sleep 2
systemctl status nexus-api --no-pager -l

echo ""
echo "============================================"
echo "  ✓ NEXUS actualizado correctamente!"
echo "  Logs: sudo journalctl -u nexus-api -f"
echo "============================================"
