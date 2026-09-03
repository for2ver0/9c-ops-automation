import { describe, expect, test } from "bun:test";
import {
  parseCsv,
  checkDuplicateHeaders,
  checkRowColumnCounts,
  checkKeyColumnNonEmpty,
  checkHasDataRows,
  checkDuplicateKeyValues,
  checkRequestedTabIsNotDefault,
  checkEmptyHeaders,
  checkGvizHeadersParam,
  isAnnotationRow,
  dataRows,
  isFullyQuotedCsv,
  checkNotFullyQuoted,
  checkLib9cSkippedRows,
  withGvizHeaders,
  checkRowCountAgainstBaseline,
  checkBaselineDiff,
  overallLevel,
  runStructuralChecks,
} from "./datasheet-validate";

describe("parseCsv", () => {
  test("splits a simple CSV into headers and rows", () => {
    const csv = parseCsv("Id,Name,Value\n1,Sword,10\n2,Shield,20\n");
    expect(csv.headers).toEqual(["Id", "Name", "Value"]);
    expect(csv.rows).toEqual([
      ["1", "Sword", "10"],
      ["2", "Shield", "20"],
    ]);
  });

  test("treats commas inside quoted fields as part of the value, not a delimiter", () => {
    // Backoffice's ValidateBasicCsvFormat did lines[i].Split(',') and false-flagged rows like
    // this as a column-count mismatch (부록 A-1, WorldBossActionPatternSheet.csv-like case).
    const csv = parseCsv('Id,Pattern,Note\n1,"1,2,3","boss, phase 1"\n');
    expect(csv.headers).toEqual(["Id", "Pattern", "Note"]);
    expect(csv.rows).toEqual([["1", "1,2,3", "boss, phase 1"]]);
  });

  test("unescapes doubled quotes inside a quoted field", () => {
    const csv = parseCsv('Id,Note\n1,"say ""hi"""\n');
    expect(csv.rows).toEqual([["1", 'say "hi"']]);
  });

  test("preserves embedded newlines inside quoted fields", () => {
    const csv = parseCsv('Id,Note\n1,"line1\nline2"\n2,plain\n');
    expect(csv.rows).toEqual([
      ["1", "line1\nline2"],
      ["2", "plain"],
    ]);
  });

  test("does not silently drop blank lines before parsing (no line-number drift)", () => {
    // Backoffice's ParseCsv used RemoveEmptyEntries on the raw lines first, which shifted
    // every subsequent error's reported line number away from the real file (부록 A-1).
    // A trailing newline alone should not manufacture a phantom row.
    const csv = parseCsv("Id,Name\n1,A\n2,B\n");
    expect(csv.rows).toHaveLength(2);
  });

  test("preserves a blank line in the middle of the file as its own row (no line-number drift)", () => {
    // Regression: an earlier version dropped ANY row shaped like a blank line, not just a
    // trailing phantom one, which shifted every row after the blank line up by one and made
    // checkRowColumnCounts/checkKeyColumnNonEmpty report the wrong physical line number.
    const csv = parseCsv("Id,Name\n1,A\n\n2,B\n");
    expect(csv.rows).toEqual([["1", "A"], [""], ["2", "B"]]);
  });

  test("still drops a single trailing blank line (phantom row from trailing newline)", () => {
    const csv = parseCsv("Id,Name\n1,A\n2,B\n\n");
    expect(csv.rows).toEqual([["1", "A"], ["2", "B"]]);
  });

  test("drops all trailing blank lines, not just the last one", () => {
    // Regression: a single unconditional pop() left a phantom [""] row behind whenever the
    // file ended with 2+ blank lines, which then false-flagged as a column-count mismatch.
    const csv = parseCsv("Id,Name\n1,A\n2,B\n\n\n");
    expect(csv.rows).toEqual([["1", "A"], ["2", "B"]]);
  });

  test("returns empty headers/rows for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("checkDuplicateHeaders", () => {
  test("OK when all headers are unique", () => {
    expect(checkDuplicateHeaders(["Id", "Name", "Value"]).level).toBe("OK");
  });

  test("FATAL when a header repeats (worldboss_info.csv Vietnam-duplicate pattern)", () => {
    const result = checkDuplicateHeaders(["Key", "Korean", "Vietnam", "Japanese", "Vietnam"]);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("Vietnam");
  });
});

describe("checkRowColumnCounts", () => {
  const headers = ["Id", "Name", "Value"];

  test("OK when every row matches the header width", () => {
    const rows = [
      ["1", "A", "10"],
      ["2", "B", "20"],
    ];
    expect(checkRowColumnCounts(headers, rows).level).toBe("OK");
  });

  test("FATAL when a row has fewer or more columns than the header", () => {
    const rows = [
      ["1", "A", "10"],
      ["2", "B"], // missing a column
      ["3", "C", "30", "extra"], // extra column
    ];
    const result = checkRowColumnCounts(headers, rows);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("3행");
    expect(result.detail).toContain("4행");
  });

  test("known limitation: reported line drifts below the physical file line after an embedded-newline row", () => {
    // parseCsv preserves embedded newlines inside quoted fields (correctly), but this check
    // numbers rows by logical index, not physical file line. A quoted multi-line field before
    // the mismatch shifts every subsequent report's line number down from the real one.
    const csv = parseCsv('Id,Note,Value\n1,"multi\nline note",10\n2,20\n');
    // "2,20" is physically the 4th file line (header + 2 physical lines for row 1 + this line),
    // but is logical row index 1 -> reported as line 3.
    const result = checkRowColumnCounts(csv.headers, csv.rows);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("3행");
  });
});

// checkEmptyHeaders에 걸러낸 행만 넘기면, lib9c가 건너뛸 행에 있는 이물질이 "데이터도 전부
// 비어 있음" WARN으로 내려앉아 사라진다. 실측 사례: EventScheduleSheet[Heimdall] 15행
// 14번째 칸의 오타 " q" — 그 시트에서 유일하게 실재하는 결함. 이 검사만 전체 행을 보는 이유.
describe("checkEmptyHeaders — lib9c 스킵 행의 이물질도 잡는다", () => {
  test("스킵될 행(첫 칸 공백)에만 값이 있어도 FATAL이고 줄 번호를 알려준다", () => {
    const headers = ["id", "name", ""];
    const rows = [
      ["1", "slime", ""],
      ["", "", " q"], // 파일 3행 — lib9c는 건너뛰지만 표 밖에 입력된 이물질이다
    ];
    const result = checkEmptyHeaders(headers, rows);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("3번째 칸");
    expect(result.detail).toContain("3행");
  });

  test("무명 열이 정말 전부 비어 있으면 WARN에 그친다", () => {
    expect(checkEmptyHeaders(["id", ""], [["1", ""]]).level).toBe("WARN");
  });
});

describe("checkKeyColumnNonEmpty", () => {
  const headers = ["Id", "Name"];

  test("OK when the key column is filled for every row", () => {
    const rows = [
      ["1", "A"],
      ["2", "B"],
    ];
    expect(checkKeyColumnNonEmpty(headers, rows, "Id").level).toBe("OK");
  });

  test("FATAL when the key column is blank on some rows (ArgumentException precursor, v200450)", () => {
    const rows = [
      ["1", "A"],
      ["", "B"],
      ["  ", "C"],
    ];
    const result = checkKeyColumnNonEmpty(headers, rows, "Id");
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("3, 4행");
  });

  test("WARN (not FATAL) when the key column name isn't in the header at all", () => {
    const result = checkKeyColumnNonEmpty(headers, [["1", "A"]], "SkuId");
    expect(result.level).toBe("WARN");
  });

  test("WARN (not FATAL) when no key column is specified", () => {
    const result = checkKeyColumnNonEmpty(headers, [["1", "A"]], null);
    expect(result.level).toBe("WARN");
  });

  test("is case-insensitive when matching the key column name", () => {
    expect(checkKeyColumnNonEmpty(["id", "Name"], [["1", "A"]], "Id").level).toBe("OK");
  });

  // 걸러낸 배열을 넘기면 주석 행 개수만큼 줄 번호가 앞으로 밀려, 파일 5행이 비었는데
  // "3행"(= 주석 행)이라고 보고된다. 이 함수는 걸러내지 않은 전체 행을 받아 내부에서
  // 건너뛰어야 한다.
  test("주석 행이 앞에 있어도 줄 번호는 원본 파일 기준으로 보고한다", () => {
    const rows = [
      ["_주석1", "x"],
      ["_주석2", "y"],
      ["1", "slime"],
      ["", "잃어버린 id"],
    ];
    const result = checkKeyColumnNonEmpty(headers, rows, "Id");
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("5행"); // 헤더1 + 주석2 + 정상1 = 파일 5행
  });

  // 주석 행 자체는(첫 칸이 `_`) 키가 "비어 있지 않지만" lib9c가 로드하지 않으므로, 반대로
  // 첫 칸이 빈 행은 따옴표 없는 CSV에서는 여전히 FATAL이어야 한다 — v200450 실패 모드.
  test("gviz(전부 따옴표) 입력에서는 첫 칸이 빈 행을 FATAL로 올리지 않는다", () => {
    const rows = [
      ["1", "slime"],
      ["", ""],
    ];
    expect(checkKeyColumnNonEmpty(headers, rows, "Id", { fullyQuoted: true }).level).toBe("OK");
    expect(checkKeyColumnNonEmpty(headers, rows, "Id").level).toBe("FATAL");
  });
});

describe("checkRowCountAgainstBaseline", () => {
  test("OK (informational) when there is no baseline yet", () => {
    const result = checkRowCountAgainstBaseline(23, null);
    expect(result.level).toBe("OK");
  });

  test("OK when row count holds steady or grows", () => {
    expect(checkRowCountAgainstBaseline(23, 23).level).toBe("OK");
    expect(checkRowCountAgainstBaseline(25, 23).level).toBe("OK");
  });

  test("FATAL when row count drops (SkillBuffSheet 188-row-loss pattern, v200450)", () => {
    const result = checkRowCountAgainstBaseline(0, 188);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("188");
  });
});

describe("checkBaselineDiff", () => {
  test("OK (informational), skipped when there is no baseline CSV yet", () => {
    const csv = parseCsv("Id,Name\n1,Sword\n");
    const result = checkBaselineDiff(csv, null, "Id");
    expect(result.level).toBe("OK");
    expect(result.detail).toContain("건너뜁니다");
  });

  test("WARN (not blocking) when no key column is given, even with a baseline present", () => {
    const baseline = parseCsv("Id,Name\n1,Sword\n");
    const csv = parseCsv("Id,Name\n1,Sword\n2,Shield\n");
    const result = checkBaselineDiff(csv, baseline, null);
    expect(result.level).toBe("WARN");
  });

  test("OK and reports counts when rows/columns changed — never escalates to FATAL by itself", () => {
    const baseline = parseCsv("Id,Damage\n1,100\n2,50\n");
    const csv = parseCsv("Id,Damage\n1,120\n3,30\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.level).toBe("OK");
    expect(result.detail).toContain("추가 1행");
    expect(result.detail).toContain("삭제 1행");
    expect(result.detail).toContain("변경 1행");
  });

  test("does not invent a 'too much changed' threshold — even a near-total rewrite stays OK", () => {
    const baseline = parseCsv("Id,Damage\n1,1\n2,1\n3,1\n4,1\n5,1\n");
    const csv = parseCsv("Id,Damage\n1,9\n2,9\n3,9\n4,9\n5,9\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.level).toBe("OK");
    expect(result.detail).toContain("변경 5행");
  });

  test("flags duplicate keys in the note rather than silently trusting the diff", () => {
    const baseline = parseCsv("Id,Damage\n1,100\n1,200\n");
    const csv = parseCsv("Id,Damage\n1,100\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.detail).toContain("중복 키");
  });

  test("degrades to WARN (not a crash) when the key column is missing from one file", () => {
    const baseline = parseCsv("Uid,Damage\n1,100\n");
    const csv = parseCsv("Id,Damage\n1,100\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.level).toBe("WARN");
    expect(result.ok).toBe(false);
  });
});

describe("overallLevel", () => {
  test("FATAL wins over WARN and OK", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }, { id: "b", name: "b", ok: false, level: "FATAL", detail: "" }])).toBe(
      "FATAL",
    );
  });

  test("WARN wins over OK when there's no FATAL", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }, { id: "b", name: "b", ok: false, level: "WARN", detail: "" }])).toBe(
      "WARN",
    );
  });

  test("OK when everything passes", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }])).toBe("OK");
  });
});

