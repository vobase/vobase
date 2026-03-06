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

export function createHttpClient(defaults?: HttpClientOptions): HttpClient {
  const baseUrl = defaults?.baseUrl ?? '';
  const defaultTimeout = defaults?.timeout ?? DEFAULT_TIMEOUT;

  async function doFetch<T = unknown>(
    url: string,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    const resolvedUrl = isAbsoluteUrl(url) ? url : `${baseUrl}${url}`;
    const timeout = options?.timeout ?? defaultTimeout;

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

    const response = await fetch(resolvedUrl, {
      method: options?.method ?? 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });

    const data = (await parseResponseData(response)) as T;

    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      data,
      raw: response,
    };
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
