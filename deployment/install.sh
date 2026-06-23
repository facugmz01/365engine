#!/bin/bash
set -e

# ==========================================================
# NEXUS - Native Installation Script for Ubuntu/Debian
# Run this script with root privileges (sudo bash install.sh)
# ==========================================================

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo bash install.sh)"
  exit 1
fi

PROJECT_DIR="/opt/nexus"
CURRENT_DIR=$(pwd)

echo ">>> NEXUS Native Deployment Setup <<<"
echo "This will install MySQL, Redis, Python, Node.js and configure Nginx."
echo ""

# 1. Update and install core dependencies
echo "[1/7] Installing System Dependencies..."
apt-get update
apt-get install -y python3 python3-venv python3-pip mysql-server redis-server nginx curl wget git

# 2. Install Node.js
echo "[2/7] Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Configure MySQL Database
echo "[3/7] Configuring MySQL..."
# The following assumes a fresh mysql installation without root password. 
# We create a new user and database using the credentials from your config.py defaults:
# intune:z~JP;lybdp,TWAs.
mysql -e "CREATE DATABASE IF NOT EXISTS intune_db;"
mysql -e "CREATE USER IF NOT EXISTS 'intune'@'localhost' IDENTIFIED BY 'z~JP;lybdp,TWAs.';"
mysql -e "GRANT ALL PRIVILEGES ON intune_db.* TO 'intune'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# 4. Prepare Application Directory
echo "[4/7] Preparing Application Directory..."
if [ "$CURRENT_DIR" != "$PROJECT_DIR" ]; then
    echo "Copying files to $PROJECT_DIR..."
    mkdir -p $PROJECT_DIR
    cp -r $CURRENT_DIR/* $PROJECT_DIR/
fi

cd $PROJECT_DIR

# 5. Setup Python Virtual Environment and Backend
echo "[5/7] Setting up Python Backend..."
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn  # Required for production systemd deployment
# Run the database migration script directly from native python
python migrate_db.py || true

# 6. Build Frontend
echo "[6/7] Building React Frontend..."
cd $PROJECT_DIR/frontend
npm install
npm run build
cd $PROJECT_DIR

# 7. Configure Services and Nginx
echo "[7/7] Configuring Systemd and Nginx..."
cp $PROJECT_DIR/deployment/nexus-api.service /etc/systemd/system/
cp $PROJECT_DIR/deployment/nexus-worker.service /etc/systemd/system/
cp $PROJECT_DIR/deployment/nexus-beat.service /etc/systemd/system/

systemctl daemon-reload
systemctl enable nexus-api nexus-worker nexus-beat
systemctl restart nexus-api nexus-worker nexus-beat

# Nginx config
cp $PROJECT_DIR/deployment/nginx.conf /etc/nginx/sites-available/nexus
ln -sf /etc/nginx/sites-available/nexus /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx

echo "=========================================================="
echo "NEXUS has been successfully deployed natively!"
echo "You can access the application at http://YOUR_VPS_IP/"
echo "Logs can be viewed with:"
echo "  sudo journalctl -u nexus-api -f"
echo "  sudo journalctl -u nexus-worker -f"
echo "=========================================================="