describe("runStructuralChecks — v200450 regression scenarios end-to-end", () => {
  // rawText를 넘겨야 전체 OK가 된다 — 안 넘기면 `csv-quoting`이 "확인하지 못했습니다" WARN을
  // 낸다(미실행을 OK로 위장하지 않기 위한 의도된 동작).
  test("clean sheet passes every structural check", () => {
    const raw = "Id,Name,Value\n1,Sword,10\n2,Shield,20\n";
    const csv = parseCsv(raw);
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: 2, rawText: raw });
    expect(overallLevel(checks)).toBe("OK");
  });

  test("corrupted header row (duplicate header) is caught", () => {
    const csv = parseCsv("Id,Value,Value\n1,10,11\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null });
    expect(overallLevel(checks)).toBe("FATAL");
  });

  test("emptied key column is caught", () => {
    const csv = parseCsv("Id,Name\n,Sword\n2,Shield\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null });
    expect(overallLevel(checks)).toBe("FATAL");
  });

  test("dropped rows vs. baseline are caught even though the CSV itself is well-formed", () => {
    const csv = parseCsv("Id,Name\n1,Sword\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: 188 });
    expect(overallLevel(checks)).toBe("FATAL");
  });

  test("baselineCsv alone (no --baseline-rows) is enough to catch a row-count drop", () => {
    const baseline = parseCsv("Id,Name\n1,A\n2,B\n3,C\n");
    const csv = parseCsv("Id,Name\n1,A\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null, baselineCsv: baseline });
    expect(overallLevel(checks)).toBe("FATAL");
    expect(checks.find((c) => c.id === "row-count-vs-baseline")?.detail).toContain("직전 3행");
  });

  test("explicit baselineRows takes precedence over baselineCsv's row count when both given", () => {
    const baseline = parseCsv("Id,Name\n1,A\n2,B\n3,C\n"); // 3 rows
    const csv = parseCsv("Id,Name\n1,A\n2,B\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: 1, baselineCsv: baseline });
    // baselineRows=1 explicitly wins, so 2 rows now vs baseline 1 should be a non-drop (OK)
    expect(checks.find((c) => c.id === "row-count-vs-baseline")?.level).toBe("OK");
  });

  test("baselineCsv also feeds the row/column diff check", () => {
    const baseline = parseCsv("Id,Name\n1,A\n2,B\n");
    const csv = parseCsv("Id,Name\n1,A\n2,B\n3,C\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null, baselineCsv: baseline });
    const diffCheck = checks.find((c) => c.id === "baseline-diff");
    expect(diffCheck?.detail).toContain("추가 1행");
  });
});

// --- 2026-09-03 회귀: "조용한 OK" 점검에서 나온 결함 ①②③ --------------------------------
// 셋 다 기존 검사 전부를 통과해 exit 0으로 끝나던 자리다.

describe("checkHasDataRows", () => {
  test("헤더만 있고 0행이면 FATAL — 익스포트 실패의 전형", () => {
    const c = checkHasDataRows(0);
    expect(c.level).toBe("FATAL");
    expect(c.detail).toContain("익스포트");
  });

  test("행이 있으면 OK", () => {
    expect(checkHasDataRows(140).level).toBe("OK");
  });

  test("0행 CSV는 이제 runStructuralChecks 전체가 FATAL", () => {
    const csv = parseCsv("Id,Name\n");
    expect(overallLevel(runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null }))).toBe("FATAL");
  });
});

describe("checkDuplicateKeyValues", () => {
  const headers = ["Id", "Name"];

  // 2026-09-03 lib9c 실측으로 등급 정정: 처음엔 "무음 덮어쓰기"라 보고 FATAL로 만들었는데,
  // 원본(`Sheet.cs`)을 읽어보니 기본 AddRow는 IDictionary.Add라 중복 시 ArgumentException을
  // 던지고(덮어쓰기 아님), 무엇보다 AddRow를 오버라이드하는 27개 시트 중 25개가 "같은 id의
  // 여러 행을 한 항목으로 합치는" 병합형이다(ArenaSheet·SkillBuffSheet·
  // EventDungeonStageWaveSheet 등). 그 시트들에선 중복 Id가 정상 형식이라 FATAL로 단정하면
  // 정상 운영 시트를 오탐한다.
  test("Id 값이 중복되면 WARN — 병합형 시트(lib9c 25종)에선 정상이라 FATAL로 단정 못 함", () => {
    const rows = [["1", "A"], ["1", "A dup"], ["2", "B"]];
    const c = checkDuplicateKeyValues(headers, rows, "Id");
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain('"1"(2회)');
    expect(c.detail).toContain("병합형");
  });

  test("전부 고유하면 OK", () => {
    expect(checkDuplicateKeyValues(headers, [["1", "A"], ["2", "B"]], "Id").level).toBe("OK");
  });

  test("빈 키 값은 여기서 세지 않는다 — checkKeyColumnNonEmpty의 몫(이중 보고 방지)", () => {
    const rows = [["", "A"], ["", "B"], ["1", "C"]];
    expect(checkDuplicateKeyValues(headers, rows, "Id").level).toBe("OK");
    expect(checkKeyColumnNonEmpty(headers, rows, "Id").level).toBe("FATAL");
  });

  test("키 컬럼 미지정/헤더에 없으면 건너뛰고 WARN", () => {
    expect(checkDuplicateKeyValues(headers, [], null).level).toBe("WARN");
    expect(checkDuplicateKeyValues(headers, [], "NoSuch").level).toBe("WARN");
  });
});

describe("checkRequestedTabIsNotDefault", () => {
  // 구글 gviz는 없는 탭 이름에 404가 아니라 기본(첫) 탭을 200으로 돌려준다 — 2026-09-03에
  // 실제 공개 시트로 확인(탭 미지정/없는 탭 A/없는 탭 B의 응답 md5가 동일).
  test("요청한 탭 응답이 기본 탭 응답과 같으면 WARN — 탭 이름 오타 의심", () => {
    const c = checkRequestedTabIsNotDefault("Id,Name\n1,A\n", "Id,Name\n1,A\n");
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("오타");
  });

  test("내용이 다르면 OK — 요청한 탭이 실재함", () => {
    expect(checkRequestedTabIsNotDefault("Id\n1\n", "Other\n9\n").level).toBe("OK");
  });

  test("로컬 파일이거나 sheet= 없는 URL이면 해당 없음(OK)", () => {
    expect(checkRequestedTabIsNotDefault(null, null).level).toBe("OK");
  });

  test("기본 탭 응답을 못 받으면 WARN — 대조 못 했다고 알린다", () => {
    expect(checkRequestedTabIsNotDefault("Id\n1\n", null).level).toBe("WARN");
  });
});

describe("checkEmptyHeaders / 빈 헤더와 이름 있는 중복의 분리", () => {
  // 실측(2026-09-03): 실제 밸런스 시트 MaterialItemSheet는 26칸 중 21칸이 빈 헤더이고
  // 330행 전부 비어 있다. 분리 전에는 이게 "중복 헤더" FATAL로 잡혀, 정상 시트가 매번
  // FATAL로 떴다(진짜 FATAL을 무시하게 만드는 오탐).
  test("빈 헤더 열이 전부 빈 값이면 WARN — export 아티팩트", () => {
    const c = checkEmptyHeaders(["Id", "", "", ""], [["1", "", "", ""]]);
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("3개");
  });

  test("빈 헤더 열에 데이터가 있으면 FATAL — 업로드 시 값이 뭉개짐", () => {
    const c = checkEmptyHeaders(["Id", "", ""], [["1", "값있음", ""]]);
    expect(c.level).toBe("FATAL");
  });

  test("빈 헤더가 없으면 OK", () => {
    expect(checkEmptyHeaders(["Id", "Name"], [["1", "A"]]).level).toBe("OK");
  });

  test("빈 헤더 여러 개는 더 이상 '헤더 중복' FATAL로 세지 않는다", () => {
    expect(checkDuplicateHeaders(["Id", "", "", ""]).level).toBe("OK");
  });

  test("이름 있는 중복은 여전히 FATAL — worldboss_info.csv의 Vietnam 중복 같은 진짜 사고", () => {
    expect(checkDuplicateHeaders(["Id", "Vietnam", "Vietnam"]).level).toBe("FATAL");
  });

  test("빈 열만 있는 정상 시트는 전체가 WARN에서 멈춘다(FATAL 아님)", () => {
    const csv = parseCsv('Id,Name,,\n1,A,,\n2,B,,\n');
    expect(overallLevel(runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null }))).toBe("WARN");
  });
});

