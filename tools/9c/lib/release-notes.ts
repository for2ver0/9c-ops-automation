/**
 * release-notes — CURRENTLY A STRUCTURE-ONLY DRAFT TOOL. See SKILL.md for the full story;
 * short version:
 *
 * 설계 문서 §4가 이 스킬에 요구한 실행 조건은 "⑤ 깃북 작성 방식 확인 + GitHub 토큰(확보만)"
 * 이었다. 2026-09-01 조사(`docs/9c-update-automation-self-check.md` ⑥)로 GitHub 토큰은
 * 애초에 필요 없다는 게 확인됐다 — 깃북 공개 페이지에 내장된 GitBook 자체 메타데이터에
 * `"direction":"export"`(깃북 → GitHub 백업, 반대 아님)가 명시돼 있어, 릴리즈 노트는 깃북
 * 에디터에서 직접 작성되고 GitHub 레포(`planetarium/nine-chronicles-docs`, 비공개)는 그
 * 내용을 자동으로 내보내는 백업 대상일 뿐이다. 즉 이 스킬의 산출물은 "사람이 깃북 에디터에
 * 붙여넣을 마크다운 텍스트"면 충분하다 — GitHub 접근 자체가 불필요.
 *
 * 원본 저장소(`nine-chronicles-docs`)가 비공개라 마크다운 소스 자체는 여전히 못 봤지만,
 * 2026-09-04에 `parseGitbookHead`와 같은 방식(렌더링된 HTML을 직접 grep — WebFetch 요약은
 * 못 믿는다, 아래 참고)으로 최근 릴리즈 5개(200430~200470)를 직접 대조해 아래를 확인했다:
 *
 *   - **카테고리 헤딩은 `<h3>`다** — `## {APV}`(버전) 다음 레벨. 이 모듈이 이미 쓰던
 *     `### ${category}`가 우연히 맞았던 것을 이번에 처음 직접 확인했다.
 *   - **다만 3단 구조도 실재한다(신규, 이 모듈은 아직 지원 안 함)** — 5개 중 2개
 *     (200450·200430)는 `<h3>` 카테고리 밑에 `<h4>` 하위 카테고리가 또 있다("New Stages",
 *     "Buff Limit Adjustments" 등). 이 모듈의 `ReleaseNoteSection`은 `{category, items}`
 *     2단뿐이라 이런 하위 카테고리는 표현할 방법이 없다 — 지금은 사람이 카테고리 이름에
 *     구분을 녹이거나(예: "신규 콘텐츠 — 신규 스테이지"), 여러 섹션으로 쪼개는 식으로
 *     우회해야 한다.
 *   - **카테고리는 고정 타입이 아니다** — WebFetch로 먼저 받은 AI 요약은 "New Event Dungeon/
 *     Game Improvements/Bug Fixes/Content Balance Adjustments/NCU"를 "표준 카테고리
 *     5종"이라고 제시했다. 직접 HTML로 재보니 5개 릴리즈 중 3개(200430·200440·200460)가
 *     그중 일부(각각 1~4개)를 실제로 썼지만, 15개 실제 제목 중 겹친 건 6개뿐이고 나머지
 *     2개 릴리즈(200450·200470)는 하나도 안 겹쳤다 — 그 5개는 "가끔 재사용되는 이름"이지
 *     "고정 카테고리 목록"은 아니다. 그래서 여전히 카테고리 이름은 고정 목록을 만들지
 *     않고 사람이 매번 정하게 둔다(아래 참고). 표(`<table>`)도 5개 전부에서 0건이라 상시
 *     쓰는 문법이 아니다.
 *   - 항목은 대개 `<li>` 텍스트, 완결된 문장 — `- ${item}` 마크다운 불릿 가정과 일치
 *     (200470·200440에서 확인). 다만 5개 중 200450은 `<li>`가 0건이고 전부 `<p>` 문단 +
 *     `<strong>` 소제목이었다 — 이 함수는 항상 `- ${item}`을 찍으므로 그런 문단형 회차는
 *     사람이 붙여넣기 전에 손봐야 한다.
 *
 * 여전히 확인 못 한 것: 콜아웃/힌트 블록, 이미지 삽입 같은 GitBook 전용 마크다운 확장
 * 문법(이번 5개 릴리즈엔 안 나왔을 뿐 안 쓰인다는 보장은 아님).
 */
