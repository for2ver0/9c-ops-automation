import { describe, expect, test } from "bun:test";
import { describeSkippedLines, parseJsonlLog } from "./jsonl-log";

// 이 헬퍼가 왜 필요한지는 lib/jsonl-log.ts 모듈 주석 참고 — 검증 없는 `as LogEntry` 캐스팅
// 탓에 deploy-prep이 쓰레기 줄을 스냅샷으로 받아들여 "롤백 대상 확보됨 … version=undefined"
// 를 출력하던 것이 발단이다.

interface Entry {
  readonly id: number;
}
const isEntry = (v: unknown): v is Entry =>
  !!v && typeof v === "object" && typeof (v as Record<string, unknown>).id === "number";

describe("parseJsonlLog", () => {
  test("유효한 줄만 통과시키고 건너뛴 줄 번호를 돌려준다", () => {
    const r = parseJsonlLog('{"id":1}\nnot json\n{"unrelated":true}\n{"id":2}\n', isEntry);
    expect(r.entries).toEqual([{ id: 1 }, { id: 2 }]);
    expect(r.skippedLines).toEqual([2, 3]);
  });

  test("null 줄도 건너뛴다 — 예전엔 여기서 내부 TypeError가 사용자에게 노출됐다", () => {
    const r = parseJsonlLog("null\n", isEntry);
    expect(r.entries).toEqual([]);
    expect(r.skippedLines).toEqual([1]);
  });

  test("문자열·숫자 줄도 건너뛴다", () => {
    const r = parseJsonlLog('"just a string"\n42\n', isEntry);
    expect(r.entries).toEqual([]);
    expect(r.skippedLines).toEqual([1, 2]);
  });

  test("빈 줄은 건너뛴 줄로 세지 않는다(append 과정에서 자연히 생김)", () => {
    const r = parseJsonlLog('{"id":1}\n\n\n{"id":2}\n', isEntry);
    expect(r.entries).toHaveLength(2);
    expect(r.skippedLines).toEqual([]);
  });

  test("전부 유효하면 건너뛴 줄이 없다", () => {
    expect(parseJsonlLog('{"id":1}\n{"id":2}\n', isEntry).skippedLines).toEqual([]);
  });
});

describe("describeSkippedLines", () => {
  test("건너뛴 줄이 없으면 null — 알릴 게 없다", () => {
    expect(describeSkippedLines("./x.jsonl", [])).toBeNull();
  });

  test("줄 번호와 파일 경로를 담은 문장을 만든다", () => {
    const s = describeSkippedLines("./x.jsonl", [2, 5])!;
    expect(s).toContain("./x.jsonl");
    expect(s).toContain("2줄");
    expect(s).toContain("2, 5행");
  });

  test("10줄이 넘으면 뒤는 '외 N줄'로 줄인다", () => {
    const s = describeSkippedLines("./x.jsonl", Array.from({ length: 13 }, (_, i) => i + 1))!;
    expect(s).toContain("외 3줄");
  });
});
