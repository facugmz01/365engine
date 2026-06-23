#!/bin/bash
set -e

# ==========================================================
# NEXUS - Native Uninstallation Script for Ubuntu/Debian
# Run this script with root privileges (sudo bash uninstall.sh)
# WARNING: THIS WILL DELETE EVERYTHING RELATED TO NEXUS
# INCLUDING THE DATABASE, FILES, AND CONFIGURATIONS.
# ==========================================================

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo bash uninstall.sh)"
  exit 1
fi

echo ">>> NEXUS Uninstallation Script <<<"
echo "WARNING: This will completely remove NEXUS, including the MySQL database 'intune_db'."
echo "Are you sure you want to proceed? (Type 'YES' to continue)"
read -r CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    echo "Uninstallation cancelled."
    exit 0
fi

echo "[1/5] Stopping and disabling Systemd services..."
systemctl stop nexus-api nexus-worker nexus-beat || true
systemctl disable nexus-api nexus-worker nexus-beat || true

echo "[2/5] Removing Systemd service files..."
rm -f /etc/systemd/system/nexus-api.service
rm -f /etc/systemd/system/nexus-worker.service
rm -f /etc/systemd/system/nexus-beat.service
systemctl daemon-reload

echo "[3/5] Removing Nginx configuration..."
rm -f /etc/nginx/sites-available/nexus
rm -f /etc/nginx/sites-enabled/nexus
systemctl restart nginx || true

echo "[4/5] Dropping MySQL Database and User..."
mysql -e "DROP DATABASE IF EXISTS intune_db;" || echo "Failed to drop database or it does not exist."
mysql -e "DROP USER IF EXISTS 'intune'@'localhost';" || echo "Failed to drop user or it does not exist."
mysql -e "FLUSH PRIVILEGES;" || true

echo "[5/5] Deleting Application Files..."
rm -rf /opt/nexus

echo "=========================================================="
echo "NEXUS has been completely removed from this server."
echo "Note: MySQL, Redis, Python, and Node.js are still installed on the system."
echo "If you want to uninstall them as well, you must run apt-get remove manually."
echo "=========================================================="
