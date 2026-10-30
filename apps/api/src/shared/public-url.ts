const PRIVATE_HOST = [
  /^localhost$/,
  /\.localhost$/,
  /\.(internal|local|flycast)$/,
  /^0\.0\.0\.0$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/,
  /^\[(::1?|f[cd][0-9a-f]*:.*|fe[89ab][0-9a-f]*:.*)\]$/,
];

/**
 * What is wrong with a deployed address setting such as `CONSOLE_BASE_URL` or `SAFETY_LINK_BASE_URL`
 * (null: nothing). Links we send people must be public https addresses: not this computer, not a
 * private network. The value is never echoed (boot errors reach the logs).
 */
export function publicHttpsProblem(name: string, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return `${name} is not a web address`;
  }
  if (url.protocol !== 'https:') return `${name} must start with https://`;
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.some((re) => re.test(host))) return `${name} points at a computer or a private network, not a public address`;
  if (url.username || url.password || url.search || url.hash) return `${name} must be a plain address (no sign-in, ? or #)`;
  return null;
}

/** An address setting (`SHARE_LINK_BASE_URL`, `NOTIFY_RECEIPT_BASE_URL`, …) without its trailing slash; null when unset (no link then: there is deliberately no default address). */
export function baseUrlFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[name]?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}
