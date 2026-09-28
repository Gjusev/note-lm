import { describe, it, expect } from "vitest";
import { assertAllowedUrl, isBlockedAddress } from "@/lib/ingestion/network-policy";
import { ImportError } from "@/lib/ingestion/types";

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("isBlockedAddress", () => {
  it("blocks private and metadata IPv4 ranges", () => {
    for (const ip of ["10.0.0.1", "192.168.1.1", "172.16.0.5", "172.31.255.255", "127.0.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks IPv6 loopback, ULA, link-local and multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("judges mapped v4 addresses by their v4 part", () => {
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("allows public addresses", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertAllowedUrl", () => {
  it("rejects non-HTTP protocols", async () => {
    await expect(assertAllowedUrl("file:///etc/passwd", resolveTo())).rejects.toThrow(ImportError);
  });

  it("blocks when any resolved address is internal", async () => {
    // dual-stack: one public, one private → the private one poisons the set
    await expect(
      assertAllowedUrl("https://example.com", resolveTo("93.184.216.34", "192.168.0.10"))
    ).rejects.toThrow(/nicht erlaubt/);
  });

  it("blocks literal internal IPs without DNS", async () => {
    await expect(assertAllowedUrl("http://127.0.0.1:3000/admin", resolveTo())).rejects.toThrow(ImportError);
    await expect(assertAllowedUrl("http://[::1]/", resolveTo())).rejects.toThrow(ImportError);
  });

  it("allows fully public resolutions", async () => {
    const url = await assertAllowedUrl("https://example.com/x", resolveTo("93.184.216.34"));
    expect(url.hostname).toBe("example.com");
  });

  it("treats DNS failure as transient network error", async () => {
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(assertAllowedUrl("https://nx.example.com", failing as never)).rejects.toMatchObject({
      code: "network",
      transient: true,
    });
  });
});
