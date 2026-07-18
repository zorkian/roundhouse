# Copyright 2026 Mark Smith
# SPDX-License-Identifier: Apache-2.0

FROM node:24.4.1-bookworm-slim@sha256:36ae19f59c91f3303c7a648f07493fe14c4bd91320ac8d898416327bacf1bbfa

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner

COPY --chown=runner:runner runner.mjs /opt/roundhouse/runner.mjs

USER runner
WORKDIR /home/runner
EXPOSE 8080

CMD ["node", "/opt/roundhouse/runner.mjs"]
