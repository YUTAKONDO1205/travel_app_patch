import {
  COUNTRY_LABELS,
  FLEXIBLE_MONTH_OPTIONS,
  FLEXIBLE_STAY_DAY_OPTIONS,
  STAY_LENGTH_OPTIONS,
  getAirportsForCountry,
  getGatewayAirportsForDestinationCodes,
  getGatewayCountriesForDestinationCodes,
  getCountryProfile,
  type Airport,
  type CabinClassKey,
  type CountryCode,
  type CountryProfile,
  type FlexibleStayDayKey,
  type PassengerCountKey,
  type StayLengthKey,
  type TravelMonthKey,
} from "./travel-data";

export type DateSearchMode = "exact" | "flexible";

export type PlannerFormState = {
  departureCountry: CountryCode | "";
  destinationCountries: CountryCode[];
  dateSearchMode: DateSearchMode;
  outboundDate: string;
  targetMonths: TravelMonthKey[];
  stayLength: StayLengthKey | "";
  stayLengthMin: FlexibleStayDayKey;
  stayLengthMax: FlexibleStayDayKey;
  passengerCount: PassengerCountKey;
  cabinClass: CabinClassKey;
  preferDirect: boolean;
};

export type FlightLegQuote = {
  direction: "outbound" | "return";
  origin: Airport;
  destination: Airport;
  travelDate: string;
  pricePerPerson: number;
  totalPrice: number;
  priceRangePerPerson: PriceRange;
  totalPriceRange: PriceRange;
  confidenceLabel: string;
  estimateBasis: string;
  durationHours: number;
  stopCount: number;
  stopLabel: string;
  distanceKm: number;
  reasonPoints: string[];
  skyscannerUrl: string;
};

export type PriceRange = {
  low: number;
  high: number;
};

export type CountryCoverage = {
  country: CountryProfile;
  airports: Airport[];
  bestOutbound: FlightLegQuote | null;
  bestInbound: FlightLegQuote | null;
};

export type BetweenTicketsGap = {
  arrivalLabel: string;
  departureLabel: string;
  distanceKm: number;
  summary: string;
  note: string;
};

export type FlightSearchResult = {
  departureCountry: CountryProfile;
  destinationCountries: CountryProfile[];
  departureAirports: Airport[];
  destinationAirports: Airport[];
  gatewayCountries: CountryProfile[];
  gatewayAirports: Airport[];
  outboundDate: string;
  returnDate: string;
  outboundDateWindow: string;
  returnDateWindow: string;
  stayLengthRangeLabel: string;
  flexibilitySummary: string;
  comparedOutboundDateCount: number;
  comparedReturnDateCount: number;
  bestOutbound: FlightLegQuote;
  bestInbound: FlightLegQuote;
  outboundAlternatives: FlightLegQuote[];
  inboundAlternatives: FlightLegQuote[];
  coverage: CountryCoverage[];
  totalPricePerPerson: number;
  totalPrice: number;
  totalPriceRangePerPerson: PriceRange;
  totalPriceRange: PriceRange;
  planHeadline: string;
  gatewaySummary: string;
  ticketingSummary: string;
  betweenTicketsGap: BetweenTicketsGap;
  planningNote: string;
  combinedSearchUrl: string;
};

export const INITIAL_FORM_STATE: PlannerFormState = {
  departureCountry: "JP",
  destinationCountries: ["FR", "GB", "DE"],
  dateSearchMode: "flexible",
  outboundDate: "",
  targetMonths: ["2026-07", "2026-08", "2026-09"],
  stayLength: "7",
  stayLengthMin: "26",
  stayLengthMax: "36",
  passengerCount: "1",
  cabinClass: "economy",
  preferDirect: false,
};

const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const distanceFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 0,
});

