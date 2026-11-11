FROM node:22-bookworm
WORKDIR /opt/diabolix
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -f /usr/bin/python /usr/bin/python3 /usr/bin/python3.* /usr/local/bin/python /usr/local/bin/python3 /usr/local/bin/python3.*
COPY worker.cjs ./
WORKDIR /workspace
USER node
ENTRYPOINT ["node", "/opt/diabolix/worker.cjs"]
