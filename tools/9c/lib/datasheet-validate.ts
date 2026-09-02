/**
 * datasheet-validate — CURRENTLY A PARTIAL BUILD covering three of the four "새로 설계할
 * 항목" the design doc (부록 A-1) lists for this skill. See
 * .claude/skills/datasheet-validate/SKILL.md for the full story; short version:
 *
 *   1. 구글 시트 단계 사전 검증 — 이 모듈이 하는 것(파일 하나 단위로).
 *   2. 시트 간 참조 ID 검증 — 미착수. lib9c 스키마별 참조 규칙을 개별로 알아야 해서
 *      스키마 매핑 작업이 선행돼야 한다.
 *   3. 회차 간 시트 diff (N 대 N-1) — **이번에 추가한 것.** 설계 문서는 "비교 기준선을
 *      lib9c 커밋/태그에서 가져올지 별도 스냅샷을 둘지 미정"(미해결 B)이라고 적어뒀는데,
 *      2026-09-01에 lib9c 공개 git 이력을 직접 조사해보니 태그(`v200220`에서 멈춤)와
 *      "latest-data" 브랜치(`v200390`에서 멈춤) 둘 다 지금 APV 범위(200450+)보다 훨씬
 *      전에 관리가 끊겼고, `development` 브랜치 커밋 메시지도 릴리즈 버전을 체계적으로
 *      남기지 않는다 — 즉 git 이력에서 N-1을 자동으로 찾아올 방법이 없다는 뜻이다.
 *      그래서 남은 선택지는 별도 스냅샷뿐이고, `--baseline-csv`로 사람이 직전 실행의
 *      CSV를 직접 넘기게 했다(release-guard `--log-file`/deploy-prep `--snapshot-log`와
 *      같은 "사람이 파일을 들고 있는" 패턴 — 새 권한이 필요 없다). diff 엔진은
 *      `qa-checklist.ts`의 `diffSheet`를 재사용한다(중복 구현 안 함).
 *   4. CSV 파싱부 신규 — 기존 Backoffice `CsvValidationService`의 결함 4건(따옴표 안
 *      쉼표 미처리, 빈 줄 제거로 인한 라인 번호 어긋남, 중복 헤더 무음 병합, quoting 없는
 *      재조립)을 재현하지 않는 RFC4180 파서 + 그 결함들이 놓쳤던 걸 잡는 구조적 검증(중복
 *      헤더, 행별 컬럼 수 불일치, 키 컬럼 공백, 행 수 급감)을 제공한다. 파서 자체는
 *      `./csv`로 옮겨졌다 — qa-checklist가 이 모듈의 parseCsv를 가져다 쓰는데, 이 모듈도
 *      qa-checklist의 diffSheet를 가져다 쓰게 되면서 생기는 순환 참조를 끊기 위해서다.
 *
 * 이 모듈은 스키마별 타입·참조 규칙을 모른다 — lib9c의 각 ISheet 구현이 컬럼을 어떻게
 * 쓰는지는 시트마다 다르고, 그 매핑을 만드는 일 자체가 큰 작업이라 이번 착수 범위 밖이다.
 * 대신 "어느 시트에나 적용되는" 구조적 결함(v200450에서 실제로 터진 3종 포함)만 잡는다.
 */
import { diffSheet, type SheetDiff } from "./qa-checklist";

export { parseCsv } from "./csv";
export type { ParsedCsv } from "./csv";
import type { ParsedCsv } from "./csv";

export type Level = "OK" | "WARN" | "FATAL";

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: Level;
  readonly detail: string;
}

// ---------------------------------------------------------------------------------------
// 구조적 검증 (순수 함수 — 유닛 테스트 대상)
// ---------------------------------------------------------------------------------------

/** 중복 헤더 검출. Backoffice `ParseCsv`가 `row[headers[j]]`로 Dictionary 키를 헤더 이름으로
 *  써서 중복 헤더의 값을 무음으로 덮어쓰던 버그(부록 A-1) — 여기서는 조용히 넘어가지 않고
 *  FATAL로 잡는다. 실측 사례: `worldboss_info.csv`의 `Vietnam` 중복(부록 A-2). */
