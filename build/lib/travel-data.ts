export type CountryCode =
  | "JP"
  | "FR"
  | "GB"
  | "DE"
  | "IT"
  | "ES"
  | "NL"
  | "HU"
  | "US"
  | "KR"
  | "TW"
  | "TH"
  | "SG"
  | "AU";

export type CabinClassKey = "economy" | "premiumeconomy" | "business";

export type PassengerCountKey = "1" | "2" | "3" | "4";

export type StayLengthKey = "5" | "7" | "10" | "14" | "21";

export type FlexibleStayDayKey = "5" | "7" | "10" | "14" | "21" | "26" | "30" | "36" | "45";

export type TravelMonthKey =
  | "2026-07"
  | "2026-08"
  | "2026-09"
  | "2026-10"
  | "2026-11"
  | "2026-12"
  | "2027-01"
  | "2027-02"
  | "2027-03"
  | "2027-04"
  | "2027-05"
  | "2027-06";

export type Airport = {
  code: string;
  city: string;
  name: string;
  countryCode: CountryCode;
  countryName: string;
  latitude: number;
  longitude: number;
  hubScore: number;
  corridorScore?: number;
};

export type CountryProfile = {
  code: CountryCode;
  name: string;
  region: string;
  airportCodes: string[];
  summary: string;
};

type GatewayExpansionOptions = {
  includeBudgetCorridors?: boolean;
};

const EUROPE_COUNTRY_CODES: CountryCode[] = ["FR", "GB", "DE", "IT", "ES", "NL", "HU"];
const EUROPE_GATEWAY_CODES: CountryCode[] = ["FR", "GB", "DE", "IT", "ES", "NL"];
const EUROPE_BUDGET_CORRIDOR_CODES: CountryCode[] = ["HU"];

export const CABIN_CLASS_OPTIONS: Array<{ value: CabinClassKey; label: string; hint: string }> = [
  { value: "economy", label: "Economy", hint: "最安重視の基本設定" },
  { value: "premiumeconomy", label: "Premium Economy", hint: "長距離でも少し余裕を残す" },
  { value: "business", label: "Business", hint: "価格よりも快適さを優先" },
];

export const PASSENGER_OPTIONS: Array<{ value: PassengerCountKey; label: string }> = [
  { value: "1", label: "1名" },
  { value: "2", label: "2名" },
  { value: "3", label: "3名" },
  { value: "4", label: "4名" },
];

export const STAY_LENGTH_OPTIONS: Array<{ value: StayLengthKey; label: string; days: number }> = [
  { value: "5", label: "5日", days: 5 },
  { value: "7", label: "7日", days: 7 },
  { value: "10", label: "10日", days: 10 },
  { value: "14", label: "14日", days: 14 },
  { value: "21", label: "21日", days: 21 },
];

export const FLEXIBLE_STAY_DAY_OPTIONS: Array<{ value: FlexibleStayDayKey; label: string; days: number }> = [
  { value: "5", label: "5日", days: 5 },
  { value: "7", label: "7日", days: 7 },
  { value: "10", label: "10日", days: 10 },
  { value: "14", label: "14日", days: 14 },
  { value: "21", label: "21日", days: 21 },
  { value: "26", label: "26日", days: 26 },
  { value: "30", label: "30日", days: 30 },
  { value: "36", label: "36日", days: 36 },
  { value: "45", label: "45日", days: 45 },
];

export const FLEXIBLE_MONTH_OPTIONS: Array<{ value: TravelMonthKey; label: string; hint: string }> = [
  { value: "2026-07", label: "2026年7月", hint: "夏の入口を広く見る" },
  { value: "2026-08", label: "2026年8月", hint: "お盆前後も比較" },
  { value: "2026-09", label: "2026年9月", hint: "夏終盤の余白" },
  { value: "2026-10", label: "2026年10月", hint: "秋の肩シーズン" },
  { value: "2026-11", label: "2026年11月", hint: "落ち着いた欧州旅行" },
  { value: "2026-12", label: "2026年12月", hint: "年末前後の確認" },
  { value: "2027-01", label: "2027年1月", hint: "新年の出発候補" },
  { value: "2027-02", label: "2027年2月", hint: "冬の価格を比較" },
  { value: "2027-03", label: "2027年3月", hint: "春休み前後" },
  { value: "2027-04", label: "2027年4月", hint: "春の肩シーズン" },
  { value: "2027-05", label: "2027年5月", hint: "初夏前の候補" },
  { value: "2027-06", label: "2027年6月", hint: "夏前の余裕" },
];

