#!/usr/bin/env bun
/**
 * datasheet-release-gate — datasheet-validate(구조 검증)와 spec-datasheet-check(기획서 대사)
 * --json 산출물을 시트별로 모아 "인터널(백오피스 스테이징)에 배포해도 되는가"를 한 화면에서
 * 보여준다. 이 CLI 자체는 아무것도 새로 계산하지 않는다 — 두 스킬이 이미 낸 파일을 읽을
 * 뿐이다. 실제 백오피스 업로드는 항상 사람이 한다(D4 원칙).
 *
 * Usage:
 *   # 먼저 시트마다 두 스킬을 --json으로 실행해 파일로 저장
 *   bun run tools/9c/datasheet-validate.ts --csv ./SkillSheet.csv --key-column Id --json > SkillSheet.structural.json
 *   bun run tools/9c/spec-datasheet-check.ts --csv ./SkillSheet.csv --assertions ./assertions.json --sheet-name SkillSheet --json > SkillSheet.speccheck.json
 *
 *   # manifest.json으로 묶어서 집계
 *   bun run tools/9c/datasheet-release-gate.ts --manifest ./manifest.json
 *
 * manifest.json 형식 (specCheckJson은 선택 — 그 시트에 기획서 변경이 없으면 생략 가능하지만,
 * 생략하면 "미실행"으로 표시되지 확인된 게 아니다):
 *   [
 *     { "sheet": "SkillSheet", "structuralJson": "./SkillSheet.structural.json", "specCheckJson": "./SkillSheet.speccheck.json" },
 *     { "sheet": "MonsterSheet", "structuralJson": "./MonsterSheet.structural.json" }
 *   ]
 */
import {
  buildGate,
  normalizeSpecCheckJson,
  normalizeStructuralJson,
  type SheetGateResult,
  type SheetSection,
} from "./lib/datasheet-release-gate";

interface ManifestEntry {
  readonly sheet: string;
  readonly structuralJson?: string;
  readonly specCheckJson?: string;
}

function parseArgs(argv: string[]): { manifestPath?: string; json: boolean } {
  const args: { manifestPath?: string; json: boolean } = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--manifest":
        args.manifestPath = next();
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  if (!args.manifestPath) throw new Error("--manifest <경로.json>이 필요합니다.");
  return args;
}

async function readJsonFile(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`파일을 찾을 수 없습니다: ${path}`);
  return JSON.parse(await file.text());
}

async function loadSection(entry: ManifestEntry): Promise<SheetSection> {
  const structural = entry.structuralJson ? normalizeStructuralJson(await readJsonFile(entry.structuralJson)) : null;
  const specCheck = entry.specCheckJson ? normalizeSpecCheckJson(await readJsonFile(entry.specCheckJson)) : null;
  return { sheet: entry.sheet, structural, specCheck };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestRaw = await readJsonFile(args.manifestPath!);
  if (!Array.isArray(manifestRaw)) throw new Error("manifest 파일은 JSON 배열이어야 합니다.");
  const manifest = manifestRaw as ManifestEntry[];
  manifest.forEach((e, i) => {
    if (!e || typeof e.sheet !== "string") throw new Error(`manifest[${i}]에 sheet(문자열)가 필요합니다.`);
  });

  const sections = await Promise.all(manifest.map(loadSection));
  const gate = buildGate(sections);

  if (args.json) {
    console.log(JSON.stringify(gate, null, 2));
  } else {
    printHumanReadable(gate);
  }
  process.exit(gate.overallLevel === "FATAL" ? 1 : 0);
}

function printHumanReadable(gate: { overallLevel: string; sheets: SheetGateResult[] }) {
  console.log(`전체 상태: ${gate.overallLevel}  (인터널/백오피스 스테이징 업로드 전 게이트 — 실제 업로드는 사람이 직접)`);
  console.log("");
  for (const s of gate.sheets) {
    console.log(`## ${s.sheet} — ${s.level}`);
    if (s.missingStructural) console.log("   [WARN] datasheet-validate 미실행 — 구조 검증 안 됨");
    if (s.missingSpecCheck) console.log("   [WARN] spec-datasheet-check 미실행 — 기획서 대사 안 됨");
    for (const c of s.checks) {
      const mark = c.level === "OK" ? "OK   " : c.level;
      console.log(`   [${mark}] ${c.name} — ${c.detail}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
