"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import {
  CABIN_CLASS_OPTIONS,
  COUNTRY_OPTIONS,
  FLEXIBLE_MONTH_OPTIONS,
  FLEXIBLE_STAY_DAY_OPTIONS,
  PASSENGER_OPTIONS,
  STAY_LENGTH_OPTIONS,
  getAirportsForCountry,
  type CabinClassKey,
  type CountryCode,
  type FlexibleStayDayKey,
  type PassengerCountKey,
  type TravelMonthKey,
} from "../lib/travel-data";
import {
  INITIAL_FORM_STATE,
  buildNoRouteGuidance,
  getDateSearchSummary,
  buildSearchSummary,
  formatCurrency,
  formatCurrencyRange,
  formatDateLabel,
  formatDuration,
  generateFlightSearchResult,
  getFormValidationMessage,
  getReturnWindowLabel,
  getStayRangeLabel,
  getReturnDate,
  isFormValid,
  type FlightLegQuote,
  type FlightSearchResult,
  type PlannerFormState,
} from "../lib/travel-planner";

const storyMoments = [
  {
    eyebrow: "Quiet planning",
    title: "複数国の旅を、静かな判断に戻す。",
    text:
      "まず決めるのは、出発国、候補国、日付、そして空の上での過ごし方だけ。細かな現地移動に入る前に、旅全体の入口と出口を落ち着いて整えます。",
  },
  {
    eyebrow: "Open jaw logic",
    title: "到着地と帰国地を分けて、旅の余白を残す。",
    text:
      "往路の最安入口と復路の最安出口を独立して比較します。成田からフランクフルトへ入り、パリから羽田へ戻るような open jaw の考え方を自然に扱えます。",
  },
  {
    eyebrow: "Live handoff",
    title: "候補が決まったら、実検索へすぐ進む。",
    text:
      "表示価格は参考見積りです。ルートの形が見えたら、Skyscanner の片道・multi-city 検索へ移り、最終的な在庫と価格を確認できます。",
  },
];

const lineupCards = [
  {
    label: "Grand tour",
    title: "欧州3か国を横断する旅",
    text: "フランス、イギリス、ドイツのように国をまたぐ旅で、入口と出口を別々に最適化します。",
  },
  {
    label: "Twin gateway",
    title: "到着都市と帰国都市を変える旅",
    text: "最初の都市に縛られず、最後に滞在する都市から帰国できる選択肢を広げます。",
  },
  {
    label: "Long stay",
    title: "長めの滞在を上品に整える旅",
    text: "滞在日数と客室クラスを変えながら、費用と移動負担のバランスを比較します。",
  },
];

function routeLabel(quote: FlightLegQuote) {
  return `${quote.origin.code} → ${quote.destination.code}`;
}