export const COUNTRY_PROFILES: CountryProfile[] = [
  {
    code: "JP",
    name: "日本",
    region: "東アジア",
    airportCodes: ["HND", "NRT", "KIX", "NGO", "FUK"],
    summary: "出発国として使いやすい主要ハブを広めに確保",
  },
  {
    code: "FR",
    name: "フランス",
    region: "西ヨーロッパ",
    airportCodes: ["CDG", "ORY", "NCE"],
    summary: "パリ中心に南仏の入口も含めて拾う",
  },
  {
    code: "GB",
    name: "イギリス",
    region: "西ヨーロッパ",
    airportCodes: ["LHR", "LGW", "MAN"],
    summary: "ロンドンの両空港とマンチェスターを代表に採用",
  },
  {
    code: "DE",
    name: "ドイツ",
    region: "中央ヨーロッパ",
    airportCodes: ["FRA", "MUC", "BER"],
    summary: "フランクフルトを軸にミュンヘンとベルリンを補完",
  },
  {
    code: "IT",
    name: "イタリア",
    region: "南ヨーロッパ",
    airportCodes: ["FCO", "MXP", "VCE"],
    summary: "ローマ、ミラノ、ベネチアで入口と出口の幅を持たせる",
  },
  {
    code: "ES",
    name: "スペイン",
    region: "南ヨーロッパ",
    airportCodes: ["MAD", "BCN", "AGP"],
    summary: "マドリードとバルセロナを軸に南部も拾う",
  },
  {
    code: "NL",
    name: "オランダ",
    region: "西ヨーロッパ",
    airportCodes: ["AMS", "EIN"],
    summary: "アムステルダム中心に補助ハブを1つ追加",
  },
  {
    code: "HU",
    name: "ハンガリー",
    region: "中央ヨーロッパ",
    airportCodes: ["BUD"],
    summary: "中欧の価格重視 gateway として比較に加える",
  },
  {
    code: "US",
    name: "アメリカ",
    region: "北米",
    airportCodes: ["JFK", "EWR", "LAX", "SFO"],
    summary: "東海岸と西海岸を跨いで代表空港を確保",
  },
  {
    code: "KR",
    name: "韓国",
    region: "東アジア",
    airportCodes: ["ICN", "GMP", "PUS"],
    summary: "ソウル圏を中心に釜山も含める",
  },
  {
    code: "TW",
    name: "台湾",
    region: "東アジア",
    airportCodes: ["TPE", "KHH"],
    summary: "台北と高雄の代表空港で絞り込む",
  },
  {
    code: "TH",
    name: "タイ",
    region: "東南アジア",
    airportCodes: ["BKK", "DMK", "HKT"],
    summary: "バンコク2空港にリゾート側の出口を足す",
  },
  {
    code: "SG",
    name: "シンガポール",
    region: "東南アジア",
    airportCodes: ["SIN"],
    summary: "単一ハブで扱いやすい国として代表採用",
  },
  {
    code: "AU",
    name: "オーストラリア",
    region: "オセアニア",
    airportCodes: ["SYD", "MEL", "BNE"],
    summary: "東海岸3都市を起点に広めに探索",
  },
];

export const COUNTRY_OPTIONS = COUNTRY_PROFILES.map((country) => ({
  value: country.code,
  label: country.name,
  hint: `${country.region} / ${country.airportCodes.length}空港`,
}));

export const COUNTRY_LABELS = Object.fromEntries(COUNTRY_PROFILES.map((country) => [country.code, country.name])) as Record<
  CountryCode,
  string
