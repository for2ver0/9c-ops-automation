/**
 * jsonl-log.ts — append-only JSONL 운영 로그를 **검증하면서** 읽는 공용 헬퍼.
 *
 * 왜 필요한가 (2026-09-03 "조용한 OK" 점검에서 발견):
 * `release-guard`와 `deploy-prep`은 로그를 `JSON.parse(line) as LogEntry`로 읽었다. 이건
 * 런타임 검증이 전혀 없는 캐스팅이라, **형식만 JSON이면 모양이 달라도 그대로 통과한다.**
 * 실측으로 확인한 결과:
 *
 *   - `{"unrelated":true}` 한 줄 → deploy-prep이 그걸 스냅샷으로 받아들여 체크리스트에
 *     `[x] 롤백 대상 확보됨 — 문제 발생 시 version=undefined(undefined 관측)로 되돌릴 수
 *     있습니다.`를 출력했다. **배포 사고 중에 "롤백 가능"이라고 체크된 안내를 보고 되돌리려
 *     하면 대상이 없다** — 이 저장소에서 나온 무음 실패 중 운영 위험이 가장 큰 축이다.
 *   - `"just a string"` 한 줄 → 같은 결과(그대로 통과).
 *   - `null` 한 줄 → `null is not an object (evaluating 'sorted[i].version')` 같은 내부
 *     TypeError가 사용자에게 그대로 노출됐다.
 *
 * 판정을 "깨진 줄이 하나라도 있으면 실패"로 하지 않은 이유: 이건 append-only 운영 로그라
 * 과거에 다른 포맷으로 쌓였거나 편집 중 한 줄이 상할 수 있는데, 그 한 줄 때문에 나머지
 * 정상 기록까지 못 쓰게 만들면 정작 롤백이 필요한 순간에 도구가 막힌다. 그래서 **쓸 수 없는
 * 줄은 건너뛰되 몇 줄을 건너뛰었는지 반드시 알려주고**, 판정에는 유효한 항목만 쓴다.
 */

export interface ParsedJsonlLog<T> {
  /** 모양 검증을 통과한 항목만. */
  readonly entries: T[];
  /** JSON 파싱 실패 또는 모양 불일치로 건너뛴 줄 번호(1-base). */
  readonly skippedLines: number[];
}

/**
 * JSONL 텍스트를 읽어 `isValid`를 통과한 항목만 돌려준다. 빈 줄은 건너뛴 줄로 세지 않는다
 * (append 과정에서 자연스럽게 생기는 것이라 이상 신호가 아니다).
 */
export function parseJsonlLog<T>(text: string, isValid: (v: unknown) => v is T): ParsedJsonlLog<T> {
  const entries: T[] = [];
  const skippedLines: number[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skippedLines.push(i + 1);
      return;
    }
    if (!isValid(parsed)) {
      skippedLines.push(i + 1);
      return;
    }
    entries.push(parsed);
  });
  return { entries, skippedLines };
}

/** 건너뛴 줄을 사람이 읽는 한 줄로. 없으면 null(=알릴 게 없음). */
export function describeSkippedLines(path: string, skippedLines: readonly number[]): string | null {
  if (skippedLines.length === 0) return null;
  const shown = skippedLines.slice(0, 10).join(", ");
  const more = skippedLines.length > 10 ? ` 외 ${skippedLines.length - 10}줄` : "";
  return `${path}에서 형식이 맞지 않는 ${skippedLines.length}줄을 건너뛰었습니다(${shown}행${more}) — 그 줄은 판정에 쓰이지 않았습니다.`;
}
