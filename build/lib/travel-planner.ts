import {
  COUNTRY_LABELS,
  STAY_LENGTH_OPTIONS,
  getAirportsForCountry,
  getCountryProfile,
  type Airport,
  type CabinClassKey,
  type CountryCode,
  type CountryProfile,
  type PassengerCountKey,
  type StayLengthKey,
} from "./travel-data";

export type PlannerFormState = {
  departureCountry: CountryCode | "";
  destinationCountries: CountryCode[];
  outboundDate: string;
  stayLength: StayLengthKey | "";
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
  durationHours: number;
  stopCount: number;
  stopLabel: string;
  distanceKm: number;
  reasonPoints: string[];
  skyscannerUrl: string;
};

export type CountryCoverage = {
  country: CountryProfile;
  airports: Airport[];
  bestOutbound: FlightLegQuote | null;
  bestInbound: FlightLegQuote | null;
};

export type FlightSearchResult = {
  departureCountry: CountryProfile;
  destinationCountries: CountryProfile[];
  departureAirports: Airport[];
  destinationAirports: Airport[];
  outboundDate: string;
  returnDate: string;
  bestOutbound: FlightLegQuote;
  bestInbound: FlightLegQuote;
  outboundAlternatives: FlightLegQuote[];
  inboundAlternatives: FlightLegQuote[];
  coverage: CountryCoverage[];
  totalPricePerPerson: number;
  totalPrice: number;
  planHeadline: string;
  openJawNote: string;
  planningNote: string;
  multiCityUrl: string;
};

export const INITIAL_FORM_STATE: PlannerFormState = {
  departureCountry: "JP",
  destinationCountries: ["FR", "GB", "DE"],
  outboundDate: "",
  stayLength: "7",
  passengerCount: "1",
  cabinClass: "economy",
  preferDirect: false,
};

const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
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
  const hubFactor = 1 - Math.max(-0.08, (origin.hubScore + destination.hubScore - 8) * 0.018);
  const cabinMultiplier = getCabinMultiplier(cabinClass);
  const directionFactor = direction === "return" ? 1.03 : 1;
  const directFactor = stopCount === 0 ? 1.08 : 0.94;
  const baseFare = 18000 + distanceKm * 11.4;
  const pricePerPerson = roundToNearestHundred(baseFare * season.factor * hubFactor * cabinMultiplier * directFactor * directionFactor);
  const totalPrice = pricePerPerson * Number.parseInt(passengerCount, 10);
  const averageSpeed = stopCount === 0 ? 860 : 760;
  const durationHours = Math.round((distanceKm / averageSpeed + (stopCount === 0 ? 1.1 : 4.1)) * 10) / 10;

  return {
    direction,
    origin,
    destination,
    travelDate,
    pricePerPerson,
    totalPrice,
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
  const stayDays = getStayDays(formState.stayLength);
  return formState.outboundDate && stayDays > 0 ? addDays(formState.outboundDate, stayDays) : "";
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

  if (!formState.outboundDate) {
    return "往路の出発日を選んでください。";
  }

  if (!formState.stayLength) {
    return "滞在日数を選んでください。";
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

  guidance.push("出発日を数日前後で動かすと、検索レンジが変わって候補が見つかりやすくなります。");
  guidance.push("代表空港の比較結果なので、最終確認は Skyscanner の実検索に進んでください。");

  return guidance.slice(0, 3);
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
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
  const returnDate = getReturnDate(formState);

  const outboundQuotes = departureAirports
    .flatMap((origin) =>
      destinationAirports.map((destination) =>
        buildFlightQuote({
          origin,
          destination,
          travelDate: formState.outboundDate,
          passengerCount: formState.passengerCount,
          cabinClass: formState.cabinClass,
          preferDirect: formState.preferDirect,
          direction: "outbound",
        }),
      ),
    )
    .filter((quote): quote is FlightLegQuote => quote !== null)
    .sort(compareQuotes);

  const inboundQuotes = destinationAirports
    .flatMap((origin) =>
      departureAirports.map((destination) =>
        buildFlightQuote({
          origin,
          destination,
          travelDate: returnDate,
          passengerCount: formState.passengerCount,
          cabinClass: formState.cabinClass,
          preferDirect: formState.preferDirect,
          direction: "return",
        }),
      ),
    )
    .filter((quote): quote is FlightLegQuote => quote !== null)
    .sort(compareQuotes);

  if (!outboundQuotes.length || !inboundQuotes.length) {
    return null;
  }

  const bestOutbound = outboundQuotes[0];
  const bestInbound = inboundQuotes[0];
  const totalPricePerPerson = bestOutbound.pricePerPerson + bestInbound.pricePerPerson;
  const totalPrice = bestOutbound.totalPrice + bestInbound.totalPrice;
  const destinationNames = destinationCountries.map((country) => country.name).join(" / ");
  const differentExit =
    bestOutbound.destination.code !== bestInbound.origin.code || bestOutbound.destination.countryCode !== bestInbound.origin.countryCode;

  return {
    departureCountry,
    destinationCountries,
    departureAirports,
    destinationAirports,
    outboundDate: formState.outboundDate,
    returnDate,
    bestOutbound,
    bestInbound,
    outboundAlternatives: outboundQuotes.slice(0, 4),
    inboundAlternatives: inboundQuotes.slice(0, 4),
    coverage: buildCountryCoverage(destinationCountries, outboundQuotes, inboundQuotes),
    totalPricePerPerson,
    totalPrice,
    planHeadline: `${departureCountry.name}発で ${destinationNames} を回るなら、往路 ${bestOutbound.origin.code}→${bestOutbound.destination.code} / 復路 ${bestInbound.origin.code}→${bestInbound.destination.code} が推定最安です。`,
    openJawNote: differentExit
      ? `${bestOutbound.destination.city} 着・${bestInbound.origin.city} 発のオープンジョー前提です。現地の移動はこのアプリでは計算に含めません。`
      : `${bestOutbound.destination.city} を同一都市の入口/出口として使う構成です。現地移動の計算は含めません。`,
    planningNote:
      "表示価格は代表空港と季節係数から作った参考見積りです。ライブ在庫ではないため、ボタンから Skyscanner の実検索に進んで最終確認してください。",
    multiCityUrl: buildSkyscannerUrl("multicity", {
      origin0: bestOutbound.origin.code.toLowerCase(),
      date0: formState.outboundDate,
      destination0: bestOutbound.destination.code.toLowerCase(),
      origin1: bestInbound.origin.code.toLowerCase(),
      date1: returnDate,
      destination1: bestInbound.destination.code.toLowerCase(),
      adultsv2: Number.parseInt(formState.passengerCount, 10),
      cabinclass: formState.cabinClass,
    }),
  };
}