function parseIsoDate(dateString: string): Date | null {
  const [yearString, monthString, dayString] = dateString.split("-");
  const year = Number.parseInt(yearString ?? "", 10);
  const month = Number.parseInt(monthString ?? "", 10);
  const day = Number.parseInt(dayString ?? "", 10);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number): string {
  const date = parseIsoDate(dateString);
  if (!date) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function compareIsoDates(left: string, right: string): number {
  return left.localeCompare(right);
}

function getMonthDateRange(monthKey: TravelMonthKey): string[] {
  const [yearString, monthString] = monthKey.split("-");
  const year = Number.parseInt(yearString ?? "", 10);
  const month = Number.parseInt(monthString ?? "", 10);

  if (!year || !month) {
    return [];
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Array.from({ length: lastDay }, (_, index) => formatIsoDate(new Date(Date.UTC(year, month - 1, index + 1))));
}

function getFlexibleStayDays(stayLength: FlexibleStayDayKey): number {
  return FLEXIBLE_STAY_DAY_OPTIONS.find((option) => option.value === stayLength)?.days ?? 0;
}

function getStayRange(formState: PlannerFormState): { min: number; max: number } {
  if (formState.dateSearchMode === "exact") {
    const days = getStayDays(formState.stayLength);
    return { min: days, max: days };
  }

  const min = getFlexibleStayDays(formState.stayLengthMin);
  const max = getFlexibleStayDays(formState.stayLengthMax);

  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
}

function getOutboundCandidateDates(formState: PlannerFormState): string[] {
  if (formState.dateSearchMode === "exact") {
    return formState.outboundDate ? [formState.outboundDate] : [];
  }

  return [...new Set(formState.targetMonths.flatMap((monthKey) => getMonthDateRange(monthKey)))].sort(compareIsoDates);
}

function getReturnCandidateDates(outboundDate: string, formState: PlannerFormState): string[] {
  const { min, max } = getStayRange(formState);

  if (!outboundDate || min <= 0 || max <= 0) {
    return [];
  }

  return Array.from({ length: max - min + 1 }, (_, index) => addDays(outboundDate, min + index)).filter(Boolean);
}

function haversineDistanceKm(origin: Airport, destination: Airport): number {
  const earthRadiusKm = 6371;
  const lat1 = (origin.latitude * Math.PI) / 180;
  const lat2 = (destination.latitude * Math.PI) / 180;
  const deltaLat = ((destination.latitude - origin.latitude) * Math.PI) / 180;
  const deltaLon = ((destination.longitude - origin.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusKm * c);
}

function getStayDays(stayLength: StayLengthKey | ""): number {
  return STAY_LENGTH_OPTIONS.find((option) => option.value === stayLength)?.days ?? 0;
}

function getCabinMultiplier(cabinClass: CabinClassKey): number {
  if (cabinClass === "premiumeconomy") {
    return 1.42;
  }
  if (cabinClass === "business") {
    return 2.38;
  }
  return 1;
}

function getSeasonFactor(dateString: string): { factor: number; label: string } {
  const month = parseIsoDate(dateString)?.getUTCMonth() ?? 0;

  if ([6, 7].includes(month)) {
    return { factor: 1.16, label: "夏休みシーズン" };
  }
  if ([11, 0].includes(month)) {
    return { factor: 1.14, label: "年末年始寄り" };
  }
  if ([2, 3, 4, 9].includes(month)) {
    return { factor: 1.02, label: "旅行需要が乗りやすい肩シーズン" };
  }
  return { factor: 0.94, label: "比較的落ち着いた時期" };
}

function getDateFlexFactor(dateString: string): { factor: number; label: string } {
  const date = parseIsoDate(dateString);

  if (!date) {
    return { factor: 1, label: "日付未設定" };
  }

  const day = date.getUTCDate();
  const dayOfWeek = date.getUTCDay();
  const month = date.getUTCMonth() + 1;
  const deterministicWave = (((month * 37 + day * 17) % 13) - 6) / 100;
  const weekdayFactor = dayOfWeek === 2 || dayOfWeek === 3 ? -0.035 : dayOfWeek === 5 || dayOfWeek === 6 ? 0.045 : 0;
  const midMonthFactor = day >= 12 && day <= 18 ? -0.025 : 0;
  const factor = 1 + deterministicWave + weekdayFactor + midMonthFactor;

  if (factor <= 0.94) {
    return { factor, label: "月内で割安な日付" };
  }

  if (factor >= 1.05) {
    return { factor, label: "週末・需要高めの日付" };
  }

  return { factor, label: "標準的な日付" };
}

function supportsDirectRoute(origin: Airport, destination: Airport, distanceKm: number): boolean {
  if (distanceKm <= 4200) {
    return true;
  }

  if (distanceKm <= 9800 && origin.hubScore + destination.hubScore >= 7) {
    return true;
  }

  return distanceKm <= 11800 && origin.hubScore + destination.hubScore >= 9;
}

function roundToNearestHundred(value: number): number {
  return Math.round(value / 100) * 100;
}

function buildPriceRange(value: number, uncertainty: number): PriceRange {
  return {
    low: Math.max(0, roundToNearestHundred(value * (1 - uncertainty))),
    high: roundToNearestHundred(value * (1 + uncertainty)),
  };
}

function getEstimateConfidence({
  origin,
  destination,
  distanceKm,
  stopCount,
}: {
  origin: Airport;
  destination: Airport;
  distanceKm: number;
  stopCount: number;
}): string {
  const hubStrength = origin.hubScore + destination.hubScore;

  if (stopCount === 0 && hubStrength >= 9) {
    return "信頼度: 高";
  }

  if (hubStrength >= 7 && distanceKm < 10500) {
    return "信頼度: 中";
  }

  return "信頼度: 参考";
}

function buildSkyscannerUrl(
  pageType: "day-view" | "multicity",
  params: Record<string, string | number | boolean | undefined>,
): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    searchParams.set(key, String(value));
  });

  searchParams.set("market", "JP");
  searchParams.set("locale", "ja-JP");
  searchParams.set("currency", "JPY");

  return `https://www.skyscanner.net/g/referrals/v1/flights/${pageType}/?${searchParams.toString()}`;
}

