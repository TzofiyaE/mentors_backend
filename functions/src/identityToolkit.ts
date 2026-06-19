const IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1";

export interface IdentityToolkitSession {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  email: string;
}

export class IdentityToolkitError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<IdentityToolkitSession> {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error("FIREBASE_API_KEY environment variable is not set");

  const response = await fetch(
    `${IDENTITY_TOOLKIT_BASE}/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );

  const data = (await response.json()) as IdentityToolkitSession & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new IdentityToolkitError(data.error?.message ?? "UNKNOWN_ERROR");
  }

  return data;
}
