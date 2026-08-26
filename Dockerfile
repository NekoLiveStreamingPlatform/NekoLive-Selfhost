FROM node:20-bookworm-slim

WORKDIR /app

# Debian (glibc) base rather than Alpine — sqlite3's prebuilt native binary
# has broader glibc-platform prebuild coverage than musl, avoiding a
# from-source compile (which would otherwise need python3/make/g++ added
# here too).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Only runtime data is declared as a Docker volume. config/ also contains
# application code (config/loader.js), so mounting the whole directory would
# mask that code. docker-compose.yml mounts only config/config.json instead.
VOLUME ["/app/data"]

EXPOSE 8090

CMD ["node", "app.js"]
