FROM node:20-bookworm-slim

WORKDIR /app

# Debian (glibc) base rather than Alpine — sqlite3's prebuilt native binary
# has broader glibc-platform prebuild coverage than musl, avoiding a
# from-source compile (which would otherwise need python3/make/g++ added
# here too).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# config/config.json and data/ are both gitignored (secrets + the SQLite
# file) — provided at runtime via volumes, see docker-compose.yml.
VOLUME ["/app/config", "/app/data"]

EXPOSE 8090

CMD ["node", "app.js"]
