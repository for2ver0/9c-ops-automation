/**
 * PNG rendering for the arena reward table — approximate reproduction of the real
 * backoffice's table image, per spec doc §7-2 "상금 표 레이아웃 스펙" (title rule,
 * left/right 2-block table, totals row, dark-brown/gold frame). No original client
 * assets exist in this environment, so this is a from-scratch approximation, not a
 * pixel match — spec doc §8-1 explicitly allows this ("표 이미지 재현 | PNG로 생성,
 * 근사 재현 허용").
 *
 * Rendering pipeline: build an SVG string (pure, testable, no native deps) -> rasterize
 * with @resvg/resvg-js (prebuilt binary, no system libvips/cairo needed — chosen over
 * canvas/sharp specifically because it installs cleanly offline-ish via a single npm
 * package with no native build step).
 *
 * Scope note: this PNG does NOT include the "티켓 정보" block that spec §7-2 describes
 * as part of the real backoffice table image. That needs season-type-specific wording
 * templates, which is arena-announce's job (§6-1: "티켓 수치를 라이브 정책 값과 대사" is
 * skill 3's role, not this one's) — including it here without the real wording would
 * look complete but be wrong. Block info (start/end block) IS included; estimated dates
 * are NOT — block-to-date conversion is explicitly a shared module owned by
 * arena-season-preview (spec doc §6-3), not duplicated here.
 */
import { Resvg } from "@resvg/resvg-js";
import type { RewardTier, TierGroup } from "./arena-reward-calc";

export interface RewardTablePngInput {
  readonly title: string;
  readonly groups: readonly TierGroup[];
  readonly tiers: readonly RewardTier[];
  readonly rankingPool: number;
  readonly season: { readonly startBlock: number; readonly endBlock: number } | null;
}

const COLORS = {
  background: "#1f130c",
  frameOuter: "#c9a227",
  frameInner: "#8a6a1f",
  headerText: "#f4e3b2",
  bodyText: "#f0e6d2",
  rowEven: "#2a1c12",
  rowOdd: "#241709",
  headerRow: "#3a2814",
  totalsRow: "#4a3319",
  gridLine: "#5c431f",
};

const COL_HEADERS = ["Group", "Players", "Reward %", "Group Reward", "Basic", "Staking lvl 02", "Staking lvl 03", "Courage Pass", "CP & Stk 02", "CP & Stk 03"];

function esc(s: string | number): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Pure SVG builder — no rasterization, so this alone is unit-testable without the
 *  native rasterizer dependency. */