describe("checkGvizHeadersParam", () => {
  // 실측(2026-09-03): 실제 밸런스 시트 CollectionSheet를
  //   ...&sheet=CollectionSheet          → 13행 (헤더가 "id 1 2 3 …"로 접힘, 882행 유실)
  //   ...&sheet=CollectionSheet&headers=1 → 895행 (정상)
  // SKILL.md/README가 안내하던 URL 패턴에 headers=1이 빠져 있어 생긴 사고 경로다.
  const gviz = "https://docs.google.com/spreadsheets/d/ABC/gviz/tq?tqx=out:csv&sheet=CollectionSheet";

  test("gviz URL에 headers=가 없으면 WARN — 대량 행 유실 경로", () => {
    const c = checkGvizHeadersParam(gviz);
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("headers=1");
  });

  test("headers=1이 있으면 OK", () => {
    expect(checkGvizHeadersParam(`${gviz}&headers=1`).level).toBe("OK");
  });

  test("로컬 파일(null)이면 해당 없음", () => {
    expect(checkGvizHeadersParam(null).level).toBe("OK");
  });

  test("gviz가 아닌 URL이면 해당 없음", () => {
    expect(checkGvizHeadersParam("https://example.com/data.csv").level).toBe("OK");
  });
});

describe("withGvizHeaders", () => {
  const gviz = "https://docs.google.com/spreadsheets/d/ID/gviz/tq?tqx=out:csv&sheet=CollectionSheet";

  test("gviz URL에 headers가 없으면 headers=1을 붙인다", () => {
    const r = withGvizHeaders(gviz);
    expect(r.added).toBe(true);
    expect(new URL(r.url).searchParams.get("headers")).toBe("1");
  });

  test("sheet 등 기존 파라미터는 보존한다", () => {
    const params = new URL(withGvizHeaders(gviz).url).searchParams;
    expect(params.get("sheet")).toBe("CollectionSheet");
    expect(params.get("tqx")).toBe("out:csv");
  });

  test("이미 headers가 있으면 값을 덮어쓰지 않는다", () => {
    const r = withGvizHeaders(`${gviz}&headers=2`);
    expect(r.added).toBe(false);
    expect(new URL(r.url).searchParams.get("headers")).toBe("2");
  });

  // 값이 비었거나 숫자가 아니면 구글이 무시하고 헤더 행 수를 추측한다 — 실측으로 확인:
  // "&headers=" 로 요청하면 895행짜리 CollectionSheet가 13행이 된다. 그래서 실수로 보고 덮는다.
  test("headers 값이 비어 있으면 1로 덮어쓴다", () => {
    const r = withGvizHeaders(`${gviz}&headers=`);
    expect(r.added).toBe(true);
    expect(new URL(r.url).searchParams.get("headers")).toBe("1");
  });

  test("headers 값이 숫자가 아니면 1로 덮어쓴다", () => {
    const r = withGvizHeaders(`${gviz}&headers=yes`);
    expect(r.added).toBe(true);
    expect(new URL(r.url).searchParams.get("headers")).toBe("1");
  });

  test("headers=0처럼 유효한 숫자는 그대로 존중한다", () => {
    const r = withGvizHeaders(`${gviz}&headers=0`);
    expect(r.added).toBe(false);
    expect(new URL(r.url).searchParams.get("headers")).toBe("0");
  });

  test("gviz가 아닌 URL은 그대로 둔다", () => {
    const r = withGvizHeaders("https://example.com/data.csv");
    expect(r.added).toBe(false);
    expect(r.url).toBe("https://example.com/data.csv");
  });

  test("URL로 파싱되지 않으면 그대로 둔다", () => {
    const r = withGvizHeaders("not a url");
    expect(r.added).toBe(false);
    expect(r.url).toBe("not a url");
  });
});

