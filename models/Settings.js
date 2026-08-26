const { Model, DataTypes } = require("sequelize");
const sequelize = require("../db");

class Settings extends Model {}
Settings.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    channelName: { type: DataTypes.STRING, allowNull: false, defaultValue: "channel" },
    channelTitle: { type: DataTypes.STRING, allowNull: true },
    channelBio: { type: DataTypes.TEXT, allowNull: true },
    // Selected from the official NekoLive Games API in the admin dashboard.
    // The central federation heartbeat validates it against that same table.
    channelGame: { type: DataTypes.STRING(120), allowNull: true },
    ownerUsername: { type: DataTypes.STRING, allowNull: false },
    ownerEmail: { type: DataTypes.STRING, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    streamKey: { type: DataTypes.STRING, allowNull: false },

    // NekoLive federation credentials are deliberately separate from the
    // creator's ingest/stream key. A one-time pairing code exchanges for a
    // node identity + HMAC secret, so linking a Selfhost node never requires
    // copying a broadcast key into the central NekoLive service.
    federationEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    federationRelayEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    federationGuestNode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    federationTransportMode: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "direct"
    },
    federationHubUrl: { type: DataTypes.STRING(500), allowNull: true },
    federationPublicUrl: { type: DataTypes.STRING(500), allowNull: true },
    federationNodeId: { type: DataTypes.STRING(80), allowNull: true },
    federationNodeSecret: { type: DataTypes.TEXT, allowNull: true },
    // Authoritative NekoLive channel for paired accounts, or the safe public
    // display name returned by NekoLive for a guest Selfhost node.
    federationChannelName: { type: DataTypes.STRING(80), allowNull: true },
    federationBlocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    federationLastSeenAt: { type: DataTypes.DATE, allowNull: true }
  },
  { sequelize, modelName: "Settings", tableName: "Settings", timestamps: true }
);

module.exports = Settings;
