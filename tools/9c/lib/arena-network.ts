/**
 * Network/planet identity for the arena tooling.
 *
 * Two DIFFERENT planet-id schemes are in play across the three data sources this skill
 * touches, and they must not be conflated (confirmed via source + live probing, 2026-08-30):
 *
 *  - ArenaService leaderboard/seasons API: keyed by host, one per network (odin-arena.9c.gg,
 *    heimdall-arena.9c.gg). Thor has NO arena endpoint — DNS doesn't resolve, and it's not in
 *    the firewall allowlist either. Thor arg is accepted but rejected fast, not silently
 *    treated as unsupported-but-ignorable.
 *  - garage staking snapshot: keyed by a capitalized name ("Odin"/"Heimdall"/"Thor") per
 *    ArenaRewardService.GetPlanetNameFromId.
 *  - SeasonPass admin API (courage pass): keyed by the raw game planet-id hex string
 *    ("0x000000000000" etc.) per planet_id query param — NOT the garage name.
 */

export type ArenaNetwork = "odin" | "heimdall" | "thor";

export interface NetworkInfo {
  readonly network: ArenaNetwork;
  readonly arenaServiceHost: string | null;
  readonly garagePlanetName: string;
  readonly planetId: string;
}

const NETWORKS: Record<ArenaNetwork, NetworkInfo> = {
  odin: {
    network: "odin",
    arenaServiceHost: "https://odin-arena.9c.gg",
    garagePlanetName: "Odin",
    planetId: "0x000000000000",
  },
  heimdall: {
    network: "heimdall",
    arenaServiceHost: "https://heimdall-arena.9c.gg",
    garagePlanetName: "Heimdall",
    planetId: "0x000000000001",
  },
  thor: {
    // Confirmed 2026-08-30: thor-arena.9c.gg does not resolve, and Thor isn't in the
    // devcontainer firewall allowlist either. Sign/Stage buttons exist for Thor in the
    // settlement UI (payout path only) but there is no season/leaderboard read path.
    network: "thor",
    arenaServiceHost: null,
    garagePlanetName: "Thor",
    planetId: "0x000000000003",
  },
};

export function getNetworkInfo(network: ArenaNetwork): NetworkInfo {
  return NETWORKS[network];
}

export class UnsupportedNetworkError extends Error {
  constructor(public readonly network: ArenaNetwork) {
    super(
      `${network} 네트워크는 아레나 엔드포인트가 없습니다 (thor-arena.9c.gg DNS 미해석, 2026-08-30 확인). ` +
        `Odin·Heimdall만 지원됩니다. 엔드포인트가 생기면 tools/9c/lib/arena-network.ts만 고치면 됩니다.`,
    );
  }
}

export function requireArenaServiceHost(network: ArenaNetwork): string {
  const info = getNetworkInfo(network);
  if (!info.arenaServiceHost) throw new UnsupportedNetworkError(network);
  return info.arenaServiceHost;
}