function buildRouteReasons({
  origin,
  destination,
  dateString,
  stopCount,
}: {
  origin: Airport;
  destination: Airport;
  dateString: string;
  stopCount: number;
}): string[] {
  const season = getSeasonFactor(dateString);

  return [
    `${origin.city}(${origin.code}) と ${destination.city}(${destination.code}) を代表空港として比較しています。`,
    stopCount === 0 ? "主要ハブ同士を優先し、直行ベースで候補化しています。" : "1回乗継を許容し、片道運賃を圧縮しやすい組み合わせを優先しています。",
    `${season.label}の参考運賃です。実勢価格は Skyscanner 側で再確認してください。`,
  ];
}

function compareQuotes(left: FlightLegQuote, right: FlightLegQuote): number {
  return left.totalPrice - right.totalPrice || left.durationHours - right.durationHours;
}

function buildFlightQuote({
  origin,
  destination,
  travelDate,
  passengerCount,
  cabinClass,
  preferDirect,
  direction,
}: {
  origin: Airport;
  destination: Airport;
  travelDate: string;
  passengerCount: PassengerCountKey;
  cabinClass: CabinClassKey;
  preferDirect: boolean;
  direction: "outbound" | "return";
}): FlightLegQuote | null {
  const distanceKm = haversineDistanceKm(origin, destination);
  const canDirect = supportsDirectRoute(origin, destination, distanceKm);

  if (preferDirect && !canDirect) {
    return null;
  }

  const stopCount = preferDirect || canDirect ? 0 : 1;
  const stopLabel = stopCount === 0 ? "直行想定" : "1回乗継";
  const season = getSeasonFactor(travelDate);
  const dateFlex = getDateFlexFactor(travelDate);
  const hubFactor = 1 - Math.max(-0.08, (origin.hubScore + destination.hubScore - 8) * 0.018);
  const cabinMultiplier = getCabinMultiplier(cabinClass);
  const directionFactor = direction === "return" ? 1.03 : 1;
  const directFactor = stopCount === 0 ? 1.08 : 0.94;
  const baseFare = 18000 + distanceKm * 11.4;
  const pricePerPerson = roundToNearestHundred(
    baseFare * season.factor * dateFlex.factor * hubFactor * cabinMultiplier * directFactor * directionFactor,
  );
  const totalPrice = pricePerPerson * Number.parseInt(passengerCount, 10);
  const uncertainty = 0.1 + (stopCount === 0 ? 0.03 : 0.06) + (distanceKm > 9500 ? 0.04 : 0);
  const priceRangePerPerson = buildPriceRange(pricePerPerson, uncertainty);
  const passengerCountValue = Number.parseInt(passengerCount, 10);
  const totalPriceRange = {
    low: priceRangePerPerson.low * passengerCountValue,
    high: priceRangePerPerson.high * passengerCountValue,
  };
  const averageSpeed = stopCount === 0 ? 860 : 760;
  const durationHours = Math.round((distanceKm / averageSpeed + (stopCount === 0 ? 1.1 : 4.1)) * 10) / 10;
  const confidenceLabel = getEstimateConfidence({ origin, destination, distanceKm, stopCount });

  return {
    direction,
    origin,
    destination,
    travelDate,
    pricePerPerson,
    totalPrice,
    priceRangePerPerson,
    totalPriceRange,
    confidenceLabel,
    estimateBasis: `${season.label} / ${dateFlex.label} / ${stopLabel} / ${distanceKm.toLocaleString("ja-JP")}km`,
    durationHours,
    stopCount,
    stopLabel,
    distanceKm,
    reasonPoints: buildRouteReasons({ origin, destination, dateString: travelDate, stopCount }),
    skyscannerUrl: buildSkyscannerUrl("day-view", {
      origin: origin.code.toLowerCase(),
      destination: destination.code.toLowerCase(),
      outboundDate: travelDate,
      adultsv2: Number.parseInt(passengerCount, 10),
      cabinclass: cabinClass,
      preferDirects: preferDirect,
      outboundaltsenabled: false,
      inboundaltsenabled: false,
    }),
  };
}

