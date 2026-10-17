# SpecGate CI/devcontainer image.
# Ships the CLI together with gitleaks pinned so `specgate check` works
# out-of-the-box in CI pipelines that don't want to call `doctor --install`.

FROM node:20-bookworm-slim AS cli
WORKDIR /opt/specgate
# Expect the release pipeline to drop a published tarball at ./specgate-cli.tgz.
# For local dev builds, place `packages/cli` + `packages/core` dists here first.
COPY . ./
RUN npm install -g ./packages/cli && npm install -g ./packages/core

FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/specgate/specgate"
LABEL org.opencontainers.image.description="SpecGate CLI with gitleaks preinstalled"
LABEL org.opencontainers.image.licenses="Apache-2.0"

ARG GITLEAKS_VERSION=8.18.4
ARG TARGETARCH=amd64

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

# gitleaks (verifying checksum is handled by the release pipeline).
RUN set -eux; \
    arch="${TARGETARCH}"; \
    case "$arch" in amd64) suffix=x64 ;; arm64) suffix=arm64 ;; *) echo "unsupported arch $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${suffix}.tar.gz" -o /tmp/gitleaks.tgz; \
    tar -xzf /tmp/gitleaks.tgz -C /usr/local/bin gitleaks; \
    rm /tmp/gitleaks.tgz

COPY --from=cli /usr/local/bin/specgate /usr/local/bin/specgate
COPY --from=cli /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=cli /usr/local/bin/node /usr/local/bin/node

ENTRYPOINT ["specgate"]
CMD ["--help"]
