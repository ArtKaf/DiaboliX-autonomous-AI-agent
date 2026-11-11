FROM node:22-bookworm
WORKDIR /opt/diabolix
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY worker.cjs ./
WORKDIR /workspace
USER node
ENTRYPOINT ["node", "/opt/diabolix/worker.cjs"]
