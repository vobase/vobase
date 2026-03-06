export interface HttpClientOptions {
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  headers: Headers;
  data: T;
  raw: Response;
}

export interface HttpClient {
  fetch<T = unknown>(
    url: string,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>>;
  get<T = unknown>(
    url: string,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<HttpResponse<T>>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<HttpResponse<T>>;
  put<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<HttpResponse<T>>;
  delete<T = unknown>(
    url: string,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<HttpResponse<T>>;
}

const DEFAULT_TIMEOUT = 30_000;

function isAbsoluteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

async function parseResponseData(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const contentLength = response.headers.get('content-length');

  if (
    response.status === 204 ||
    contentLength === '0' ||
    response.body === null
  ) {
    return null;
  }

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return text;
}

const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableMethod(method: string): boolean {
  return method === 'GET';
}

export function createHttpClient(defaults?: HttpClientOptions): HttpClient {
  const baseUrl = defaults?.baseUrl ?? '';
  const defaultTimeout = defaults?.timeout ?? DEFAULT_TIMEOUT;
  const defaultRetries = defaults?.retries ?? DEFAULT_RETRIES;
  const defaultRetryDelay = defaults?.retryDelay ?? DEFAULT_RETRY_DELAY;

  async function doFetch<T = unknown>(
    url: string,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    const resolvedUrl = isAbsoluteUrl(url) ? url : `${baseUrl}${url}`;
    const timeout = options?.timeout ?? defaultTimeout;
    const maxRetries = options?.retries ?? defaultRetries;
    const method = options?.method ?? 'GET';

    const headers: Record<string, string> = { ...options?.headers };
    let body: BodyInit | undefined;

    if (options?.body !== undefined) {
      if (
        typeof options.body === 'string' ||
        options.body instanceof Blob ||
        options.body instanceof FormData ||
        options.body instanceof ArrayBuffer ||
        options.body instanceof URLSearchParams ||
        options.body instanceof ReadableStream
      ) {
        body = options.body;
      } else {
        headers['content-type'] =
          headers['content-type'] ?? 'application/json';
        body = JSON.stringify(options.body);
      }
    }

    let lastError: unknown;
    let lastResponse: HttpResponse<T> | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(defaultRetryDelay * 2 ** (attempt - 1));
      }

      try {
        const response = await fetch(resolvedUrl, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(timeout),
        });

        const data = (await parseResponseData(response)) as T;

        lastResponse = {
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          data,
          raw: response,
        };

        // Retry on 5xx only for GET requests
        if (response.status >= 500 && isRetryableMethod(method) && attempt < maxRetries) {
          continue;
        }

        return lastResponse;
      } catch (error) {
        lastError = error;
      }
    }

    // If we have a last response (5xx after exhausting retries), return it
    if (lastResponse) {
      return lastResponse;
    }

    // Otherwise throw the last network error
    throw lastError;
  }

  return {
    fetch: doFetch,

    get<T = unknown>(
      url: string,
      options?: Omit<RequestOptions, 'method' | 'body'>,
    ) {
      return doFetch<T>(url, { ...options, method: 'GET' });
    },

    post<T = unknown>(
      url: string,
      body?: unknown,
      options?: Omit<RequestOptions, 'method' | 'body'>,
    ) {
      return doFetch<T>(url, { ...options, method: 'POST', body });
    },

    put<T = unknown>(
      url: string,
      body?: unknown,
      options?: Omit<RequestOptions, 'method' | 'body'>,
    ) {
      return doFetch<T>(url, { ...options, method: 'PUT', body });
    },

    delete<T = unknown>(
      url: string,
      options?: Omit<RequestOptions, 'method' | 'body'>,
    ) {
      return doFetch<T>(url, { ...options, method: 'DELETE' });
    },
  };
}
