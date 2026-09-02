/**
 * Discord announcement draft template for arena season pairs.
 *
 * Template derived from 3 real announcements the domain owner supplied (2026-08-30) —
 * see .claude/skills/arena-announce/references/announcement-samples.md for the verbatim
 * originals this was reverse-engineered from. Key findings from that investigation:
 *
 *  - The first 3 lines (Dear @everyone / New Seasons... / Don't miss out...) are BYTE-
 *    IDENTICAL across all 3 samples — safe to hardcode as a fixed template.
 *  - Public season number == `seasonGroupId`, confirmed exactly across all 6
 *    (network, season) pairs in the 3 samples (odin/heimdall × 3 announcements).
 *  - A pair is exactly one Odin season + one Heimdall season. OFF_SEASON is never
 *    announced (0/3 samples included one).
 *  - The "medals adjusted to 0" paragraph is CONDITIONAL, not fixed template text — it
 *    only appeared in the 2 samples that included a CHAMPIONSHIP season, and only when
 *    that Championship's requiredMedalCount was 0 (confirmed via DB: older championships
 *    had real medal requirements — odin g16=60, heimdall g8=50 — before dropping to 0 at
 *    odin g17 / heimdall g9). The paragraph text itself names a specific past promotion
 *    ("Ragnarok Breaker") — reusing it verbatim for a future unrelated medals==0 event
 *    would misattribute the reason. This module therefore NEVER auto-inserts that
 *    paragraph; it only flags the condition and shows the past wording as a reference for
 *    a human to adapt or replace (agreed with the domain owner, 2026-08-30).
 *  - The link lines' target URL is a rewards detail page, NOT `prize_detail_url` (which
 *    the backend hardcodes to a fixed Discord channel — see spec doc §5-1) — so the URL
 *    can never be auto-generated here and is always a human-filled slot.
 *  - Ticket prices/purchase info do NOT appear in these announcements. A DB timestamp
 *    check (domain owner) found essentially zero ticket-policy price changes in ~11
 *    months (all 12 policy rows have created_at == updated_at; policies get replaced
 *    wholesale, not edited, and the last replacement was 2025-10-01) — consistent with
 *    price changes being rare enough that routine season announcements never need to
 *    mention them. This module doesn't attempt to generate ticket-price copy.
 */

export type AnnounceableArenaType = "SEASON" | "CHAMPIONSHIP";

export interface SeasonForAnnouncement {
  readonly network: "odin" | "heimdall";
  readonly seasonGroupId: number;
  readonly arenaType: AnnounceableArenaType;
  readonly requiredMedalCount: number;
  readonly startBlock: number;
}

const FIXED_HEADER = [
  "Dear @everyone",
  "",
  "New Seasons of Arena are just around the corner.",
  "Check out the rewards from the links below.",
  "Don't miss out on the Arena bonus rewards that come with the Season Pass!",
].join("\n");

/** Verbatim from the sample that used it (Odin S39 / Heimdall CS9 announcement). Shown
 *  to the human as a reference, never spliced into the generated draft automatically —
 *  see module doc comment for why. */
export const MEDAL_NOTE_REFERENCE_TEXT =
  "For the time being, the medals required to participate in the Championship have been adjusted to 0\n" +
  "for adventurers newly exploring NineChronicles through Ragnarok Breaker — we look forward to your active participation!";

function networkLabel(network: "odin" | "heimdall"): string {
  return network === "odin" ? "Odin" : "Heimdall";
}

function typeLabel(arenaType: AnnounceableArenaType): string {
  return arenaType === "CHAMPIONSHIP" ? "Championship" : "Season";
}

