/**
 * Worker functions. workerkit sends each one to a Web Worker as source text
 * (`.toString()`), so every function must be self-contained: no imports and
 * no variables from outside the function body. Type-only imports are fine —
 * they are erased at build time.
 */
import type {
  CategorySummary,
  ChunkSpec,
  Currency,
  RawTransaction,
  Summary,
  TransactionRow,
} from '../types';

/**
 * Generates the transactions for each chunk. Deterministic: a given `id`
 * always produces the same row, however the chunks are split across threads.
 */
export function generateTransactions({
  data,
}: {
  data: ChunkSpec[];
}): RawTransaction[] {
  const merchants = [
    'Northwind Traders',
    'Contoso Coffee',
    'Fabrikam Air',
    'Tailspin Toys',
    'Wide World Importers',
    'Litware Books',
    'Adventure Works',
    'Proseware Cloud',
    'Lamna Health',
    'Alpine Ski House',
    'Coho Winery',
    'Blue Yonder Rail',
  ];
  const categories = [
    'Groceries',
    'Travel',
    'Software',
    'Dining',
    'Health',
    'Books',
    'Electronics',
    'Entertainment',
  ];
  const currencies: Currency[] = ['USD', 'EUR', 'GBP', 'JPY'];
  const countries = ['US', 'DE', 'GB', 'JP', 'FR', 'CA', 'NL', 'ES'];
  const yearStart = Date.UTC(2026, 0, 1);
  const day = 86_400_000;

  const rows: RawTransaction[] = [];
  for (const chunk of data) {
    for (let id = chunk.start; id < chunk.start + chunk.count; id++) {
      // mulberry32, seeded by the row id
      let seed = Math.imul(id + 1, 0x9e3779b1);
      const random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const pick = <T>(list: T[]): T =>
        list[Math.floor(random() * list.length)];

      const currency = pick(currencies);
      // Mostly small amounts, a few large ones (up to ~5,000 in USD terms)
      const major = 2 + random() ** 3 * 4998;
      rows.push({
        id,
        merchant: pick(merchants),
        category: pick(categories),
        country: pick(countries),
        currency,
        amountMinor:
          currency === 'JPY'
            ? Math.round(major * 150)
            : Math.round(major * 100),
        timestamp: yearStart + Math.floor(random() * 300 * day),
      });
    }
  }
  return rows;
}

/**
 * Turns raw transactions into display rows: formats amounts in their own
 * currency and dates in UTC, converts to USD and flags large payments.
 */
export function transformTransactions({
  data,
}: {
  data: RawTransaction[];
}): TransactionRow[] {
  const usdRate: Record<Currency, number> = {
    USD: 1,
    EUR: 1.08,
    GBP: 1.27,
    JPY: 0.0067,
  };
  const minorUnits: Record<Currency, number> = {
    USD: 100,
    EUR: 100,
    GBP: 100,
    JPY: 1,
  };
  const moneyFormats = new Map<Currency, Intl.NumberFormat>();
  const dateFormat = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  return data.map((tx) => {
    let money = moneyFormats.get(tx.currency);
    if (!money) {
      money = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: tx.currency,
      });
      moneyFormats.set(tx.currency, money);
    }
    const amount = tx.amountMinor / minorUnits[tx.currency];
    const amountUsd = Math.round(amount * usdRate[tx.currency] * 100) / 100;
    return {
      id: tx.id,
      merchant: tx.merchant,
      details: `${tx.category} · ${tx.country} · ${dateFormat.format(tx.timestamp)}`,
      amountLabel: money.format(amount),
      amountUsd,
      category: tx.category,
      flagged:
        amountUsd >= 3000 ||
        (tx.category === 'Travel' && tx.country !== 'US' && amountUsd >= 1500),
      searchText:
        `${tx.merchant} ${tx.category} ${tx.country} #${tx.id}`.toLowerCase(),
    };
  });
}

/** Totals per category, largest first. */
export function summarizeTransactions({
  data,
}: {
  data: TransactionRow[];
}): Summary {
  const round = (n: number) => Math.round(n * 100) / 100;
  const byCategory = new Map<string, CategorySummary>();
  let totalUsd = 0;
  let flagged = 0;

  for (const row of data) {
    totalUsd += row.amountUsd;
    if (row.flagged) flagged++;
    let entry = byCategory.get(row.category);
    if (!entry) {
      entry = { category: row.category, count: 0, totalUsd: 0, flagged: 0 };
      byCategory.set(row.category, entry);
    }
    entry.count++;
    entry.totalUsd += row.amountUsd;
    if (row.flagged) entry.flagged++;
  }

  return {
    count: data.length,
    totalUsd: round(totalUsd),
    flagged,
    byCategory: [...byCategory.values()]
      .map((entry) => ({ ...entry, totalUsd: round(entry.totalUsd) }))
      .sort((a, b) => b.totalUsd - a.totalUsd),
  };
}
