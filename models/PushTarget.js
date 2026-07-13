const { Model, DataTypes } = require("sequelize");
const sequelize = require("../db");

// One row per multistream destination (Twitch, YouTube, Kick, your own
// NekoLive channel, any custom RTMP/SRT target...). No channel_id — this
// app only ever has the one channel. Mirrors NekoLive's own
// models/PushPublishTarget.js, minus the multi-tenant FK.
class PushTarget extends Model {}
PushTarget.init(
  {
    label: { type: DataTypes.STRING, allowNull: false },
    protocol: { type: DataTypes.STRING, allowNull: false, defaultValue: "rtmp" },
    url: { type: DataTypes.STRING, allowNull: false },
    streamKey: { type: DataTypes.STRING, allowNull: true },
    // The streamer's persisted on/off intent — independent of whether it's
    // actually pushing right now (that's omePushId). Turning this on while
    // already live starts the push immediately (see routes/api/multistream.js's
    // toggle handler); it doesn't wait for the next go-live event.
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    omePushId: { type: DataTypes.STRING, allowNull: true }
  },
  { sequelize, modelName: "PushTarget", tableName: "PushTargets", timestamps: true }
);

module.exports = PushTarget;