/** U+2060 WORD JOINER — confirmed by byte inspection of the real samples (e2 81 a0 in
 *  UTF-8), NOT zero-width joiner (U+200D) or zero-width space (U+200B). Invisible in any
 *  editor, so it's pulled out as a named constant rather than left as a literal character
 *  buried in a template string — a future edit could otherwise "clean up" what looks like
 *  a stray space, or retype it as a different, wrong invisible codepoint. Precedes the
 *  link text in all 3 real samples; looks like a Discord copy artifact (possibly from how
 *  Discord renders an unfurled link/mention) rather than meaningful formatting, so this
 *  module reproduces it for fidelity but never treats its presence as something that must
 *  be validated downstream — if a human strips it while editing the draft, the
 *  announcement is still perfectly fine posted without it. */
const WORD_JOINER = "⁠";

export function linkLine(season: SeasonForAnnouncement): string {
  return `${WORD_JOINER}[${networkLabel(season.network)}] Arena ${typeLabel(season.arenaType)} ${season.seasonGroupId}`;
}

export interface AnnounceCheck {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: "OK" | "WARN" | "FATAL";
  readonly detail: string;
}

/** Runs every check this module knows how to run BEFORE the draft is considered safe to
 *  show. seasonGroupId==0 is FATAL (not WARN) deliberately: OFF_SEASON is rejected before
 *  this function ever runs, so a SEASON/CHAMPIONSHIP entry with seasonGroupId==0 can only
 *  be a data-entry mistake (real case caught 2026-08-30: heimdall sid=42, a live SEASON,
 *  had seasonGroupId=0 — publishing that verbatim would have announced "Season 0"
 *  publicly, which is exactly the kind of un-take-backable mistake the spec doc's "외부
 *  공개 게시는 되돌릴 수 없다" principle warns about).
 *
 *  Root cause CONFIRMED directly from source (2026-08-30) — and corrected once already.
 *  An earlier pass of this comment blamed the EF model's
 *  `SeasonGroupId { get; set; } = 0;` default (ArenaService.Shared/Models/Season.cs). That
 *  default is real but isn't actually what's responsible: `AddSeasonWithRoundsAsync`
 *  always takes seasonGroupId as an explicit required parameter, so the model-level
 *  default never gets a chance to apply. The real mechanism is one layer up, in the Blazor
 *  form itself (ArenaService.BackOffice/Components/Pages/ManageSeasons.razor:267):
 *  `private int newSeasonGroupId;` — an uninitialized component field, defaulting to 0 per
 *  ordinary C# rules, bound to the number input via `@bind="newSeasonGroupId"` (line 198).
 *  Leave that field untouched and it submits as 0 — indistinguishable at a glance from
 *  OFF_SEASON's legitimate 0. This was "probably a data-entry mistake" before; it's now a
 *  confirmed mechanism — just not the one first claimed here. */
export function checkAnnouncementPair(odin: SeasonForAnnouncement, heimdall: SeasonForAnnouncement): AnnounceCheck[] {
  const checks: AnnounceCheck[] = [];

  for (const s of [odin, heimdall]) {
    checks.push({
      id: `season-group-id-nonzero-${s.network}`,
      name: `${networkLabel(s.network)} seasonGroupId != 0`,
      ok: s.seasonGroupId !== 0,
      level: s.seasonGroupId === 0 ? "FATAL" : "OK",
      detail:
        s.seasonGroupId === 0
          ? `${networkLabel(s.network)} ${typeLabel(s.arenaType)}의 seasonGroupId가 0입니다 — ManageSeasons.razor의 폼 필드(newSeasonGroupId)가 초기화 없이 선언돼 있어 기본값이 0이고, 그 칸을 안 채우면 조용히 0으로 제출됩니다(소스로 확인됨, 2026-08-30). OFF_SEASON도 0을 쓰기 때문에 겉보기엔 구분이 안 갑니다(실제로 heimdall sid=42에서 발견). "Season 0"으로 그대로 공지되지 않도록 백오피스에서 실제 번호를 확인하고 고친 뒤 다시 실행하세요.`
          : `${s.seasonGroupId}`,
    });
  }

  for (const s of [odin, heimdall]) {
    if (s.arenaType !== "CHAMPIONSHIP") continue;
    // Only requiredMedalCount==0 gets a WARN. A normal nonzero value is the routine case
    // — flagging it every time would be noise that trains whoever reads the report to
    // skim past WARNs, which is worse than saying nothing (2026-08-30 review: an earlier
    // version of this check WARNed unconditionally whenever a Championship was present,
    // suggesting the operator "rewrite the paragraph with the real number" — reverted,
    // since no real announcement in the samples ever used medal-count wording for a
    // nonzero value, so recommending specific phrasing here would be inventing copy
    // dressed up as guidance, not reporting an observed fact).
    checks.push({
      id: `championship-medal-note-${s.network}`,
      name: `${networkLabel(s.network)} Championship 메달 문단 검토`,
      ok: s.requiredMedalCount !== 0,
      level: s.requiredMedalCount === 0 ? "WARN" : "OK",
      detail:
        s.requiredMedalCount === 0
          ? `requiredMedalCount=0 — 과거 사례(odin S39/heimdall CS9 공지)에서는 이럴 때 메달 조정 안내 문단이 들어갔습니다. 이번에도 필요한지, 넣는다면 이유가 그때와 같은지 확인하고 아래 참고 문구를 그대로 쓰지 말고 다듬어서 넣으세요.`
          : `requiredMedalCount=${s.requiredMedalCount} — 정상 범위, 메달 문단 불필요.`,
    });
  }

  return checks;
}

