import { describe, expect, test } from "bun:test";
import { checkPolicyFingerprint } from "./arena-policy-fingerprint";

describe("checkPolicyFingerprint", () => {
  test("known policy id used with its only-ever-observed type -> OK", () => {
    const result = checkPolicyFingerprint("odin", 6, "CHAMPIONSHIP");
    expect(result.ok).toBe(true);
    expect(result.level).toBe("OK");
  });

  test("known policy id used with a type never observed for it -> WARN, not FATAL", () => {
    // odin policy 4 ("new season") has only ever been SEASON.
    const result = checkPolicyFingerprint("odin", 4, "CHAMPIONSHIP");
    expect(result.ok).toBe(false);
    expect(result.level).toBe("WARN");
  });

  test("completely unknown policy id -> WARN", () => {
    const result = checkPolicyFingerprint("odin", 999, "SEASON");
    expect(result.ok).toBe(false);
    expect(result.level).toBe("WARN");
    expect(result.detail).toContain("관측 데이터에 없는 값");
  });

  test("thor policy 6 has genuinely mixed history (OFF_SEASON + CHAMPIONSHIP) -> WARN even for a type it HAS been used with", () => {
    // This is the real counter-example: matching a past use is not enough to call it OK,
    // because the same policy id was also used for a different type.
    const offSeason = checkPolicyFingerprint("thor", 6, "OFF_SEASON");
    expect(offSeason.level).toBe("WARN");
    expect(offSeason.detail).toContain("CHAMPIONSHIP");

    const championship = checkPolicyFingerprint("thor", 6, "CHAMPIONSHIP");
    expect(championship.level).toBe("WARN");
    expect(championship.detail).toContain("OFF_SEASON");
  });

  test("never claims FATAL-grade certainty in its wording", () => {
    for (const network of ["odin", "heimdall", "thor"] as const) {
      for (const arenaType of ["SEASON", "CHAMPIONSHIP", "OFF_SEASON"] as const) {
        for (let policyId = 1; policyId <= 6; policyId++) {
          const result = checkPolicyFingerprint(network, policyId, arenaType);
          expect(result.level).not.toBe("FATAL" as unknown as "OK" | "WARN");
          expect(result.detail).not.toMatch(/전용|반드시|무조건/);
        }
      }
    }
  });
});
