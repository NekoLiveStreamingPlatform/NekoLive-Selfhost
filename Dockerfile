FROM node:20-bookworm-slim

WORKDIR /app

# Debian (glibc) base rather than Alpine — sqlite3's prebuilt native binary
# has broader glibc-platform prebuild coverage than musl, avoiding a
# from-source compile (which would otherwise need python3/make/g++ added
# here too).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Fail the multi-arch image build before publishing if a runtime JavaScript
# file contains a syntax error. Compile the admin EJS too because federation
# settings/game-category UI changes live there and a malformed template would
# otherwise only fail when a creator opens /admin.
RUN node --check app.js \
 && node --check models/Settings.js \
 && node --check routes/admin.js \
 && node --check routes/api/omeProxy.js \
 && node --check chat/chatServer.js \
 && node --check services/nodeIdentity.js \
 && node --check services/federationClient.js \
 && node --check services/omeClient.js \
 && node -e "require('ejs').compile(require('fs').readFileSync('views/admin/dashboard.ejs','utf8'))"

# Only runtime data is declared as a Docker volume. config/ also contains
# application code (config/loader.js), so mounting the whole directory would
# mask that code. docker-compose.yml mounts only config/config.json instead.
VOLUME ["/app/data"]

EXPOSE 8090

CMD ["node", "app.js"]
