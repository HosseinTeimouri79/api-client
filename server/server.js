import { createApp } from "./app.js";
import { openDb } from "./db/index.js";
import { config } from "./config.js";

const db = openDb();
const server = createApp(db).listen(config.port, () =>
  console.log(`API Client listening on :${config.port}`),
);
process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));
const stop = () =>
  server.close(() => {
    db.close();
    process.exit(0);
  });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
