/**
 * csv.ts — RFC4180 CSV 파서. `datasheet-validate.ts`와 `qa-checklist.ts`가 공유하는 최소
 * 단위 모듈이다.
 *
 * 원래 이 파서는 `datasheet-validate.ts`에 있었고 `qa-checklist.ts`가 거기서 가져다 썼다.
 * datasheet-validate에 "회차 간 diff" 기능을 추가하면서 이번엔 반대로 datasheet-validate가
 * qa-checklist의 `diffSheet`를 가져다 써야 하는 상황이 생겼는데, 그러면 두 모듈이 서로를
 * import하는 순환 참조가 된다. 파서를 이 파일로 뽑아내 양쪽 다 여기서만 가져오게 해서
 * 순환을 끊었다 — `datasheet-validate.ts`/`qa-checklist.ts`는 각각 `parseCsv`/`ParsedCsv`를
 * 그대로 re-export하므로 기존 소비자(CLI, 테스트)는 import 경로를 바꿀 필요 없다.
 */

export interface ParsedCsv {
  readonly headers: string[];
  /** 각 행은 헤더와 같은 순서의 문자열 배열. 원본 줄바꿈(따옴표 안)은 보존됨. */
  readonly rows: string[][];
}

/**
 * RFC4180 방식 CSV 파서. Backoffice `CsvValidationService`의 결함(따옴표 안 쉼표
 * 미처리·빈 줄 제거로 인한 라인 번호 어긋남·중복 헤더 무음 병합·quoting 없는 재조립,
 * 설계 문서 부록 A-1)을 재현하지 않는다:
 *   - 따옴표로 감싼 필드 안의 쉼표·줄바꿈을 값의 일부로 취급한다.
 *   - `""`(이스케이프된 따옴표)를 `"` 한 글자로 되돌린다.
 *   - 빈 줄을 파싱 전에 미리 제거하지 않는다 — 원본 줄 번호가 그대로 유지된다.
 * 헤더 중복은 여기서 병합하지 않고 그대로 배열에 남긴다.
 */
/** 필드 하나를 RFC4180 최소 인용으로 직렬화한다 — 콤마·따옴표·개행이 있을 때만 감싼다. */
function serializeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * `ParsedCsv`를 CSV 텍스트로 직렬화한다(`parseCsv`의 역함수). `datasheet-to-csv`가 lib9c
 * `Lib9c/TableCSV/*.csv`에 그대로 커밋해도 되는 파일을 만들 때 쓴다 — 실측 결과 그 파일들은
 * 전부 LF만 쓰고 따옴표를 전혀 안 쓰므로(콤마·개행이 필요한 값이 없어서), 항상 인용하는 방식
 * 대신 RFC4180 최소 인용으로 직렬화해야 lib9c 원본과 같은 모양이 나온다. 줄바꿈은 항상 LF로
 * 강제한다(입력 문자열에 CRLF가 섞여 있어도 출력엔 CR을 남기지 않는다 — Windows 개발 환경에서
 * 실행해도 lib9c의 LF 관례를 깨지 않기 위해서).
 *
 * **트레일링 개행 없음** — `planetarium/lib9c`의 `Lib9c/TableCSV/SkillSheet.csv`를 실제로
 * 받아 확인(2026-09-04): 마지막 데이터 행 뒤에 개행이 없다. 여기서 개행을 붙이면 diff 계산엔
 * 영향 없지만(값 비교는 파싱된 행 단위라 무관), 사람이 최종 파일을 `git diff`로 확인할 때
 * "파일 끝에 개행 없음" 표시가 매번 걸려 실제 변경과 섞여 보인다.
 */
export function serializeCsv(csv: ParsedCsv): string {
  const lines = [csv.headers, ...csv.rows].map((row) => row.map(serializeField).join(","));
  return lines.map((l) => l.replace(/\r\n/g, "\n").replace(/\r/g, "\n")).join("\n");
}

export function parseCsv(text: string): ParsedCsv {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawRows = tokenizeCsvRows(normalized);
  if (rawRows.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = rawRows;
  return { headers, rows };
}

function tokenizeCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let sawAnyChar = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (sawAnyChar && (field.length > 0 || row.length > 0)) {
    endRow();
  }
  // 파일 끝의 완전히 빈 줄(트레일링 개행)로 생긴 [""] 한 칸짜리 행은 실질적으로 빈 줄이므로 버린다.
  // 끝에서부터 연속된 빈 줄을 전부 제거한다 — 트레일링 빈 줄이 2개 이상이면 하나만 지울 경우
  // 유령 행이 남아 checkRowColumnCounts 등에서 오탐 FATAL을 낸다. 파일 중간의 빈 줄은 건드리지
  // 않는다 — 그걸 지우면 그 뒤 모든 행의 원본 줄 번호가 어긋난다(Backoffice CsvValidationService의
  // 결함, 설계 문서 부록 A-1과 동일한 실패 모드).
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last !== undefined && last.length === 1 && last[0] === "") {
      rows.pop();
    } else {
      break;
    }
  }
  return rows;
}
