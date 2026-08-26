const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const axios = require("axios");
const { ensureAuthenticated } = require("../middleware/auth");
const { loadConfig } = require("../config/loader");
const Settings = require("../models/Settings");
const BannedConnection = require("../models/BannedConnection");
const federationClient = require("../services/federationClient");

const router = express.Router();
const BCRYPT_ROUNDS = 12;
const NEKOLIVE_HUB_URL = "https://nekolive.co.uk";
const GAMES_CACHE_MS = 5 * 60 * 1000;
let gamesCache = { expiresAt: 0, games: [] };

router.use(ensureAuthenticated);

async function fetchNekoLiveGames({ force = false } = {}) {
  if (!force && gamesCache.expiresAt > Date.now()) return gamesCache.games;

  try {
    const response = await axios.get(`${NEKOLIVE_HUB_URL}/api/games`, {
      timeout: 5000,
      headers: { Accept: "application/json" },
      validateStatus: () => true
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`NekoLive games API returned ${response.status}`);
    }

    const games = Array.isArray(response.data?.games)
      ? response.data.games
          .filter((game) => game && String(game.name || "").trim())
          .map((game) => ({
            id: game.id,
            name: String(game.name).trim(),
            image: String(game.image || ""),
            url: String(game.url || "")
          }))
      : [];

    gamesCache = { expiresAt: Date.now() + GAMES_CACHE_MS, games };
    return games;
  } catch (error) {
    console.warn("Could not load NekoLive game categories:", error.message);
    return gamesCache.games;
  }
}

router.get("/", async (req, res) => {
  const settings = await Settings.findByPk(1);
  const [bans, games] = await Promise.all([
    BannedConnection.findAll({ order: [["createdAt", "DESC"]] }),
    fetchNekoLiveGames()
  ]);
  const federationMessage = req.session.federationMessage || null;
  delete req.session.federationMessage;
  const config = loadConfig();
  res.render("admin/dashboard", {
    pageTitle: "Admin Dashboard",
    settings,
    bans,
    games,
    siteUrl: config.siteUrl || "",
    nekoliveHubUrl: NEKOLIVE_HUB_URL,
    nodeIdentity: federationClient.getNodeIdentity(),
    messages: { channel: null, account: null, ban: null, federation: federationMessage }
  });
});

router.post("/channel", async (req, res) => {
  const settings = await Settings.findByPk(1);
  settings.channelName = String(req.body.channelName || settings.channelName).trim().toLowerCase();
  settings.channelTitle = String(req.body.channelTitle || "").trim();
  settings.channelBio = String(req.body.channelBio || "").trim();

  const requestedGame = String(req.body.channelGame || "").trim();
  if (!requestedGame) {
    settings.channelGame = null;
  } else {
    const games = await fetchNekoLiveGames({ force: true });
    const match = games.find((game) => game.name === requestedGame);
    if (match) {
      settings.channelGame = match.name;
    } else {
      req.session.federationMessage =
        "Channel details saved, but the selected game is no longer available on NekoLive.";
    }
  }

  await settings.save();
  federationClient.heartbeat().catch(() => {});
  res.redirect("/admin");
});

router.post("/account", async (req, res) => {
  const settings = await Settings.findByPk(1);
  const { currentPassword, username, email, newPassword } = req.body;
  const currentMatches = await bcrypt.compare(String(currentPassword || ""), settings.passwordHash);
  if (!currentMatches) {
    req.session.federationMessage = "Account changes were not saved: current password is incorrect.";
    return res.redirect("/admin");
  }
  if (username) settings.ownerUsername = String(username).trim();
  if (email) settings.ownerEmail = String(email).trim();
  if (newPassword) {
    if (String(newPassword).length < 8) {
      req.session.federationMessage = "New password must be at least 8 characters.";
      return res.redirect("/admin");
    }
    settings.passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  }
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

router.post("/stream-key/regenerate", async (req, res) => {
  const settings = await Settings.findByPk(1);
  settings.streamKey = crypto.randomBytes(24).toString("hex");
  await settings.save();
  res.redirect("/admin");
});

router.post("/federation/pair", async (req, res) => {
  try {
    const transportMode = req.body.transportMode === "tunnel" ? "tunnel" : "direct";
    const settings = await federationClient.pair({
      hubUrl: NEKOLIVE_HUB_URL,
      publicUrl: req.body.publicUrl,
      pairingCode: req.body.pairingCode,
      transportMode
    });
    req.session.federationMessage = settings.federationChannelName
      ? `Selfhost node paired with NekoLive channel ${settings.federationChannelName} successfully.`
      : "Selfhost node paired with NekoLive successfully.";
  } catch (error) {
    req.session.federationMessage = error.message;
  }
  res.redirect("/admin");
});

router.post("/federation/guest", async (req, res) => {
  try {
    const settings = await federationClient.registerGuest({ hubUrl: NEKOLIVE_HUB_URL });
    req.session.federationMessage = `Anonymous NekoLive relay enabled as ${settings.federationChannelName}. No NekoLive account was created.`;
  } catch (error) {
    req.session.federationMessage = error.message;
  }
  res.redirect("/admin");
});

router.post("/federation/relay", async (req, res) => {
  try {
    const enabled = String(req.body.enabled || "") === "true";
    await federationClient.setRelayEnabled(enabled);
    req.session.federationMessage = enabled
      ? "NekoLive relay enabled. Your local stream remains the source."
      : "NekoLive relay disabled. Your local Selfhost stream is still running normally.";
  } catch (error) {
    req.session.federationMessage = error.message;
  }
  res.redirect("/admin");
});

router.post("/federation/disconnect", async (req, res) => {
  await federationClient.disconnect();
  req.session.federationMessage = "NekoLive federation link removed. Your local stream is unchanged.";
  res.redirect("/admin");
});

module.exports = router;
