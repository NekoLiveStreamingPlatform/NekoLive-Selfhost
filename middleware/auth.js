const Settings = require("../models/Settings");

// No default admin/admin credential ships with this app — every request is
// redirected to /setup until a Settings row actually exists, and /setup
// stops working the moment one does (see routes/index.js).
async function requireSetupComplete(req, res, next) {
  try {
    const settings = await Settings.findByPk(1);
    if (!settings && req.path !== "/setup") return res.redirect("/setup");
    if (settings && req.path === "/setup") return res.redirect("/login");
    next();
  } catch (error) {
    next(error);
  }
}

function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect("/login");
}

module.exports = { requireSetupComplete, ensureAuthenticated };