function buildCountryCoverage(
  destinationCountries: CountryProfile[],
  outboundQuotes: FlightLegQuote[],
  inboundQuotes: FlightLegQuote[],
): CountryCoverage[] {
  return destinationCountries.map((country) => {
    const airports = getAirportsForCountry(country.code);

    return {
      country,
      airports,
      bestOutbound: outboundQuotes.find((quote) => quote.destination.countryCode === country.code) ?? null,
      bestInbound: inboundQuotes.find((quote) => quote.origin.countryCode === country.code) ?? null,
    };
  });
}

export function getReturnDate(formState: PlannerFormState): string {
  const { min } = getStayRange(formState);
  return formState.outboundDate && min > 0 ? addDays(formState.outboundDate, min) : "";
}

export function formatTargetMonthLabel(monthKey: TravelMonthKey): string {
  return FLEXIBLE_MONTH_OPTIONS.find((option) => option.value === monthKey)?.label ?? monthKey;
}

export function getStayRangeLabel(formState: PlannerFormState): string {
  const { min, max } = getStayRange(formState);

  if (!min || !max) {
    return "未設定";
  }

  return min === max ? `${min}日` : `${min}〜${max}日`;
}

export function getDateSearchSummary(formState: PlannerFormState): string {
  if (formState.dateSearchMode === "exact") {
    const returnDate = getReturnDate(formState);
    return returnDate ? `${formatDateLabel(formState.outboundDate)}出発 / ${formatDateLabel(returnDate)}帰国` : "日付指定";
  }

  const monthLabels = formState.targetMonths.map((monthKey) => formatTargetMonthLabel(monthKey)).join(" / ");
  return `${monthLabels || "月未設定"}出発 / 滞在${getStayRangeLabel(formState)}`;
}

