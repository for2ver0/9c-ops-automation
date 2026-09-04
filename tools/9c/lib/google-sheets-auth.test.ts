import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { signServiceAccountJwt } from "./google-sheets-auth";

function decodeBase64url(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("signServiceAccountJwt", () => {
  const now = new Date("2026-09-04T00:00:00Z");
  const jwt = signServiceAccountJwt(
    { clientEmail: "sa@example.iam.gserviceaccount.com", privateKey },
    "https://www.googleapis.com/auth/spreadsheets",
    now,
  );
  const [headerPart, claimPart, sigPart] = jwt.split(".");

  test("produces a signature verifiable with the matching public key", () => {
    const signature = Buffer.from(sigPart!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const unsigned = `${headerPart}.${claimPart}`;
    expect(cryptoVerify("RSA-SHA256", Buffer.from(unsigned), publicKey, signature)).toBe(true);
  });

  test("a tampered claim fails verification", () => {
    const tamperedClaim = decodeBase64url(claimPart!).replace(
      "sa@example.iam.gserviceaccount.com",
      "attacker@example.com",
    );
    const tamperedPart = Buffer.from(tamperedClaim, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const signature = Buffer.from(sigPart!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const unsigned = `${headerPart}.${tamperedPart}`;
    expect(cryptoVerify("RSA-SHA256", Buffer.from(unsigned), publicKey, signature)).toBe(false);
  });

  test("the header declares RS256", () => {
    expect(JSON.parse(decodeBase64url(headerPart!))).toEqual({ alg: "RS256", typ: "JWT" });
  });

  test("the claim carries iss/scope/aud and a 1-hour expiry", () => {
    const claim = JSON.parse(decodeBase64url(claimPart!));
    expect(claim.iss).toBe("sa@example.iam.gserviceaccount.com");
    expect(claim.scope).toBe("https://www.googleapis.com/auth/spreadsheets");
    expect(claim.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claim.exp - claim.iat).toBe(3600);
    expect(claim.iat).toBe(Math.floor(now.getTime() / 1000));
  });
});