>;

export const AIRPORTS: Record<string, Airport> = {
  HND: {
    code: "HND",
    city: "東京",
    name: "羽田空港",
    countryCode: "JP",
    countryName: "日本",
    latitude: 35.5494,
    longitude: 139.7798,
    hubScore: 5,
  },
  NRT: {
    code: "NRT",
    city: "東京",
    name: "成田空港",
    countryCode: "JP",
    countryName: "日本",
    latitude: 35.7719,
    longitude: 140.3929,
    hubScore: 5,
  },
  KIX: {
    code: "KIX",
    city: "大阪",
    name: "関西国際空港",
    countryCode: "JP",
    countryName: "日本",
    latitude: 34.4347,
    longitude: 135.2441,
    hubScore: 4,
  },
  NGO: {
    code: "NGO",
    city: "名古屋",
    name: "中部国際空港",
    countryCode: "JP",
    countryName: "日本",
    latitude: 34.8584,
    longitude: 136.8054,
    hubScore: 3,
  },
  FUK: {
    code: "FUK",
    city: "福岡",
    name: "福岡空港",
    countryCode: "JP",
    countryName: "日本",
    latitude: 33.5859,
    longitude: 130.451,
    hubScore: 3,
  },
  CDG: {
    code: "CDG",
    city: "パリ",
    name: "シャルル・ド・ゴール空港",
    countryCode: "FR",
    countryName: "フランス",
    latitude: 49.0097,
    longitude: 2.5479,
    hubScore: 5,
  },
  ORY: {
    code: "ORY",
    city: "パリ",
    name: "オルリー空港",
    countryCode: "FR",
    countryName: "フランス",
    latitude: 48.7262,
    longitude: 2.3652,
    hubScore: 4,
  },
  NCE: {
    code: "NCE",
    city: "ニース",
    name: "コート・ダジュール空港",
    countryCode: "FR",
    countryName: "フランス",
    latitude: 43.6653,
    longitude: 7.215,
    hubScore: 3,
  },
  LHR: {
    code: "LHR",
    city: "ロンドン",
    name: "ヒースロー空港",
    countryCode: "GB",
    countryName: "イギリス",
    latitude: 51.47,
    longitude: -0.4543,
    hubScore: 5,
  },
  LGW: {
    code: "LGW",
    city: "ロンドン",
    name: "ガトウィック空港",
    countryCode: "GB",
    countryName: "イギリス",
    latitude: 51.1537,
    longitude: -0.1821,
    hubScore: 4,
    corridorScore: 5,
  },
  MAN: {
    code: "MAN",
    city: "マンチェスター",
    name: "マンチェスター空港",
    countryCode: "GB",
    countryName: "イギリス",
    latitude: 53.365,
    longitude: -2.2728,
    hubScore: 4,
    corridorScore: 3,
  },
  FRA: {
    code: "FRA",
    city: "フランクフルト",
    name: "フランクフルト空港",
    countryCode: "DE",
    countryName: "ドイツ",
    latitude: 50.0379,
    longitude: 8.5622,
    hubScore: 5,
  },
  MUC: {
    code: "MUC",
    city: "ミュンヘン",
    name: "ミュンヘン空港",
    countryCode: "DE",
    countryName: "ドイツ",
    latitude: 48.3538,
    longitude: 11.7861,
    hubScore: 4,
  },
  BER: {
    code: "BER",
    city: "ベルリン",
    name: "ベルリン・ブランデンブルク空港",
    countryCode: "DE",
    countryName: "ドイツ",
    latitude: 52.3667,
    longitude: 13.5033,
    hubScore: 3,
    corridorScore: 2,
  },
  FCO: {
    code: "FCO",
    city: "ローマ",
    name: "フィウミチーノ空港",
    countryCode: "IT",
    countryName: "イタリア",
    latitude: 41.8003,
    longitude: 12.2389,
    hubScore: 5,
  },
  MXP: {
    code: "MXP",
    city: "ミラノ",
    name: "マルペンサ空港",
    countryCode: "IT",
    countryName: "イタリア",
    latitude: 45.63,
    longitude: 8.7231,
    hubScore: 4,
    corridorScore: 4,
  },
  VCE: {
    code: "VCE",
    city: "ベネチア",
    name: "マルコ・ポーロ空港",
    countryCode: "IT",
    countryName: "イタリア",
    latitude: 45.5053,
    longitude: 12.3519,
    hubScore: 3,
    corridorScore: 2,
  },
  MAD: {
    code: "MAD",
    city: "マドリード",
    name: "アドルフォ・スアレス・マドリード空港",
    countryCode: "ES",
    countryName: "スペイン",
    latitude: 40.4983,
    longitude: -3.5676,
    hubScore: 5,
  },
  BCN: {
    code: "BCN",
    city: "バルセロナ",
    name: "バルセロナ空港",
    countryCode: "ES",
    countryName: "スペイン",
    latitude: 41.2974,
    longitude: 2.0833,
    hubScore: 5,
    corridorScore: 3,
  },
  AGP: {
    code: "AGP",
    city: "マラガ",
    name: "マラガ空港",
    countryCode: "ES",
    countryName: "スペイン",
    latitude: 36.6749,
    longitude: -4.4991,
    hubScore: 3,
    corridorScore: 2,
  },
  AMS: {
    code: "AMS",
    city: "アムステルダム",
    name: "スキポール空港",
    countryCode: "NL",
    countryName: "オランダ",
    latitude: 52.3105,
    longitude: 4.7683,
    hubScore: 5,
    corridorScore: 3,
  },
  EIN: {
    code: "EIN",
    city: "アイントホーフェン",
    name: "アイントホーフェン空港",
    countryCode: "NL",
    countryName: "オランダ",
    latitude: 51.4501,
    longitude: 5.3745,
    hubScore: 3,
    corridorScore: 4,
  },
  BUD: {
    code: "BUD",
    city: "ブダペスト",
    name: "ブダペスト空港",
    countryCode: "HU",
    countryName: "ハンガリー",
    latitude: 47.4369,
    longitude: 19.2556,
    hubScore: 3,
    corridorScore: 5,
  },
  JFK: {
    code: "JFK",
    city: "ニューヨーク",
    name: "ジョン・F・ケネディ空港",
    countryCode: "US",
    countryName: "アメリカ",
    latitude: 40.6413,
    longitude: -73.7781,
    hubScore: 5,
  },
  EWR: {
    code: "EWR",
    city: "ニューヨーク",
    name: "ニューアーク空港",
    countryCode: "US",
    countryName: "アメリカ",
    latitude: 40.6895,
    longitude: -74.1745,
    hubScore: 4,
  },
  LAX: {
    code: "LAX",
    city: "ロサンゼルス",
    name: "ロサンゼルス国際空港",
    countryCode: "US",
    countryName: "アメリカ",
    latitude: 33.9416,
    longitude: -118.4085,
    hubScore: 5,
  },
  SFO: {
    code: "SFO",
    city: "サンフランシスコ",
    name: "サンフランシスコ国際空港",
    countryCode: "US",
    countryName: "アメリカ",
    latitude: 37.6213,
    longitude: -122.379,
    hubScore: 5,
  },
  ICN: {
    code: "ICN",
    city: "ソウル",
    name: "仁川国際空港",
    countryCode: "KR",
    countryName: "韓国",
    latitude: 37.4602,
    longitude: 126.4407,
    hubScore: 5,
  },
  GMP: {
    code: "GMP",
    city: "ソウル",
    name: "金浦空港",
    countryCode: "KR",
    countryName: "韓国",
    latitude: 37.5583,
    longitude: 126.7906,
    hubScore: 4,
  },
  PUS: {
    code: "PUS",
    city: "釜山",
    name: "金海国際空港",
    countryCode: "KR",
    countryName: "韓国",
    latitude: 35.1795,
    longitude: 128.9382,
    hubScore: 3,
  },
  TPE: {
    code: "TPE",
    city: "台北",
    name: "桃園国際空港",
    countryCode: "TW",
    countryName: "台湾",
    latitude: 25.0797,
    longitude: 121.2342,
    hubScore: 5,
  },
  KHH: {
    code: "KHH",
    city: "高雄",
    name: "高雄国際空港",
    countryCode: "TW",
    countryName: "台湾",
    latitude: 22.5771,
    longitude: 120.349,
    hubScore: 3,
  },
  BKK: {
    code: "BKK",
    city: "バンコク",
    name: "スワンナプーム空港",
    countryCode: "TH",
    countryName: "タイ",
    latitude: 13.69,
    longitude: 100.7501,
    hubScore: 5,
  },
  DMK: {
    code: "DMK",
    city: "バンコク",
    name: "ドンムアン空港",
    countryCode: "TH",
    countryName: "タイ",
    latitude: 13.9126,
    longitude: 100.607,
    hubScore: 3,
  },
  HKT: {
    code: "HKT",
    city: "プーケット",
    name: "プーケット国際空港",
    countryCode: "TH",
    countryName: "タイ",
    latitude: 8.1132,
    longitude: 98.3169,
    hubScore: 3,
  },
  SIN: {
    code: "SIN",
    city: "シンガポール",
    name: "チャンギ国際空港",
    countryCode: "SG",
    countryName: "シンガポール",
    latitude: 1.3644,
    longitude: 103.9915,
    hubScore: 5,
  },
  SYD: {
    code: "SYD",
    city: "シドニー",
    name: "シドニー国際空港",
    countryCode: "AU",
    countryName: "オーストラリア",
    latitude: -33.9399,
    longitude: 151.1753,
    hubScore: 5,
  },
  MEL: {
    code: "MEL",
    city: "メルボルン",
    name: "メルボルン空港",
    countryCode: "AU",
    countryName: "オーストラリア",
    latitude: -37.669,
    longitude: 144.841,
    hubScore: 5,
  },
  BNE: {
    code: "BNE",
    city: "ブリスベン",
    name: "ブリスベン空港",
    countryCode: "AU",
    countryName: "オーストラリア",
    latitude: -27.3842,
    longitude: 153.1175,
    hubScore: 4,
  },
};