export function checkDuplicateHeaders(headers: readonly string[]): Check {
  const id = "duplicate-headers";
  const name = "헤더 중복";
  const seen = new Map<string, number>();
  for (const h of headers) seen.set(h, (seen.get(h) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([h]) => h);
  if (dupes.length > 0) {
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `중복된 헤더: ${dupes.join(", ")} — 이대로 두면 값이 무음으로 덮어써져 컬럼 하나가 통째로 소실될 수 있습니다.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: "중복 헤더 없음." };
}

/** 행별 컬럼 수가 헤더 수와 일치하는지. 파서가 따옴표 안 쉼표를 이미 값으로 흡수했으므로,
 *  여기서 불일치가 나오면 실제 데이터 결함(열 누락/추가)이지 파싱 오탐이 아니다.
 *
 *  알려진 한계: `line`은 논리 행 인덱스로 계산한다(1개 논리 행 = 물리 파일 1줄이라는 가정).
 *  어떤 행이든 따옴표 안에 개행을 포함하면 그 이후 모든 행은 실제 물리 줄 번호보다 작게
 *  보고된다 — 파서가 물리 줄 번호를 별도로 추적하지 않기 때문. 진단이 완전히 틀리는 건
 *  아니고(그 행 근처를 찾는 데는 쓸 수 있음) 정확한 줄 번호가 필요하면 직접 세어야 한다. */
export function checkRowColumnCounts(headers: readonly string[], rows: readonly string[][]): Check {
  const id = "row-column-counts";
  const name = "행별 컬럼 수 일치";
  const mismatches: Array<{ line: number; count: number }> = [];
  rows.forEach((row, idx) => {
    if (row.length !== headers.length) {
      mismatches.push({ line: idx + 2, count: row.length }); // +2: 1-index + 헤더 행
    }
  });
  if (mismatches.length > 0) {
    const sample = mismatches
      .slice(0, 5)
      .map((m) => `${m.line}행(${m.count}칸)`)
      .join(", ");
    const more = mismatches.length > 5 ? ` 외 ${mismatches.length - 5}건` : "";
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `헤더는 ${headers.length}칸인데 컬럼 수가 다른 행: ${sample}${more}.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `모든 행이 헤더와 같은 ${headers.length}칸.` };
}

/** 지정된 키 컬럼(보통 Id)이 비어 있는 행 검출. Backoffice에 그대로 올리면 key 컬럼이 빈
 *  값으로 `ISheet.Set`에 들어가 `ArgumentException`을 내는 실패 모드(부록 A-1, v200450)를
 *  업로드 전에 미리 잡는다. keyColumn이 헤더에 없으면 스킵(WARN)이지 실패가 아니다 —
 *  시트마다 키 컬럼 이름이 다를 수 있어서 강제하지 않는다.
 *
 *  `line`은 checkRowColumnCounts와 같은 논리 행 인덱스 방식이라 같은 한계(따옴표 안 개행이
 *  있는 행 이후로는 물리 줄 번호보다 작게 보고됨)를 그대로 갖는다 — 위 주석 참고. */
export function checkKeyColumnNonEmpty(
  headers: readonly string[],
  rows: readonly string[][],
  keyColumn: string | null,
): Check {
  const id = "key-column-non-empty";
  const name = "키 컬럼 공백";
  if (keyColumn === null) {
    return { id, name, ok: true, level: "WARN", detail: "키 컬럼이 지정되지 않아 이 검사를 건너뜁니다 (--key-column으로 지정하세요)." };
  }
  const colIdx = headers.findIndex((h) => h.toLowerCase() === keyColumn.toLowerCase());
  if (colIdx === -1) {
    return { id, name, ok: false, level: "WARN", detail: `키 컬럼 "${keyColumn}"이 헤더에 없습니다 — 이 검사를 건너뜁니다.` };
  }
  const emptyLines = rows
    .map((row, idx) => ({ line: idx + 2, value: row[colIdx] }))
    .filter((r) => r.value === undefined || r.value.trim().length === 0)
    .map((r) => r.line);
  if (emptyLines.length > 0) {
    const sample = emptyLines.slice(0, 10).join(", ");
    const more = emptyLines.length > 10 ? ` 외 ${emptyLines.length - 10}건` : "";
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `키 컬럼 "${keyColumn}"이 비어 있는 행: ${sample}행${more} — 업로드 시 ArgumentException으로 이어질 수 있습니다.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `키 컬럼 "${keyColumn}" 전부 채워짐.` };
}

/**
 * 직전 기준(baseline) 행 수 대비 급감 검출. v200450에서 `SkillBuffSheet` 188행이 익스포트
 * 과정에서 통째로 유실된 실패 모드(부록 A-1)를 사후 대조로 잡는다. baseline이 없으면(첫
 * 실행) 비교 없이 정보성으로만 표시한다. 증가는 정상(패치로 항목 추가)이라 통과.
 */
export function checkRowCountAgainstBaseline(rowCount: number, baselineCount: number | null): Check {
  const id = "row-count-vs-baseline";
  const name = "행 수 급감";
  if (baselineCount === null) {
    return { id, name, ok: true, level: "OK", detail: `기준값 없음 — 현재 ${rowCount}행을 다음 실행의 기준으로 쓰세요(--baseline-rows).` };
  }
  if (rowCount < baselineCount) {
    const dropped = baselineCount - rowCount;
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `직전 ${baselineCount}행 → 현재 ${rowCount}행 (${dropped}행 감소) — SkillBuffSheet 188행 유실과 같은 패턴일 수 있습니다. 익스포트를 다시 확인하세요.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `직전 ${baselineCount}행 → 현재 ${rowCount}행 (감소 없음).` };
}

/**
 * 회차 간 시트 diff (N 대 N-1). `--baseline-csv`로 사람이 넘긴 직전 회차 CSV와 지금 CSV를
 * `qa-checklist.ts`의 `diffSheet`로 대조해 추가·삭제·변경된 행/컬럼 수를 보여준다. 항상
 * 정보성(OK)이다 — "몇 % 이상 바뀌면 이상하다" 같은 임계값은 근거 없이 지어낸 게이트가
 * 되므로 만들지 않았다(설계 문서 전반의 원칙 — 근거 없는 규칙을 판정에 쓰지 않는다). 사람이
 * 이 요약을 보고 "이번 회차에 의도한 만큼만 바뀌었는지" 스스로 판단한다. baseline이
 * 없으면(첫 실행이거나 --baseline-csv 미지정) 비교 없이 건너뛴다 — WARN이 아니다, 첫
 * 실행은 정상 상황이다.
 */
export function checkBaselineDiff(csv: ParsedCsv, baseline: ParsedCsv | null, keyColumn: string | null): Check {
  const id = "baseline-diff";
  const name = "회차 간 diff (N 대 N-1)";
  if (baseline === null) {
    return { id, name, ok: true, level: "OK", detail: "기준(직전 회차) CSV 없음 — 비교를 건너뜁니다(--baseline-csv로 지정하면 다음부터 비교됩니다)." };
  }
  if (keyColumn === null) {
    return { id, name, ok: true, level: "WARN", detail: "키 컬럼이 지정되지 않아 회차 간 diff를 건너뜁니다 (--key-column으로 지정하세요)." };
  }
  let diff: SheetDiff;
  try {
    diff = diffSheet(baseline, csv, keyColumn);
  } catch (e) {
    return { id, name, ok: false, level: "WARN", detail: `diff 계산 실패: ${e instanceof Error ? e.message : e}` };
  }
  const dupNote =
    diff.duplicateKeysBefore.length > 0 || diff.duplicateKeysAfter.length > 0
      ? ` (주의: 중복 키가 있어 diff는 마지막 값만 반영함 — 원본 확인 필요)`
      : "";
  return {
    id,
    name,
    ok: true,
    level: "OK",
    detail: `직전 회차 대비 추가 ${diff.added.length}행 / 삭제 ${diff.removed.length}행 / 변경 ${diff.changed.length}행 / 컬럼 추가 ${diff.columnChanges.added.length}개 / 컬럼 삭제 ${diff.columnChanges.removed.length}개${dupNote}`,
  };
}

export function overallLevel(checks: readonly Check[]): Level {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}

export function runStructuralChecks(
  csv: ParsedCsv,
  opts: { keyColumn: string | null; baselineRows: number | null; baselineCsv?: ParsedCsv | null },
): Check[] {
  const baselineCsv = opts.baselineCsv ?? null;
  // baselineCsv가 있으면 거기서 행 수를 자동으로 뽑아 쓴다 — 급감 검사를 위해 --baseline-rows를
  // 따로 또 계산해서 넘길 필요가 없다. 둘 다 명시적으로 주어졌으면 --baseline-rows가 우선(더
  // 명시적인 입력을 존중).
  const baselineRows = opts.baselineRows ?? (baselineCsv ? baselineCsv.rows.length : null);
  return [
    checkDuplicateHeaders(csv.headers),
    checkRowColumnCounts(csv.headers, csv.rows),
    checkKeyColumnNonEmpty(csv.headers, csv.rows, opts.keyColumn),
    checkRowCountAgainstBaseline(csv.rows.length, baselineRows),
    checkBaselineDiff(csv, baselineCsv, opts.keyColumn),
  ];
}