describe("checkGvizHeadersParam — 자동 보충", () => {
  const gviz = "https://docs.google.com/spreadsheets/d/ID/gviz/tq?tqx=out:csv&sheet=CollectionSheet";

  test("CLI가 자동으로 붙였으면 WARN이 아니라 OK", () => {
    const c = checkGvizHeadersParam(gviz, true);
    expect(c.level).toBe("OK");
    expect(c.detail).toContain("자동으로");
  });

  test("headers 값이 비어 있으면 지정된 것으로 보지 않는다", () => {
    expect(checkGvizHeadersParam(`${gviz}&headers=`, false).level).toBe("WARN");
  });

  test("자동 보충을 쓰지 않는 호출자에겐 여전히 WARN", () => {
    expect(checkGvizHeadersParam(gviz, false).level).toBe("WARN");
  });
});

describe("withGvizHeaders — 데이터 요청과 폴백 대조 요청의 조건 일치", () => {
  // CLI는 같은 URL을 두 번 받는다: 요청한 탭(sheet=있음)과 기본 탭(sheet=뺀 것). 두 응답을
  // 본문으로 대조해 탭 이름 오타를 잡으므로, headers 조건이 서로 다르면 대조가 의미를 잃는다.
  const withSheet = "https://docs.google.com/spreadsheets/d/ID/gviz/tq?tqx=out:csv&sheet=CollectionSheet";
  const dropSheet = (u: string) => {
    const p = new URL(u);
    p.searchParams.delete("sheet");
    return p.toString();
  };
  const headersOf = (u: string) => new URL(withGvizHeaders(u).url).searchParams.get("headers");

  test("원본에 headers가 없으면 양쪽 다 1이 된다", () => {
    expect(headersOf(withSheet)).toBe("1");
    expect(headersOf(dropSheet(withSheet))).toBe("1");
  });

  test("원본이 headers=2면 양쪽 다 2로 유지된다", () => {
    const u = `${withSheet}&headers=2`;
    expect(headersOf(u)).toBe("2");
    expect(headersOf(dropSheet(u))).toBe("2");
  });

  test("특수문자가 든 탭 이름도 값이 보존된다", () => {
    const tab = "EventScheduleSheet[Heimdall]";
    const u = `https://docs.google.com/spreadsheets/d/ID/gviz/tq?tqx=out:csv&sheet=${tab}`;
    const params = new URL(withGvizHeaders(u).url).searchParams;
    expect(params.get("sheet")).toBe(tab);
    expect(params.get("tqx")).toBe("out:csv");
  });
});

