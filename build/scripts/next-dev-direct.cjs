#!/usr/bin/env node

const path = require("node:path");
const { startServer } = require("next/dist/server/lib/start-server");

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) {
    return fallback;
  }
  return process.argv[index + 1];
}

const port = Number.parseInt(readArg("port", process.env.PORT || "3000"), 10);
const hostname = readArg("hostname", "127.0.0.1");
const dir = path.resolve(__dirname, "..");

process.env.NODE_ENV ||= "development";
process.env.NEXT_TELEMETRY_DISABLED ||= "1";

startServer({
  dir,
  port,
  hostname,
  isDev: true,
  allowRetry: false,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
