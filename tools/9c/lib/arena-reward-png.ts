/**
 * PNG rendering for the arena reward table — approximate reproduction of the real
 * backoffice's table image, per spec doc §7-2 "상금 표 레이아웃 스펙" (title rule,
 * left/right 2-block table, totals row, dark-brown/gold frame). No original client
 * assets exist in this environment, so this is a from-scratch approximation, not a
 * pixel match — spec doc §8-1 explicitly allows this ("표 이미지 재현 | PNG로 생성,
 * 근사 재현 허용").
 *
 * Layout/typography (serif font, italic "Rank N – M" labels, two/three-line column
 * headers, gold divider after Group Reward, Sum row highlighted only on the left
 * block, Block/Ticket Information lines below the table) were reverse-engineered
 * from a real backoffice screenshot (Odin Season 38) the operator shared, 2026-08-31.
 *
 * Rendering pipeline: build an SVG string (pure, testable, no native deps) -> rasterize
 * with @resvg/resvg-js (prebuilt binary, no system libvips/cairo needed — chosen over
 * canvas/sharp specifically because it installs cleanly offline-ish via a single npm
 * package with no native build step).
 *
 * Scope note on ticket numbers: this module never invents them. `ticketInfo` is an
 * explicit, caller-supplied input (see arena-reward-table.ts's --ticket-total/
 * --ticket-session) — omit it and the Ticket Information lines simply don't render
 * (the "Ticket Information" heading still does, matching the real table's layout when
 * an operator hasn't confirmed the numbers yet). Wording differs by season type
 * (SEASON has a per-session refresh bullet, CHAMPIONSHIP does not per the operator,
 * 2026-08-31) — that branching lives in the CLI, not here, same reasoning as the
 * pre-existing scope note about season-type wording belonging to arena-announce.
 *
 * Block info (start/end block) IS included, and — since arena-season-preview's shared
 * arena-block-time.ts module now exists (it didn't when this file was first written) —
 * estimated dates are too, when the caller supplies them. This module still does NOT do
 * its own block-to-date conversion; that stays arena-season-preview's job (spec §6-3). A
 * caller without a date estimate handy can pass `dates: null` and the line falls back to
 * block numbers only, same as before.
 */
import { Resvg } from "@resvg/resvg-js";
import type { RewardTier, TierGroup } from "./arena-reward-calc";

export type BulletSegmentColor = "amber" | "green" | "default";

export interface BulletSegment {
  readonly text: string;
  readonly color?: BulletSegmentColor;
}

export interface RewardTablePngInput {
  readonly title: string;
  readonly groups: readonly TierGroup[];
  readonly tiers: readonly RewardTier[];
  readonly rankingPool: number;
  readonly season: { readonly startBlock: number; readonly endBlock: number } | null;
  /** Optional — caller supplies these from arena-block-time.ts's estimateDateForBlock.
   *  null (or omitted) renders block numbers only, matching this module's original
   *  behavior before the shared block-time module existed. */
  readonly dates?: {
    readonly start: Date;
    readonly startMarginMinutes: number;
    readonly end: Date;
    readonly endMarginMinutes: number;
  } | null;
  /** Explicit, caller-confirmed ticket numbers — never defaulted or inferred here.
   *  Omit to render just the "Ticket Information" heading with no bullet lines. */
  readonly ticketInfo?: {
    readonly lines: readonly (readonly BulletSegment[])[];
  } | null;
}

const COLORS = {
  background: "#150d08",
  frameOuter: "#c9a227",
  frameInner: "#8a6a1f",
  titleText: "#f5f0e0",
  headerBg: "#2b1c10",
  headerText: "#f5f0e0",
  rowA: "#22160d",
  bodyText: "#ece4d0",
  sumBg: "#ab823c",
  sumText: "#241608",
  gridDotted: "#7a5a2a",
  divider: "#c9a227",
  sectionOlive: "#a8b56a",
  sectionWhite: "#f0ece0",
  bulletAmber: "#e0a355",
  bulletGreen: "#8fbf6f",
  bulletDefault: "#ece4d0",
  footer: "#8a6a1f",
};

// Page border's offset from the image edge — shared between pageFrameSvg (which draws
// it) and renderRewardTableSvg (which centers the title against it).
const PAGE_BORDER = 13;

