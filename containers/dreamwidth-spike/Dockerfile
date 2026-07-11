# Copyright 2026 Mark Smith
# SPDX-License-Identifier: Apache-2.0

FROM ghcr.io/dreamwidth/devcontainer@sha256:19365e4d012402b280b20a18187f882feac676c40c2163de6f8ebb92e54cebcd

COPY runner.mjs /opt/roundhouse/runner.mjs

WORKDIR /opt/roundhouse
EXPOSE 8080

CMD ["node", "/opt/roundhouse/runner.mjs"]
