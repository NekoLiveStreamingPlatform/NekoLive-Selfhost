const { Model, DataTypes } = require("sequelize");
const sequelize = require("../db");

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
    streamKey: { type: DataTypes.STRING, allowNull: false },

    // NekoLive federation credentials are deliberately separate from the
    // creator's ingest/stream key. A one-time pairing code exchanges for a
    // node identity + HMAC secret, so linking a Selfhost node never requires
    // copying a broadcast key into the central NekoLive service.
    federationEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    federationHubUrl: { type: DataTypes.STRING(500), allowNull: true },
    federationPublicUrl: { type: DataTypes.STRING(500), allowNull: true },
    federationNodeId: { type: DataTypes.STRING(80), allowNull: true },
    federationNodeSecret: { type: DataTypes.TEXT, allowNull: true },
    federationBlocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    federationLastSeenAt: { type: DataTypes.DATE, allowNull: true }
  },
  { sequelize, modelName: "Settings", tableName: "Settings", timestamps: true }
);

module.exports = Settings;
