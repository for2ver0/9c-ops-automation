/**
 * datasheet-to-csv.ts — 구글 시트를 lib9c `Lib9c/TableCSV/<시트명>.csv`에 커밋해도 되는 형태로
 * 만들기 전, 마지막 안전장치와 초안 문구를 담당하는 순수 함수들이다. 실제 diff는
 * `qa-checklist.ts`의 `diffSheet`/`buildQaChecklist`를 그대로 재사용한다(중복 구현 안 함) —
 * 이 파일은 그 위에 두 가지만 더한다.
 *
 * 1. **구조 검증** — `datasheet-validate.ts`가 export하는 검사 함수 12개 중 7개만 쓴다.
 *    뺀 5개는 두 갈래다:
 *    - gviz 전용 3개(`checkNotFullyQuoted`·`checkGvizHeadersParam`·
 *      `checkRequestedTabIsNotDefault`) — 이 도구는 gviz가 아니라 Sheets API로 읽으므로 그
 *      함정 자체가 없고, 셋 다 원문(rawText)/URL이 null이면 사실과 다른 WARN을 낸다
 *      (`checkNotFullyQuoted`가 특히 그렇다 — "확인 못 함"을 WARN으로 표시하는데, 우리는
 *      애초에 확인할 필요가 없는 경우다).
 *    - baseline 비교 2개(`checkRowCountAgainstBaseline`·`checkBaselineDiff`) — 이건
 *      datasheet-validate의 "회차 N 대 N-1" 비교용인데, 이 도구는 그 자리에 lib9c의 현재
 *      값을 `diffSheet`로 따로 대조한다(아래 CLI). 같은 종류의 비교를 두 번 하지 않는다.
 *    나머지 순수 구조 검사(헤더 중복·빈 헤더·행별 칸 수·lib9c 스킵 행·데이터 존재·키 공백·
 *    키 중복)는 형식과 무관하게 항상 유효해서 그대로 쓴다.
 * 2. **커밋 메시지 초안** — `planetarium/lib9c` `Lib9c/TableCSV/` 실제 커밋 이력(2026-09-04
 *    조사)에서 관찰된 그대로: `Update <시트명>.csv from Google Sheets`. 새로 짓지 않는다.
 */
import {
  checkDuplicateHeaders,
  checkDuplicateKeyValues,
  checkEmptyHeaders,
  checkHasDataRows,
  checkKeyColumnNonEmpty,
  checkLib9cSkippedRows,
  checkRowColumnCounts,
  dataRows,
  type Check,
  type Level,
} from "./datasheet-validate";
import { serializeCsv, type ParsedCsv } from "./csv";

/** Sheets API로 읽은 CSV(gviz 아님 — `fullyQuoted`는 항상 false)에 적용 가능한 구조 검사만
 *  골라 돌린다. */
export function runReadinessChecks(csv: ParsedCsv, keyColumn: string): Check[] {
  const data = dataRows(csv.rows);
  return [
    checkDuplicateHeaders(csv.headers),
    checkEmptyHeaders(csv.headers, csv.rows),
    checkRowColumnCounts(csv.headers, csv.rows),
    checkLib9cSkippedRows(csv.rows),
    checkHasDataRows(data.length),
    checkKeyColumnNonEmpty(csv.headers, csv.rows, keyColumn),
    checkDuplicateKeyValues(csv.headers, data, keyColumn),
  ];
}

export function assessReadiness(checks: readonly Check[]): Level {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}

/**
 * `serializeCsv`(항상 LF, 트레일링 개행 없음)의 출력을, lib9c에 이미 있는 같은 파일의 실제
 * 줄바꿈 관례에 맞춰 다시 입힌다. 실측(2026-09-04, `Lib9c/TableCSV/*.csv` 여러 개 직접 비교)
 * 결과 **파일마다 관례가 다르다** — `SkillSheet.csv`/`WorldBossActionPatternSheet.csv`는
 * LF만·트레일링 개행 없음, `CollectionSheet.csv`/`WorldSheet.csv`/`EventScheduleSheet.csv`는
 * CRLF에 트레일링 개행 있음. 파일 안에서는 일관됨(한 파일이 CRLF/LF를 섞어 쓰지 않음)을
 * 확인했다. 이 관례를 안 맞추면 값이 하나도 안 바뀐 시트도 git diff에서 파일 전체가 바뀐 것처럼
 * 보인다 — 실제 변경과 줄바꿈 스타일 차이가 뒤섞여 사람이 뭐가 진짜 변경인지 못 알아본다.
 * lib9c에 아직 없는 신규 시트(`referenceRawText === null`)는 맞출 대상이 없으니 기본값(LF,
 * 트레일링 개행 없음)을 그대로 쓴다.
 */
export function serializeMatchingStyle(csv: ParsedCsv, referenceRawText: string | null): string {
  const base = serializeCsv(csv);
  if (referenceRawText === null) return base;
  const useCrlf = referenceRawText.includes("\r\n");
  const hasTrailingNewline = referenceRawText.endsWith("\n");
  const withLineEnding = useCrlf ? base.replace(/\n/g, "\r\n") : base;
  return hasTrailingNewline ? withLineEnding + (useCrlf ? "\r\n" : "\n") : withLineEnding;
}

/** 관찰된 실제 lib9c 커밋 관례 그대로 — 새로 짓지 않는다. */
export function buildDraftCommitMessage(sheetName: string): string {
  return `Update ${sheetName}.csv from Google Sheets`;
}

/** 사람이 자기 환경에서 직접 실행할 git 명령 제안. 이 도구는 이 문자열을 절대 실행하지
 *  않는다 — 텍스트로만 보여준다(`tools/9c/` 전체에 git 실행 코드가 없다는 기존 관례를 유지). */
export function buildSuggestedGitCommands(
  sheetName: string,
  outPath: string,
  branchName: string,
  commitMessage: string,
): string[] {
  return [
    `git checkout -b ${branchName}`,
    `cp ${outPath} Lib9c/TableCSV/${sheetName}.csv`,
    `git add Lib9c/TableCSV/${sheetName}.csv`,
    `git commit -m "${commitMessage}"`,
    `git push -u <fork-remote> ${branchName}`,
  ];
}