function renderLegCard(quote: FlightLegQuote, title: string) {
  return (
    <article className={styles.legCard}>
      <div className={styles.legHeader}>
        <span className={styles.legTag}>{title}</span>
        <span className={styles.legPrice}>{formatCurrency(quote.totalPrice)}</span>
      </div>
      <h3 className={styles.routeCodes}>{routeLabel(quote)}</h3>
      <p className={styles.routeCities}>
        {quote.origin.city} ({quote.origin.name}) → {quote.destination.city} ({quote.destination.name})
      </p>
      <div className={styles.metaRow}>
        <span>{formatDateLabel(quote.travelDate)}</span>
        <span>{quote.stopLabel}</span>
        <span>{formatDuration(quote.durationHours)}</span>
        <span>{quote.confidenceLabel}</span>
      </div>
      <div className={styles.estimateBand}>
        <span>参考レンジ</span>
        <strong>{formatCurrencyRange(quote.totalPriceRange)}</strong>
        <small>{quote.estimateBasis}</small>
      </div>
      <ul className={styles.reasonList}>
        {quote.reasonPoints.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <a className={styles.linkButton} href={quote.skyscannerUrl} target="_blank" rel="noreferrer">
        Skyscanner でこの片道を開く
      </a>
    </article>
  );
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

export default function HomePage() {
  const [formState, setFormState] = useState<PlannerFormState>(INITIAL_FORM_STATE);
  const [submitted, setSubmitted] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FlightSearchResult | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const pendingSearchRef = useRef<number | null>(null);

  const validationMessage = submitted ? getFormValidationMessage(formState) : null;
  const canSearch = isFormValid(formState);
  const returnDate = getReturnDate(formState);
  const dateSearchSummary = getDateSearchSummary(formState);
  const stayRangeLabel = getStayRangeLabel(formState);
  const previewOutboundDate = `${formState.targetMonths[0] ?? "2026-07"}-15`;
  const returnWindowPreview = formState.dateSearchMode === "exact" ? returnDate : getReturnWindowLabel(previewOutboundDate, formState);
  const departureAirportCount = formState.departureCountry ? getAirportsForCountry(formState.departureCountry).length : 0;
  const destinationAirportCount = formState.destinationCountries.reduce(
    (count, countryCode) => count + getAirportsForCountry(countryCode).length,
    0,
  );
  const noRouteGuidance = buildNoRouteGuidance(formState);

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
    }, 720);
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
      setIsScrolled(window.scrollY > 32);
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

  return (
    <main className={styles.page}>
      <header className={`${styles.header} ${isScrolled ? styles.headerSolid : ""}`}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#top">
            <span className={styles.brandMark}>MP</span>
            <span className={styles.brandText}>
              <strong>Maison Passage</strong>
              <span>Open Jaw Explorer</span>
            </span>
          </a>

          <nav className={styles.headerNav} aria-label="ページ内メニュー">
            <a href="#intro">Concept</a>
            <a href="#brief">Search</a>
            <a href="#results">Result</a>
          </nav>

          <a className={styles.headerCta} href="#brief">
            旅を整える
          </a>
        </div>
      </header>

      <section className={styles.hero} id="top" data-testid="hero">
        <div className={styles.heroBackdrop} />
        <div className={styles.shell}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Premium overseas open-jaw planning</p>
              <h1 className={styles.heroTitle}>旅の入口と出口を、美しく決める。</h1>
              <p className={styles.heroLead}>
                複数の国をめぐる海外旅行で、まず必要なのは最初の到着地と最後の帰国地を静かに見極めること。
                Maison Passage は代表空港を比較し、open jaw の往路と復路を上品に整理します。
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="#brief">
                  検索ブリーフへ
                </a>
                <a className={styles.secondaryButton} href="#results">
                  結果の見方を見る
                </a>
              </div>
            </div>

            <div className={styles.heroAside}>
              <div className={styles.metricCard}>
                <span>Departure coverage</span>
                <strong>{departureAirportCount || 5} airports</strong>
                <p>出発国の代表空港を広げ、入口の比較を現実的にします。</p>
              </div>
              <div className={styles.metricCard}>
                <span>Destination spread</span>
                <strong>{destinationAirportCount || 9} airports</strong>
                <p>候補国の空港群から、到着地と帰国地を別々に選べます。</p>
              </div>
              <div className={styles.metricCard}>
                <span>Travel posture</span>
                <strong>Quiet confidence</strong>
                <p>必要な入力だけに絞り、判断の余白を残します。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.shell}>
        <section className={styles.intro} id="intro">
          <p className={styles.introKicker}>Concept</p>
          <h2 className={styles.introTitle}>予約サイトに入る前の、静かな編集室。</h2>
          <p className={styles.introText}>
            価格比較の前に、旅の輪郭を整える。温かい紙のような背景、ブロンズの細い線、余白を活かした構成で、
            複雑な航空路の選択を落ち着いた体験に変えます。
          </p>
        </section>

        <section className={styles.collageSection} aria-label="価値訴求コラージュ">
          <div className={styles.collageLead}>
            <p className={styles.sectionEyebrow}>Value collage</p>
            <h2>複数国をめぐる旅に、雑誌の見開きのような余白を。</h2>
            <p>
              1枚の大きな視覚要素と小さなカードを組み合わせ、ルート比較を「情報の山」ではなく、
              旅の意図を整えるための編集作業として見せます。
            </p>
          </div>
          <div className={styles.collage}>
            <article className={`${styles.collageCard} ${styles.collageTall}`}>
              <span>01</span>
              <h3>入口と出口を別々に考える</h3>
              <p>到着都市と帰国都市を分けることで、旅程の自由度と価格の選択肢を広げます。</p>
            </article>
            <article className={`${styles.collageCard} ${styles.collageWide}`}>
              <span>02</span>
              <h3>検索条件は、短く、上質に</h3>
              <p>出発国、候補国、日付、滞在日数。必要な判断だけを先に置きます。</p>
            </article>
            <article className={styles.collageImage} aria-hidden="true" />
            <article className={styles.collageCard}>
              <span>03</span>
              <h3>候補は、整然と見せる</h3>
              <p>最安候補、代替案、国別カバレッジを同じ世界観でまとめます。</p>
            </article>
          </div>
        </section>

        <section className={styles.storyGrid}>
          {storyMoments.map((moment, index) => (
            <article key={moment.title} className={`${styles.storyCard} ${index % 2 === 1 ? styles.storyCardAlt : ""}`}>
              <div>
                <p className={styles.sectionEyebrow}>{moment.eyebrow}</p>
                <h2>{moment.title}</h2>
              </div>
              <p>{moment.text}</p>
            </article>
          ))}
        </section>

        <section className={styles.lineupSection} id="lineup">
          <div className={styles.lineupHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Plan lineup</p>
              <h2>旅の型を選び、入口と出口を整える。</h2>
            </div>
            <p>
              代表的な海外旅行の組み立て方を、静かなカードとして並べました。目的地を決めきる前でも、
              どのような open jaw が似合うかを先に眺められます。
            </p>
          </div>

          <div className={styles.lineupEditorial}>
            {lineupCards.map((card, index) => (
              <article key={card.title} className={styles.lineupEditorialCard}>
                <div className={styles.lineupImage} aria-hidden="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className={styles.lineupBody}>
                  <span>{card.label}</span>
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.briefSection} id="brief">
          <div className={styles.briefIntro}>
            <p className={styles.sectionEyebrow}>Search brief</p>
            <h2>検索は、数手で十分。</h2>
            <p>
              出発国と候補国を選び、日付と滞在日数を入れるだけ。内部では代表空港を広げて比較し、
              往路の入口と復路の出口を別々に探します。
            </p>
          </div>

          <div className={styles.briefLayout}>
            <section className={styles.searchPanel}>
              <div className={styles.panelHeader}>
                <div>
                  <h3>Trip parameters</h3>
                  <p>{buildSearchSummary(formState)}</p>
                </div>
                <span className={styles.inlinePill}>候補国は最大5か国</span>
              </div>

              <form onSubmit={handleSearch} data-testid="trip-brief-form">
                <div className={styles.formGrid}>
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

                  <fieldset className={`${styles.fieldWide} ${styles.optionField}`}>
                    <legend className={styles.fieldLabel}>客室クラス</legend>
                    <div className={styles.optionRow}>
                      {CABIN_CLASS_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`${styles.optionButton} ${formState.cabinClass === option.value ? styles.buttonActive : ""}`}
                          onClick={() => updateFormState("cabinClass", option.value as CabinClassKey)}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.hint}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className={`${styles.fieldWide} ${styles.optionField}`}>
                    <legend className={styles.fieldLabel}>候補の渡航国</legend>
                    <p className={styles.fieldHint}>
                      到着地と帰国地を、この国群の中で別々に最安化します。出発国と同じ国は選べません。
                    </p>
                    <div className={styles.countryGrid}>
                      {COUNTRY_OPTIONS.filter((option) => option.value !== formState.departureCountry).map((option) => {
                        const active = formState.destinationCountries.includes(option.value as CountryCode);
                        const disabled = !active && formState.destinationCountries.length >= 5;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`${styles.countryChip} ${active ? styles.buttonActive : ""} ${disabled ? styles.buttonDisabled : ""}`}
                            onClick={() => toggleDestinationCountry(option.value as CountryCode)}
                            disabled={disabled}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                </div>

                <label className={styles.switchRow}>
                  <input
                    type="checkbox"
                    checked={formState.preferDirect}
                    onChange={(event) => updateFormState("preferDirect", event.target.checked)}
                  />
                  <span>直行優先で探す。外すと 1 回乗継も許容して、価格重視の候補を拾います。</span>
                </label>

                <div className={styles.helperRow}>
                  <p className={styles.helperText}>想定復路: {returnDate ? formatDateLabel(returnDate) : "未設定"}</p>
                  <p className={styles.helperText}>出発空港候補: {departureAirportCount}</p>
                  <p className={styles.helperText}>候補空港: {destinationAirportCount}</p>
                </div>

                {validationMessage ? <p className={styles.validationText}>{validationMessage}</p> : null}

                <div className={styles.actionRow}>
                  <button className={styles.primaryButton} type="submit" disabled={!canSearch || loading}>
                    {loading ? "ルートを整えています..." : "最安ルートを提案する"}
                  </button>
                  <button className={styles.secondaryButton} type="button" onClick={handleReset}>
                    リセット
                  </button>
                </div>
              </form>
            </section>

            <aside className={styles.briefAside}>
              <div className={styles.asideCard}>
                <p className={styles.sectionEyebrow}>Preserved logic</p>
                <h3>検索ロジックはそのまま、見せ方を上質に。</h3>
                <ul className={styles.sideList}>
                  <li>国を代表空港へ展開し、現実的な比較対象を作ります。</li>
                  <li>往路と復路を独立して比較し、open jaw の余地を残します。</li>
                  <li>最後は Skyscanner の実検索へ進めます。</li>
                </ul>
              </div>

              <div className={styles.asideCard}>
                <p className={styles.sectionEyebrow}>Not included</p>
                <h3>現地移動は、あえて余白として残す。</h3>
                <p className={styles.asideText}>
                  フランクフルトに入り、パリから戻るような旅でも、都市間移動はこの比較に含めません。
                  まず航空券の入口と出口だけを静かに決め、列車や短距離便は次の判断に分けます。
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className={styles.resultsSection} id="results">
          <div className={styles.resultsIntro}>
            <p className={styles.sectionEyebrow}>Results flow</p>
            <h2>結果も、同じ静けさの中で。</h2>
            <p>
              最安の入口と出口、代替案、国別カバレッジを、予約前の判断材料として整然と並べます。
            </p>
          </div>

          {loading ? (
            <div className={styles.loadingState}>
              <div className={styles.loadingPulse} />
              <h3>代表空港を広げて比較しています。</h3>
              <p>候補国の空港をまとめて開き、往路と復路を別々に最安化しています。</p>
            </div>
          ) : null}

          {!loading && !hasGenerated ? (
            <div className={styles.emptyState}>
              <h3>検索ブリーフを入れると、ここに提案が表示されます。</h3>
              <p>出発国、往路日、滞在日数、候補国を選ぶと、海外 open jaw の入口と出口を比較できます。</p>
            </div>
          ) : null}

          {!loading && hasGenerated && !result ? (
            <div className={styles.emptyState}>
              <h3>この条件では、十分な比較ルートを作れませんでした。</h3>
              <ul className={styles.guidanceList}>
                {noRouteGuidance.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!loading && result ? (
            <>
              <div className={styles.resultHero} data-testid="result-summary">
                <div className={styles.resultCopy}>
                  <p className={styles.resultEyebrow}>Recommended open-jaw combination</p>
                  <h3 className={styles.resultHeadline}>{result.planHeadline}</h3>
                  <p className={styles.resultLead}>{result.openJawNote}</p>
                </div>

                <div className={styles.priceCard}>
                  <span className={styles.priceLabel}>推定合計</span>
                  <strong>{formatCurrency(result.totalPrice)}</strong>
                  <span>目安レンジ {formatCurrencyRange(result.totalPriceRange)}</span>
                  <span>1名あたり {formatCurrency(result.totalPricePerPerson)}</span>
                  <span>1名レンジ {formatCurrencyRange(result.totalPriceRangePerPerson)}</span>
                </div>
              </div>

              <div className={styles.legGrid}>
                {renderLegCard(result.bestOutbound, "往路の最安入口")}
                {renderLegCard(result.bestInbound, "復路の最安出口")}
              </div>

              <div className={styles.ctaStrip}>
                <a className={styles.primaryLink} href={result.multiCityUrl} target="_blank" rel="noreferrer">
                  Skyscanner で open jaw 検索を開く
                </a>
                <a className={styles.secondaryLink} href={result.bestOutbound.skyscannerUrl} target="_blank" rel="noreferrer">
                  往路だけ確認
                </a>
                <a className={styles.secondaryLink} href={result.bestInbound.skyscannerUrl} target="_blank" rel="noreferrer">
                  復路だけ確認
                </a>
              </div>

              <div className={styles.noteCard}>
                <p className={styles.sectionEyebrow}>Planning note</p>
                <h3>この提案の読み方</h3>
                <p>{result.planningNote}</p>
              </div>

              <div className={styles.gapCard} data-testid="open-jaw-gap">
                <div>
                  <p className={styles.sectionEyebrow}>Open-jaw gap</p>
                  <h3>入口と出口のあいだにある余白</h3>
                  <p>{result.openJawGap.summary}</p>
                  <p>{result.openJawGap.note}</p>
                </div>
                <div className={styles.gapRoute}>
                  <span>Arrival</span>
                  <strong>{result.openJawGap.arrivalLabel}</strong>
                  <em>現地移動は別手配</em>
                  <span>Return from</span>
                  <strong>{result.openJawGap.departureLabel}</strong>
                </div>
              </div>

              <div className={styles.altGrid}>
                <section className={styles.altSection}>
                  <div className={styles.altHeader}>
                    <h3>往路の代替入口</h3>
                    <span className={styles.inlinePill}>{result.outboundAlternatives.length}案</span>
                  </div>
                  <div className={styles.altList}>
                    {result.outboundAlternatives.map((quote, index) => (
                      <article key={`${quote.direction}-${quote.origin.code}-${quote.destination.code}`} className={styles.altCard}>
                        <div className={styles.altTop}>
                          <strong>{routeLabel(quote)}</strong>
                          <span>{formatCurrency(quote.totalPrice)}</span>
                        </div>
                        <span className={styles.altBadge}>{getAlternativeBadge(quote, index, result.bestOutbound)}</span>
                        <p className={styles.altMeta}>
                          {formatDateLabel(quote.travelDate)} / {quote.stopLabel} / {formatDuration(quote.durationHours)}
                        </p>
                        <p className={styles.altNote}>{quote.reasonPoints[1]}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className={styles.altSection}>
                  <div className={styles.altHeader}>
                    <h3>復路の代替出口</h3>
                    <span className={styles.inlinePill}>{result.inboundAlternatives.length}案</span>
                  </div>
                  <div className={styles.altList}>
                    {result.inboundAlternatives.map((quote, index) => (
                      <article key={`${quote.direction}-${quote.origin.code}-${quote.destination.code}`} className={styles.altCard}>
                        <div className={styles.altTop}>
                          <strong>{routeLabel(quote)}</strong>
                          <span>{formatCurrency(quote.totalPrice)}</span>
                        </div>
                        <span className={styles.altBadge}>{getAlternativeBadge(quote, index, result.bestInbound)}</span>
                        <p className={styles.altMeta}>
                          {formatDateLabel(quote.travelDate)} / {quote.stopLabel} / {formatDuration(quote.durationHours)}
                        </p>
                        <p className={styles.altNote}>{quote.reasonPoints[1]}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <section className={styles.coverageSection}>
                <div className={styles.altHeader}>
                  <h3>候補国ごとの空港カバレッジ</h3>
                  <span className={styles.inlinePill}>{result.destinationCountries.length}か国</span>
                </div>
                <div className={styles.coverageGrid}>
                  {result.coverage.map((entry) => (
                    <article key={entry.country.code} className={styles.coverageCard}>
                      <div className={styles.coverageHeader}>
                        <h4>{entry.country.name}</h4>
                        <span>{entry.country.region}</span>
                      </div>
                      <p className={styles.coverageText}>{entry.country.summary}</p>
                      <p className={styles.coverageAirports}>代表空港: {entry.airports.map((airport) => airport.code).join(" / ")}</p>
                      <div className={styles.coverageRoute}>
                        <strong>入口候補</strong>
                        <span>
                          {entry.bestOutbound
                            ? `${routeLabel(entry.bestOutbound)} / ${formatCurrency(entry.bestOutbound.totalPrice)}`
                            : "該当なし"}
                        </span>
                      </div>
                      <div className={styles.coverageRoute}>
                        <strong>出口候補</strong>
                        <span>
                          {entry.bestInbound
                            ? `${routeLabel(entry.bestInbound)} / ${formatCurrency(entry.bestInbound.totalPrice)}`
                            : "該当なし"}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </section>
      </div>

      <section className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <p className={styles.sectionEyebrow}>Private brief</p>
          <h2>次の海外旅行を、入口と出口から上質に組み立てる。</h2>
          <p>
            候補国を選び、代表空港の組み合わせを比べ、最後は Skyscanner の実検索へ。
            Maison Passage は予約前の迷いを、余白のある判断へ変えます。
          </p>
          <a className={styles.finalCtaButton} href="#brief">
            旅の条件を入力する
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <p className={styles.footerMark}>Maison Passage</p>
            <p className={styles.footerText}>
              予約前の判断を静かに整える、海外 open jaw 旅行のための探索アトリエ。
            </p>
          </div>
          <a className={styles.footerLink} href="#brief">
            検索ブリーフへ戻る
          </a>
        </div>
      </footer>
    </main>
  );
}
