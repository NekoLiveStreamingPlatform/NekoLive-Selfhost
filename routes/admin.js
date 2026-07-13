const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { ensureAuthenticated } = require("../middleware/auth");
const Settings = require("../models/Settings");
const BannedConnection = require("../models/BannedConnection");

const router = express.Router();
const BCRYPT_ROUNDS = 12;

router.use(ensureAuthenticated);

router.get("/", async (req, res) => {
  const settings = await Settings.findByPk(1);
  const bans = await BannedConnection.findAll({ order: [["createdAt", "DESC"]] });
  res.render("admin/dashboard", {
    pageTitle: "Admin Dashboard",
    settings,
    bans,
    messages: { channel: null, account: null, relay: null, ban: null }
  });
});

router.post("/channel", async (req, res) => {
  const settings = await Settings.findByPk(1);
  settings.channelName = String(req.body.channelName || settings.channelName).trim().toLowerCase();
  settings.channelTitle = String(req.body.channelTitle || "").trim();
  settings.channelBio = String(req.body.channelBio || "").trim();
  await settings.save();
  res.redirect("/admin");
});

router.post("/account", async (req, res) => {
  const settings = await Settings.findByPk(1);
  const { currentPassword, username, email, newPassword } = req.body;

  const currentMatches = await bcrypt.compare(String(currentPassword || ""), settings.passwordHash);
  if (!currentMatches) {
    const bans = await BannedConnection.findAll({ order: [["createdAt", "DESC"]] });
    return res.render("admin/dashboard", {
      pageTitle: "Admin Dashboard",
      settings,
      bans,
      messages: { channel: null, account: "Current password is incorrect.", relay: null, ban: null }
    });
  }

  if (username) settings.ownerUsername = String(username).trim();
  if (email) settings.ownerEmail = String(email).trim();
  if (newPassword) {
    if (String(newPassword).length < 8) {
      const bans = await BannedConnection.findAll({ order: [["createdAt", "DESC"]] });
      return res.render("admin/dashboard", {
        pageTitle: "Admin Dashboard",
        settings,
        bans,
        messages: { channel: null, account: "New password must be at least 8 characters.", relay: null, ban: null }
      });
    }
    settings.passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  }
  await settings.save();
  res.redirect("/admin");
});

router.post("/relay", async (req, res) => {
  const settings = await Settings.findByPk(1);
  settings.relayEnabled = req.body.relayEnabled === "on";
  settings.relayRtmpUrl = String(req.body.relayRtmpUrl || "").trim();
  settings.relayStreamKey = String(req.body.relayStreamKey || "").trim();
  await settings.save();
  res.redirect("/admin");
});

router.post("/ban", async (req, res) => {
  const ip = String(req.body.ip || "").trim();
  if (ip) {
    await BannedConnection.findOrCreate({
      where: { ip },
      defaults: { reason: String(req.body.reason || "").trim() || null }
    });
  }
  res.redirect("/admin");
});

router.post("/ban/:id/remove", async (req, res) => {
  await BannedConnection.destroy({ where: { id: req.params.id } });
  res.redirect("/admin");
});

// Regenerating invalidates the old key immediately — anyone still trying to
// publish with it (including the owner's own already-configured broadcast
// software) will start getting denied by the admission webhook right away.
router.post("/stream-key/regenerate", async (req, res) => {
  const settings = await Settings.findByPk(1);
  settings.streamKey = crypto.randomBytes(24).toString("hex");
  await settings.save();
  res.redirect("/admin");
});

module.exports = router;
