FROM node:22-bookworm
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb openbox xterm xdotool xclip scrot chromium fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/diabolix
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY desktop.sh /opt/diabolix/desktop.sh
COPY browser-state.cjs /opt/diabolix/browser-state.cjs
COPY browser-check.cjs /opt/diabolix/browser-check.cjs
RUN chmod 755 /opt/diabolix/desktop.sh
ENV DISPLAY=:99 HOME=/tmp/diabolix-home
WORKDIR /workspace
USER node
ENTRYPOINT ["/opt/diabolix/desktop.sh"]
