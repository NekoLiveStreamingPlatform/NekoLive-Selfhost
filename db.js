const path = require("path");
const fs = require("fs");
const { Sequelize } = require("sequelize");

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// SQLite — a single file, no separate database server to install/configure.
// That's the whole point of this being a self-hosted app someone can just
// run, unlike the main NekoLive site's MySQL requirement.
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: path.join(dataDir, "selfhost.sqlite"),
  logging: false
});

module.exports = sequelize;
