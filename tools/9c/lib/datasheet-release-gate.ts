/**
 * datasheet-release-gate — "인터널(백오피스 스테이징)에 배포해도 되는가"를 한 화면에서
 * 판단하기 위한 순수 집계 로직. arena-season-checklist와 같은 원칙 — 이 모듈은 아무것도
 * 새로 계산하지 않는다. datasheet-validate(구조 검증)와 spec-datasheet-check(기획서 대사)가
 * 이미 낸 --json을 시트별로 모아서 전체 등급만 계산한다.
 *
 * 실제 백오피스 스테이징 업로드(Backoffice `/table-patch`)는 이 스킬의 범위 밖이다 — D4
 * 원칙(자동화는 라이브를 바꾸지 않는다)에 따라 사람이 직접 한다. 이 게이트는 "업로드 버튼을
 * 누르기 전에 이 두 검증을 다 통과했는지"만 한 화면에서 확인시켜준다.
 */

export type Level = "OK" | "WARN" | "FATAL";

export interface NormalizedCheck {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: Level;
  readonly detail: string;
}

export interface SheetSection {
  readonly sheet: string;
  /** 각 JSON이 밝힌 시트/소스. manifest와 대조해 파일을 잘못 물린 사고를 잡는다
   *  (checkSheetIdentity 참고). 안 넘기면 대조 없이 진행한다(구버전 호출 호환). */
  readonly structuralIdentity?: SourceIdentity | null;
  readonly specCheckIdentity?: SourceIdentity | null;
  /** null = datasheet-validate JSON을 안 줌(미실행) — FATAL/WARN으로 안 치지만 OK로도 안 침. */
  readonly structural: NormalizedCheck[] | null;
  /** null = spec-datasheet-check JSON을 안 줌(미실행). 참고: 그 스킬이 "이 시트에 해당하는
   *  assertion 0건"으로 정상 종료한 경우는 null이 아니라 빈 배열([])이다 — 두 상황을
   *  구분해야 "확인 안 함"과 "확인했는데 해당 없음"을 안 헷갈린다. */
  readonly specCheck: NormalizedCheck[] | null;
}

export interface SheetGateResult {
  readonly sheet: string;
  readonly level: Level;
  readonly missingStructural: boolean;
  readonly missingSpecCheck: boolean;
  readonly checks: NormalizedCheck[];
}

function isCheckArray(value: unknown): value is NormalizedCheck[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) => v && typeof v === "object" && "id" in v && "name" in v && "ok" in v && "level" in v && "detail" in v,
    )
  );
}

/** datasheet-validate.ts --json 출력(`{ source, headerCount, rowCount, level, checks }`)에서
 *  checks 배열만 뽑는다. */
export function normalizeStructuralJson(raw: unknown): NormalizedCheck[] {
  const obj = raw as { checks?: unknown };
  if (!isCheckArray(obj.checks)) {
    throw new Error("datasheet-validate JSON에서 checks 배열을 못 찾았습니다 — 형식이 바뀐 것 같습니다.");
  }
  return obj.checks;
}

/** 두 스킬의 --json이 자기가 어느 시트/소스를 봤는지 밝히는 필드. 없을 수도 있다(구버전 출력,
 *  또는 --sheet-name을 안 준 실행). */
export interface SourceIdentity {
  readonly sheetName: string | null;
  readonly source: string | null;
}

export function readIdentity(raw: unknown): SourceIdentity {
  const o = raw as { sheetName?: unknown; source?: unknown };
  return {
    sheetName: typeof o?.sheetName === "string" ? o.sheetName : null,
    source: typeof o?.source === "string" ? o.source : null,
  };
}

/**
 * manifest가 선언한 시트와 JSON이 실제로 본 시트가 같은지 대조 (2026-09-03 추가).
 * 이전엔 아무 대조가 없어서, manifest에 `MonsterSheet`라 적고 `SkillSheet`의 검증 결과를
 * 물려줘도 "MonsterSheet — OK"로 보고했다(실제로 이 실수를 저지른 적이 있다). 시트를 여러 개
 * 다루는 회차에서 파일을 잘못 물리면 검증 안 된 시트가 통과하므로 FATAL로 잡는다.
 *
 * 판정:
 *   - JSON의 sheetName이 있고 manifest와 다르면 FATAL(확실한 불일치).
 *   - 두 JSON이 서로 다른 source(CSV 경로/URL)를 봤으면 FATAL(같은 시트를 본 게 아니다).
 *   - 대조할 정보 자체가 없으면(sheetName 미기재) WARN — "확인 안 함"을 OK로 두지 않는다.
 */
