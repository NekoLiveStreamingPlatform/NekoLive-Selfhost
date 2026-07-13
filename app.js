const path = require("path");
const http = require("http");
const express = require("express");
const session = require("express-session");
const { loadConfig } = require("./config/loader");
const sequelize = require("./db");
const { requireSetupComplete } = require("./middleware/auth");

const indexRouter = require("./routes/index");
const adminRouter = require("./routes/admin");
const admissionRouter = require("./routes/api/admission");
const streamRouter = require("./routes/api/stream");
const chatServer = require("./chat/chatServer");
const liveDetection = require("./services/liveDetection");

const config = loadConfig();

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/js", express.static(path.join(__dirname, "views", "js")));
app.use("/css", express.static(path.join(__dirname, "views", "css")));

// In-memory session store — fine for a single small self-hosted process
// with one admin account; no need for Redis/DB-backed sessions here.
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax" }
  })
);

// The OME admission webhook is called by OME itself, not a browser — it
// must never redirect to /setup or /login, so it's mounted before that
// gate.
app.use("/api/admission/ome", admissionRouter);

app.use(requireSetupComplete);

app.use("/api/stream", streamRouter);
app.use("/admin", adminRouter);
app.use("/", indexRouter);

app.use((req, res) => res.status(404).send("Not found"));

const server = http.createServer(app);
chatServer.start(server);

sequelize
  .sync()
  .then(() => {
    liveDetection.start();
    server.listen(config.port, () => {
      console.log(`NekoLive Self-Host listening on ${config.siteUrl || `http://localhost:${config.port}`}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
  });

process.on("SIGINT", () => {
  liveDetection.stop();
  chatServer.stop();
  server.close(() => process.exit(0));
});
