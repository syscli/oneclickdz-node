// Account balance and the transaction ledger. Balance is a single number; the
// ledger is paginated, so it comes back as a Page you can step through or as an
// async iterator that walks the whole history.

import { Resource, type Page } from "./base";
import type { Envelope, Pagination } from "../http";
import type { Balance, Transaction, TransactionsParams } from "../types";

/** The transactions endpoint nests its items and pagination inside `data`. */
function extractTransactions(env: Envelope<unknown>): {
  items: Transaction[];
  pagination: Pagination;
} {
  const d = (env.data ?? {}) as {
    items?: Transaction[];
    pagination?: Pagination;
  };
  return {
    items: d.items ?? [],
    pagination:
      d.pagination ?? { page: 1, pageSize: 0, totalPages: 1, totalResults: 0 },
  };
}

export class Account extends Resource {
  /** The current balance in dinars. */
  balance(signal?: AbortSignal): Promise<Balance> {
    return this.getData<Balance>("account/balance", undefined, signal);
  }

  /** One page of the transaction ledger, newest first. */
  transactions(params: TransactionsParams = {}): Promise<Page<Transaction>> {
    return this.fetchPage<Transaction>(
      "account/transactions",
      { ...params },
      extractTransactions,
    );
  }

  /** Every transaction across every page, as an async iterator. */
  paginateTransactions(
    params: TransactionsParams = {},
  ): AsyncGenerator<Transaction> {
    return this.iterate(this.transactions(params));
  }
}
