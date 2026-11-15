export interface AuthSession {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
  expires?: string;
}

interface AuthProviders {
  credentials?: {
    type?: string;
  };
}

interface AuthRedirectResponse {
  url?: string;
}

export interface RegistrationInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const callbackUrl =
  import.meta.env.VITE_TASKFLOW_CALLBACK_URL ??
  "https://task-flow-six-rouge.vercel.app/";

async function getCsrfToken() {
  const response = await fetch("/api/auth/csrf", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Unable to start a secure sign-in request.");
  }

  const result = (await response.json()) as { csrfToken?: string };
  if (!result.csrfToken) {
    throw new Error("The authentication server did not return a CSRF token.");
  }
  return result.csrfToken;
}

async function getApiError(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    return body.error?.message ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

export async function registerWithTaskFlow(input: RegistrationInput) {
  const response = await fetch("/api/register", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await getApiError(response));

  return (await response.json()) as {
    id: string;
    name: string;
    email: string;
    createdAt: string;
  };
}

export async function getSession() {
  const response = await fetch("/api/auth/session", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to verify your TaskFlow session.");

  const session: AuthSession | null = await response.json();
  return session?.user?.id ? session : null;
}

export async function signInWithCredentials(email: string, password: string) {
  const providersResponse = await fetch("/api/auth/providers", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!providersResponse.ok) {
    throw new Error("Unable to contact the TaskFlow authentication service.");
  }
  const providers = (await providersResponse.json()) as AuthProviders;
  if (!providers.credentials) {
    throw new Error("The TaskFlow Credentials provider is not available.");
  }

  const csrfToken = await getCsrfToken();
  const body = new URLSearchParams({
    csrfToken,
    callbackUrl,
    email,
    password,
  });
  const response = await fetch("/api/auth/callback/credentials", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body,
  });
  if (!response.ok) {
    throw new Error("Email or password is incorrect.");
  }

  const result = (await response.json()) as AuthRedirectResponse;
  if (!result.url) {
    throw new Error("The authentication server returned an unexpected response.");
  }
  if (new URL(result.url, window.location.origin).searchParams.has("error")) {
    throw new Error("Email or password is incorrect.");
  }

  const session = await getSession();
  if (!session) throw new Error("Sign-in did not establish an active session.");
  return session;
}

export async function signOut() {
  const csrfToken = await getCsrfToken();
  const body = new URLSearchParams({ csrfToken, callbackUrl });
  const response = await fetch("/api/auth/signout", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body,
  });
  if (!response.ok) throw new Error("Unable to sign out of TaskFlow.");

  if (await getSession()) {
    throw new Error("The TaskFlow session is still active after sign-out.");
  }
}
