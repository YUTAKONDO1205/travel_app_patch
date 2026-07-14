"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./page.module.css";
import {
  CABIN_CLASS_OPTIONS,
  COUNTRY_LABELS,
  COUNTRY_OPTIONS,
  FLEXIBLE_MONTH_OPTIONS,
  FLEXIBLE_STAY_DAY_OPTIONS,
  PASSENGER_OPTIONS,
  STAY_LENGTH_OPTIONS,
  getAirportsForCountry,
  getGatewayAirportsForDestinationCodes,
  getGatewayCountriesForDestinationCodes,
  isEuropeanCountryCode,
  type CabinClassKey,
  type CountryCode,
  type FlexibleStayDayKey,
  type PassengerCountKey,
  type TravelMonthKey,
} from "../lib/travel-data";
import {
  INITIAL_FORM_STATE,
  buildNoRouteGuidance,
  buildSearchSummary,
  formatCurrency,
  formatCurrencyRange,
  formatDateLabel,
  formatDuration,
  generateFlightSearchResult,
  getDateSearchSummary,
  getFormValidationMessage,
  getReturnDate,
  getReturnWindowLabel,
  getStayRangeLabel,
  isFormValid,
  type FlightLegQuote,
  type FlightSearchResult,
  type LiveFareSource,
  type PlannerFormState,
} from "../lib/travel-planner";
import {
  DEFAULT_SKIN,
  MIX_MAP,
  SKINS,
  SKIN_STORAGE_KEY,
  isSkinId,
  skinTag,
  type SkinId,
  type SkinZone,
} from "../lib/design-skins";

const NAV_ITEMS = [
  { id: "search", label: "検索" },
  { id: "destinations", label: "目的地" },
  { id: "results", label: "結果" },
  { id: "how", label: "仕組み" },
];

const destinations: Array<{ code: CountryCode; city: string; country: string; img: string }> = [
  { code: "FR", city: "パリ", country: "フランス", img: "/img/paris.jpg" },
  { code: "GB", city: "ロンドン", country: "イギリス", img: "/img/london.jpg" },
  { code: "ES", city: "バルセロナ", country: "スペイン", img: "/img/coast.jpg" },
  { code: "DE", city: "ミュンヘン", country: "ドイツ", img: "/img/alps.jpg" },
];

const trustItems = [
  { stat: "片道 × 片道", label: "片道を2枚組み合わせて、安くなる形を探します" },
  { stat: "複数月まとめて", label: "選んだ月の中から、往路が安い日を見つけます" },
  { stat: "16空港から", label: "行きたい国の周りの空港まで含めて探します" },
  { stat: "Skyscanner へ", label: "往路と復路を、そのまま実際の検索に渡せます" },
];

const howSteps = [
  {
    step: "1",
    title: "出発国と行きたい国、時期を選ぶ",
    text: "出発国を選ぶと、その国の主な空港が候補に入ります。ヨーロッパなら周りの都市まで広げるので、ベルリンに行きたくても、まずミラノ着で入る、みたいな入口も出てきます。",
  },
  {
    step: "2",
    title: "先に往路の安い日を決めて、そこから復路を探す",
    text: "選んだ月の全部の日から往路がいちばん安い入口を探して、その日から滞在日数ぶんずらして、復路の安い出口を比べます。",
  },
  {
    step: "3",
    title: "片道2枚を Skyscanner で確かめる",
    text: "往路と復路、それぞれの検索を Skyscanner で開けます。もし価格が出てこなくても、同じ条件を打ち直せばすぐ調べ直せます。",
  },
];

const archetypes = [
  { label: "Grand Tour", title: "欧州三都をまたぐ", text: "複数の国をまたいで、入口と出口を別々にする旅。" },
  { label: "Long Stay", title: "一か月くらいの長め滞在", text: "滞在日数をゆるく決めて、安い日を狙う旅。" },
  { label: "Dual Gateway", title: "入口と出口を分ける", text: "入口はミラノ、帰りはベルリン、みたいに分ける旅。" },
];

function routeLabel(quote: FlightLegQuote) {
  return `${quote.origin.code} → ${quote.destination.code}`;
}

function revealStyle(step: number): CSSProperties {
  return { ["--reveal-delay" as never]: `${step * 80}ms` } as CSSProperties;
}

function getAlternativeBadge(quote: FlightLegQuote, index: number, bestQuote: FlightLegQuote) {
  if (index === 0) return "最安";
  if (quote.stopCount === 0) return "直行";
  if (quote.durationHours < bestQuote.durationHours) return "短時間";
  if (quote.origin.city !== bestQuote.origin.city || quote.destination.city !== bestQuote.destination.city) return "別ゲート";
  return "価格寄り";
}

type PriceTone = "low" | "mid" | "high";

const TONE_LABEL: Record<PriceTone, string> = { low: "お得", mid: "標準", high: "高め" };

// Google-Flights-style price temperature: position a value within a min..max band.
function priceTone(value: number, min: number, max: number): PriceTone {
  if (!Number.isFinite(value) || max <= min) return "mid";
  const t = (value - min) / (max - min);
  if (t <= 0.18) return "low";
  if (t >= 0.7) return "high";
  return "mid";
}

