# Foody — Slack Socket Mode worker.
# No inbound port: it dials out to Slack over a WebSocket, so this runs fine as
# a "background worker" on Railway / Render / Fly with nothing exposed.
FROM node:22-slim

WORKDIR /app

# Foody runs TypeScript directly via tsx, and checkout.ts imports puppeteer at
# module load — so we install ALL deps (tsx, puppeteer-extra, …), but skip the
# ~150MB Chromium binary: the hosted demo runs in mock mode and never launches it.
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Demo defaults — set SLACK_* via the host's env / secrets.
ENV NODE_ENV=production \
    FOODY_DISABLE_LIVE=1 \
    FOODY_LOG_LEVEL=info

CMD ["npm", "run", "start"]
