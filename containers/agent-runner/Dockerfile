# Copyright 2026 Mark Smith
# SPDX-License-Identifier: Apache-2.0

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner

COPY --chown=runner:runner runner.mjs /opt/roundhouse/runner.mjs

USER runner
WORKDIR /home/runner
EXPOSE 8080

CMD ["node", "/opt/roundhouse/runner.mjs"]
