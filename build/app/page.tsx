"use client";

import { startTransition, useEffect, useRef, useState, type CSSProperties } from "react";
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

const proofPoints = [
  {
    label: "予約戦略",
    value: "片道2枚で比較",
    text: "最初に決めるのは往復券ではなく、往路1枚と復路1枚の組み合わせです。",
  },
  {
    label: "探索単位",
    value: "複数月 + 滞在幅 + gateway",
    text: "7月から9月、26日から36日、さらに周辺 gateway 都市まで広げて比較します。",
  },
  {
    label: "最終確認",
    value: "Two one-way handoff",
    text: "往路と復路をそれぞれ実検索へ渡し、2枚の片道券として最終確認します。",
  },
];

const methodMoments = [
  {
    label: "Chapter 01",
    title: "滞在したい国から、周辺 gateway まで静かに広げる。",
    text:
      "日本を選んだら、羽田・成田・関西といった主要な出発空港に展開します。さらにヨーロッパ圏は周辺 gateway 都市まで検索プールを広げるので、ベルリン旅でもミラノ着のような入口が拾えます。",
  },
  {
    label: "Chapter 02",
    title: "往路の最安日を先に決め、その後で復路を探す。",
    text:
      "フレックス探索では、選んだ月全体を対象に往路の最安入口を先に見つけます。そこから滞在レンジだけ時間をずらして、復路の最安出口を探します。",
  },
  {
    label: "Chapter 03",
    title: "都市間移動は、次の判断として後ろに置く。",
    text:
      "ミラノに入り、ベルリンやパリから戻る。その間の列車や短距離便はまだ決めません。まず片道2枚の輪郭だけ整えることで、旅全体の自由度が上がります。",
  },
];

const archetypes = [
  {
    label: "Grand Tour",
    title: "欧州三都の横断",
    text: "フランス、イギリス、ドイツのように複数国をまたぎ、入口と出口を別々に構成する旅。",
  },
  {
    label: "Long Stay",
    title: "一か月前後の余白",
    text: "7月出発から8月帰国のように、滞在レンジをゆるく持ちながら価格の落ちる日を見ます。",
  },
  {
    label: "Dual Gateway",
    title: "主目的地と gateway を分ける",
    text: "ドイツ旅でも入口はミラノ、帰国はベルリンのように、滞在先と航空券の入口・出口を分けて整えます。",
  },
];

function routeLabel(quote: FlightLegQuote) {
  return `${quote.origin.code} → ${quote.destination.code}`;
}

function revealStyle(step: number): CSSProperties {
  return { ["--reveal-delay" as never]: `${step * 110}ms` } as CSSProperties;
}

function getAlternativeBadge(quote: FlightLegQuote, index: number, bestQuote: FlightLegQuote) {
  if (index === 0) {
    return "最安";
  }

  if (quote.stopCount === 0) {
    return "直行";
  }

  if (quote.durationHours < bestQuote.durationHours) {
    return "短時間";
  }

  if (quote.origin.city !== bestQuote.origin.city || quote.destination.city !== bestQuote.destination.city) {
    return "別ゲート";
  }

  return "価格寄り";
}

