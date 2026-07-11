FROM node:24.4.1-bookworm-slim

ENV COREPACK_HOME=/opt/corepack

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.13.1 --activate \
    && chmod --recursive a+rX /opt/corepack \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner \
    && install --directory --owner runner --group runner /workspace /artifacts

USER runner
WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--version"]
