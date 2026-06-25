// The shared base every resource extends. It holds the HttpClient and offers the
// three things resources keep needing: read a single payload, send one, and walk
// a paginated list. List endpoints differ in where they nest their items, so the
// pagination helper takes an extractor and lets each resource map its own shape.

import type { HttpClient, QueryParams, Envelope } from "../http";
import type { Pagination } from "../http";

/**
 * One page of a list, plus a `next()` that fetches the page after it. `next()`
 * resolves to undefined once there is nothing more, so a `while (page)` loop ends
 * cleanly.
 */
export interface Page<T> extends Pagination {
  items: T[];
  /** True while a further page exists. */
  hasMore: boolean;
  /** The next page, or undefined when this is the last one. */
  next(): Promise<Page<T> | undefined>;
}

export abstract class Resource {
  constructor(protected readonly http: HttpClient) {}

  /** GET a path and return its `data` payload. */
  protected async getData<T>(
    path: string,
    query?: QueryParams,
    signal?: AbortSignal,
  ): Promise<T> {
    const env = await this.http.request<T>("GET", path, { query, signal });
    return env.data;
  }

  /** POST a body and return the `data` payload. */
  protected async postData<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const env = await this.http.request<T>("POST", path, { body, signal });
    return env.data;
  }

  /**
   * Fetch one page of a list. `extract` pulls the items and the pagination block
   * out of whatever shape the endpoint nests them in; it gets the whole envelope
   * because some endpoints keep pagination in `data` and others in `meta`.
   * `next()` reissues the same request with the page number bumped.
   */
  protected async fetchPage<T>(
    path: string,
    query: QueryParams,
    extract: (env: Envelope<unknown>) => { items: T[]; pagination: Pagination },
  ): Promise<Page<T>> {
    const env = await this.http.request<unknown>("GET", path, { query });
    const { items, pagination } = extract(env);
    const hasMore = pagination.page < pagination.totalPages;
    return {
      items,
      ...pagination,
      hasMore,
      next: hasMore
        ? () =>
            this.fetchPage(
              path,
              { ...query, page: pagination.page + 1 },
              extract,
            )
        : async () => undefined,
    };
  }

  /** Walk every item across every page, starting from a first-page promise. */
  protected async *iterate<T>(first: Promise<Page<T>>): AsyncGenerator<T> {
    let page: Page<T> | undefined = await first;
    while (page) {
      for (const item of page.items) yield item;
      page = await page.next();
    }
  }
}
