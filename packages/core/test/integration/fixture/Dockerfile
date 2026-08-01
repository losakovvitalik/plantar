# Disposable SSH target for @plantar/core integration tests: Ubuntu 24.04
# with sshd, plus pre-baked node/pm2/nginx so test runs do not install them
# over the network. The container does not run systemd as PID 1, so a
# systemctl shim on PATH maps the calls the deploy makes (nginx reload,
# pm2 startup) to their non-systemd equivalents.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      openssh-server nginx curl ca-certificates gnupg iproute2 && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g pm2 && \
    rm -rf /var/lib/apt/lists/*

# Root password login is fine for a throwaway container bound to 127.0.0.1.
# /etc/systemd/system must exist: `pm2 startup systemd` writes its unit there.
RUN echo 'root:plantar-test' | chpasswd && \
    printf 'PermitRootLogin yes\nPasswordAuthentication yes\n' \
      > /etc/ssh/sshd_config.d/01-plantar-test.conf && \
    mkdir -p /run/sshd /etc/systemd/system

COPY systemctl-shim.sh /usr/local/bin/systemctl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /usr/local/bin/systemctl /entrypoint.sh

EXPOSE 22 80
CMD ["/entrypoint.sh"]