function renderTicketCard(quote: FlightLegQuote, title: string, revealStep?: number) {
  return (
    <article className={styles.ticketCard} data-reveal={revealStep !== undefined || undefined} style={revealStep !== undefined ? revealStyle(revealStep) : undefined}>
      <div className={styles.ticketHead}>
        <span className={styles.ticketTag}>{title}</span>
        <strong className={styles.ticketPrice}>{formatCurrency(quote.totalPrice)}</strong>
      </div>

      <div className={styles.ticketRoute}>
        <span>{quote.origin.code}</span>
        <div className={styles.ticketLine} />
        <span>{quote.destination.code}</span>
      </div>

      <p className={styles.ticketCities}>
        {quote.origin.city} / {quote.destination.city}
      </p>

      <div className={styles.ticketMeta}>
        <span>{formatDateLabel(quote.travelDate)}</span>
        <span>{quote.stopLabel}</span>
        <span>{formatDuration(quote.durationHours)}</span>
      </div>

      <div className={styles.ticketRange}>
        <span>参考レンジ</span>
        <strong>{formatCurrencyRange(quote.totalPriceRange)}</strong>
        <small>{quote.confidenceLabel}</small>
        <small>{quote.estimateBasis}</small>
      </div>

      <ul className={styles.reasonList}>
        {quote.reasonPoints.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <a className={styles.ticketLink} href={quote.skyscannerUrl} target="_blank" rel="noreferrer">
        この片道を Skyscanner で確認
      </a>
    </article>
  );
}

function renderLiveFareSourceCard(source: LiveFareSource) {
  const isReference = source.status === "reference";

  return (
    <article className={styles.liveSourceCard} data-tone={source.status}>
      <div className={styles.liveSourceHead}>
        <div>
          <span className={styles.liveSourceLabel}>{source.label}</span>
          <strong className={styles.liveSourceRoute}>{source.routeLabel}</strong>
        </div>
        <span className={styles.liveSourceStatus}>{source.statusLabel}</span>
      </div>

      <div className={styles.liveSourceMeta}>
        <div className={styles.liveSourceMetaItem}>
          <span>Provider</span>
          <strong>{source.provider}</strong>
        </div>
        <div className={styles.liveSourceMetaItem}>
          <span>Date</span>
          <strong>{source.dateLabel}</strong>
        </div>
        <div className={styles.liveSourceMetaItem}>
          <span>Search brief</span>
          <strong>{source.detailsLabel}</strong>
        </div>
      </div>

      <p className={styles.liveSourceFallback}>{source.fallbackLabel}</p>

      <a className={isReference ? styles.secondaryLink : styles.ticketLink} href={source.url} target="_blank" rel="noreferrer">
        {isReference ? "参考検索を開く" : "この検索を Skyscanner で開く"}
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
  const pendingSearchRef = useRef<number | null>(null);

  const validationMessage = submitted ? getFormValidationMessage(formState) : null;
  const canSearch = isFormValid(formState);
  const returnDate = getReturnDate(formState);
  const dateSearchSummary = getDateSearchSummary(formState);
  const stayRangeLabel = getStayRangeLabel(formState);
  const previewOutboundDate = `${formState.targetMonths[0] ?? "2026-07"}-15`;
  const returnWindowPreview = formState.dateSearchMode === "exact" ? returnDate : getReturnWindowLabel(previewOutboundDate, formState);
  const departureAirportCount = formState.departureCountry ? getAirportsForCountry(formState.departureCountry).length : 0;
  const selectedDestinationAirportCount = formState.destinationCountries.reduce(
    (count, countryCode) => count + getAirportsForCountry(countryCode).length,
    0,
  );
  const gatewayExpansionOptions = {
    includeBudgetCorridors: !formState.preferDirect,
  };
  const gatewayCountries = getGatewayCountriesForDestinationCodes(
    formState.destinationCountries,
    gatewayExpansionOptions,
  );
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
    formState.destinationCountries.map((countryCode) => COUNTRY_LABELS[countryCode]).join(" / ") || "滞在国を選ぶとここに表示します。";
  const gatewayOnlyLabels =
    gatewayOnlyCountries.map((country) => country.name).join(" / ") || "今の組み合わせでは追加の gateway 拡張はありません。";
  const noRouteGuidance = buildNoRouteGuidance(formState);
  const corridorModeActive =
    !formState.preferDirect && formState.destinationCountries.some((countryCode) => isEuropeanCountryCode(countryCode));

  function updateFormState<Key extends keyof PlannerFormState>(key: Key, value: PlannerFormState[Key]) {
    setFormState((current) => ({
      ...current,
      [key]: value,
    }));
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
      if (current.departureCountry === countryCode) {
        return current;
      }

      if (current.destinationCountries.includes(countryCode)) {
        return {
          ...current,
          destinationCountries: current.destinationCountries.filter((item) => item !== countryCode),
        };
      }

      if (current.destinationCountries.length >= 5) {
        return current;
      }

      return {
        ...current,
        destinationCountries: [...current.destinationCountries, countryCode],
      };
    });
  }

  function toggleTargetMonth(monthKey: TravelMonthKey) {
    setFormState((current) => {
      if (current.targetMonths.includes(monthKey)) {
        return {
          ...current,
          targetMonths: current.targetMonths.filter((item) => item !== monthKey),
        };
      }

      if (current.targetMonths.length >= 4) {
        return current;
      }

      return {
        ...current,
        targetMonths: [...current.targetMonths, monthKey].sort(),
      };
    });
  }

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);

    if (!canSearch || loading) {
      return;
    }

    const snapshot = { ...formState };
    setLoading(true);

    if (pendingSearchRef.current !== null) {
      window.clearTimeout(pendingSearchRef.current);
    }

    pendingSearchRef.current = window.setTimeout(() => {
      const nextResult = generateFlightSearchResult(snapshot);
      startTransition(() => {
        setResult(nextResult);
        setHasGenerated(true);
        setLoading(false);
      });
      pendingSearchRef.current = null;
    }, 820);
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

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setIsScrolled(y > 24);
      const doc = document.documentElement;
      const max = (doc.scrollHeight - window.innerHeight) || 1;
      setScrollProgress(Math.min(1, Math.max(0, y / max)));
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (pendingSearchRef.current !== null) {
        window.clearTimeout(pendingSearchRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const ids = ["top", "atelier", "folio", "method", "archetypes", "concierge"];
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (!sections.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      {
        rootMargin: "-40% 0px -50% 0px",
        threshold: [0, 0.1, 0.5, 1],
      },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (!revealNodes.length) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealNodes.forEach((node) => node.dataset.revealVisible = "true");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.setAttribute("data-reveal-visible", "true");
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -10% 0px",
      },
    );

    revealNodes.forEach((node) => {
      if (node.dataset.revealVisible === "true") {
        return;
      }

      observer.observe(node);
    });

    return () => observer.disconnect();
  }, [hasGenerated, loading, result]);

  return (
    <main className={styles.page}>
      <div className={styles.scrollProgress} aria-hidden="true">
        <span style={{ transform: `scaleX(${scrollProgress})` }} />
      </div>

      <header className={`${styles.header} ${isScrolled ? styles.headerSolid : ""}`}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#top">
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="16" cy="16" r="13" />
                <path d="M16 3v26M3 16h26" />
                <path d="M16 5l3 11-3 3-3-3z" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className={styles.brandText}>
              <strong>Maison Passage</strong>
              <span>Gateway Pair Explorer · est. 2026</span>
            </span>
          </a>

          <nav className={styles.headerNav} aria-label="ページ内メニュー">
            <a href="#atelier" data-active={activeSection === "atelier" || undefined}>
              <em>01</em>Planner
            </a>
            <a href="#folio" data-active={activeSection === "folio" || undefined}>
              <em>02</em>Result
            </a>
            <a href="#method" data-active={activeSection === "method" || undefined}>
              <em>03</em>Method
            </a>
            <a href="#archetypes" data-active={activeSection === "archetypes" || undefined}>
              <em>04</em>Archetypes
            </a>
            <a href="#concierge" data-active={activeSection === "concierge" || undefined}>
              <em>05</em>Concierge
            </a>
          </nav>

          <a className={styles.headerCta} href="#atelier">
            <span>旅の台帳を開く</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>
      </header>

      <section className={styles.coverSection} id="top" data-testid="hero">
        <div className={styles.coverBackdrop} />
        <div className={styles.coverGrid} aria-hidden="true" />
        <span className={`${styles.regMark} ${styles.regTL}`} aria-hidden="true" />
        <span className={`${styles.regMark} ${styles.regTR}`} aria-hidden="true" />
        <span className={`${styles.regMark} ${styles.regBL}`} aria-hidden="true" />
        <span className={`${styles.regMark} ${styles.regBR}`} aria-hidden="true" />

        <div className={styles.shell}>
          <div className={styles.coverLayout}>
            <div className={styles.coverCopy} data-reveal style={revealStyle(0)}>
              <p className={styles.overline}>
                <span className={styles.dot} aria-hidden="true" />
                Grand Tour Ledger
                <em>· Vol. 04</em>
              </p>
              <h1 className={styles.coverTitle}>
                往復ではなく、<i>二枚の</i>
                <br />
                <span className={styles.titleAccent}>片道券</span>として整える。
              </h1>
              <p className={styles.coverLead}>
                目的地を先に決めきらなくてもいい。まずは出発国、候補の国、そして季節の幅だけ。
                Maison Passage は、複数月の往路と滞在レンジ後の復路を静かに比べ、片道2枚の輪郭だけを美しく選び出します。
              </p>

              <div className={styles.coverActions}>
                <a className={styles.primaryButton} href="#atelier">
                  <span>旅の条件を綴る</span>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </a>
                <a className={styles.secondaryButton} href="#folio">
                  結果の読み方を見る
                </a>
              </div>

              <div className={styles.coverNote}>
                <span>
                  <strong>01.</strong> いま決めるのは、往復券ではなく往路1枚と復路1枚の組み合わせ。
                </span>
                <span>
                  <strong>02.</strong> そのあいだの列車や短距離便は、まだ余白として残します。
                </span>
              </div>
            </div>

            <div className={styles.coverPreview} data-reveal style={revealStyle(1)}>
              <div className={styles.previewSheet}>
                <div className={styles.previewSheetHead}>
                  <p className={styles.previewLabel}>Specimen route · MP-04</p>
                  <span className={styles.previewStamp}>
                    <em>Filed</em>
                    <strong>2026 · 05</strong>
                  </span>
                </div>

                <div className={styles.previewCodes}>
                  <span>TYO</span>
                  <span>MIL</span>
                  <span>BER</span>
                  <span>TYO</span>
                </div>

                <svg className={styles.previewArc} viewBox="0 0 480 160" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="arcGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#ff4f2f" />
                      <stop offset="50%" stopColor="#1f55ff" />
                      <stop offset="100%" stopColor="#ffd548" />
                    </linearGradient>
                    <pattern id="arcDots" width="6" height="6" patternUnits="userSpaceOnUse">
                      <circle cx="1" cy="1" r="1" fill="rgba(17,17,17,0.18)" />
                    </pattern>
                  </defs>
                  <rect x="0" y="0" width="480" height="160" fill="url(#arcDots)" />
                  <path d="M16 132 Q 120 -10 240 80 T 464 132" fill="none" stroke="rgba(17,17,17,0.18)" strokeWidth="2" strokeDasharray="4 6" />
                  <path
                    className={styles.arcPath}
                    d="M16 132 Q 120 -10 240 80 T 464 132"
                    fill="none"
                    stroke="url(#arcGradient)"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <g className={styles.arcStations}>
                    <circle cx="16" cy="132" r="6" fill="#fffaf1" stroke="#111" strokeWidth="2.6" />
                    <circle cx="240" cy="80" r="6" fill="#ffd548" stroke="#111" strokeWidth="2.6" />
                    <circle cx="464" cy="132" r="6" fill="#fffaf1" stroke="#111" strokeWidth="2.6" />
                  </g>
                  <g className={styles.arcPlane} aria-hidden="true">
                    <circle r="9" fill="#fffaf1" stroke="#111" strokeWidth="2.4" />
                    <path d="M-4 0 L4 0 M0 -3 L0 3" stroke="#111" strokeWidth="2" strokeLinecap="round" />
                  </g>
                </svg>

                <div className={styles.previewLegend}>
                  <div>
                    <span>Entry</span>
                    <strong>Milan · MXP</strong>
                  </div>
                  <div>
                    <span>Exit</span>
                    <strong>Berlin · BER</strong>
                  </div>
                  <div>
                    <span>Window</span>
                    <strong>Jul–Sep / 26-36d</strong>
                  </div>
                </div>
              </div>

              <div className={styles.previewDock}>
                <div>
                  <span>Departure</span>
                  <strong>{departureAirportCount || 5} airports</strong>
                </div>
                <div>
                  <span>Gateways</span>
                  <strong>{destinationAirportCount || 9} gateway airports</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.tickerStrip} aria-hidden="true">
          <div className={styles.tickerTrack}>
            {Array.from({ length: 2 }).map((_, loop) => (
              <span key={loop} className={styles.tickerGroup}>
                <em>HND</em>·<em>NRT</em>·<em>KIX</em>·<em>CDG</em>·<em>LHR</em>·<em>FRA</em>·<em>FCO</em>·<em>MXP</em>·<em>BCN</em>·<em>MAD</em>·<em>AMS</em>·<em>VIE</em>·<em>PRG</em>·<em>BUD</em>·<em>BER</em>·<em>ZRH</em>·<em>CPH</em>·<em>OSL</em>·<em>HEL</em>·<em>IST</em>·
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.proofStrip}>
        <div className={styles.shell}>
          <div className={styles.proofGrid}>
            {proofPoints.map((item, index) => (
              <article key={item.label} className={styles.proofCard} data-reveal style={revealStyle(index)}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.plannerStage} id="atelier">
        <div className={styles.shell}>
          <div className={styles.sectionIntro} data-reveal style={revealStyle(0)}>
            <p className={styles.sectionLabel}>Planner atelier</p>
            <h2>条件を埋めるのではなく、旅の素描をつくる。</h2>
            <p>
              この画面はフォームではなく、旅の brief を整えるための台帳です。月単位のフレックス探索も、
              固定日程の比較も、同じ紙面の中で静かに切り替えられます。
            </p>
          </div>

          <div className={styles.briefRibbon} data-reveal style={revealStyle(1)}>
            <div>
              <span>Current brief</span>
              <strong>{buildSearchSummary(formState)}</strong>
            </div>
            <div>
              <span>Date window</span>
              <strong>{dateSearchSummary}</strong>
            </div>
            <div>
              <span>Search pool</span>
              <strong>
                出発 {departureAirportCount} / gateway候補 {destinationAirportCount}
              </strong>
            </div>
          </div>

          <div className={styles.atelierLayout}>
            <aside className={styles.atelierAside}>
              <div className={styles.atelierCard} data-reveal style={revealStyle(2)}>
                <p className={styles.sectionLabel}>House note</p>
                <h3>最初に旅程全体を完成させない。</h3>
                <p>
                  Maison Passage が扱うのは、海外旅行の入口と出口です。最初の到着地と最後の帰国地を整えることで、
                  そのあとの現地移動に余白が生まれます。
                </p>
              </div>

              <div className={styles.atelierCard} data-reveal style={revealStyle(3)}>
                <p className={styles.sectionLabel}>Suggested frame</p>
                <ul className={styles.memoList}>
                  <li>7月から9月をまとめて比較する。</li>
                  <li>26日から36日の滞在幅を持たせる。</li>
                  <li>フランス、イギリス、ドイツを同時に候補にする。</li>
                </ul>
              </div>
            </aside>

            <section className={styles.atelierSurface}>
              <form onSubmit={handleSearch} data-testid="trip-brief-form" className={styles.atelierForm}>
                <article className={styles.sheet} data-reveal style={revealStyle(4)}>
                  <div className={styles.sheetHead}>
                    <span>01</span>
                    <div>
                      <h3>Origin</h3>
                      <p>どこから旅を始めるか。</p>
                    </div>
                  </div>

                  <div className={styles.fieldStack}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>出発国</span>
                      <select
                        className={styles.select}
                        value={formState.departureCountry}
                        onChange={(event) => handleDepartureChange(event.target.value as CountryCode)}
                      >
                        {COUNTRY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </article>

                <article className={styles.sheet} data-reveal style={revealStyle(5)}>
                  <div className={styles.sheetHead}>
                    <span>02</span>
                    <div>
                      <h3>Travel window</h3>
                      <p>日付を一点で決めるか、季節の幅で探すか。</p>
                    </div>
                  </div>

                  <div className={styles.modeRail}>
                    <button
                      type="button"
                      className={`${styles.modeButton} ${formState.dateSearchMode === "flexible" ? styles.modeButtonActive : ""}`}
                      onClick={() => updateFormState("dateSearchMode", "flexible")}
                    >
                      <strong>複数月で探す</strong>
                      <span>季節の幅から最安日を拾う</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.modeButton} ${formState.dateSearchMode === "exact" ? styles.modeButtonActive : ""}`}
                      onClick={() => updateFormState("dateSearchMode", "exact")}
                    >
                      <strong>日付を指定する</strong>
                      <span>既に決めている日程で比較する</span>
                    </button>
                  </div>

                  {formState.dateSearchMode === "exact" ? (
                    <div className={styles.inlineFields}>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>往路の出発日</span>
                        <input
                          className={styles.input}
                          type="date"
                          value={formState.outboundDate}
                          onChange={(event) => updateFormState("outboundDate", event.target.value)}
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>滞在日数</span>
                        <select
                          className={styles.select}
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
                    <>
                      <div className={styles.monthRail}>
                        {FLEXIBLE_MONTH_OPTIONS.map((option) => {
                          const active = formState.targetMonths.includes(option.value);
                          const disabled = !active && formState.targetMonths.length >= 4;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={`${styles.monthTile} ${active ? styles.monthTileActive : ""} ${disabled ? styles.monthTileDisabled : ""}`}
                              onClick={() => toggleTargetMonth(option.value)}
                              disabled={disabled}
                            >
                              <strong>{option.label}</strong>
                              <span>{option.hint}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className={styles.inlineFields}>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>最短滞在</span>
                          <select
                            className={styles.select}
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
                          <span className={styles.fieldLabel}>最長滞在</span>
                          <select
                            className={styles.select}
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
                    </>
                  )}
                </article>

                <article className={styles.sheet} data-reveal style={revealStyle(6)}>
                  <div className={styles.sheetHead}>
                    <span>03</span>
                    <div>
                      <h3>Cabin and travelers</h3>
                      <p>移動の姿勢と人数を整える。</p>
                    </div>
                  </div>

                  <div className={styles.inlineFields}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>人数</span>
                      <select
                        className={styles.select}
                        value={formState.passengerCount}
                        onChange={(event) => updateFormState("passengerCount", event.target.value as PassengerCountKey)}
                      >
                        {PASSENGER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className={styles.optionRail}>
                    {CABIN_CLASS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`${styles.optionCard} ${formState.cabinClass === option.value ? styles.optionCardActive : ""}`}
                        onClick={() => updateFormState("cabinClass", option.value as CabinClassKey)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.hint}</span>
                      </button>
                    ))}
                  </div>

                  <label className={styles.switchRow}>
                    <input
                      type="checkbox"
                      checked={formState.preferDirect}
                      onChange={(event) => updateFormState("preferDirect", event.target.checked)}
                    />
                    <span>直行を優先する。外すと 1 回乗継も含め、価格重視で候補を拾います。</span>
                  </label>
                </article>

                <article className={styles.sheet} data-reveal style={revealStyle(7)}>
                  <div className={styles.sheetHead}>
                    <span>04</span>
                    <div>
                      <h3>Destinations</h3>
                      <p>入口と出口の候補になる国を選ぶ。</p>
                    </div>
                  </div>

                  <p className={styles.sheetHint}>
                    最大5か国まで。出発国と同じ国は選べません。候補国の代表空港から、往路の入口と復路の出口を別々に探します。
                  </p>

                  <div className={styles.destinationGrid}>
                    {COUNTRY_OPTIONS.filter((option) => option.value !== formState.departureCountry).map((option) => {
                      const active = formState.destinationCountries.includes(option.value as CountryCode);
                      const disabled = !active && formState.destinationCountries.length >= 5;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          data-country-code={option.value}
                          className={`${styles.destinationChip} ${active ? styles.destinationChipActive : ""} ${disabled ? styles.destinationChipDisabled : ""}`}
                          onClick={() => toggleDestinationCountry(option.value as CountryCode)}
                          disabled={disabled}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.hint}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className={styles.gatewayPreview} data-reveal style={revealStyle(8)}>
                    <div className={styles.gatewayPreviewCard}>
                      <span>Stay countries</span>
                      <strong>
                        {formState.destinationCountries.length}カ国 / {selectedDestinationAirportCount}空港
                      </strong>
                      <p>{selectedDestinationLabels}</p>
                    </div>
                    <div className={styles.gatewayPreviewCard}>
                      <span>Auto gateway</span>
                      <strong>
                        {gatewayOnlyCountries.length}カ国 / {gatewayOnlyAirportCount}空港
                      </strong>
                      <p>{gatewayOnlyLabels}</p>
                    </div>
                    <div className={styles.gatewayPreviewCard}>
                      <span>Total pool</span>
                      <strong>
                        {gatewayCountries.length}カ国 / {destinationAirportCount}空港
                      </strong>
                      <p>
                        {gatewayOnlyCountries.length
                          ? "滞在国はそのまま、入口と出口の候補だけを周辺 gateway に広げて比較します。"
                          : "選択した滞在国の代表空港だけで比較します。"}
                      </p>
                    </div>
                  </div>

                  {corridorModeActive ? (
                    <div className={styles.corridorNote} data-reveal style={revealStyle(8)}>
                      <span>Europe corridor mode</span>
                      <strong>非直行を許容しているため、通常の gateway に加えて Budapest や Prague のような curated corridor gateway も内部候補として比較します。</strong>
                      <p>
                        滞在国は主目的地のまま維持しつつ、入口と出口だけ価格重視の長距離回廊まで広げて見ています。最終運賃は
                        Skyscanner 側で確認してください。
                      </p>
                    </div>
                  ) : null}
                </article>

                <div className={styles.compareBar} data-reveal style={revealStyle(9)}>
                  <div className={styles.compareMeta}>
                    <span>現在の探索</span>
                    <strong>{dateSearchSummary}</strong>
                  </div>
                  <div className={styles.compareMeta}>
                    <span>復路の目安</span>
                    <strong>
                      {formState.dateSearchMode === "exact"
                        ? returnDate
                          ? formatDateLabel(returnDate)
                          : "未設定"
                        : `${returnWindowPreview} / ${stayRangeLabel}`}
                    </strong>
                  </div>
                  <div className={styles.compareMeta}>
                    <span>空港の広がり</span>
                    <strong>
                      出発 {departureAirportCount} / 候補 {destinationAirportCount}
                    </strong>
                  </div>
                </div>

                {validationMessage ? <p className={styles.validationText}>{validationMessage}</p> : null}

                <div className={styles.actionRow}>
                  <button className={styles.primaryButton} type="submit" disabled={!canSearch || loading}>
                    {loading ? "route brief を整えています..." : "最安の入口と出口を提案する"}
                  </button>
                  <button className={styles.secondaryButton} type="button" onClick={handleReset}>
                    初期状態に戻す
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </section>

      <section className={styles.resultSection} id="folio">
        <div className={styles.shell}>
          <div className={styles.sectionIntro} data-reveal style={revealStyle(0)}>
            <p className={styles.sectionLabel}>Result folio</p>
            <h2>往路と復路を、左右のページに分けて読む。</h2>
            <p>
              結果は一枚の価格カードではなく、往路の入口、復路の出口、そのあいだの余白で構成します。
              まずは推定最安の形をつかみ、その後に実検索へ進みます。
            </p>
          </div>

          {loading ? (
            <div className={styles.loadingBoard} data-reveal style={revealStyle(1)}>
              <div className={styles.loadingRoute}>
                <span>TYO</span>
                <div className={styles.loadingLine} />
                <span>EU</span>
              </div>
              <h3>複数月と代表空港から、route brief を組み上げています。</h3>
              <p>往路の最安入口を見つけ、その日から滞在レンジぶんだけ復路を探しています。</p>
            </div>
          ) : null}

          {!loading && !hasGenerated ? (
            <div className={styles.emptyBoard} data-reveal style={revealStyle(1)}>
              <h3>brief を入力すると、ここに旅の folio が現れます。</h3>
              <p>複数月でも、固定日程でも、最安の入口と出口を左右に分けて表示します。</p>
            </div>
          ) : null}

          {!loading && hasGenerated && !result ? (
            <div className={styles.emptyBoard} data-reveal style={revealStyle(1)}>
              <h3>この条件では十分なルート候補が見つかりませんでした。</h3>
              <ul className={styles.guidanceList}>
                {noRouteGuidance.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!loading && result ? (
            <>
              <div className={styles.resultDock} data-testid="result-summary" data-reveal style={revealStyle(1)}>
                <div>
                  <span>Recommended two-ticket pairing</span>
                  <h3>{result.planHeadline}</h3>
                  <p>{result.flexibilitySummary}</p>
                  <p>{result.gatewaySummary}</p>
                </div>
                <div className={styles.resultDockPrice}>
                  <span>2枚合計の推定額</span>
                  <strong>{formatCurrency(result.totalPrice)}</strong>
                  <small>{formatCurrencyRange(result.totalPriceRange)}</small>
                  <small>1名あたり {formatCurrencyRange(result.totalPriceRangePerPerson)}</small>
                </div>
              </div>

              <div className={styles.resultSpread}>
                {renderTicketCard(result.bestOutbound, "片道1枚目 / 往路", 2)}

                <div className={styles.gapBand} data-testid="between-tickets-gap" data-reveal style={revealStyle(3)}>
                  <p className={styles.sectionLabel}>Between tickets</p>
                  <h3>滞在先と gateway は、あえて同じにしなくていい。</h3>
                  <p>{result.betweenTicketsGap.summary}</p>
                  <p>{result.betweenTicketsGap.note}</p>

                  <div className={styles.gapMeta}>
                    <div>
                      <span>Arrival</span>
                      <strong>{result.betweenTicketsGap.arrivalLabel}</strong>
                    </div>
                    <div>
                      <span>Return from</span>
                      <strong>{result.betweenTicketsGap.departureLabel}</strong>
                    </div>
                  </div>
                </div>

                {renderTicketCard(result.bestInbound, "片道2枚目 / 復路", 4)}
              </div>

              <div className={styles.resultLedger} data-reveal style={revealStyle(4)}>
                <div>
                  <span>探索ウィンドウ</span>
                  <strong>往路 {result.outboundDateWindow}</strong>
                  <small>復路 {result.returnDateWindow}</small>
                </div>
                <div>
                  <span>滞在の幅</span>
                  <strong>{result.stayLengthRangeLabel}</strong>
                  <small>往路 {result.comparedOutboundDateCount}日 / 復路 {result.comparedReturnDateCount}日を比較</small>
                </div>
                <div>
                  <span>Ticketing note</span>
                  <strong>{result.ticketingSummary}</strong>
                  <small>{result.planningNote}</small>
                </div>
                <div>
                  <span>Gateway pool</span>
                  <strong>{result.gatewayCountries.length}カ国 / {result.gatewayAirports.length}空港</strong>
                  <small>{result.gatewaySummary}</small>
                </div>
              </div>

              <section className={styles.liveSourceSection} data-reveal style={revealStyle(5)}>
                <div className={styles.rackHead}>
                  <h3>Live fare sources</h3>
                  <span>{result.liveFareSources.length} cards</span>
                </div>
                <p className={styles.liveSourceIntro}>
                  ここから先は推定カードではなく near-live handoff です。Skyscanner 側で価格が取れない場合は、各カードの route と date を
                  そのまま手入力して再検索し、画面内の推定値は fallback reference として扱ってください。
                </p>
                <div className={styles.liveSourceLegend} aria-label="Estimate and handoff guidance">
                  <article className={styles.liveSourceLegendItem} data-tone="estimate">
                    <span>Estimate anchor</span>
                    <strong>画面内の価格帯・信頼度・basis を比較の基準にする</strong>
                    <p>最初に意思決定するための reference layer です。provider 側で価格が崩れても、比較の形はここで保ちます。</p>
                  </article>
                  <article className={styles.liveSourceLegendItem} data-tone="handoff">
                    <span>Near-live handoff</span>
                    <strong>Skyscanner で最終価格を確認し、だめなら同条件で手入力する</strong>
                    <p>route・date・人数・cabin をそのまま引き継ぎ、live 側の最終差分だけを確認するための handoff layer です。</p>
                  </article>
                </div>
                <div className={styles.liveSourceGrid}>
                  {result.liveFareSources.map((source) => (
                    <div key={source.id}>{renderLiveFareSourceCard(source)}</div>
                  ))}
                </div>
              </section>

              <div className={styles.ticketRack}>
                <section className={styles.rackSection} data-reveal style={revealStyle(6)}>
                  <div className={styles.rackHead}>
                    <h3>往路の代替入口</h3>
                    <span>{result.outboundAlternatives.length}案</span>
                  </div>
                  <div className={styles.rackScroller}>
                    {result.outboundAlternatives.map((quote, index) => (
                      <article key={`${quote.direction}-${quote.origin.code}-${quote.destination.code}-${quote.travelDate}`} className={styles.rackCard}>
                        <div className={styles.rackTop}>
                          <span>{getAlternativeBadge(quote, index, result.bestOutbound)}</span>
                          <strong>{formatCurrency(quote.totalPrice)}</strong>
                        </div>
                        <h4>{routeLabel(quote)}</h4>
                        <p>{formatDateLabel(quote.travelDate)}</p>
                        <p>{quote.reasonPoints[1]}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className={styles.rackSection} data-reveal style={revealStyle(7)}>
                  <div className={styles.rackHead}>
                    <h3>復路の代替出口</h3>
                    <span>{result.inboundAlternatives.length}案</span>
                  </div>
                  <div className={styles.rackScroller}>
                    {result.inboundAlternatives.map((quote, index) => (
                      <article key={`${quote.direction}-${quote.origin.code}-${quote.destination.code}-${quote.travelDate}`} className={styles.rackCard}>
                        <div className={styles.rackTop}>
                          <span>{getAlternativeBadge(quote, index, result.bestInbound)}</span>
                          <strong>{formatCurrency(quote.totalPrice)}</strong>
                        </div>
                        <h4>{routeLabel(quote)}</h4>
                        <p>{formatDateLabel(quote.travelDate)}</p>
                        <p>{quote.reasonPoints[1]}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <section className={styles.coverageSection} data-reveal style={revealStyle(8)}>
                <div className={styles.rackHead}>
                  <h3>候補国ごとのカバレッジ</h3>
                  <span>{result.destinationCountries.length}か国</span>
                </div>
                <div className={styles.coverageList}>
                  {result.coverage.map((entry, index) => (
                    <article key={entry.country.code} className={styles.coverageRow} data-reveal style={revealStyle(index)}>
                      <div>
                        <span>{entry.country.region}</span>
                        <strong>{entry.country.name}</strong>
                      </div>
                      <p>{entry.country.summary}</p>
                      <p>{entry.airports.map((airport) => airport.code).join(" / ")}</p>
                      <div>
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

      <section className={styles.methodSection} id="method">
        <div className={styles.shell}>
          <div className={styles.methodLayout}>
            <div className={styles.methodIntro} data-reveal style={revealStyle(0)}>
              <p className={styles.sectionLabel}>Method rail</p>
              <h2>複雑な旅を、判断の順番だけで軽くする。</h2>
              <p>
                海外旅行は、最初から全体を最適化しようとすると急に重くなります。
                Maison Passage は、片道2枚の入口と出口を先に決めることで、残りの旅をあとから自由にできます。
              </p>
            </div>

            <div className={styles.methodRail}>
              {methodMoments.map((item, index) => (
                <article key={item.title} className={styles.methodCard} data-reveal style={revealStyle(index + 1)}>
                  <span>{item.label}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.archetypeSection} id="archetypes">
        <div className={styles.shell}>
          <div className={styles.sectionIntro} data-reveal style={revealStyle(0)}>
            <p className={styles.sectionLabel}>Trip archetypes</p>
            <h2>旅の型を先に選ぶと、ルートは自然に細くなる。</h2>
            <p>目的地がまだ揺れていても、旅の型が見えていれば入口と出口の選び方は変わります。</p>
          </div>

          <div className={styles.archetypeGrid}>
            {archetypes.map((item, index) => (
              <article key={item.title} className={styles.archetypeCard} data-reveal style={revealStyle(index + 1)}>
                <div className={styles.archetypeVisual}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className={styles.archetypeBody}>
                  <p>{item.label}</p>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.conciergeSection} id="concierge">
        <div className={styles.conciergeInner} data-reveal style={revealStyle(0)}>
          <p className={styles.sectionLabel}>Concierge brief</p>
          <h2>次の海外旅行は、日付ではなく季節から始めてもいい。</h2>
          <p>
            複数月と滞在レンジを選び、往路の入口と復路の出口を整え、最後に実検索へ渡す。
            Maison Passage は、その最初の判断だけを上質に引き受けます。
          </p>
          <a className={styles.conciergeButton} href="#atelier">
            旅の台帳を開く
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <p className={styles.footerMark}>Maison Passage</p>
            <p className={styles.footerText}>海外旅行の片道2枚を整えるための、静かな route atelier。</p>
          </div>
          <a className={styles.footerLink} href="#atelier">
            Planner atelier へ戻る
          </a>
        </div>
      </footer>
    </main>
  );
}
