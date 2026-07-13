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
    // Generated on /setup, shown (and regeneratable) from the admin
    // dashboard — not something the owner hand-edits into config.json. This
    // is what OME's admission webhook checks incoming publishes against
    // (routes/api/admission.js), via a `?jwt=` query param on the ingest URL.
    streamKey: { type: DataTypes.STRING, allowNull: false }
    // Multistream targets (formerly a single relayEnabled/relayRtmpUrl/
    // relayStreamKey/relayOmePushId set here) now live in their own
    // PushTarget rows — see models/PushTarget.js and services/multistream.js.
  },
  { sequelize, modelName: "Settings", tableName: "Settings", timestamps: true }
);

module.exports = Settings;
