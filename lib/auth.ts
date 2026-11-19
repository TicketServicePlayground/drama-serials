import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { apiFetch, type Account } from "./api";

// Holds the API's token; httpOnly, so page scripts never see it.
export const SESSION_COOKIE = "ds_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** The signed-in account with its access period, or null. One API call per request. */
export const getAccount = cache(async (): Promise<Account | null> => {
  const token = await getToken();
  if (!token) return null;
  const { status, data } = await apiFetch<Account>("/me", { token });
  return status === 200 ? data : null;
});

export async function getSessionEmail(): Promise<string | null> {
  return (await getAccount())?.email ?? null;
}

export async function startSession(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Off only for plain-http local runs (COOKIE_SECURE=false).
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