// Each header cell can be 1-3 lines — matches the real table's "No of\nPlayers",
// "Staking\nlvl 02", "Courage Pass\n&\nStaking lvl 2" wrapping.
const COL_HEADERS: readonly (readonly string[])[] = [
  ["Group"],
  ["No of", "Players"],
  ["Reward %"],
  ["Group Reward"],
  ["Basic"],
  ["Staking", "lvl 02"],
  ["Staking", "lvl 03"],
  ["Courage Pass"],
  ["Courage Pass", "&", "Staking lvl 2"],
  ["Courage Pass", "&", "Staking lvl 3"],
];

const LEFT_BLOCK_COLS = 4; // Group / No of Players / Reward % / Group Reward — the Sum row and the gold divider both key off this

function esc(s: string | number): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "August 8th" — matches the real table's date format (no time, no year). UTC, since
 *  that's what estimateDateForBlock returns. */
export function formatOrdinalDate(d: Date): string {
  return `${MONTH_NAMES[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}`;
}

/** "Rank 1 – 2" / "Rank 251 – 500", or "Rank 1" when the group is a single rank.
 *  Exported so tests can build the same label instead of duplicating the format. */
export function formatRankLabel(minRank: number, maxRank: number): string {
  return minRank === maxRank ? `Rank ${minRank}` : `Rank ${minRank} – ${maxRank}`;
}

function segmentColor(c: BulletSegmentColor | undefined): string {
  switch (c) {
    case "amber": return COLORS.bulletAmber;
    case "green": return COLORS.bulletGreen;
    default: return COLORS.bulletDefault;
  }
}

/** Builds the standard "Start Block : N (Est. Month Dth)    End Block : N (Est. Month
 *  Dth)" bullet, colored the way the real table does it (numbers amber, estimated
 *  dates green). Falls back to block-numbers-only when no date estimate is available. */
export function buildBlockInfoBullet(
  season: { startBlock: number; endBlock: number },
  dates?: { start: Date; end: Date } | null,
): BulletSegment[] {
  const seg: BulletSegment[] = [
    { text: "Start Block : " },
    { text: fmt(season.startBlock), color: "amber" },
  ];
  if (dates) {
    seg.push({ text: " (Est. " }, { text: formatOrdinalDate(dates.start), color: "green" }, { text: ")" });
  }
  seg.push({ text: "    End Block : " }, { text: fmt(season.endBlock), color: "amber" });
  if (dates) {
    seg.push({ text: " (Est. " }, { text: formatOrdinalDate(dates.end), color: "green" }, { text: ")" });
  }
  return seg;
}

/** SEASON-type ticket wording (two bullets: season total + per-session extra). Real
 *  wording confirmed against an operator-shared screenshot, 2026-08-31. */
export function buildSeasonTicketLines(totalTickets: number, extraPerSession: number): BulletSegment[][] {
  return [
    [
      { text: "You can buy up to " },
      { text: String(totalTickets), color: "amber" },
      { text: " tickets during the entire Season" },
    ],
    [
      { text: "You can buy up to " },
      { text: String(extraPerSession), color: "amber" },
      { text: " extra tickets during each session (each refresh, or about 24 hours)." },
    ],
  ];
}

/** CHAMPIONSHIP-type ticket wording (single bullet, no per-session refresh concept —
 *  per operator, 2026-08-31; wording itself unconfirmed beyond "no session bullet", so
 *  callers should treat this as provisional until cross-checked against a real
 *  Championship-type table image). */
export function buildChampionshipTicketLines(totalTickets: number): BulletSegment[][] {
  return [
    [
      { text: "You can buy up to " },
      { text: String(totalTickets), color: "amber" },
      { text: " tickets during the entire Championship" },
    ],
  ];
}