import { fetchGitbookHead } from "./release-guard";

export { fetchGitbookHead };

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: "OK" | "WARN" | "FATAL";
  readonly detail: string;
}

export interface ReleaseNoteSection {
  readonly category: string;
  readonly items: readonly string[];
}

export interface ReleaseNoteInput {
  readonly apv: number;
  readonly sections: readonly ReleaseNoteSection[];
}

/** 릴리즈 노트가 실제로 다음 회차인지 대사한다. 이미 깃북에 있거나(같거나 더 낮은 APV) 더
 *  과거인 값을 실수로 다시 올리는 걸 막는다. */
export function checkApvNotAlreadyPublished(apv: number, currentGitbookApv: number): Check {
  const id = "apv-not-already-published";
  const name = "APV가 이미 게시된 값보다 최신";
  if (apv <= currentGitbookApv) {
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `입력한 v${apv}는 깃북에 이미 있는 최신값(v${currentGitbookApv})보다 크지 않습니다 — 잘못된 버전을 지정했을 가능성.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `깃북 최신값(v${currentGitbookApv})보다 큽니다.` };
}

/** 관측 근거: 2026-09-01 깃북 릴리즈 노트 페이지의 버전 헤딩을 직접 확인해보니, 200330부터
 *  200470까지 15개 값이 예외 없이 +10 간격이었다(200480은 아직 없음 — 이 세션에서
 *  0건으로 직접 확인). 그중 200400~200470의 8개는 날짜도 확인됐지만(설계 문서 부록 C,
 *  2026-01-27~08-25) 200330~200390 구간은 값만 확인했을 뿐 날짜는 모른다 — 날짜와 개수를
 *  섞어서 주장하지 않는다. 관측 15건 전부 일치하는 강한 패턴이지만, 그래도 게이트로 쓰기엔
 *  근거가 하나의 관행일 뿐이라 WARN에 그친다 — FATAL로 막지 않는다. */
export function checkApvFollowsObservedIncrement(apv: number, currentGitbookApv: number): Check {
  const id = "apv-increment-pattern";
  const name = "APV가 +10 관행을 따름";
  const expected = currentGitbookApv + 10;
  if (apv !== expected) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: `깃북 릴리즈 노트 헤딩 200330~200470(15개)이 전부 +10 간격이었습니다(관행, 2026-09-01 확인). 이번 값(v${apv})은 예상값(v${expected})과 다릅니다 — 의도한 건너뜀이면 무시하세요.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `+10 관행과 일치 (v${expected}).` };
}

export function checkSectionsPresent(sections: readonly ReleaseNoteSection[]): Check {
  const id = "sections-present";
  const name = "섹션 존재";
  if (sections.length === 0) {
    return { id, name, ok: false, level: "FATAL", detail: "섹션이 하나도 없습니다 — 내용 없이 빈 릴리즈 노트를 만들 수 없습니다." };
  }
  return { id, name, ok: true, level: "OK", detail: `${sections.length}개 섹션.` };
}

