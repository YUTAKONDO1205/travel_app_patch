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
    gatewayResult.gatewayCountries.some((country) => country.code === "HU"),
    "Expected Hungary to appear in the Europe corridor gateway pool when non-direct search is allowed.",
  );
  assert(
    gatewayResult.gatewayCountries.some((country) => country.code === "CZ"),
    "Expected Czech Republic to appear in the Europe corridor gateway pool when non-direct search is allowed.",
  );
  assert(
    gatewayResult.gatewayAirports.some((airport) => airport.code === "PRG"),
    "Expected Prague to appear in the Europe corridor gateway airport pool when non-direct search is allowed.",
  );
  assert(
    gatewayResult.gatewayAirports.length > gatewayResult.destinationAirports.length,
    "Expected gateway airport expansion for Germany search.",
  );

  const directGatewayResult = planner.generateFlightSearchResult({
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
    preferDirect: true,
  });

  assert(directGatewayResult, "Expected a result for Japan to Germany direct-first search.");
  assert(
    directGatewayResult.gatewayCountries.every((country) => country.code !== "HU" && country.code !== "CZ"),
    "Expected corridor gateway countries to stay out of the pool when direct-first search is enabled.",
  );
  assert(
    directGatewayResult.gatewayAirports.every((airport) => airport.code !== "BUD" && airport.code !== "PRG"),
    "Expected corridor gateway airports to stay out of the pool when direct-first search is enabled.",
  );

  const corridorResult = planner.generateFlightSearchResult({
    ...planner.INITIAL_FORM_STATE,
    departureCountry: "JP",
    destinationCountries: ["FR", "GB", "DE", "IT", "ES"],
    dateSearchMode: "flexible",
    outboundDate: "",
    targetMonths: ["2026-07", "2026-08"],
    stayLengthMin: "21",
    stayLengthMax: "45",
    passengerCount: "2",
    cabinClass: "economy",
    preferDirect: false,
  });

  assert(corridorResult, "Expected a result for the Western Europe corridor scenario.");
  assert(
    corridorResult.gatewayCountries.some((country) => country.code === "HU"),
    "Expected corridor search to include Hungary in the gateway country pool.",
  );
  assert(
    corridorResult.gatewayCountries.some((country) => country.code === "CZ"),
    "Expected corridor search to include Czech Republic in the gateway country pool.",
  );
  assert(corridorResult.bestOutbound.destination.code === "LGW", "Expected London Gatwick to win the outbound corridor estimate.");
  assert(corridorResult.bestInbound.origin.code === "BUD", "Expected Budapest to win the return corridor estimate.");
  assert(corridorResult.bestOutbound.stopCount >= 2, "Expected a higher-stop corridor outbound route.");
  assert(corridorResult.bestInbound.stopCount >= 2, "Expected a higher-stop corridor return route.");
  assert(
    corridorResult.bestOutbound.estimateBasis.includes("corridor"),
    "Expected the outbound estimate basis to call out corridor pricing.",
  );

  console.log("[planner-smoke] PASS deterministic gateway-pair planner result");
} finally {
  fs.rmSync(tempDir, { force: true, recursive: true });
}
