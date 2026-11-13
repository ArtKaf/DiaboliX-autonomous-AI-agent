FROM node:22-bookworm
WORKDIR /opt/diabolix
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-dev python3-venv python3-pip python-is-python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY worker.cjs install-proxy.cjs command-filter.cjs patch-match.cjs recon.cjs lsp-client.cjs code-tools.cjs project-diagnostics.cjs security-scan.cjs security-rules.yml ./
WORKDIR /workspace
USER node
ENTRYPOINT ["node", "/opt/diabolix/worker.cjs"]