// --- 2026-09-03 운영 재확인에서 나온 것: lib9c 스킵 규칙 반영 ---------------------------
// 근거는 planetarium/lib9c의 Sheet.Set 원본: `if (line.StartsWith(",") || line.StartsWith("_")) continue;`
// 이걸 반영하지 않아 실제 밸런스 시트의 주석 행이 "키 컬럼 공백" FATAL, "키 값 중복" WARN으로
// 잡혔다(EventScheduleSheet 2행, CostumeItemSheet의 _spine_resource_path 4행).

describe("isAnnotationRow / dataRows", () => {
  test("_로 시작하는 행은 형식과 무관하게 주석", () => {
    expect(isAnnotationRow(["_item_sub_type", "FullCostume|HairCostume"])).toBe(true);
    expect(isAnnotationRow(["10113000", "Sword"])).toBe(false);
  });

  test("따옴표 없는 실제 익스포트에서는 빈 첫 칸을 데이터 행으로 남긴다(v200450 FATAL 유지)", () => {
    const rows = [["", "Sword"], ["2", "Shield"]];
    expect(dataRows(rows)).toHaveLength(2);
  });

  test("gviz 프록시(따옴표)에서는 빈 첫 칸도 제외한다 — 거기선 주석 행이 그렇게 보인다", () => {
    const rows = [["", "1 -> 0.1"], ["1001", "Monster Island"]];
    expect(dataRows(rows, { fullyQuoted: true })).toHaveLength(1);
  });
});