export function checkNoEmptySections(sections: readonly ReleaseNoteSection[]): Check {
  const id = "no-empty-sections";
  const name = "빈 섹션 없음";
  // 공백만 있는 항목은 "있는 것"으로 세지 않는다 (2026-09-03 "조용한 OK" 점검). 예전에는
  // `items.length === 0`만 봐서, `items: ["", "  "]`인 섹션이 이 검사를 통과하고 초안에는
  // `- ` / `-   ` 같은 빈 불릿이 그대로 찍혔다 — 그 상태로 전체 판정이 OK였다(실측).
  const meaningful = (s: ReleaseNoteSection) => s.items.filter((i) => i.trim() !== "");
  const empty = sections.filter((s) => meaningful(s).length === 0).map((s) => s.category);
  const partiallyBlank = sections
    .filter((s) => meaningful(s).length > 0 && meaningful(s).length < s.items.length)
    .map((s) => s.category);

  if (empty.length > 0) {
    const blankNote = partiallyBlank.length > 0 ? ` 또한 ${partiallyBlank.join(", ")} 섹션에 빈 항목이 섞여 있습니다.` : "";
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: `항목이 하나도 없는(또는 전부 공백인) 섹션: ${empty.join(", ")} — 실수로 빈 채 둔 건 아닌지 확인하세요.${blankNote}`,
    };
  }
  if (partiallyBlank.length > 0) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: `빈 항목이 섞인 섹션: ${partiallyBlank.join(", ")} — 초안에 빈 불릿("- ")이 그대로 찍힙니다.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: "모든 섹션에 항목이 있습니다." };
}

export function checkNoDuplicateCategories(sections: readonly ReleaseNoteSection[]): Check {
  const id = "no-duplicate-categories";
  const name = "섹션 이름 중복 없음";
  const seen = new Map<string, number>();
  for (const s of sections) seen.set(s.category, (seen.get(s.category) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  if (dupes.length > 0) {
    return { id, name, ok: false, level: "WARN", detail: `같은 이름의 섹션이 여러 번: ${dupes.join(", ")} — 하나로 합치는 게 나을 수 있습니다.` };
  }
  return { id, name, ok: true, level: "OK", detail: "섹션 이름 중복 없음." };
}

export function runChecks(input: ReleaseNoteInput, currentGitbookApv: number): Check[] {
  return [
    checkApvNotAlreadyPublished(input.apv, currentGitbookApv),
    checkApvFollowsObservedIncrement(input.apv, currentGitbookApv),
    checkSectionsPresent(input.sections),
    checkNoEmptySections(input.sections),
    checkNoDuplicateCategories(input.sections),
  ];
}

export function overallLevel(checks: readonly Check[]): "OK" | "WARN" | "FATAL" {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}

/**
 * 구조만 잡는 초안. 버전 헤딩(`## {APV}`)과 카테고리 헤딩(`### {category}`) 둘 다 실제 렌더링
 * HTML 직접 대조(release-guard의 `parseGitbookHead` 패턴, 2026-09-04에 200430~200470 5개
 * 릴리즈로 이 모듈도 재확인)로 검증됐다. 그 아래 항목 문구는 전부 사람이 입력값으로 준 것을
 * 그대로 옮길 뿐, 이 함수가 새로 짓지 않는다 — 콜아웃·이미지 같은 GitBook 전용 확장 문법은
 * 여전히 검증되지 않았으니(원본 마크다운 소스는 비공개라 못 봄), 그런 게 필요한 항목이면
 * 붙여넣기 전에 사람이 직접 손봐야 한다. `<h4>` 하위 카테고리(3단 구조)와 200450 같은
 * 문단형(`<p>`+`<strong>`) 회차도 이 함수는 표현하지 못한다 — 아래 트레일링 경고문은 그
 * 두 가지까지는 아직 언급하지 않는다(모듈 doc과 SKILL.md §6 참고).
 */
export function buildReleaseNoteDraft(input: ReleaseNoteInput): string {
  const lines: string[] = [`## ${input.apv}`, ""];
  for (const section of input.sections) {
    lines.push(`### ${section.category}`, "");
    for (const item of section.items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  lines.push(
    "<!-- ⚠️ 초안입니다 — 헤딩 레벨(##/###)은 실제 깃북 페이지로 검증됐지만, 콜아웃·이미지 같은 GitBook 전용 문법은 검증 안 됐습니다. -->",
    "<!-- 과거 릴리즈 노트 페이지와 비교해 형식을 맞춘 뒤 깃북 에디터에 붙여넣으세요. 게시는 항상 사람이 직접 합니다. -->",
  );
  return lines.join("\n");
}
