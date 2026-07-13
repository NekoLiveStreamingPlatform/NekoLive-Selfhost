const { Model, DataTypes } = require("sequelize");
const sequelize = require("../db");

// Singleton row (id is always 1) — this app has exactly one owner and one
// channel, so there's no point normalizing this into separate tables the
// way NekoLive's multi-tenant Channel/User split needs to.
class Settings extends Model {}
Settings.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    channelName: { type: DataTypes.STRING, allowNull: false, defaultValue: "channel" },
    channelTitle: { type: DataTypes.STRING, allowNull: true },
    channelBio: { type: DataTypes.TEXT, allowNull: true },
    ownerUsername: { type: DataTypes.STRING, allowNull: false },
    ownerEmail: { type: DataTypes.STRING, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    relayEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    relayRtmpUrl: { type: DataTypes.STRING, allowNull: true },
    relayStreamKey: { type: DataTypes.STRING, allowNull: true },
    relayOmePushId: { type: DataTypes.STRING, allowNull: true }
  },
  { sequelize, modelName: "Settings", tableName: "Settings", timestamps: true }
);

module.exports = Settings;
