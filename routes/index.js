const express = require("express");
const bcrypt = require("bcrypt");
const Settings = require("../models/Settings");
const { loadConfig } = require("../config/loader");
const { resolveOmePlaybackUrls } = require("../services/omeClient");
const liveDetection = require("../services/liveDetection");
const viewerSessions = require("../services/viewerSessions");
const chatServer = require("../chat/chatServer");

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// One-time admin creation wizard. requireSetupComplete (app.js-mounted
// middleware) already redirects everyone here until a Settings row exists,
// and redirects away from here once one does — so this never ships a
// default credential and can't be re-run to hijack an already-configured
// instance.
router.get("/setup", async (req, res) => {
  const existing = await Settings.findByPk(1);
  if (existing) return res.redirect("/login");
  res.render("setup", { error: null, pageTitle: "Set up your channel" });
});

router.post("/setup", async (req, res) => {
  const existing = await Settings.findByPk(1);
  if (existing) return res.redirect("/login");

  const { username, email, password, channelName } = req.body;
  if (!username || !email || !password || !channelName) {
    return res.render("setup", { error: "All fields are required.", pageTitle: "Set up your channel" });
  }
  if (String(password).length < 8) {
    return res.render("setup", { error: "Password must be at least 8 characters.", pageTitle: "Set up your channel" });
  }

  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  await Settings.create({
    id: 1,
    ownerUsername: String(username).trim(),
    ownerEmail: String(email).trim(),
    passwordHash,
    channelName: String(channelName).trim().toLowerCase()
  });

  req.session.loggedIn = true;
  res.redirect("/admin");
});

router.get("/login", (req, res) => {
  if (req.session?.loggedIn) return res.redirect("/admin");
  res.render("login", { error: null, pageTitle: "Log in" });
});

router.post("/login", async (req, res) => {
  const settings = await Settings.findByPk(1);
  const { username, password } = req.body;
  const match = settings && (await bcrypt.compare(String(password || ""), settings.passwordHash));
  const usernameMatches = settings && String(username || "").toLowerCase() === settings.ownerUsername.toLowerCase();

  if (!settings || !usernameMatches || !match) {
    return res.render("login", { error: "Incorrect username or password.", pageTitle: "Log in" });
  }

  req.session.loggedIn = true;
  res.redirect("/admin");
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// The one and only channel page.
router.get("/", async (req, res) => {
  const settings = await Settings.findByPk(1);
  const config = loadConfig();
  const live = liveDetection.getState();
  const playback = resolveOmePlaybackUrls(config.ome, config.ome.streamName);

  res.render("channel", {
    pageTitle: settings?.channelName || "NekoLive Self-Host",
    channelName: settings?.channelName || "channel",
    channelTitle: settings?.channelTitle || "",
    channelBio: settings?.channelBio || "",
    isLive: live.isLive,
    whepUrl: playback.webrtc,
    llhlsUrl: playback.llhls,
    viewerCount: viewerSessions.countViewers(config.ome.streamName),
    isLoggedIn: !!req.session?.loggedIn,
    adminChatToken: req.session?.loggedIn ? chatServer.ADMIN_TOKEN : null
  });
});

module.exports = router;
