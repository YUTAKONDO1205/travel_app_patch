#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maison-passage-planner-"));

function transpileFile(sourceFile, outputFile) {
  const source = fs.readFileSync(path.join(projectRoot, sourceFile), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceFile,
  });
  fs.writeFileSync(path.join(tempDir, outputFile), output.outputText, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  transpileFile("lib/travel-data.ts", "travel-data.js");
  transpileFile("lib/travel-planner.ts", "travel-planner.js");

  const planner = require(path.join(tempDir, "travel-planner.js"));
  const result = planner.generateFlightSearchResult({
    ...planner.INITIAL_FORM_STATE,
    departureCountry: "JP",
    destinationCountries: ["FR", "GB", "DE"],
    outboundDate: "2026-10-10",
    stayLength: "10",
    passengerCount: "2",
    cabinClass: "economy",
    preferDirect: false,
  });

  assert(result, "Expected a result for Japan to France/GB/Germany.");
  assert(result.bestOutbound.totalPrice > 0, "Expected outbound price.");
  assert(result.bestInbound.totalPrice > 0, "Expected return price.");
  assert(result.totalPriceRange.low <= result.totalPrice, "Expected total price to be within low range.");
  assert(result.totalPriceRange.high >= result.totalPrice, "Expected total price to be within high range.");
  assert(result.bestOutbound.totalPriceRange.low <= result.bestOutbound.totalPrice, "Expected outbound range.");
  assert(result.bestInbound.totalPriceRange.high >= result.bestInbound.totalPrice, "Expected return range.");
  assert(result.bestOutbound.confidenceLabel.startsWith("信頼度:"), "Expected outbound confidence label.");
  assert(result.bestInbound.estimateBasis.includes("km"), "Expected return estimate basis.");
  assert(result.openJawGap.note.includes("移動費") || result.openJawGap.note.includes("国際線の入口と出口"), "Expected explicit internal-travel exclusion note.");
  assert(result.multiCityUrl.includes("skyscanner"), "Expected Skyscanner multi-city handoff.");

  console.log("[planner-smoke] PASS deterministic open-jaw planner result");
} finally {
  fs.rmSync(tempDir, { force: true, recursive: true });
}