function renderFlightCard(quote: FlightLegQuote, tag: string, accent: "out" | "in", revealStep: number) {
  return (
    <article className={styles.flightCard} data-ui="flight-card" data-accent={accent} data-reveal style={revealStyle(revealStep)}>
      <header className={styles.flightTop}>
        <span className={styles.flightTag} data-ui="flight-tag" data-accent={accent}>
          <span className={styles.flightDot} aria-hidden="true" />
          {tag}
        </span>
        <span className={styles.flightConfidence}>{quote.confidenceLabel}</span>
      </header>

      <div className={styles.flightRoute} data-ui="flight-route">
        <div className={styles.flightNode}>
          <strong>{quote.origin.code}</strong>
          <span>{quote.origin.city}</span>
        </div>
        <div className={styles.flightPath} aria-hidden="true">
          <span className={styles.flightDur}>{formatDuration(quote.durationHours)}</span>
          <span className={styles.flightLine} />
          <span className={styles.flightStop}>{quote.stopLabel}</span>
        </div>
        <div className={styles.flightNode} data-align="end">
          <strong>{quote.destination.code}</strong>
          <span>{quote.destination.city}</span>
        </div>
      </div>

      <div className={styles.flightPrice} data-ui="flight-price">
        <div>
          <span>合計の推定額</span>
          <strong>{formatCurrency(quote.totalPrice)}</strong>
        </div>
        <div className={styles.flightPriceMeta}>
          <span>{formatDateLabel(quote.travelDate)}</span>
          <span>参考 {formatCurrencyRange(quote.totalPriceRange)}</span>
        </div>
      </div>

      <p className={styles.flightBasis}>{quote.estimateBasis}</p>

      <ul className={styles.flightReasons}>
        {quote.reasonPoints.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <a className={styles.flightLink} data-ui="flight-link" href={quote.skyscannerUrl} target="_blank" rel="noreferrer">
        この片道を Skyscanner で確認
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </a>
    </article>
  );
}

function renderHandoffCard(source: LiveFareSource) {
  const isReference = source.status === "reference";

  return (
    <article className={styles.handoffCard} data-ui="handoff-card" data-tone={source.status}>
      <header className={styles.handoffHead}>
        <span className={styles.handoffStatus}>{source.statusLabel}</span>
        <span className={styles.handoffProvider}>{source.provider}</span>
      </header>
      <strong className={styles.handoffRoute} data-ui="handoff-route">{source.routeLabel}</strong>
      <span className={styles.handoffLabel}>{source.label}</span>

      <div className={styles.handoffMeta} data-ui="handoff-meta">
        <div>
          <span>日付</span>
          <strong>{source.dateLabel}</strong>
        </div>
        <div>
          <span>条件</span>
          <strong>{source.detailsLabel}</strong>
        </div>
      </div>

      <p className={styles.handoffFallback}>{source.fallbackLabel}</p>

      <a
        className={isReference ? styles.handoffLinkGhost : styles.handoffLink}
        data-ui="handoff-link"
        href={source.url}
        target="_blank"
        rel="noreferrer"
      >
        {isReference ? "参考検索を開く" : "この検索を開く"}
      </a>
    </article>
  );
}

export default function HomePage() {
  const [formState, setFormState] = useState<PlannerFormState>(INITIAL_FORM_STATE);
  const [submitted, setSubmitted] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FlightSearchResult | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeSection, setActiveSection] = useState<string>("top");
  const [skin, setSkin] = useState<SkinId>(DEFAULT_SKIN);
  const [labOpen, setLabOpen] = useState(false);
  const pendingSearchRef = useRef<number | null>(null);

  const isMix = skin === "mix";

  // In single-skin mode the scope sits on <main> and every zone inherits it.
  // In 全部盛り mode each zone carries its own scope instead.
  const zoneSkin = useCallback((zone: SkinZone): SkinId | undefined => (isMix ? MIX_MAP[zone] : undefined), [isMix]);
  const zoneProps = useCallback(
    (zone: SkinZone) => {
      const zoneId = zoneSkin(zone);
      return { "data-skin-scope": zoneId, "data-skin-tag": skinTag(zoneId) };
    },
    [zoneSkin],
  );

  const validationMessage = submitted ? getFormValidationMessage(formState) : null;
  const canSearch = isFormValid(formState);
  const returnDate = getReturnDate(formState);
  const dateSearchSummary = getDateSearchSummary(formState);
  const stayRangeLabel = getStayRangeLabel(formState);
  const previewOutboundDate = `${formState.targetMonths[0] ?? "2026-07"}-15`;
  const returnWindowPreview =
    formState.dateSearchMode === "exact" ? returnDate : getReturnWindowLabel(previewOutboundDate, formState);
  const departureAirportCount = formState.departureCountry ? getAirportsForCountry(formState.departureCountry).length : 0;
  const selectedDestinationAirportCount = formState.destinationCountries.reduce(
    (count, countryCode) => count + getAirportsForCountry(countryCode).length,
    0,
  );
  const gatewayExpansionOptions = { includeBudgetCorridors: !formState.preferDirect };
  const gatewayCountries = getGatewayCountriesForDestinationCodes(formState.destinationCountries, gatewayExpansionOptions);
  const gatewayOnlyCountries = gatewayCountries.filter((country) => !formState.destinationCountries.includes(country.code));
  const gatewayOnlyAirportCount = gatewayOnlyCountries.reduce(
    (count, country) => count + getAirportsForCountry(country.code).length,
    0,
  );
  const destinationAirportCount = getGatewayAirportsForDestinationCodes(
    formState.destinationCountries,
    gatewayExpansionOptions,
  ).length;
  const selectedDestinationLabels =
    formState.destinationCountries.map((countryCode) => COUNTRY_LABELS[countryCode]).join(" / ") ||
    "滞在国を選ぶとここに表示します。";
  const gatewayOnlyLabels =
    gatewayOnlyCountries.map((country) => country.name).join(" / ") || "今の組み合わせでは追加のゲートウェイ拡張はありません。";
  const noRouteGuidance = buildNoRouteGuidance(formState);
  const corridorModeActive =
    !formState.preferDirect && formState.destinationCountries.some((countryCode) => isEuropeanCountryCode(countryCode));

  // Lightweight cheapest two-ticket estimate per destination card (exact mode = cheap to compute).
  const destinationEstimates = useMemo(() => {
    const map: Partial<Record<CountryCode, number | null>> = {};
    for (const dest of destinations) {
      if (dest.code === (formState.departureCountry || "JP")) {
        map[dest.code] = null;
        continue;
      }
      const estimate = generateFlightSearchResult({
        departureCountry: formState.departureCountry || "JP",
        destinationCountries: [dest.code],
        dateSearchMode: "exact",
        outboundDate: "2026-08-17",
        targetMonths: [],
        stayLength: "10",
        stayLengthMin: "26",
        stayLengthMax: "36",
        passengerCount: "1",
        cabinClass: "economy",
        preferDirect: false,
      });
      map[dest.code] = estimate ? estimate.totalPrice : null;
    }
    return map;
  }, [formState.departureCountry]);

  const destinationPrices = destinations
    .map((dest) => destinationEstimates[dest.code])
    .filter((value): value is number => typeof value === "number");
  const destMin = destinationPrices.length ? Math.min(...destinationPrices) : 0;
  const destMax = destinationPrices.length ? Math.max(...destinationPrices) : 0;

  const heroDestSummary = formState.destinationCountries.length
    ? `${COUNTRY_LABELS[formState.destinationCountries[0]]}${formState.destinationCountries.length > 1 ? ` 他${formState.destinationCountries.length - 1}か国` : ""}`
    : "国を選ぶ";

  function scrollToSearch() {
    document.getElementById("search")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateFormState<Key extends keyof PlannerFormState>(key: Key, value: PlannerFormState[Key]) {
    setFormState((current) => ({ ...current, [key]: value }));
  }

  function handleDepartureChange(nextCountry: CountryCode) {
    setFormState((current) => ({
      ...current,
      departureCountry: nextCountry,
      destinationCountries: current.destinationCountries.filter((countryCode) => countryCode !== nextCountry),
    }));
  }

  function toggleDestinationCountry(countryCode: CountryCode) {
    setFormState((current) => {
      if (current.departureCountry === countryCode) return current;
      if (current.destinationCountries.includes(countryCode)) {
        return { ...current, destinationCountries: current.destinationCountries.filter((item) => item !== countryCode) };
      }
      if (current.destinationCountries.length >= 5) return current;
      return { ...current, destinationCountries: [...current.destinationCountries, countryCode] };
    });
  }

  function selectDestinationFromCard(countryCode: CountryCode) {
    setFormState((current) => {
      if (current.departureCountry === countryCode) return current;
      const already = current.destinationCountries.includes(countryCode);
      return {
        ...current,
        destinationCountries: already
          ? current.destinationCountries
          : current.destinationCountries.length >= 5
            ? [...current.destinationCountries.slice(1), countryCode]
            : [...current.destinationCountries, countryCode],
      };
    });
    requestAnimationFrame(() => {
      document.getElementById("search")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function toggleTargetMonth(monthKey: TravelMonthKey) {
    setFormState((current) => {
      if (current.targetMonths.includes(monthKey)) {
        return { ...current, targetMonths: current.targetMonths.filter((item) => item !== monthKey) };
      }
      if (current.targetMonths.length >= 4) return current;
      return { ...current, targetMonths: [...current.targetMonths, monthKey].sort() };
    });
  }

  function runSearch() {
    setSubmitted(true);
    if (!canSearch) {
      scrollToSearch();
      return;
    }
    if (loading) return;

    const snapshot = { ...formState };
    setLoading(true);

    if (pendingSearchRef.current !== null) window.clearTimeout(pendingSearchRef.current);

    pendingSearchRef.current = window.setTimeout(() => {
      const nextResult = generateFlightSearchResult(snapshot);
      startTransition(() => {
        setResult(nextResult);
        setHasGenerated(true);
        setLoading(false);
      });
      pendingSearchRef.current = null;
      requestAnimationFrame(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }, 700);
  }

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runSearch();
  }

  function handleReset() {
    if (pendingSearchRef.current !== null) {
      window.clearTimeout(pendingSearchRef.current);
      pendingSearchRef.current = null;
    }
    setFormState(INITIAL_FORM_STATE);
    setSubmitted(false);
    setHasGenerated(false);
    setLoading(false);
    setResult(null);
  }

  function selectSkin(nextSkin: SkinId) {
    setSkin(nextSkin);
    try {
      window.localStorage.setItem(SKIN_STORAGE_KEY, nextSkin);
    } catch {
      // Private mode or a blocked store: the skin still applies for this visit.
    }
  }

  // Restore after mount so the server and the first client render agree.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SKIN_STORAGE_KEY);
      if (isSkinId(stored)) setSkin(stored);
    } catch {
      // Ignore an unreadable store and keep the default skin.
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setIsScrolled(y > 12);
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight || 1;
      setScrollProgress(Math.min(1, Math.max(0, y / max)));
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (pendingSearchRef.current !== null) window.clearTimeout(pendingSearchRef.current);
    };
  }, []);

  useEffect(() => {
    const ids = ["top", "search", "destinations", "results", "how"];
    const sections = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.1, 0.5, 1] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!revealNodes.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealNodes.forEach((node) => (node.dataset.revealVisible = "true"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-reveal-visible", "true");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );

    revealNodes.forEach((node) => {
      if (node.dataset.revealVisible === "true") return;
      observer.observe(node);
    });
    return () => observer.disconnect();
  }, [hasGenerated, loading, result, skin]);

  return (
    <main
      className={styles.page}
      data-skin={skin}
      data-skin-scope={skin === "mix" || skin === "classic" ? undefined : skin}
    >
      <div className={styles.progress} aria-hidden="true">
        <span style={{ transform: `scaleX(${scrollProgress})` }} />
      </div>

      <header className={`${styles.header} ${isScrolled ? styles.headerSolid : ""}`} data-ui="header" {...zoneProps("header")}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#top" data-ui="brand">
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 16l18-6-6 18-3-7z" />
              </svg>
            </span>
            <span className={styles.brandText}>Maison Passage</span>
          </a>

          <nav className={styles.nav} aria-label="ページ内メニュー">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={styles.navLink}
                data-ui="nav-link"
                data-active={activeSection === item.id || undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <a className={styles.headerCta} href="#search" data-ui="header-cta">
            航空券を検索
          </a>
        </div>
      </header>

      <section className={styles.hero} id="top" data-testid="hero" data-ui="hero" {...zoneProps("hero")}>
        <div className={styles.heroMedia} data-ui="hero-media" aria-hidden="true" />
        <div className={styles.heroOverlay} data-ui="hero-overlay" aria-hidden="true" />
        <div className={styles.shell}>
          <div className={styles.heroCopy}>
            <span className="mp-eyebrow" data-ui="eyebrow">Gateway Pair Explorer</span>
            <span className={styles.heroBadge} data-ui="hero-badge">海外の航空券を、片道2枚で</span>
            <h1 className={styles.heroTitle} data-ui="hero-title">
              往復で買う前に、<br />
              片道2枚を比べてみる。
            </h1>
            <p className={styles.heroLead} data-ui="hero-lead">
              出発国と行きたい国、それに時期を選ぶと、往路と復路を別々の片道券として比べて、いちばん安い入口と出口を探します。往復より安くなることがあります。
            </p>
            <div className={styles.heroChips} data-ui="hero-chips">
              <span>複数の月をまとめて比較</span>
              <span>入口は周りの都市まで</span>
              <span>Skyscanner で最終確認</span>
            </div>
          </div>

          <div className={styles.heroSearch} data-ui="hero-search" role="search">
            <label className={styles.heroField} data-ui="hero-field">
              <span>出発国</span>
              <select
                value={formState.departureCountry}
                onChange={(event) => handleDepartureChange(event.target.value as CountryCode)}
                aria-label="出発国"
                data-ui="select"
              >
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={styles.heroField} data-ui="hero-field" onClick={scrollToSearch}>
              <span>目的地</span>
              <strong>{heroDestSummary}</strong>
            </button>
            <button type="button" className={styles.heroField} data-ui="hero-field" onClick={scrollToSearch}>
              <span>時期</span>
              <strong>{dateSearchSummary}</strong>
            </button>
            <button type="button" className={styles.heroSearchBtn} data-ui="hero-search-btn" onClick={runSearch} disabled={loading}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <span>{loading ? "探索中…" : "検索"}</span>
            </button>
          </div>
        </div>
      </section>

      <section className={styles.searchSection} id="search" data-ui="search-section" {...zoneProps("search")}>
        <div className={styles.shell}>
          <div className={styles.searchPanel} data-ui="search-panel" data-reveal style={revealStyle(0)}>
            <div className={styles.searchPanelHead} data-ui="search-panel-head">
              <h2>航空券を片道2枚で検索</h2>
              <p>{buildSearchSummary(formState)}・{dateSearchSummary}</p>
            </div>

            <form onSubmit={handleSearch} data-testid="trip-brief-form" className={styles.searchForm}>
              <div className={styles.steps}>
                <section className={styles.step}>
                  <span className={styles.stepLabel} data-ui="field-label">出発国</span>
                  <select
                    className={styles.select}
                    data-ui="select"
                    value={formState.departureCountry}
                    onChange={(event) => handleDepartureChange(event.target.value as CountryCode)}
                  >
                    {COUNTRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </section>

                <section className={styles.step}>
                  <span className={styles.stepLabel} data-ui="field-label">人数</span>
                  <select
                    className={styles.select}
                    data-ui="select"
                    value={formState.passengerCount}
                    onChange={(event) => updateFormState("passengerCount", event.target.value as PassengerCountKey)}
                  >
                    {PASSENGER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </section>

                <section className={`${styles.step} ${styles.stepWide}`}>
                  <span className={styles.stepLabel} data-ui="field-label">探し方</span>
                  <div className={styles.segmented} data-ui="segmented" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={formState.dateSearchMode === "flexible"}
                      className={`${styles.segment} ${formState.dateSearchMode === "flexible" ? styles.segmentActive : ""}`}
                      data-ui="segment"
                      data-active={formState.dateSearchMode === "flexible" || undefined}
                      onClick={() => updateFormState("dateSearchMode", "flexible")}
                    >
                      複数月で探す
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={formState.dateSearchMode === "exact"}
                      className={`${styles.segment} ${formState.dateSearchMode === "exact" ? styles.segmentActive : ""}`}
                      data-ui="segment"
                      data-active={formState.dateSearchMode === "exact" || undefined}
                      onClick={() => updateFormState("dateSearchMode", "exact")}
                    >
                      日付を指定
                    </button>
                  </div>
                </section>
              </div>

              {formState.dateSearchMode === "exact" ? (
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span className={styles.stepLabel} data-ui="field-label">往路の出発日</span>
                    <input
                      className={styles.input}
                      data-ui="input"
                      type="date"
                      value={formState.outboundDate}
                      onChange={(event) => updateFormState("outboundDate", event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.stepLabel} data-ui="field-label">滞在日数</span>
                    <select
                      className={styles.select}
                      data-ui="select"
                      value={formState.stayLength}
                      onChange={(event) => updateFormState("stayLength", event.target.value as PlannerFormState["stayLength"])}
                    >
                      {STAY_LENGTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <div className={styles.flexBlock}>
                  <span className={styles.stepLabel} data-ui="field-label">出発月（最大4つ）</span>
                  <div className={styles.monthGrid}>
                    {FLEXIBLE_MONTH_OPTIONS.map((option) => {
                      const active = formState.targetMonths.includes(option.value);
                      const disabled = !active && formState.targetMonths.length >= 4;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`${styles.monthChip} ${active ? styles.monthChipActive : ""} ${disabled ? styles.monthChipDisabled : ""}`}
                          data-ui="month-chip"
                          data-active={active || undefined}
                          onClick={() => toggleTargetMonth(option.value)}
                          disabled={disabled}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span className={styles.stepLabel} data-ui="field-label">最短滞在</span>
                      <select
                        className={styles.select}
                        data-ui="select"
                        value={formState.stayLengthMin}
                        onChange={(event) => updateFormState("stayLengthMin", event.target.value as FlexibleStayDayKey)}
                      >
                        {FLEXIBLE_STAY_DAY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.stepLabel} data-ui="field-label">最長滞在</span>
                      <select
                        className={styles.select}
                        data-ui="select"
                        value={formState.stayLengthMax}
                        onChange={(event) => updateFormState("stayLengthMax", event.target.value as FlexibleStayDayKey)}
                      >
                        {FLEXIBLE_STAY_DAY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              <div className={styles.destBlock}>
                <span className={styles.stepLabel} data-ui="field-label">候補の国（最大5か国・入口と出口の候補になります）</span>
                <div className={styles.chipGrid}>
                  {COUNTRY_OPTIONS.filter((option) => option.value !== formState.departureCountry).map((option) => {
                    const active = formState.destinationCountries.includes(option.value as CountryCode);
                    const disabled = !active && formState.destinationCountries.length >= 5;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        data-country-code={option.value}
                        className={`${styles.countryChip} ${active ? styles.countryChipActive : ""} ${disabled ? styles.countryChipDisabled : ""}`}
                        data-ui="country-chip"
                        data-active={active || undefined}
                        onClick={() => toggleDestinationCountry(option.value as CountryCode)}
                        disabled={disabled}
                        aria-pressed={active}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.optionsRow}>
                <div className={styles.cabinRow}>
                  {CABIN_CLASS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.cabinCard} ${formState.cabinClass === option.value ? styles.cabinCardActive : ""}`}
                      data-ui="cabin-card"
                      data-active={formState.cabinClass === option.value || undefined}
                      onClick={() => updateFormState("cabinClass", option.value as CabinClassKey)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label className={styles.toggleRow} data-ui="toggle-row">
                  <input
                    type="checkbox"
                    checked={formState.preferDirect}
                    onChange={(event) => updateFormState("preferDirect", event.target.checked)}
                  />
                  <span className={styles.toggleSwitch} data-ui="toggle-switch" aria-hidden="true" />
                  <span className={styles.toggleText}>直行を優先（外すと乗継も含め価格重視）</span>
                </label>
              </div>

              <div className={styles.poolPreview} data-ui="pool-preview">
                <div className={styles.poolCard} data-ui="pool-card">
                  <span>滞在国</span>
                  <strong>{formState.destinationCountries.length}カ国 / {selectedDestinationAirportCount}空港</strong>
                  <p>{selectedDestinationLabels}</p>
                </div>
                <div className={styles.poolCard} data-ui="pool-card">
                  <span>自動ゲートウェイ<small className="mp-en">Auto gateway</small></span>
                  <strong>{gatewayOnlyCountries.length}カ国 / {gatewayOnlyAirportCount}空港</strong>
                  <p>{gatewayOnlyLabels}</p>
                </div>
                <div className={styles.poolCard} data-ui="pool-card" data-tone="total">
                  <span>合計プール</span>
                  <strong>{gatewayCountries.length}カ国 / {destinationAirportCount}空港</strong>
                  <p>復路の目安：{formState.dateSearchMode === "exact" ? (returnDate ? formatDateLabel(returnDate) : "未設定") : `${returnWindowPreview} / ${stayRangeLabel}`}</p>
                </div>
              </div>

              {corridorModeActive ? (
                <p className={styles.corridorNote} data-ui="corridor-note">
                  <strong>欧州の乗継ルートも比較中：</strong>乗継ありにしているので、ブダペストやプラハのような安く狙える都市も、入口や出口の候補に入れて比べています。
                </p>
              ) : null}

              {validationMessage ? <p className={styles.validationText}>{validationMessage}</p> : null}

              <div className={styles.searchActions}>
                <button className={styles.btnGhost} data-ui="btn-ghost" type="button" onClick={handleReset}>
                  リセット
                </button>
                <button className={styles.btnSearch} data-ui="btn-search" type="submit" disabled={!canSearch || loading}>
                  {loading ? "探索中…" : "最安の片道2枚を検索"}
                  {!loading ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  ) : null}
                </button>
              </div>
            </form>
          </div>

          <div className={styles.trustRow}>
            {trustItems.map((item, index) => (
              <div key={item.stat} className={styles.trustItem} data-ui="trust-item" data-reveal style={revealStyle(index)}>
                <strong>{item.stat}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.destSection} id="destinations" data-ui="dest-section" {...zoneProps("dest")}>
        <div className={styles.shell}>
          <div className={styles.sectionHead} data-ui="section-head" data-reveal style={revealStyle(0)}>
            <h2 className={styles.sectionTitle} data-ui="section-title">人気の目的地から始める</h2>
            <p className={styles.sectionLead} data-ui="section-lead">気になる都市を選ぶと候補の国に入ります。そのまま検索に進めます。</p>
          </div>
          <div className={styles.destGrid} data-ui="dest-grid">
            {destinations.map((dest, index) => {
              const active = formState.destinationCountries.includes(dest.code);
              const estimate = destinationEstimates[dest.code];
              const tone = typeof estimate === "number" ? priceTone(estimate, destMin, destMax) : null;
              return (
                <button
                  key={dest.code}
                  type="button"
                  className={styles.destCard}
                  data-ui="dest-card"
                  data-active={active || undefined}
                  onClick={() => selectDestinationFromCard(dest.code)}
                  data-reveal
                  style={revealStyle(index)}
                >
                  <span className={styles.destImg} data-ui="dest-img" style={{ backgroundImage: `url(${dest.img})` }} aria-hidden="true" />
                  <span className={styles.destTag} data-ui="dest-tag">{active ? "選択中" : "候補に追加"}</span>
                  <span className={styles.destBody} data-ui="dest-body">
                    <span className={styles.destCityRow}>
                      <span>
                        <span className={styles.destCity}>{dest.city}</span>
                        <span className={styles.destCountry}>{dest.country}</span>
                      </span>
                      {tone ? <span className={styles.toneBadge} data-ui="tone-badge" data-tone={tone}>{TONE_LABEL[tone]}</span> : null}
                    </span>
                    <span className={styles.destPriceRow}>
                      <span className={styles.destPriceLabel}>片道2枚の目安</span>
                      <strong className={styles.destPrice} data-ui="dest-price">
                        {typeof estimate === "number" ? formatCurrency(estimate) : "—"}
                      </strong>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.resultsSection} id="results" data-ui="results-section">
        <div className={styles.shell}>
          <div data-ui="result-intro" {...zoneProps("resultIntro")}>
            <div className={styles.sectionHead} data-ui="section-head" data-reveal style={revealStyle(0)}>
              <span className="mp-kicker" data-ui="kicker">Grand Tour Ledger</span>
              <h2 className={styles.sectionTitle} data-ui="section-title">検索結果</h2>
              <p className={styles.sectionLead} data-ui="section-lead">結果は、往路の入口と復路の出口、その間の移動に分けて出します。まず安い組み合わせを見て、実際の検索で確かめてください。</p>
            </div>

            {loading ? (
              <div className={styles.stateCard} data-ui="state-card" data-reveal style={revealStyle(1)}>
                <div className={styles.loadingRoute}>
                  <span>TYO</span>
                  <span className={styles.loadingLine} />
                  <span>EU</span>
                </div>
                <h3>選んだ月と空港から、ルートを探しています。</h3>
                <p>往路の安い入口を見つけて、そこから滞在日数ぶんずらして復路を探しています。</p>
              </div>
            ) : null}

            {!loading && !hasGenerated ? (
              <div className={styles.stateCard} data-ui="state-card" data-reveal style={revealStyle(1)}>
                <h3>条件を入力すると、ここに片道2枚のプランが出ます。</h3>
                <p>月をまたいでも、日付を決めても、安い入口と出口を出します。</p>
                <a className={styles.btnSearch} data-ui="btn-search" href="#search">条件を入力する</a>
              </div>
            ) : null}

            {!loading && hasGenerated && !result ? (
              <div className={styles.stateCard} data-ui="state-card" data-reveal style={revealStyle(1)}>
                <h3>この条件では十分なルート候補が見つかりませんでした。</h3>
                <ul className={styles.guidanceList}>
                  {noRouteGuidance.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {!loading && result ? (
            <>
              <div data-ui="result-core" {...zoneProps("resultCore")}>
                {result.fallbackNotice ? (
                  <div className={styles.fallbackBanner} data-ui="fallback-banner" role="status" data-reveal style={revealStyle(1)}>
                    <span className={styles.fallbackIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 9v4M12 17h.01" />
                        <path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
                      </svg>
                    </span>
                    <p>{result.fallbackNotice}</p>
                  </div>
                ) : null}

                <div className={styles.resultHero} data-ui="result-hero" data-testid="result-summary" data-reveal style={revealStyle(1)}>
                  <div className={styles.resultHeadline}>
                    <span className={styles.resultKicker} data-ui="kicker">おすすめの片道2枚</span>
                    <h3>{result.planHeadline}</h3>
                    <p>{result.flexibilitySummary}</p>
                  </div>
                  <div className={styles.resultPrice} data-ui="result-price">
                    <span>2枚合計の推定額</span>
                    <strong>{formatCurrency(result.totalPrice)}</strong>
                    <small>{formatCurrencyRange(result.totalPriceRange)}</small>
                    <small>1名あたり {formatCurrencyRange(result.totalPriceRangePerPerson)}</small>
                  </div>
                </div>

                <div className={styles.pairGrid} data-ui="pair-grid">
                  {renderFlightCard(result.bestOutbound, "往路（片道1枚目）", "out", 2)}

                  <div className={styles.gapCard} data-ui="gap-card" data-testid="between-tickets-gap" data-reveal style={revealStyle(3)}>
                    <span className={styles.gapKicker} data-ui="kicker">Between tickets</span>
                    <h3>滞在先と空港は、同じでなくていい。</h3>
                    <p>{result.betweenTicketsGap.summary}</p>
                    <p>{result.betweenTicketsGap.note}</p>
                    <div className={styles.gapMeta}>
                      <div>
                        <span>到着</span>
                        <strong>{result.betweenTicketsGap.arrivalLabel}</strong>
                      </div>
                      <div className={styles.gapArrow} aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </div>
                      <div>
                        <span>出発</span>
                        <strong>{result.betweenTicketsGap.departureLabel}</strong>
                      </div>
                    </div>
                  </div>

                  {renderFlightCard(result.bestInbound, "復路（片道2枚目）", "in", 4)}
                </div>
              </div>

              <div className={styles.statLedger} data-ui="stat-ledger" data-reveal style={revealStyle(4)} {...zoneProps("ledger")}>
                <div className={styles.statCell} data-ui="stat-cell" data-cell="1">
                  <span>探索ウィンドウ</span>
                  <strong>往路 {result.outboundDateWindow}</strong>
                  <small>復路 {result.returnDateWindow}</small>
                </div>
                <div className={styles.statCell} data-ui="stat-cell" data-cell="2">
                  <span>滞在の幅</span>
                  <strong>{result.stayLengthRangeLabel}</strong>
                  <small>往路 {result.comparedOutboundDateCount}日 / 復路 {result.comparedReturnDateCount}日を比較</small>
                </div>
                <div className={styles.statCell} data-ui="stat-cell" data-cell="3">
                  <span>ゲートウェイプール</span>
                  <strong>{result.gatewayCountries.length}カ国 / {result.gatewayAirports.length}空港</strong>
                  <small>{result.gatewaySummary}</small>
                </div>
                <div className={styles.statCell} data-ui="stat-cell" data-cell="4">
                  <span>チケッティング</span>
                  <strong>片道2枚を別々に見積もり</strong>
                  <small>{result.ticketingSummary}</small>
                </div>
              </div>

              <section className={styles.handoffSection} data-ui="handoff-section" data-reveal style={revealStyle(5)} {...zoneProps("handoff")}>
                <div className={styles.subHead} data-ui="sub-head">
                  <h3>実検索へのハンドオフ</h3>
                  <span>{result.liveFareSources.length} cards</span>
                </div>
                <p className={styles.subLead} data-ui="sub-lead">
                  ここからは推定ではなく、実際の検索への受け渡しです。価格が出ないときは、各カードの区間と日付をそのまま入力して調べ直してください。
                </p>
                <div className={styles.handoffGrid} data-ui="handoff-grid">
                  {result.liveFareSources.map((source) => (
                    <div key={source.id}>{renderHandoffCard(source)}</div>
                  ))}
                </div>
              </section>

              <div className={styles.altWrap}>
                <section className={styles.altSection} data-ui="alt-section" data-reveal style={revealStyle(6)} {...zoneProps("alt")}>
                  <div className={styles.subHead} data-ui="sub-head">
                    <h3>往路の代替入口</h3>
                    <span>{result.outboundAlternatives.length}案</span>
                  </div>
                  <div className={styles.altRow} data-ui="alt-row">
                    {result.outboundAlternatives.map((quote, index, arr) => (
                      <article key={`${quote.direction}-${quote.origin.code}-${quote.destination.code}-${quote.travelDate}`} className={styles.altCard} data-ui="alt-card">
                        <div className={styles.altTop}>
                          <span>{getAlternativeBadge(quote, index, result.bestOutbound)}</span>
                          <strong data-tone={priceTone(quote.totalPrice, arr[0].totalPrice, arr[arr.length - 1].totalPrice)}>
                            {formatCurrency(quote.totalPrice)}
                          </strong>
                        </div>
                        <h4>{routeLabel(quote)}</h4>
                        <p>{formatDateLabel(quote.travelDate)} · {quote.stopLabel}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className={styles.altSection} data-ui="alt-section" data-reveal style={revealStyle(7)} {...zoneProps("alt")}>
                  <div className={styles.subHead} data-ui="sub-head">
                    <h3>復路の代替出口</h3>
                    <span>{result.inboundAlternatives.length}案</span>
                  </div>
                  <div className={styles.altRow} data-ui="alt-row">
                    {result.inboundAlternatives.map((quote, index, arr) => (
                      <article key={`${quote.direction}-${quote.origin.code}-${quote.destination.code}-${quote.travelDate}`} className={styles.altCard} data-ui="alt-card">
                        <div className={styles.altTop}>
                          <span>{getAlternativeBadge(quote, index, result.bestInbound)}</span>
                          <strong data-tone={priceTone(quote.totalPrice, arr[0].totalPrice, arr[arr.length - 1].totalPrice)}>
                            {formatCurrency(quote.totalPrice)}
                          </strong>
                        </div>
                        <h4>{routeLabel(quote)}</h4>
                        <p>{formatDateLabel(quote.travelDate)} · {quote.stopLabel}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <section className={styles.coverageSection} data-ui="coverage-section" data-reveal style={revealStyle(8)} {...zoneProps("coverage")}>
                <div className={styles.subHead} data-ui="sub-head">
                  <h3>候補国ごとのカバレッジ</h3>
                  <span>{result.destinationCountries.length}か国</span>
                </div>
                <div className={styles.coverageGrid} data-ui="coverage-grid">
                  {result.coverage.map((entry) => (
                    <article key={entry.country.code} className={styles.coverageCard} data-ui="coverage-card">
                      <header>
                        <span>{entry.country.region}</span>
                        <strong>{entry.country.name}</strong>
                      </header>
                      <p>{entry.country.summary}</p>
                      <p className={styles.coverageCodes}>{entry.airports.map((airport) => airport.code).join(" / ")}</p>
                      <div className={styles.coverageLegs}>
                        <small>入口 {entry.bestOutbound ? `${routeLabel(entry.bestOutbound)} / ${formatCurrency(entry.bestOutbound.totalPrice)}` : "該当なし"}</small>
                        <small>出口 {entry.bestInbound ? `${routeLabel(entry.bestInbound)} / ${formatCurrency(entry.bestInbound.totalPrice)}` : "該当なし"}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </section>

      <section className={styles.howSection} id="how" data-ui="how-section" {...zoneProps("how")}>
        <div className={styles.shell}>
          <div className={styles.sectionHead} data-ui="section-head" data-reveal style={revealStyle(0)}>
            <h2 className={styles.sectionTitle} data-ui="section-title">使い方は3ステップ</h2>
            <p className={styles.sectionLead} data-ui="section-lead">片道2枚の入口と出口を先に決めることで、残りの旅をあとから自由にできます。</p>
          </div>
          <div className={styles.howGrid} data-ui="how-grid">
            {howSteps.map((item, index) => (
              <article key={item.title} className={styles.howCard} data-ui="how-card" data-reveal style={revealStyle(index + 1)}>
                <span className={styles.howStep} data-ui="how-step">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>

          <div className={styles.archGrid} data-ui="arch-grid">
            {archetypes.map((item, index) => (
              <article key={item.title} className={styles.archCard} data-ui="arch-card" data-reveal style={revealStyle(index + 1)}>
                <span className={styles.archLabel} data-ui="kicker">{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.ctaSection} data-ui="cta-section" {...zoneProps("cta")}>
        <div className={styles.shell}>
          <div className={styles.ctaInner} data-ui="cta-inner" data-reveal style={revealStyle(0)}>
            <div>
              <h2>行き先や日付がまだ決まっていなくても、探せます。</h2>
              <p>月と滞在日数を選ぶだけで、往路と復路の安い組み合わせが出ます。あとは実際の検索で確かめてください。</p>
            </div>
            <a className={styles.btnSearchLight} data-ui="btn-search-light" href="#search">
              片道2枚を探す
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      <footer className={styles.footer} data-ui="footer" {...zoneProps("footer")}>
        <div className={styles.shell}>
          <div className={styles.footerInner}>
            <div>
              <p className={styles.footerMark}>Maison Passage</p>
              <p className={styles.footerText}>海外の航空券を、片道2枚で比べるためのツールです。</p>
            </div>
            <nav className={styles.footerNav} aria-label="フッターメニュー">
              {NAV_ITEMS.map((item) => (
                <a key={item.id} href={`#${item.id}`}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
          <p className={styles.footerFine}>
            表示価格は、片道2枚をそれぞれ別に見積もった参考値です。実際の空席や運賃ではないので、最終確認は各リンク先でお願いします。写真はイメージです。
          </p>
        </div>
      </footer>

      <aside className="mp-lab" data-open={labOpen || undefined} data-testid="design-lab">
        <button
          type="button"
          className="mp-lab__toggle"
          onClick={() => setLabOpen((open) => !open)}
          aria-expanded={labOpen}
          aria-controls="mp-lab-panel"
        >
          <span aria-hidden="true">🎨</span>
          <span className="mp-lab__toggleText">Design Lab</span>
        </button>

        <div className="mp-lab__panel" id="mp-lab-panel" role="listbox" aria-label="UIスタイルを選ぶ" hidden={!labOpen}>
          <p className="mp-lab__head">
            <strong>UIスタイルを着せ替える</strong>
            <span>同じ画面を10通りの流儀で見てみる。</span>
          </p>
          <div className="mp-lab__list">
            {SKINS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={skin === item.id}
                className="mp-lab__item"
                data-active={skin === item.id || undefined}
                data-skin-id={item.id}
                onClick={() => selectSkin(item.id)}
              >
                <span className="mp-lab__no">{item.no}</span>
                <span className="mp-lab__text">
                  <strong>{item.name}</strong>
                  <small>{item.blurb}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
