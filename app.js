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
const multistreamRouter = require("./routes/api/multistream");
const federationRouter = require("./routes/api/federation");
const omeProxyRouter = require("./routes/api/omeProxy");
const chatServer = require("./chat/chatServer");
const liveDetection = require("./services/liveDetection");
const federationClient = require("./services/federationClient");

const config = loadConfig();

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/js", express.static(path.join(__dirname, "views", "js")));
app.use("/css", express.static(path.join(__dirname, "views", "css")));
app.use("/assets", express.static(path.join(__dirname, "views", "assets")));

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax" }
  })
);

app.use("/api/admission/ome", admissionRouter);
app.use(requireSetupComplete);

app.use("/ome", omeProxyRouter);
app.use("/api/stream", streamRouter);
app.use("/api/multistream", multistreamRouter);
app.use("/api/federation", federationRouter);
app.use("/admin", adminRouter);
app.use("/", indexRouter);

app.use((req, res) => res.status(404).send("Not found"));

const server = http.createServer(app);
chatServer.start(server);
chatServer.setRelaySender(federationClient.sendChatMessage);
federationClient.setChatInjector(chatServer.broadcastFederatedMessage);

sequelize
  .sync({ alter: true })
  .then(() => {
    liveDetection.start();
    federationClient.start();
    server.listen(config.port, () => {
      console.log(`NekoLive Self-Host listening on ${config.siteUrl || `http://localhost:${config.port}`}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
  });

process.on("SIGINT", () => {
  federationClient.stop();
  liveDetection.stop();
  chatServer.stop();
  server.close(() => process.exit(0));
});