export function renderRewardTableSvg(input: RewardTablePngInput): string {
  const { title, groups, tiers, rankingPool, season } = input;

  const colWidths = [110, 90, 100, 140, 110, 130, 130, 130, 130, 130];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const marginX = 60;
  const titleY = 70;
  const blockInfoY = season ? 105 : titleY + 20;
  const tableTop = blockInfoY + 40;
  const rowHeight = 40;
  const headerHeight = 46;
  const rows = groups.length + 1; // +1 totals row
  const tableHeight = headerHeight + rows * rowHeight;
  const width = marginX * 2 + tableWidth;
  const height = tableTop + tableHeight + 60;

  const colX: number[] = [];
  {
    let x = marginX;
    for (const w of colWidths) {
      colX.push(x);
      x += w;
    }
  }

  const cellsFor = (cols: (string | number)[], rowIndex: number, rowFill: string, textColor = COLORS.bodyText, bold = false) => {
    const y = tableTop + headerHeight + rowIndex * rowHeight;
    let svg = `<rect x="${marginX}" y="${y}" width="${tableWidth}" height="${rowHeight}" fill="${rowFill}"/>`;
    cols.forEach((c, i) => {
      const cx = colX[i] + colWidths[i] - 12;
      svg += `<text x="${cx}" y="${y + rowHeight / 2 + 5}" font-size="17" fill="${textColor}" text-anchor="end" font-weight="${bold ? 700 : 400}" font-family="Consolas, 'Courier New', monospace">${esc(c)}</text>`;
    });
    return svg;
  };

  let rowsSvg = "";
  groups.forEach((g, i) => {
    const t = tiers[i];
    const fill = i % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
    rowsSvg += cellsFor(
      [
        g.rankGroup,
        g.playerCount,
        `${g.rewardPercentage}%`,
        fmt(g.groupReward),
        fmt(t.basicReward),
        fmt(t.basicReward + t.staking2Reward),
        fmt(t.basicReward + t.staking3Reward),
        fmt(t.basicReward + t.couragePassReward),
        fmt(t.basicReward + t.couragePassAndStaking2Reward),
        fmt(t.basicReward + t.couragePassAndStaking3Reward),
      ],
      i,
      fill,
    );
  });

  const playerSum = groups.reduce((s, g) => s + g.playerCount, 0);
  const pctSum = groups.reduce((s, g) => s + g.rewardPercentage, 0);
  const groupRewardSum = groups.reduce((s, g) => s + g.groupReward, 0);
  rowsSvg += cellsFor(
    ["TOTAL", playerSum, `${pctSum}%`, fmt(groupRewardSum), "", "", "", "", "", ""],
    groups.length,
    COLORS.totalsRow,
    COLORS.headerText,
    true,
  );

  // Grid lines (vertical, between columns + outer edges)
  let gridSvg = "";
  const gridTop = tableTop;
  const gridBottom = tableTop + tableHeight;
  for (let i = 0; i <= colWidths.length; i++) {
    const x = i === colWidths.length ? colX[i - 1] + colWidths[i - 1] : colX[i];
    gridSvg += `<line x1="${x}" y1="${gridTop}" x2="${x}" y2="${gridBottom}" stroke="${COLORS.gridLine}" stroke-width="1"/>`;
  }
  gridSvg += `<line x1="${marginX}" y1="${gridBottom}" x2="${marginX + tableWidth}" y2="${gridBottom}" stroke="${COLORS.gridLine}" stroke-width="1"/>`;

  const headerCellsSvg = COL_HEADERS.map((h, i) => {
    const cx = colX[i] + colWidths[i] / 2;
    return `<text x="${cx}" y="${tableTop + headerHeight / 2 + 6}" font-size="15" fill="${COLORS.headerText}" text-anchor="middle" font-weight="700" font-family="Consolas, 'Courier New', monospace">${esc(h)}</text>`;
  }).join("");

  const blockInfoSvg = season
    ? `<text x="${width / 2}" y="${blockInfoY}" font-size="16" fill="${COLORS.bodyText}" text-anchor="middle" font-family="Consolas, 'Courier New', monospace">Block ${fmt(season.startBlock)} - ${fmt(season.endBlock)} (추정 날짜: 블록타임 실측 전까지 미표기)</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.background}"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" fill="none" stroke="${COLORS.frameOuter}" stroke-width="3"/>
  <rect x="22" y="22" width="${width - 44}" height="${height - 44}" fill="none" stroke="${COLORS.frameInner}" stroke-width="1"/>
  <text x="${width / 2}" y="${titleY}" font-size="26" fill="${COLORS.headerText}" text-anchor="middle" font-weight="700" font-family="Georgia, 'Times New Roman', serif">${esc(title)}</text>
  ${blockInfoSvg}
  <rect x="${marginX}" y="${tableTop}" width="${tableWidth}" height="${headerHeight}" fill="${COLORS.headerRow}"/>
  ${headerCellsSvg}
  ${rowsSvg}
  ${gridSvg}
  <text x="${width / 2}" y="${height - 24}" font-size="13" fill="${COLORS.frameInner}" text-anchor="middle" font-family="Consolas, monospace">Total Ranking Pool: ${fmt(rankingPool)} — 근사 재현 (arena-reward-table)</text>
</svg>`;
}

/** Rasterizes the SVG to PNG bytes. Kept separate from renderRewardTableSvg so the SVG
 *  builder can be unit-tested without pulling in the native rasterizer. */
export function renderRewardTablePng(input: RewardTablePngInput): Buffer {
  const svg = renderRewardTableSvg(input);
  const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
  const pngData = resvg.render();
  return pngData.asPng();
}
