# Copyright 2026 Mark Smith
# SPDX-License-Identifier: Apache-2.0

FROM ghcr.io/dreamwidth/devcontainer@sha256:19365e4d012402b280b20a18187f882feac676c40c2163de6f8ebb92e54cebcd

COPY runner.mjs /opt/roundhouse/runner.mjs

WORKDIR /opt/roundhouse
ENV GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt
EXPOSE 8080

CMD ["/bin/bash", "-lc", "if [[ -f /etc/cloudflare/certs/cloudflare-containers-ca.crt ]]; then cat /etc/cloudflare/certs/cloudflare-containers-ca.crt >> /etc/ssl/certs/ca-certificates.crt; fi; exec node /opt/roundhouse/runner.mjs"]