/** D: a same-network, same-type season's seasonGroupId should be exactly one more than
 *  the previous same-type season's — a gap (or non-increment) is a broader signal than
 *  the seasonGroupId==0 check above (that only catches the zero case; this catches any
 *  skipped/duplicated number, e.g. registering 25 when 24 was never used). WARN, not
 *  FATAL — unlike ==0 (which is never legitimate for SEASON/CHAMPIONSHIP), a gap here
 *  could in principle be intentional renumbering, so a human should confirm rather than
 *  have the tool refuse outright. */
export function checkSequentialSeasonNumber(
  season: SeasonForAnnouncement,
  previousSameTypeSeasonGroupId: number | null,
): AnnounceCheck {
  const network = networkLabel(season.network);
  if (previousSameTypeSeasonGroupId === null) {
    return {
      id: `sequential-season-number-${season.network}`,
      name: `${network} ${typeLabel(season.arenaType)} 번호가 직전 시즌 +1`,
      ok: true,
      level: "OK",
      detail: "직전 동일 타입 시즌을 찾지 못해 건너뜀 (이 타입의 첫 시즌이거나 조회 범위 밖)",
    };
  }
  const expected = previousSameTypeSeasonGroupId + 1;
  const ok = season.seasonGroupId === expected;
  return {
    id: `sequential-season-number-${season.network}`,
    name: `${network} ${typeLabel(season.arenaType)} 번호가 직전 시즌 +1`,
    ok,
    level: ok ? "OK" : "WARN",
    detail: ok
      ? `직전 ${typeLabel(season.arenaType)}(${previousSameTypeSeasonGroupId}) 다음 번호(${expected}) 맞음`
      : `직전 ${typeLabel(season.arenaType)} 번호는 ${previousSameTypeSeasonGroupId}라 ${expected}가 기대되는데 이번 값은 ${season.seasonGroupId} — 번호가 튀거나 겹칩니다. 등록 실수인지 확인하세요.`,
  };
}

export interface AnnouncementDraft {
  readonly body: string;
  readonly checks: AnnounceCheck[];
  readonly medalNoteReference: string | null;
}

export function buildAnnouncementDraft(odin: SeasonForAnnouncement, heimdall: SeasonForAnnouncement): AnnouncementDraft {
  const checks = checkAnnouncementPair(odin, heimdall);
  const needsMedalNote = checks.some((c) => c.id.startsWith("championship-medal-note-") && !c.ok);

  const body = [FIXED_HEADER, "", linkLine(odin), linkLine(heimdall)].join("\n");

  return {
    body,
    checks,
    medalNoteReference: needsMedalNote ? MEDAL_NOTE_REFERENCE_TEXT : null,
  };
}
