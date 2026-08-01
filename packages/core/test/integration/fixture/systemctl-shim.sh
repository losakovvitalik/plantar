#!/bin/sh
# Minimal systemctl stand-in: the container has no systemd as PID 1.
# The deploy runs "systemctl reload nginx"; `pm2 startup systemd` runs
# enable/daemon-reload, which only need to succeed.
case "$1 $2" in
  "reload nginx") exec nginx -s reload ;;
  "start nginx") exec nginx ;;
esac
exit 0
