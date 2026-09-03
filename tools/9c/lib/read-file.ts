/**
 * read-file.ts — 파일을 읽기 전에 존재 여부를 먼저 확인하는 공용 헬퍼.
 *
 * 왜 그냥 `await Bun.file(path).text()`를 쓰면 안 되는가 (2026-09-03 실측, Bun 1.4.0 / Windows):
 * 없는 파일을 `bun run <스크립트>`에서 읽으면 **그 거부가 `.catch()`에 전달되기 전에 프로세스가
 * 먼저 끝난다.** 결과는 출력 0바이트 · exit 0 — 호출자가 에러 처리를 아무리 잘 해놔도 그
 * 핸들러 자체가 실행되지 않는다.
 *
 * 재현·판별(둘을 구분해서 확인했다):
 *   - 이벤트 루프를 살려두면(`setInterval`) 같은 읽기가 **7ms 만에 ENOENT로 정상 reject**하고
 *     `.catch`도 걸려 exit 1이 된다. 즉 promise가 "영원히 안 끝나는" 게 아니다.
 *   - 루프를 안 붙잡으면 같은 코드가 출력 없이 exit 0. → 원인은 **거부 전달 전 조기 종료**다.
 *   - `Promise.all`과는 무관하다(단독 `await`도 동일). `Promise.reject()`를 직접 넣은 최소
 *     재현은 정상적으로 catch되므로, 파일 I/O처럼 **비동기 완료가 필요한** 거부에서만 난다.
 *
 * 이 저장소에서 같은 버그가 세 번 났다:
 *   1. `qa-checklist.ts` — 커밋 969a29f에서 수정. 당시 원인을 "Promise.all의 동시 reject가
 *      삼켜진다"로 적었는데 위 재현으로 그건 아니었음이 확인됐다(수정 자체인 `.exists()`
 *      사전 체크는 유효했다).
 *   2. `arena-season-checklist.ts` — 2026-09-03 발견. `--reward-table-json ./없는파일.json`
 *      하나만 줘도 출력 0바이트 exit 0이었고, 인자를 아예 안 줬을 때보다 출력이 적었다.
 *   3. `arena-reward-table.ts` — 같은 날 발견(`--config ./없는파일`).
 *
 * 세 번 재발했으므로 개별 수정 대신 이 헬퍼로 묶는다. **새 CLI에서 파일을 읽을 땐 반드시
 * 이걸 쓸 것.**
 */

/** 파일을 텍스트로 읽는다. 없으면 명확한 에러를 던진다(위 모듈 주석의 무음 행을 피하기 위함).
 *  `label`은 사용자에게 보여줄 이름 — 보통 그 파일을 가리키는 플래그(`--config` 등). */
export async function readTextFileOrThrow(path: string, label: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`${label} 파일을 찾을 수 없습니다: ${path}`);
  }
  return file.text();
}

/** `readTextFileOrThrow` + `JSON.parse`. JSON 파싱 실패도 어느 파일인지 알 수 있게 감싼다. */
export async function readJsonFileOrThrow(path: string, label: string): Promise<unknown> {
  const text = await readTextFileOrThrow(path, label);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${label} 파일이 올바른 JSON이 아닙니다 (${path}): ${e instanceof Error ? e.message : e}`);
  }
}
