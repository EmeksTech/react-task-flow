export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export async function getApiError(response: Response) {
  let message = `Request failed (${response.status} ${response.statusText}).`;
  let code: string | undefined;

  try {
    const body = (await response.json()) as ApiErrorBody;
    message = body.error?.message ?? message;
    code = body.error?.code;
  } catch {
    const text = await response.text().catch(() => "");
    if (text) message = text;
  }

  return new ApiError(message, response.status, code);
}

export async function requestJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) throw await getApiError(response);
  return (await response.json()) as T;
}

export async function requestVoid(
  url: string,
  options: RequestInit = {},
): Promise<void> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) throw await getApiError(response);
}
