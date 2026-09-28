import { promises as dns } from "dns";
import { ImportError } from "./types";

/**
 * Network policy for all outbound fetches of the importer:
 * exact-host/protocol validation, DNS resolution checked against blocked
 * ranges (IPv4 + IPv6, including mapped v4), and per-hop re-validation of
 * redirects. Every resolved destination is checked, never just the first.
 */

export type Lookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: Lookup = async (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

// NOTE: base values must be built with arithmetic, not `<<` — bit shifts on
// octets ≥ 128 overflow the signed 32-bit range and silently disable the check.
const ip4 = (a: number, b = 0, c = 0, d = 0) => ((a * 256 + b) * 256 + c) * 256 + d;

const BLOCKED_V4: [number, number][] = [
  [ip4(0), 1 << 24], // 0.0.0.0/8 "this network"
  [ip4(10), 1 << 24], // 10.0.0.0/8 private
  [ip4(100, 64), 10 * (1 << 22)], // 100.64.0.0/10 CGNAT
  [ip4(127), 1 << 24], // 127.0.0.0/8 loopback
  [ip4(169, 254), 1 << 16], // 169.254.0.0/16 link-local + cloud metadata
  [ip4(172, 16), 16 * (1 << 16)], // 172.16.0.0/12 private
  [ip4(192, 0, 2), 1], // 192.0.2.0/24 TEST-NET-1
  [ip4(192, 168), 1 << 16], // 192.168.0.0/16 private
  [ip4(198, 18), 2 * (1 << 16)], // 198.18.0.0/15 benchmark
];

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToLong(ip);
  if (n === null) return true;
  return BLOCKED_V4.some(([base, size]) => n >= base && n < base + size);
}

/** Expand an IPv6 address into its eight 16-bit groups. */
function expandIpv6(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const parsed = groups.map((g) => {
    const v = parseInt(g, 16);
    return Number.isInteger(v) && v >= 0 && v <= 0xffff ? v : NaN;
  });
  return parsed.some(Number.isNaN) ? null : parsed;
}

function isBlockedIpv6(ip: string): boolean {
  // Mapped v4 (::ffff:a.b.c.d) is judged by its v4 part.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const g = expandIpv6(ip);
  if (g === null) return true; // unparsable → block
  const first = g[0];
  const isZero = g.every((v) => v === 0);
  return (
    isZero || // :: unspecified
    (g.slice(0, 7).every((v) => v === 0) && g[7] === 1) || // ::1 loopback
    (first >= 0xfc00 && first < 0xfe00) || // fc00::/7 unique-local
    (first >= 0xfe80 && first < 0xfec0) || // fe80::/10 link-local
    first >= 0xff00 // ff00::/8 multicast
  );
}

export function isBlockedAddress(address: string): boolean {
  return address.includes(":") ? isBlockedIpv6(address) : isBlockedIpv4(address);
}

/** Throws ImportError("blocked") unless every resolved address of the URL is public. */
export async function assertAllowedUrl(rawUrl: string, lookup: Lookup = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImportError("unrecognized_url", "Ungültige URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImportError("blocked", `Protokoll nicht erlaubt: ${url.protocol}`);
  }

  // INGEST_ALLOW_PRIVATE=1 disables the internal-address check. Test/local
  // harnesses only — never enable where users can submit URLs.
  if (process.env.INGEST_ALLOW_PRIVATE === "1") return url;

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    addresses = [{ address: hostname, family: hostname.includes(":") ? 6 : 4 }];
  } else {
    try {
      addresses = await lookup(hostname);
    } catch {
      throw new ImportError("network", `Host konnte nicht aufgelöst werden: ${hostname}`, { transient: true });
    }
  }

  if (addresses.length === 0) {
    throw new ImportError("network", `Host konnte nicht aufgelöst werden: ${hostname}`, { transient: true });
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      // ponytail: DNS re-check per hop mitigates redirect-based SSRF; full rebinding pinning needs a custom undici dispatcher
      throw new ImportError("blocked", `Zieladresse ist nicht erlaubt: ${hostname}`);
    }
  }
  return url;
}

export interface PolicyFetchResult {
  response: Response;
  finalUrl: string;
}

/** Fetch with manual redirects; every hop re-validated against the policy. */
export async function policyFetch(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string>; lookup?: Lookup } = {}
): Promise<PolicyFetchResult> {
  const { timeoutMs = 30_000, maxRedirects = 5, headers = {}, lookup } = opts;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertAllowedUrl(current, lookup);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; KIResearchBot/1.0)", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new ImportError("timeout", "Zeitüberschreitung beim Abruf", { transient: true });
      }
      throw new ImportError("network", `Abruf fehlgeschlagen: ${(err as Error).message}`, { transient: true });
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new ImportError("bad_content", `Umleitung ohne Ziel (HTTP ${res.status})`);
      current = new URL(location, url).toString();
      continue;
    }
    return { response: res, finalUrl: current };
  }
  throw new ImportError("bad_content", "Zu viele Umleitungen");
}
