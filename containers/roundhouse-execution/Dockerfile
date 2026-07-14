# Copyright 2026 Mark Smith
# SPDX-License-Identifier: Apache-2.0

FROM node:24.4.1-bookworm-slim@sha256:36ae19f59c91f3303c7a648f07493fe14c4bd91320ac8d898416327bacf1bbfa AS dependencies

RUN npm install --global pnpm@10.13.1

WORKDIR /opt/roundhouse-source
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
    && find . -type d -name node_modules -prune -print0 \
        | tar --null --files-from=- --create --file=/opt/roundhouse-dependencies.tar \
    && sha256sum pnpm-lock.yaml | cut -d ' ' -f 1 > /opt/roundhouse-dependencies.sha256

FROM node:24.4.1-bookworm-slim@sha256:36ae19f59c91f3303c7a648f07493fe14c4bd91320ac8d898416327bacf1bbfa

ARG ROUNDHOUSE_RELEASE_COMMIT=unknown
ENV ROUNDHOUSE_RELEASE_COMMIT=${ROUNDHOUSE_RELEASE_COMMIT}

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.13.1 @openai/codex@0.144.1 @anthropic-ai/claude-code@2.1.142 prettier@3.6.2 \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner \
    && install --directory --owner runner --group runner /home/runner/workspace

COPY --from=dependencies /opt/roundhouse-dependencies.tar /opt/roundhouse/dependencies.tar
COPY --from=dependencies /opt/roundhouse-dependencies.sha256 /opt/roundhouse/dependencies.sha256
COPY --chown=runner:runner containers/roundhouse-execution/runner.mjs /opt/roundhouse/runner.mjs

USER runner
WORKDIR /home/runner/workspace
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/roundhouse/runner.mjs"]