function bulletLineSvg(segments: readonly BulletSegment[], x: number, y: number, fontSize = 15): string {
  // x/y live on the <text> element only; each <tspan> omits its own x/y so the SVG
  // renderer's own font metrics flow them one after another on the same baseline —
  // exact, unlike a hand-rolled per-character advance estimate.
  const spans = segments.map((s) => `<tspan fill="${segmentColor(s.color)}">${esc(s.text)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="Georgia, 'Times New Roman', serif">${spans}</text>`;
}

/** "Picture frame" border — a single plain thin gold rule, sharp right-angle corners
 *  (down from a double rule per operator feedback, 2026-08-31). */
function pageFrameSvg(width: number, height: number): string {
  const outer = PAGE_BORDER;
  return `<rect x="${outer}" y="${outer}" width="${width - outer * 2}" height="${height - outer * 2}" fill="none" stroke="${COLORS.frameOuter}" stroke-width="1.5"/>`;
}

/** Pure SVG builder — no rasterization, so this alone is unit-testable without the
 *  native rasterizer dependency. */
export function renderRewardTableSvg(input: RewardTablePngInput): string {
  const { title, groups, tiers, season, dates, ticketInfo } = input;

  const colWidths = [130, 120, 100, 140, 110, 130, 130, 130, 150, 150];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const leftBlockWidth = colWidths.slice(0, LEFT_BLOCK_COLS).reduce((a, b) => a + b, 0);
  const marginX = 60;
  const tableTop = 105;
  // Vertically centered between the page border (pageFrameSvg's `outer`, kept in sync
  // here) and the table's top edge — not a fixed offset from the top.
  const titleY = Math.round((PAGE_BORDER + tableTop) / 2 + 10);
  const rowHeight = 42;
  const headerHeight = 66;
  const rows = groups.length + 1; // +1 sum row
  const tableHeight = headerHeight + rows * rowHeight;
  const tableBottom = tableTop + tableHeight;
  const width = marginX * 2 + tableWidth;

  const infoLabelX = marginX;
  const infoTextX = marginX + 250;
  const infoTop = tableBottom + 55;
  const infoLineGap = 34;
  let infoLinesUsed = 0; // Block Information's single bullet
  const blockBulletY = infoTop;
  infoLinesUsed += 1;
  const ticketHeadingY = infoTop + infoLineGap * infoLinesUsed + 12;
  const ticketBulletStartY = ticketHeadingY;
  const ticketLineCount = ticketInfo?.lines.length ?? 0;
  const infoBottom = ticketBulletStartY + (ticketLineCount > 0 ? (ticketLineCount - 1) * infoLineGap : 0);
  const height = infoBottom + 55;

  const colX: number[] = [];
  {
    let x = marginX;
    for (const w of colWidths) {
      colX.push(x);
      x += w;
    }
  }

  const rowCellsSvg = (cols: (string | number)[], rowIndex: number, rowFill: string | null, opts: { bold?: boolean; italicFirst?: boolean; noBottomLine?: boolean } = {}) => {
    const y = tableTop + headerHeight + rowIndex * rowHeight;
    let svg = "";
    if (rowFill) {
      // Full left-block row fill (Group column included) — matches the operator's
      // reference photo, where the Rank label cell shares the same row band as the
      // other three columns (2026-08-31).
      svg += `<rect x="${marginX}" y="${y}" width="${leftBlockWidth}" height="${rowHeight}" fill="${rowFill}"/>`;
    }
    cols.forEach((c, i) => {
      if (c === "" ) return;
      const cx = colX[i] + colWidths[i] / 2;
      const italic = opts.italicFirst && i === 0;
      svg += `<text x="${cx}" y="${y + rowHeight / 2 + 6}" font-size="16" fill="${opts.bold ? COLORS.sumText : COLORS.bodyText}" text-anchor="middle" font-weight="${opts.bold ? 700 : 400}" font-style="${italic ? "italic" : "normal"}" font-family="Georgia, 'Times New Roman', serif">${esc(c)}</text>`;
    });
    // Dotted row separator — omitted on the table's last row (no line trailing the Sum row)
    if (!opts.noBottomLine) {
      svg += `<line x1="${marginX}" y1="${y + rowHeight}" x2="${marginX + tableWidth}" y2="${y + rowHeight}" stroke="${COLORS.gridDotted}" stroke-width="1" stroke-dasharray="1,3" opacity="0.5"/>`;
    }
    return svg;
  };

  let rowsSvg = "";
  groups.forEach((g, i) => {
    const t = tiers[i];
    const fill = COLORS.rowA; // every data row filled the same — no alternating banding
    rowsSvg += rowCellsSvg(
      [
        formatRankLabel(g.minRank, g.maxRank),
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
      { italicFirst: true },
    );
  });

  const playerSum = groups.reduce((s, g) => s + g.playerCount, 0);
  const pctSum = groups.reduce((s, g) => s + g.rewardPercentage, 0);
  const groupRewardSum = groups.reduce((s, g) => s + g.groupReward, 0);
  rowsSvg += rowCellsSvg(
    ["Sum", playerSum, `${pctSum}%`, fmt(groupRewardSum), "", "", "", "", "", ""],
    groups.length,
    COLORS.sumBg,
    { bold: true, noBottomLine: true },
  );
  // The right block (Basic..CP&Stk3) stays blank on the Sum row — it never gets the
  // gold Sum highlight the left block does — so give it its own closing rule under the
  // last data row instead, otherwise that block would visually trail off with nothing
  // marking where the data ends.
  {
    const y = tableTop + headerHeight + groups.length * rowHeight;
    rowsSvg += `<line x1="${colX[LEFT_BLOCK_COLS]}" y1="${y}" x2="${marginX + tableWidth}" y2="${y}" stroke="${COLORS.frameOuter}" stroke-width="1"/>`;
  }

  // Vertical grid lines: thin between every internal column, thicker gold divider
  // after the left block (Group Reward | Basic) — but no vertical stroke on the
  // table's own left/right outer edge, only the top/bottom rules frame it.
  let gridSvg = "";
  for (let i = 1; i < colWidths.length; i++) {
    const x = colX[i];
    const isDivider = i === LEFT_BLOCK_COLS;
    gridSvg += `<line x1="${x}" y1="${tableTop}" x2="${x}" y2="${tableBottom}" stroke="${isDivider ? COLORS.divider : COLORS.gridDotted}" stroke-width="${isDivider ? 1.3 : 1}" opacity="${isDivider ? 1 : 0.35}"/>`;
  }

  const headerCellsSvg = COL_HEADERS.map((lines, i) => {
    const cx = colX[i] + colWidths[i] / 2;
    const lineHeight = 17;
    const startY = tableTop + headerHeight / 2 - ((lines.length - 1) * lineHeight) / 2 + 6;
    const tspans = lines
      .map((l, li) => `<tspan x="${cx}" y="${startY + li * lineHeight}">${esc(l)}</tspan>`)
      .join("");
    return `<text font-size="14" fill="${COLORS.headerText}" text-anchor="middle" font-weight="700" font-family="Georgia, 'Times New Roman', serif">${tspans}</text>`;
  }).join("");

  const blockInfoSvg = season
    ? `<text x="${infoLabelX}" y="${blockBulletY}" font-size="19" font-weight="700" font-family="Georgia, 'Times New Roman', serif"><tspan fill="${COLORS.sectionOlive}">Block</tspan><tspan fill="${COLORS.sectionWhite}"> Information</tspan></text>` +
      `<text x="${infoTextX - 18}" y="${blockBulletY}" font-size="15" fill="${COLORS.bodyText}">•</text>` +
      bulletLineSvg(buildBlockInfoBullet(season, dates ? { start: dates.start, end: dates.end } : null), infoTextX, blockBulletY)
    : "";

  let ticketInfoSvg = "";
  if (season) {
    ticketInfoSvg += `<text x="${infoLabelX}" y="${ticketHeadingY}" font-size="19" font-weight="700" font-family="Georgia, 'Times New Roman', serif"><tspan fill="${COLORS.sectionOlive}">Ticket</tspan><tspan fill="${COLORS.sectionWhite}"> Information</tspan></text>`;
    (ticketInfo?.lines ?? []).forEach((line, li) => {
      const y = ticketBulletStartY + li * infoLineGap;
      ticketInfoSvg += `<text x="${infoTextX - 18}" y="${y}" font-size="15" fill="${COLORS.bodyText}">•</text>`;
      ticketInfoSvg += bulletLineSvg(line, infoTextX, y);
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.background}"/>
  ${pageFrameSvg(width, height)}
  <text x="${width / 2}" y="${titleY}" font-size="30" fill="${COLORS.titleText}" text-anchor="middle" font-weight="700" font-family="Georgia, 'Times New Roman', serif">${esc(title)}</text>
  <rect x="${marginX}" y="${tableTop}" width="${tableWidth}" height="${headerHeight}" fill="${COLORS.headerBg}"/>
  ${headerCellsSvg}
  ${rowsSvg}
  ${gridSvg}
  <line x1="${marginX}" y1="${tableTop}" x2="${marginX + tableWidth}" y2="${tableTop}" stroke="${COLORS.frameOuter}" stroke-width="1"/>
  <line x1="${marginX}" y1="${tableTop + headerHeight}" x2="${marginX + tableWidth}" y2="${tableTop + headerHeight}" stroke="${COLORS.frameOuter}" stroke-width="1"/>
  ${blockInfoSvg}
  ${ticketInfoSvg}
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
