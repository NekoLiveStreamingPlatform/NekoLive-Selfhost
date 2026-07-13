const { Model, DataTypes } = require("sequelize");
const sequelize = require("../db");

// One row per banned IP. Deliberately IP-only, not tied to any account —
// viewers never make an account at all, so this is the only identity the
// admin has to ban by. Consulted by BOTH the chat WS join handler and the
// OME admission webhook's `outgoing` (playback) branch — one ban action
// blocks both.
class BannedConnection extends Model {}
BannedConnection.init(
  {
    ip: { type: DataTypes.STRING, allowNull: false, unique: true },
    reason: { type: DataTypes.STRING, allowNull: true }
  },
  { sequelize, modelName: "BannedConnection", tableName: "BannedConnections", timestamps: true }
);

module.exports = BannedConnection;
