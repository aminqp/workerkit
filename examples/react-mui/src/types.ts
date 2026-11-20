export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY';

/** A range of rows for one generator job. */
export interface ChunkSpec {
  start: number;
  count: number;
}

/** A transaction as generated — never sent to the main thread. */
export interface RawTransaction {
  id: number;
  merchant: string;
  category: string;
  country: string;
  currency: Currency;
  /** Amount in the currency's minor unit (cents; yen for JPY). */
  amountMinor: number;
  /** Epoch milliseconds. */
  timestamp: number;
}

/** A transaction ready to display. */
export interface TransactionRow {
  id: number;
  merchant: string;
  /** "Category · Country · Date" */
  details: string;
  /** Formatted in the transaction's own currency. */
  amountLabel: string;
  amountUsd: number;
  category: string;
  /** Large amounts that a reviewer should look at. */
  flagged: boolean;
  /** Lower-cased text the filter box matches against. */
  searchText: string;
}

export interface CategorySummary {
  category: string;
  count: number;
  totalUsd: number;
  flagged: number;
}

export interface Summary {
  count: number;
  totalUsd: number;
  flagged: number;
  byCategory: CategorySummary[];
}
