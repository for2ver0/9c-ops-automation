import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFileOrThrow, readTextFileOrThrow } from "./read-file";

// 이 헬퍼가 존재하는 이유는 lib/read-file.ts 모듈 주석 참고 — 없는 파일을 그냥 읽으면 읽기
// 거부가 .catch에 전달되기 전에 프로세스가 끝나 출력 0바이트 exit 0이 되기 때문이다. 그 무음
// 경로를 "명확한 에러"로 바꾸는 게 전부이므로, 테스트도 그 계약만 고정한다.

const dir = mkdtempSync(join(tmpdir(), "read-file-test-"));

describe("readTextFileOrThrow", () => {
  test("파일이 있으면 내용을 그대로 돌려준다", async () => {
    const p = join(dir, "ok.txt");
    writeFileSync(p, "hello", "utf8");
    expect(await readTextFileOrThrow(p, "--some-flag")).toBe("hello");
  });

  test("없는 파일이면 라벨과 경로가 담긴 에러를 던진다(무음으로 끝나지 않는다)", async () => {
    const p = join(dir, "missing.txt");
    await expect(readTextFileOrThrow(p, "--some-flag")).rejects.toThrow("--some-flag 파일을 찾을 수 없습니다");
  });
});

describe("readJsonFileOrThrow", () => {
  test("올바른 JSON을 파싱해 돌려준다", async () => {
    const p = join(dir, "ok.json");
    writeFileSync(p, '{"a":1}', "utf8");
    expect(await readJsonFileOrThrow(p, "--config")).toEqual({ a: 1 });
  });

  test("없는 파일이면 '찾을 수 없습니다' 에러", async () => {
    await expect(readJsonFileOrThrow(join(dir, "nope.json"), "--config")).rejects.toThrow("찾을 수 없습니다");
  });

  test("JSON이 깨져 있으면 어느 파일인지 알 수 있는 에러", async () => {
    const p = join(dir, "broken.json");
    writeFileSync(p, "{not json", "utf8");
    await expect(readJsonFileOrThrow(p, "--config")).rejects.toThrow("올바른 JSON이 아닙니다");
  });
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
