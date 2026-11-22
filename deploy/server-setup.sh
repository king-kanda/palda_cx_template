#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 EC2 instance: updates, Docker Engine + Compose, nginx, certbot, firewall.
# Skip it on a box that already runs Docker and nginx (for example the Palda Homes server).
#   bash ~/palda-cx/server-setup.sh
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then echo "Run as your normal user (ubuntu), not root. It uses sudo."; exit 1; fi

# No prompts: keep existing config files and restart services automatically (Ubuntu's needrestart asks otherwise).
APT=(sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

echo "==> System update"
sudo apt-get update
"${APT[@]}" upgrade
"${APT[@]}" install ca-certificates curl gnupg ufw nginx certbot python3-certbot-nginx openssl

# Small instances (1-2 GB RAM) need swap so a memory spike doesn't kill Postgres or the web app.
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo "==> 2 GB swap file"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf >/dev/null
  sudo sysctl -q -p /etc/sysctl.d/99-swappiness.conf
fi

if ! command -v docker >/dev/null; then
  echo "==> Docker Engine (official repo)"
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  CODENAME="${UBUNTU_CODENAME:-$VERSION_CODENAME}"
  if ! curl -fsI "https://download.docker.com/linux/ubuntu/dists/${CODENAME}/Release" >/dev/null; then CODENAME=noble; fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  "${APT[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
fi

echo "==> Firewall (SSH, HTTP, HTTPS only)"
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo systemctl enable --now nginx

# Keep Docker's own logs from filling a small disk.
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }' | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker
fi

echo
echo "Done. Log out and back in (so the docker group applies), check 'docker ps', then run:  bash ~/palda-cx/bootstrap.sh"