export function getReturnWindowLabel(outboundDate: string, formState: PlannerFormState): string {
  const returnDates = getReturnCandidateDates(outboundDate, formState);

  if (!returnDates.length) {
    return "未設定";
  }

  return returnDates.length === 1
    ? formatDateLabel(returnDates[0])
    : `${formatDateLabel(returnDates[0])}〜${formatDateLabel(returnDates[returnDates.length - 1])}`;
}

export function getFormValidationMessage(formState: PlannerFormState): string | null {
  if (!formState.departureCountry) {
    return "出発国を選んでください。";
  }

  if (formState.destinationCountries.length === 0) {
    return "候補の渡航国を1つ以上選んでください。";
  }

  if (formState.destinationCountries.includes(formState.departureCountry)) {
    return "出発国と同じ国は候補国から外してください。";
  }

  if (formState.dateSearchMode === "exact") {
    if (!formState.outboundDate) {
      return "往路の出発日を選んでください。";
    }

    if (!formState.stayLength) {
      return "滞在日数を選んでください。";
    }
  }

  if (formState.dateSearchMode === "flexible") {
    if (formState.targetMonths.length === 0) {
      return "比較したい出発月を1つ以上選んでください。";
    }

    const minStay = getFlexibleStayDays(formState.stayLengthMin);
    const maxStay = getFlexibleStayDays(formState.stayLengthMax);

    if (!minStay || !maxStay) {
      return "滞在日数の幅を選んでください。";
    }

    if (minStay > maxStay) {
      return "最短滞在日数は最長滞在日数以下にしてください。";
    }
  }

  return null;
}

export function isFormValid(formState: PlannerFormState): boolean {
  return getFormValidationMessage(formState) === null;
}

