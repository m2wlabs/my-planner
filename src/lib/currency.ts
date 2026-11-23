/**
 * Currency display layer.
 *
 * Money is stored once, in minor units of a single base currency (USD), which is
 * what every existing row already holds. The chosen display currency only changes
 * presentation: amounts are converted with the latest cached rate. Rates are
 * fetched from a keyless free endpoint and cached in the settings table, so the
 * UI always has a value to render even when the network is down.
 */

export const BASE_CURRENCY = "USD";
export const RATES_URL = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`;
export const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type RateTable = {
  base: string;
  /** When these rates were fetched, ISO-8601. */
  at: string;
  rates: Record<string, number>;
};

export const DEFAULT_RATES: RateTable = { base: BASE_CURRENCY, at: "", rates: { [BASE_CURRENCY]: 1 } };

const codePattern = /^[A-Z]{3}$/;

/** Parses the cached `currency_rates` setting, falling back to USD-only. */
export function readRates(raw?: string | null): RateTable {
  if (!raw) return DEFAULT_RATES;
  try {
    const parsed = JSON.parse(raw) as Partial<RateTable> | null;
    if (!parsed || typeof parsed.rates !== "object" || parsed.rates === null) return DEFAULT_RATES;
    const rates: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.rates)) {
      const code = key.toUpperCase();
      const rate = Number(value);
      if (codePattern.test(code) && rate > 0) rates[code] = rate;
    }
    rates[BASE_CURRENCY] = 1;
    return {
      base: BASE_CURRENCY,
      at: typeof parsed.at === "string" ? parsed.at : "",
      rates,
    };
  } catch {
    return DEFAULT_RATES;
  }
}

export function ratesAreStale(table: RateTable, now = Date.now()): boolean {
  const at = Date.parse(table.at);
  return !Number.isFinite(at) || now - at > RATES_MAX_AGE_MS;
}

export async function fetchRates(): Promise<RateTable> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(RATES_URL, { cache: "no-store", signal: controller.signal });
  } catch {
    throw new Error(controller.signal.aborted ? "The exchange-rate service did not answer in time" : "Could not reach the exchange-rate service");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Exchange-rate service returned HTTP ${res.status}`);
  const payload = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (payload.result !== "success" || !payload.rates) throw new Error("Exchange-rate service returned no rates");
  const rates: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload.rates)) {
    const code = key.toUpperCase();
    const rate = Number(value);
    if (codePattern.test(code) && rate > 0) rates[code] = rate;
  }
  rates[BASE_CURRENCY] = 1;
  return { base: BASE_CURRENCY, at: new Date().toISOString(), rates };
}

const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(code: string): Intl.NumberFormat {
  let formatter = formatters.get(code);
  if (!formatter) {
    // Use narrowSymbol so currencies render their pure symbol (e.g. "$" instead of "US$" or "CA$"),
    // while keeping each currency's native fraction digits (XAF 0, USD 2, BHD 3).
    try {
      formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      });
    } catch {
      formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
      });
    }
    formatters.set(code, formatter);
  }
  return formatter;
}

/** Strips any region/country letters prepended to a currency glyph (e.g. "US$" -> "$", "CA$" -> "$", "CN¥" -> "¥"). */
function cleanCurrencySymbol(raw: string): string {
  const trimmed = raw.trim();
  const glyphMatch = /([$£¥€₹₩₦₱₫₪฿₺₴₸₽₡₲₵₭₮₼₾]+)$/.exec(trimmed);
  if (glyphMatch) {
    return glyphMatch[1];
  }
  return trimmed;
}

/** How many fraction digits this currency is normally shown with. */
export function currencyDigits(code = BASE_CURRENCY): number {
  if (!codePattern.test(code)) return 2;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function toDisplayValue(minor: number, rate: number): number {
  return ((Number.isFinite(minor) ? minor : 0) / 100) * (rate > 0 ? rate : 1);
}

/** Formats an amount held in base-currency minor units into the display currency (symbol + amount only). */
export function formatMoney(minor: number, code = BASE_CURRENCY, rate = 1): string {
  const { symbol, value, symbolLast } = formatMoneyParts(minor, code, rate);
  return symbolLast ? `${value}${symbol}` : `${symbol}${value}`;
}

/** The sign, symbol and digits of a formatted amount, so the symbol can be styled apart. */
export type MoneyParts = { sign: string; symbol: string; value: string; symbolLast: boolean };

/** Formats an amount already expressed in the display currency (major units), returning symbol and amount only. */
export function formatDisplayParts(amount: number, code = BASE_CURRENCY): MoneyParts {
  const absAmount = Math.abs(Number.isFinite(amount) ? amount : 0);
  if (!codePattern.test(code)) {
    return {
      sign: "",
      symbol: cleanCurrencySymbol(code),
      value: ` ${absAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      symbolLast: false,
    };
  }
  const parts = getFormatter(code).formatToParts(absAmount);
  const index = parts.findIndex((p) => p.type === "currency");
  if (index === -1) {
    return { sign: "", symbol: "", value: getFormatter(code).format(absAmount), symbolLast: false };
  }
  const isNumber = (type: string) =>
    type === "integer" || type === "fraction" || type === "group" || type === "decimal";
  const rawSymbol = parts
    .filter((p) => p.type === "currency")
    .map((p) => p.value)
    .join("");
  return {
    sign: "",
    symbol: cleanCurrencySymbol(rawSymbol),
    value: parts
      .filter((p) => p.type !== "currency" && p.type !== "minusSign" && p.type !== "plusSign")
      .map((p) => p.value)
      .join(""),
    // Locales that put the symbol after the number, e.g. "1,00 €".
    symbolLast: parts.slice(0, index).some((p) => isNumber(p.type)),
  };
}

/** The display-currency amount for a base-currency amount, rounded to the currency's precision. */
export function toDisplayAmount(minor: number, code = BASE_CURRENCY, rate = 1): number {
  const factor = 10 ** currencyDigits(code);
  return Math.round(toDisplayValue(minor, rate) * factor) / factor;
}

export function formatMoneyParts(minor: number, code = BASE_CURRENCY, rate = 1): MoneyParts {
  return formatDisplayParts(toDisplayValue(minor, rate), code);
}

/** Converts an amount typed in the display currency into base-currency minor units. */
export function toBaseMinor(value: number, rate = 1): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value / (rate > 0 ? rate : 1)) * 100);
}

const names = new Map<string, string>();

export function currencyName(code: string): string {
  const cached = names.get(code);
  if (cached) return cached;
  let name = code;
  try {
    name = new Intl.DisplayNames(undefined, { type: "currency" }).of(code) ?? code;
  } catch {
    /* older webviews without Intl.DisplayNames */
  }
  names.set(code, name);
  return name;
}

/** Every currency the cached rate table knows, base first, then alphabetical. */
export function currencyOptions(rates: Record<string, number>): { value: string; label: string }[] {
  return Object.keys(rates)
    .sort((a, b) => (a === BASE_CURRENCY ? -1 : b === BASE_CURRENCY ? 1 : a.localeCompare(b)))
    .map((code) => ({ value: code, label: `${code} · ${currencyName(code)}` }));
}
