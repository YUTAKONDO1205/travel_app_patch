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
    dateSearchMode: "flexible",
    outboundDate: "",
    targetMonths: ["2026-07", "2026-08", "2026-09"],
    stayLengthMin: "26",
    stayLengthMax: "36",
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
  assert(result.comparedOutboundDateCount >= 90, "Expected flexible outbound month comparison.");
  assert(result.comparedReturnDateCount === 11, "Expected 26-36 day return window.");
  assert(result.stayLengthRangeLabel === "26〜36日", "Expected flexible stay range label.");
  assert(result.flexibilitySummary.includes("2026年7月"), "Expected month labels in flexibility summary.");
  assert(result.gatewayCountries.length > result.destinationCountries.length, "Expected gateway country expansion.");
  assert(result.gatewayAirports.length > result.destinationAirports.length, "Expected expanded gateway airport pool.");
  assert(
    result.ticketingSummary.includes("片道券") || result.ticketingSummary.includes("片道2枚"),
    "Expected explicit two-ticket summary.",
  );
  assert(
    result.betweenTicketsGap.note.includes("片道2枚") || result.betweenTicketsGap.note.includes("国際線"),
    "Expected explicit internal-travel exclusion note.",
  );
  assert(result.combinedSearchUrl.includes("skyscanner"), "Expected Skyscanner combined handoff.");

  const gatewayResult = planner.generateFlightSearchResult({
    ...planner.INITIAL_FORM_STATE,
    departureCountry: "JP",
    destinationCountries: ["DE"],
    dateSearchMode: "flexible",
    outboundDate: "",
    targetMonths: ["2026-08"],
    stayLengthMin: "30",
    stayLengthMax: "36",
    passengerCount: "2",
    cabinClass: "economy",
    preferDirect: false,
  });

  assert(gatewayResult, "Expected a result for Japan to Germany gateway search.");
  assert(
    gatewayResult.gatewayCountries.some((country) => country.code === "IT"),
    "Expected Italy to appear in the gateway search pool for Germany.",
  );
  assert(
    gatewayResult.gatewayAirports.length > gatewayResult.destinationAirports.length,
    "Expected gateway airport expansion for Germany search.",
  );

  console.log("[planner-smoke] PASS deterministic gateway-pair planner result");
} finally {
  fs.rmSync(tempDir, { force: true, recursive: true });
}
