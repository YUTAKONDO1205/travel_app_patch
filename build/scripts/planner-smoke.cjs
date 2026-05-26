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
  const travelData = require(path.join(tempDir, "travel-data.js"));

  assert(
    travelData.COUNTRY_OPTIONS.every((option) => option.value !== "HU" && option.value !== "CZ" && option.value !== "MY"),
    "Expected corridor-only countries to stay out of the primary country picker.",
  );
  assert(
    travelData.COUNTRY_LABELS.HU && travelData.COUNTRY_LABELS.CZ && travelData.COUNTRY_LABELS.MY,
    "Expected corridor-only country labels to remain available for gateway summaries.",
  );

  // Label integrity: catch silent Shift_JIS-as-UTF-8 mojibake in corridor entries.
  const mojibakeMarkers = ["繝", "荳ｭ", "蛻", "縺", "ｺ", "ｼ", "ｱ", "ｭ"];
  function assertNoMojibake(label, where) {
    for (const marker of mojibakeMarkers) {
      assert(!label.includes(marker), `Expected clean Japanese label in ${where}, found mojibake marker "${marker}" in "${label}".`);
    }
  }
  assert(travelData.COUNTRY_LABELS.CZ === "チェコ", `Expected CZ label "チェコ", got "${travelData.COUNTRY_LABELS.CZ}".`);
  assert(travelData.COUNTRY_LABELS.MY === "マレーシア", `Expected MY label "マレーシア", got "${travelData.COUNTRY_LABELS.MY}".`);
  assertNoMojibake(travelData.AIRPORTS.PRG.city, "AIRPORTS.PRG.city");
  assertNoMojibake(travelData.AIRPORTS.PRG.name, "AIRPORTS.PRG.name");
  assertNoMojibake(travelData.AIRPORTS.PRG.countryName, "AIRPORTS.PRG.countryName");
  assertNoMojibake(travelData.AIRPORTS.KUL.city, "AIRPORTS.KUL.city");
  Object.values(travelData.COUNTRY_LABELS).forEach((label) => assertNoMojibake(label, `COUNTRY_LABELS["${label}"]`));
  travelData.COUNTRY_PROFILES.forEach((country) => {
    assertNoMojibake(country.region, `COUNTRY_PROFILES["${country.code}"].region`);
    assertNoMojibake(country.summary, `COUNTRY_PROFILES["${country.code}"].summary`);
  });

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
  assert(result.liveFareSources.length === 3, "Expected outbound, return, and combined live fare sources.");
  assert(
    result.liveFareSources.every((source) => source.provider === "Skyscanner"),
    "Expected live fare sources to point at Skyscanner.",
  );
  assert(
    result.liveFareSources.some((source) => source.id === "outbound" && source.status === "near-live"),
    "Expected an outbound near-live fare handoff source.",
  );
  assert(
    result.liveFareSources.some((source) => source.id === "combined" && source.status === "reference"),
    "Expected a combined reference fare handoff source.",
  );
  assert(
    result.planningNote.includes("near-live handoff") || result.planningNote.includes("手入力"),
    "Expected planning note to explain near-live handoff fallback.",
  );

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

  const seaCorridorResult = planner.generateFlightSearchResult({
    ...planner.INITIAL_FORM_STATE,
    departureCountry: "JP",
    destinationCountries: ["TH", "SG"],
    dateSearchMode: "flexible",
    outboundDate: "",
    targetMonths: ["2026-09"],
    stayLengthMin: "14",
    stayLengthMax: "21",
    passengerCount: "2",
    cabinClass: "economy",
    preferDirect: false,
  });

  assert(seaCorridorResult, "Expected a result for the Southeast Asia corridor scenario.");
  assert(
    seaCorridorResult.gatewayCountries.some((country) => country.code === "MY"),
    "Expected Malaysia to appear in the SEA corridor gateway country pool when non-direct is allowed.",
  );
  assert(
    seaCorridorResult.gatewayAirports.some((airport) => airport.code === "KUL"),
    "Expected Kuala Lumpur (KUL) to appear in the SEA corridor airport pool when non-direct is allowed.",
  );

  const seaDirectResult = planner.generateFlightSearchResult({
    ...planner.INITIAL_FORM_STATE,
    departureCountry: "JP",
    destinationCountries: ["TH", "SG"],
    dateSearchMode: "flexible",
    outboundDate: "",
    targetMonths: ["2026-09"],
    stayLengthMin: "14",
    stayLengthMax: "21",
    passengerCount: "2",
    cabinClass: "economy",
    preferDirect: true,
  });

  assert(seaDirectResult, "Expected a result for the Southeast Asia direct-first scenario.");
  assert(
    seaDirectResult.gatewayCountries.every((country) => country.code !== "MY"),
    "Expected Malaysia to stay out of the SEA gateway pool when direct-first is enabled.",
  );
  assert(
    seaDirectResult.gatewayAirports.every((airport) => airport.code !== "KUL"),
    "Expected Kuala Lumpur to stay out of the SEA gateway pool when direct-first is enabled.",
  );

  console.log("[planner-smoke] PASS deterministic gateway-pair planner result");
} finally {
  fs.rmSync(tempDir, { force: true, recursive: true });
}