export function checkSheetIdentity(
  sheet: string,
  structural: SourceIdentity | null,
  specCheck: SourceIdentity | null,
): NormalizedCheck {
  const id = "sheet-identity";
  const name = "시트 이름 대조";
  const declared: Array<{ from: string; sheetName: string }> = [];
  if (structural?.sheetName) declared.push({ from: "datasheet-validate", sheetName: structural.sheetName });
  if (specCheck?.sheetName) declared.push({ from: "spec-datasheet-check", sheetName: specCheck.sheetName });

  const mismatched = declared.filter((d) => d.sheetName !== sheet);
  if (mismatched.length > 0) {
    const detail = mismatched.map((m) => `${m.from} JSON은 "${m.sheetName}"을 봤음`).join(", ");
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `manifest는 "${sheet}"이라고 선언했는데 ${detail} — 다른 시트의 결과를 물려준 것 같습니다.`,
    };
  }

  const sources = [structural?.source, specCheck?.source].filter((s): s is string => typeof s === "string");
  if (sources.length === 2 && sources[0] !== sources[1]) {
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `두 검증이 서로 다른 소스를 봤습니다: "${sources[0]}" vs "${sources[1]}" — 같은 시트를 검증한 게 아닙니다.`,
    };
  }

  if (declared.length === 0) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: `JSON에 시트 이름이 없어 "${sheet}"과 대조하지 못했습니다 — datasheet-validate에 --sheet-name을, spec-datasheet-check에 --sheet-name을 주면 대조됩니다.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `JSON이 밝힌 시트가 manifest의 "${sheet}"과 일치.` };
}

interface RawAssertionResult {
  readonly assertion?: { readonly id?: unknown; readonly column?: unknown };
  readonly status?: unknown;
  readonly level?: unknown;
  readonly detail?: unknown;
}

/** spec-datasheet-check.ts --json 출력(`{ ..., results }`)을 NormalizedCheck 모양으로
 *  옮긴다 — 그 스킬의 결과 항목은 id/name/ok가 아니라 assertion/status 모양이라 그대로는
 *  arena-season-checklist류 집계와 섞을 수 없기 때문. */
export function normalizeSpecCheckJson(raw: unknown): NormalizedCheck[] {
  const obj = raw as { results?: unknown };
  if (!Array.isArray(obj.results)) {
    throw new Error("spec-datasheet-check JSON에서 results 배열을 못 찾았습니다 — 형식이 바뀐 것 같습니다.");
  }
  return (obj.results as RawAssertionResult[]).map((r, i) => {
    const id = r.assertion?.id;
    const column = r.assertion?.column;
    return {
      id: `spec-${String(column ?? "?")}-${String(id ?? i)}`,
      name: `기획서 대사: ${String(column ?? "?")} (id=${String(id ?? "?")})`,
      ok: r.status === "OK",
      level: (r.level as Level) ?? "FATAL",
      detail: String(r.detail ?? ""),
    };
  });
}

function levelOf(checks: readonly NormalizedCheck[]): Level {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}

export function evaluateSheet(section: SheetSection): SheetGateResult {
  // 시트 대조는 입력이 하나라도 있을 때만 의미가 있다 — 둘 다 미실행인 시트에까지 "대조 못 함"
  // WARN을 붙이면 이미 표시되는 "미실행" 경고와 중복된다.
  const anyInput = section.structural !== null || section.specCheck !== null;
  const identityCheck = anyInput
    ? [checkSheetIdentity(section.sheet, section.structuralIdentity ?? null, section.specCheckIdentity ?? null)]
    : [];
  const checks = [...identityCheck, ...(section.structural ?? []), ...(section.specCheck ?? [])];
  return {
    sheet: section.sheet,
    level: levelOf(checks),
    missingStructural: section.structural === null,
    missingSpecCheck: section.specCheck === null,
    checks,
  };
}

export interface GateSummary {
  readonly overallLevel: Level;
  readonly sheets: SheetGateResult[];
}

export function buildGate(sections: readonly SheetSection[]): GateSummary {
  const sheets = sections.map(evaluateSheet);
  const overallLevel: Level = sheets.some((s) => s.level === "FATAL")
    ? "FATAL"
    : sheets.some((s) => s.level === "WARN")
      ? "WARN"
      : "OK";
  return { overallLevel, sheets };
}