export function getCountryProfile(code: CountryCode): CountryProfile {
  return COUNTRY_PROFILES.find((country) => country.code === code) as CountryProfile;
}

export function getAirportsForCountry(code: CountryCode): Airport[] {
  return getCountryProfile(code).airportCodes.map((airportCode) => AIRPORTS[airportCode]);
}

export function isEuropeanCountryCode(countryCode: CountryCode): boolean {
  return EUROPE_COUNTRY_CODES.includes(countryCode);
}

export function getGatewayCountriesForDestinationCodes(
  countryCodes: CountryCode[],
  options: GatewayExpansionOptions = {},
): CountryProfile[] {
  const expandedCountryCodes = new Set<CountryCode>(countryCodes);
  const shouldExpandToEurope = countryCodes.some((countryCode) => isEuropeanCountryCode(countryCode));

  if (shouldExpandToEurope) {
    EUROPE_GATEWAY_CODES.forEach((countryCode) => expandedCountryCodes.add(countryCode));

    if (options.includeBudgetCorridors) {
      EUROPE_BUDGET_CORRIDOR_CODES.forEach((countryCode) => expandedCountryCodes.add(countryCode));
    }
  }

  return COUNTRY_PROFILES.filter((country) => expandedCountryCodes.has(country.code));
}

export function getGatewayAirportsForDestinationCodes(
  countryCodes: CountryCode[],
  options: GatewayExpansionOptions = {},
): Airport[] {
  const seenAirportCodes = new Set<string>();

  return getGatewayCountriesForDestinationCodes(countryCodes, options)
    .flatMap((country) => getAirportsForCountry(country.code))
    .filter((airport) => {
      if (seenAirportCodes.has(airport.code)) {
        return false;
      }

      seenAirportCodes.add(airport.code);
      return true;
    });
}