describe("isFullyQuotedCsv / checkNotFullyQuoted", () => {
  test("gviz 출력은 따옴표 형식으로 판정", () => {
    expect(isFullyQuotedCsv('"id","name"\n"1","a"\n')).toBe(true);
  });

  test("실제 lib9c CSV는 아니다", () => {
    expect(isFullyQuotedCsv("id,name\n1,a\n")).toBe(false);
  });

  test("따옴표 형식이면 WARN — lib9c 파서가 따옴표를 못 읽어 로드가 중단된다", () => {
    const c = checkNotFullyQuoted('"id","name"\n"1","a"\n');
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("그대로 업로드하면");
  });

  test("따옴표 없는 CSV는 OK", () => {
    expect(checkNotFullyQuoted("id,name\n1,a\n").level).toBe("OK");
  });
});

describe("checkLib9cSkippedRows", () => {
  // 2026-09-03 등급 정정: 처음엔 주석 행만 있어도 WARN을 냈는데, `_` 주석은 lib9c TableCSV의
  // 정상 관행이라(실측: 140개 중 7개 파일이 사용) 정상 파일에 상시 경고가 떴다 — 진짜 경고를
  // 무시하게 만드는 패턴이라 정보성 OK로 낮추고, 개수·줄 번호는 그대로 알린다.
  test("_ 주석 행만 있으면 정보성 OK — 개수와 줄 번호는 알린다", () => {
    const c = checkLib9cSkippedRows([["_note", "x"], ["1", "a"]]);
    expect(c.level).toBe("OK");
    expect(c.detail).toContain("2행");
    expect(c.detail).toContain("정상 관행");
  });

  test("따옴표 없는 CSV에서는 빈 첫 칸을 스킵 행으로 세지 않는다", () => {
    expect(checkLib9cSkippedRows([["", "a"], ["1", "b"]], false).level).toBe("OK");
  });

  test("gviz 프록시에서는 빈 첫 칸도 스킵 행으로 센다", () => {
    expect(checkLib9cSkippedRows([["", "a"], ["1", "b"]], true).level).toBe("WARN");
  });
});