export function buildNoRouteGuidance(formState: PlannerFormState): string[] {
  const guidance: string[] = [];

  if (formState.preferDirect) {
    guidance.push("直行優先を外すと、1回乗継を許容した安い候補が出やすくなります。");
  }

  if (formState.destinationCountries.length <= 1) {
    guidance.push("候補国を2〜3か国に広げると、入口と出口の最適化余地が増えます。");
  }

  guidance.push("日付指定から月単位のフレックス探索に切り替えると、候補が見つかりやすくなります。");
  guidance.push("代表空港の比較結果なので、最終確認は Skyscanner の実検索に進んでください。");

  return guidance.slice(0, 3);
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatCurrencyRange(range: PriceRange): string {
  return `${formatCurrency(range.low)} - ${formatCurrency(range.high)}`;
}

export function formatDuration(durationHours: number): string {
  const wholeHours = Math.floor(durationHours);
  const minutes = Math.round((durationHours - wholeHours) * 60);

  if (minutes >= 60) {
    return `${wholeHours + 1}時間00分`;
  }

  return `${wholeHours}時間${String(minutes).padStart(2, "0")}分`;
}

export function formatDateLabel(dateString: string): string {
  const date = parseIsoDate(dateString);

  if (!date) {
    return "日付未設定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

export function buildSearchSummary(formState: PlannerFormState): string {
  const departure = formState.departureCountry ? COUNTRY_LABELS[formState.departureCountry] : "未設定";
  const destinations =
    formState.destinationCountries.map((countryCode) => COUNTRY_LABELS[countryCode]).join(" / ") || "未設定";

  return `${departure}発 / ${destinations} / ${formState.passengerCount}名 / ${formState.cabinClass}`;
}

export function generateFlightSearchResult(formState: PlannerFormState): FlightSearchResult | null {
  if (!isFormValid(formState) || !formState.departureCountry) {
    return null;
  }

  const departureCountry = getCountryProfile(formState.departureCountry);
  const destinationCountries = formState.destinationCountries.map((countryCode) => getCountryProfile(countryCode));
  const departureAirports = getAirportsForCountry(departureCountry.code);
  const destinationAirports = destinationCountries.flatMap((country) => getAirportsForCountry(country.code));
  const gatewayCountries = getGatewayCountriesForDestinationCodes(formState.destinationCountries);
  const gatewayAirports = getGatewayAirportsForDestinationCodes(formState.destinationCountries);
  const outboundCandidateDates = getOutboundCandidateDates(formState);

  const outboundQuotes = departureAirports
    .flatMap((origin) =>
      gatewayAirports.flatMap((destination) =>
        outboundCandidateDates.map((travelDate) =>
          buildFlightQuote({
            origin,
            destination,
            travelDate,
            passengerCount: formState.passengerCount,
            cabinClass: formState.cabinClass,
            preferDirect: formState.preferDirect,
            direction: "outbound",
          }),
        ),
      ),
    )
    .filter((quote): quote is FlightLegQuote => quote !== null)
    .sort(compareQuotes);

  if (!outboundQuotes.length) {
    return null;
  }

  const bestOutbound = outboundQuotes[0];
  const returnCandidateDates = getReturnCandidateDates(bestOutbound.travelDate, formState);

  const inboundQuotes = gatewayAirports
    .flatMap((origin) =>
      departureAirports.flatMap((destination) =>
        returnCandidateDates.map((travelDate) =>
          buildFlightQuote({
            origin,
            destination,
            travelDate,
            passengerCount: formState.passengerCount,
            cabinClass: formState.cabinClass,
            preferDirect: formState.preferDirect,
            direction: "return",
          }),
        ),
      ),
    )
    .filter((quote): quote is FlightLegQuote => quote !== null)
    .sort(compareQuotes);

  if (!inboundQuotes.length) {
    return null;
  }

  const bestInbound = inboundQuotes[0];
  const returnDate = bestInbound.travelDate;
  const outboundDateWindow =
    outboundCandidateDates.length === 1
      ? formatDateLabel(outboundCandidateDates[0])
      : `${formatDateLabel(outboundCandidateDates[0])}〜${formatDateLabel(outboundCandidateDates[outboundCandidateDates.length - 1])}`;
  const returnDateWindow = getReturnWindowLabel(bestOutbound.travelDate, formState);
  const stayLengthRangeLabel = getStayRangeLabel(formState);
  const flexibilitySummary =
    formState.dateSearchMode === "flexible"
      ? `${formState.targetMonths.map((monthKey) => formatTargetMonthLabel(monthKey)).join(" / ")}の全日から往路最安日を選び、そこから${stayLengthRangeLabel}後の復路候補を比較しました。`
      : `${formatDateLabel(bestOutbound.travelDate)}出発、${formatDateLabel(bestInbound.travelDate)}帰国の固定日程で比較しました。`;
  const totalPricePerPerson = bestOutbound.pricePerPerson + bestInbound.pricePerPerson;
  const totalPrice = bestOutbound.totalPrice + bestInbound.totalPrice;
  const totalPriceRangePerPerson = {
    low: bestOutbound.priceRangePerPerson.low + bestInbound.priceRangePerPerson.low,
    high: bestOutbound.priceRangePerPerson.high + bestInbound.priceRangePerPerson.high,
  };
  const totalPriceRange = {
    low: bestOutbound.totalPriceRange.low + bestInbound.totalPriceRange.low,
    high: bestOutbound.totalPriceRange.high + bestInbound.totalPriceRange.high,
  };
  const destinationNames = destinationCountries.map((country) => country.name).join(" / ");
  const gatewayNames = gatewayCountries.map((country) => country.name).join(" / ");
  const destinationCountryCodes = new Set(formState.destinationCountries);
  const differentExit =
    bestOutbound.destination.code !== bestInbound.origin.code || bestOutbound.destination.countryCode !== bestInbound.origin.countryCode;
  const usesGatewayEntry = !destinationCountryCodes.has(bestOutbound.destination.countryCode);
  const usesGatewayExit = !destinationCountryCodes.has(bestInbound.origin.countryCode);
  const betweenTicketsDistanceKm = differentExit ? haversineDistanceKm(bestOutbound.destination, bestInbound.origin) : 0;
  const betweenTicketsGap: BetweenTicketsGap = differentExit
    ? {
        arrivalLabel: `${bestOutbound.destination.city} (${bestOutbound.destination.code})`,
        departureLabel: `${bestInbound.origin.city} (${bestInbound.origin.code})`,
        distanceKm: betweenTicketsDistanceKm,
        summary: `片道1枚目の到着地と片道2枚目の出発地の間には約${distanceFormatter.format(betweenTicketsDistanceKm)}kmの現地移動があります。`,
        note: "この区間の列車・短距離便・車移動は見積もりに含めず、国際線の片道2枚だけを比較しています。",
      }
    : {
        arrivalLabel: `${bestOutbound.destination.city} (${bestOutbound.destination.code})`,
        departureLabel: `${bestInbound.origin.city} (${bestInbound.origin.code})`,
        distanceKm: 0,
        summary: "片道1枚目の到着地と片道2枚目の出発地は同じ空港です。",
        note: "この場合も現地移動費用の計算は含めず、国際線の片道2枚だけを比較しています。",
      };
  const gatewaySummary =
    gatewayCountries.length > destinationCountries.length
      ? `${destinationNames} を主目的地にしつつ、検索プールは ${gatewayNames} の ${gatewayAirports.length} 空港まで広げています。`
      : `${destinationNames} の代表空港 ${destinationAirports.length} 件をそのまま検索プールとして使っています。`;
  const ticketingSummary =
    usesGatewayEntry || usesGatewayExit
      ? `往路と復路は別々の片道券として見積もっています。主目的地が ${destinationNames} でも、入口は ${bestOutbound.destination.city}、出口は ${bestInbound.origin.city} のように周辺 gateway 都市が選ばれることがあります。`
      : `往路と復路は別々の片道券として見積もっています。今回は ${destinationNames} の代表空港どうしで最安の組み合わせが見つかりました。`;

  return {
    departureCountry,
    destinationCountries,
    departureAirports,
    destinationAirports,
    gatewayCountries,
    gatewayAirports,
    outboundDate: bestOutbound.travelDate,
    returnDate,
    outboundDateWindow,
    returnDateWindow,
    stayLengthRangeLabel,
    flexibilitySummary,
    comparedOutboundDateCount: outboundCandidateDates.length,
    comparedReturnDateCount: returnCandidateDates.length,
    bestOutbound,
    bestInbound,
    outboundAlternatives: outboundQuotes.slice(0, 4),
    inboundAlternatives: inboundQuotes.slice(0, 4),
    coverage: buildCountryCoverage(destinationCountries, outboundQuotes, inboundQuotes),
    totalPricePerPerson,
    totalPrice,
    totalPriceRangePerPerson,
    totalPriceRange,
    planHeadline: `${departureCountry.name}発で ${destinationNames} を回るなら、片道2枚の組み合わせは ${bestOutbound.origin.code}→${bestOutbound.destination.code} と ${bestInbound.origin.code}→${bestInbound.destination.code} が現時点の推定最安です。`,
    gatewaySummary,
    ticketingSummary,
    betweenTicketsGap,
    planningNote:
      "表示価格は2枚の片道券を別々に見積もった参考値です。ライブ在庫ではないため、往路と復路それぞれの Skyscanner 実検索で最終確認してください。",
    combinedSearchUrl: buildSkyscannerUrl("multicity", {
      origin0: bestOutbound.origin.code.toLowerCase(),
      date0: bestOutbound.travelDate,
      destination0: bestOutbound.destination.code.toLowerCase(),
      origin1: bestInbound.origin.code.toLowerCase(),
      date1: returnDate,
      destination1: bestInbound.destination.code.toLowerCase(),
      adultsv2: Number.parseInt(formState.passengerCount, 10),
      cabinclass: formState.cabinClass,
    }),
  };
}
