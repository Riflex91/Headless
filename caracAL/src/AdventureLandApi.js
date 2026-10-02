"use strict";

const ADVENTURE_LAND_ORIGIN = "https://adventure.land";

function apiUrl(method) {
  return `${ADVENTURE_LAND_ORIGIN}/json_api/${encodeURIComponent(method)}`;
}

function jsonApiBody(method, args = {}, auth = null) {
  const payload = {
    method,
    args: args || {},
  };
  if (auth) payload.auth = auth;
  return JSON.stringify(payload);
}

function setCookieValues(headers) {
  if (!headers) return [];
  if (typeof headers.raw === "function") {
    const raw = headers.raw();
    if (Array.isArray(raw?.["set-cookie"])) return raw["set-cookie"];
  }
  const value =
    typeof headers.get === "function" ? headers.get("set-cookie") : null;
  return value ? [value] : [];
}

function authFromHeaders(headers) {
  for (const cookie of setCookieValues(headers)) {
    const match = /(?:^|[,;]\s*)auth=([^;\s,]+)/i.exec(String(cookie));
    if (match?.[1]) return match[1];
  }
  return null;
}

function responseMessages(data) {
  const entries = Array.isArray(data) ? data : data ? [data] : [];
  return entries
    .map((entry) => entry?.message || entry?.args?.[0] || entry?.reason)
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
}

function isCredentialFailure(data) {
  return responseMessages(data).some((message) =>
    /wrong password|email not found|login failed/i.test(message),
  );
}

function accountPayload(data) {
  const entries = Array.isArray(data) ? data : data ? [data] : [];
  const account = entries.find(
    (entry) =>
      entry?.type === "servers_and_characters" &&
      Array.isArray(entry.servers) &&
      Array.isArray(entry.characters),
  );

  if (account) return account;

  const messages = responseMessages(data);
  const authenticationFailure = messages.find((message) =>
    /not logged in|no user|nouser|auth/i.test(message),
  );
  if (authenticationFailure) {
    const error = new Error(
      `Adventure Land authentication failed: ${authenticationFailure}`,
    );
    error.code = "ADVENTURE_LAND_AUTH_FAILED";
    throw error;
  }

  const error = new Error(
    "Adventure Land returned no servers_and_characters payload",
  );
  error.code = "ADVENTURE_LAND_ACCOUNT_RESPONSE_INVALID";
  throw error;
}

async function login(fetchImpl, email, password) {
  const raw = await fetchImpl(apiUrl("signup_or_login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonApiBody("signup_or_login", {
      email,
      password,
      only_login: true,
    }),
  });

  if (!raw.ok) {
    throw new Error(`failed to call login api: ${raw.statusText}`);
  }

  const data = await raw.json();
  if (isCredentialFailure(data)) return null;

  const session = authFromHeaders(raw.headers);
  if (!session) {
    const error = new Error(
      "Adventure Land login succeeded without an auth cookie",
    );
    error.code = "ADVENTURE_LAND_AUTH_COOKIE_MISSING";
    throw error;
  }
  return session;
}

async function fetchAccountInfo(fetchImpl, session) {
  if (!session) {
    const error = new Error("Adventure Land session is missing");
    error.code = "ADVENTURE_LAND_AUTH_MISSING";
    throw error;
  }

  const raw = await fetchImpl(apiUrl("servers_and_characters"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonApiBody("servers_and_characters", {}, session),
  });

  if (!raw.ok) {
    throw new Error(`failed to update account info: ${raw.statusText}`);
  }

  return accountPayload(await raw.json());
}

module.exports = {
  ADVENTURE_LAND_ORIGIN,
  accountPayload,
  apiUrl,
  authFromHeaders,
  fetchAccountInfo,
  isCredentialFailure,
  jsonApiBody,
  login,
  responseMessages,
};
