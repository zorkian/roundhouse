# Copyright 2026 Mark Smith
# SPDX-License-Identifier: Apache-2.0

FROM node:24.4.1-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.13.1 \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner \
    && install --directory --owner runner --group runner /home/runner/workspace

COPY --chown=runner:runner runner.mjs /opt/roundhouse/runner.mjs

USER runner
WORKDIR /home/runner/workspace
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/roundhouse/runner.mjs"]
