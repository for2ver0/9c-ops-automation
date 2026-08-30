/**
 * release-guard — public-endpoint-only consistency/head check across the three places that
 * each independently claim "what the current release is":
 *
 *   1. Gitbook 릴리즈 노트(docs.nine-chronicles.com) — 설계 문서가 채택한 기준(SOT). 실제로
 *      사람이 발매 내용을 적는 유일한 곳이라 기준으로 삼는다.
 *   2. 메인넷 배포 매니페스트(planetarium/9c-infra, 9c-main/network/{odin,heimdall}.yaml)의
 *      `appProtocolVersion` — 그 네트워크가 실제로 구동 중인 버전.
 *   3. 인게임 공지판(assets.nine-chronicles.com/live-assets/Json/TextNotice*.json) — 플레이어가
 *      실제로 보는 버전 표시.
 *
 * 셋 다 인증 없는 공개 읽기다 — 2026-08-30/31 라이브로 확인됨(아래 각 fetch* 함수 주석 참고).
 * 이 모듈은 release-guard가 다루는 두 갈래(설계 문서 "일관성·헤드" vs "Event.json 스냅샷") 중
 * **일관성·헤드 쪽만** 구현한다. 스냅샷/백업 쪽은 S3 읽기 권한과 백업 저장 위치 결정이 아직
 * 없어 착수하지 않았다 — SKILL.md 참고.
 */

export type Level = "OK" | "WARN" | "FATAL";

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: Level;
  readonly detail: string;
}

// ---------------------------------------------------------------------------------------
// 데이터 소스 형태
// ---------------------------------------------------------------------------------------

export type ManifestNetwork = "odin" | "heimdall" | "thor";
export type NoticeFile = "TextNotice" | "TextNotice_KR" | "TextNotice_JP";

export interface ManifestApv {
  readonly network: ManifestNetwork;
  /** null = appProtocolVersion 키 자체가 없거나(예: general.yaml) 파싱 실패. */
  readonly apv: number | null;
  readonly raw: string | null;
}

export interface NoticeHead {
  readonly file: NoticeFile;
  /** 최상단 공지 항목이 하나도 없으면 null. */
  readonly header: string | null;
  readonly apv: number | null;
  readonly contents: string | null;
  readonly date: string | null;
}

export interface ClientBuildInfo {
  readonly version: number;
  readonly timestamp: string;
}

export interface ManifestApvSet {
  readonly odin: number | null;
  readonly heimdall: number | null;
  readonly thor: number | null;
}

export interface NoticeApvSet {
  readonly en: number | null;
  readonly kr: number | null;
  readonly jp: number | null;
}

export interface LogEntry {
  readonly observedAt: string;
  readonly gitbookApv: number | null;
  readonly manifestApv: ManifestApvSet;
  readonly noticeApv: NoticeApvSet;
}

// ---------------------------------------------------------------------------------------
// 순수 파싱 함수 (네트워크 없음 — 유닛 테스트 대상)
// ---------------------------------------------------------------------------------------

/**
 * Gitbook 릴리즈 노트 페이지 HTML에서 최상단(=최신) 항목의 APV를 뽑는다.
 * 각 릴리즈는 `<h2 id="id-200470" ...>` 형태의 헤딩으로 문서 내림차순(최신 먼저)으로
 * 렌더링된다 — 2026-08-31 라이브 HTML로 확인. 페이지 구조가 바뀌면(리브랜딩 등) 이 정규식이
 * 가장 먼저 깨지므로, 실패 시 null을 반환해 호출부가 "파싱 실패"로 명시적으로 처리하게 한다.
 */
export function parseGitbookHead(html: string): number | null {
  const m = html.match(/<h2[^>]*\bid="id-(\d+)"/);
  if (!m) return null;
  const apv = Number(m[1]);
  return Number.isFinite(apv) ? apv : null;
}

/**
 * `9c-main/network/{net}.yaml` 원문에서 `appProtocolVersion: "200470/<hex>/<sig>/<b64>"`의
 * 선두 숫자만 뽑는다. general.yaml처럼 키 자체가 없는 파일은 raw=null로 반환한다(에러 아님 —
 * 설계 문서상 검사 대상이 아닌 파일).
 */
export function parseManifestApv(network: ManifestNetwork, yamlText: string): ManifestApv {
  const m = yamlText.match(/appProtocolVersion:\s*"(\d+)\//);
  if (!m) return { network, apv: null, raw: null };
  const apv = Number(m[1]);
  return { network, apv: Number.isFinite(apv) ? apv : null, raw: m[1] };
}

/** `v200470` 형식만 유효 — 소문자 `v` + 숫자, 그 외(대문자 V, `v` 누락, 공백 등)는 형식 오류. */
export function parseNoticeHeaderApv(header: string): number | null {
  const m = header.match(/^v(\d+)$/);
  if (!m) return null;
  const apv = Number(m[1]);
  return Number.isFinite(apv) ? apv : null;
}

export interface RawNoticeJson {
  readonly NoticeData?: ReadonlyArray<{ Header?: string; Date?: string; Contents?: string }>;
}

/** TextNotice*.json 최상단(NoticeData[0]) 항목만 뽑는다 — 헤드 체크 범위(설계 문서 3단계 이후). */
export function extractNoticeHead(file: NoticeFile, raw: RawNoticeJson): NoticeHead {
  const top = raw.NoticeData?.[0];
  if (!top || typeof top.Header !== "string") {
    return { file, header: null, apv: null, contents: top?.Contents ?? null, date: top?.Date ?? null };
  }
  return {
    file,
    header: top.Header,
    apv: parseNoticeHeaderApv(top.Header),
    contents: top.Contents ?? null,
    date: top.Date ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// fetch (라이브 네트워크 — 전부 인증 불필요한 공개 읽기)
// ---------------------------------------------------------------------------------------

const GITBOOK_URL = "https://docs.nine-chronicles.com/introduction/intro/release-notes";
const MANIFEST_BASE = "https://raw.githubusercontent.com/planetarium/9c-infra/main/9c-main/network";
const NOTICE_BASE = "https://assets.nine-chronicles.com/live-assets/Json";
const LATEST_JSON_URL = "https://release.nine-chronicles.com/main/player/latest.json";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

/** 2026-08-31 라이브 확인: 리다이렉트 없음, 인증 불필요. */
export async function fetchGitbookHead(): Promise<number> {
  const html = await fetchText(GITBOOK_URL);
  const apv = parseGitbookHead(html);
  if (apv === null) {
    throw new Error(
      `깃북 릴리즈 노트 페이지에서 버전 헤딩(<h2 id="id-NNNNNN">)을 찾지 못했습니다 — 페이지 구조가 바뀌었을 수 있습니다: ${GITBOOK_URL}`,
    );
  }
  return apv;
}

/** 2026-08-31 라이브 확인: planetarium/9c-infra 저장소, `9c-main/network/{odin,heimdall,thor}.yaml`.
 *  general.yaml은 appProtocolVersion 키가 없어 apv:null이 정상 — 호출부에서 에러로 취급하지 않는다. */
export async function fetchManifestApv(network: ManifestNetwork): Promise<ManifestApv> {
  const yamlText = await fetchText(`${MANIFEST_BASE}/${network}.yaml`);
  return parseManifestApv(network, yamlText);
}

/** 2026-08-31 라이브 확인: `assets.nine-chronicles.com/live-assets/Json/TextNotice{,_KR,_JP}.json`. */
export async function fetchNoticeHead(file: NoticeFile): Promise<NoticeHead> {
  const res = await fetch(`${NOTICE_BASE}/${file}.json`);
  if (!res.ok) throw new Error(`GET ${file}.json -> HTTP ${res.status}`);
  const raw = (await res.json()) as RawNoticeJson;
  return extractNoticeHead(file, raw);
}

/** 참고용(정보 제공)만 — `version` 필드가 APV와 어떤 인코딩 규칙으로 대응하는지는 설계 문서상
 *  미확정(관측 1건뿐)이라 이 함수는 원본 값만 반환하고 어떤 검사에도 쓰이지 않는다. */
export async function fetchClientBuildInfo(): Promise<ClientBuildInfo> {
  const res = await fetch(LATEST_JSON_URL);
  if (!res.ok) throw new Error(`GET ${LATEST_JSON_URL} -> HTTP ${res.status}`);
  const body = (await res.json()) as { version: number; timestamp: string };
  return { version: body.version, timestamp: body.timestamp };
}

// ---------------------------------------------------------------------------------------
// 대조 체크 (순수 함수 — 유닛 테스트 대상)
// ---------------------------------------------------------------------------------------

/** 함수 1: 공지 헤더가 `v{APV}` 형식을 지키는지. 어긋나면 Backoffice의 `KeepLatestNotices()`
 *  정렬 로직(문자열 정렬)이 이 항목을 최신순 밖으로 밀어낼 수 있다 — F-15. */
export function checkNoticeHeaderFormat(file: NoticeFile, head: NoticeHead): Check {
  const id = `notice-header-format-${file}`;
  if (head.header === null) {
    return { id, name: `${file} 헤더 존재`, ok: false, level: "FATAL", detail: `${file}.json에 공지 항목이 하나도 없습니다.` };
  }
  if (head.apv === null) {
    return {
      id,
      name: `${file} 헤더 형식`,
      ok: false,
      level: "FATAL",
      detail: `${file}.json 최상단 헤더 "${head.header}"가 "v{APV}" 형식이 아닙니다 — 정렬 로직이 이 항목을 최신순에서 밀어낼 수 있습니다.`,
    };
  }
  return { id, name: `${file} 헤더 형식`, ok: true, level: "OK", detail: `"${head.header}" 형식 정상.` };
}

/** 함수 2: 게시된 공지의 빈 Contents 사후 탐지. 붙여넣기 사고(빈 언어 섹션)를 게시 후에 잡는다. */
export function checkNoticeEmptyContents(file: NoticeFile, head: NoticeHead): Check {
  const id = `notice-empty-contents-${file}`;
  const isEmpty = head.contents === null || head.contents.trim().length === 0;
  if (isEmpty) {
    return {
      id,
      name: `${file} 본문 비어있음`,
      ok: false,
      level: "FATAL",
      detail: `${file}.json 최상단 공지("${head.header ?? "?"}")의 Contents가 비어 있습니다 — 붙여넣기 누락 의심.`,
    };
  }
  return { id, name: `${file} 본문 비어있음`, ok: true, level: "OK", detail: "본문 있음." };
}

/** 보조: EN/KR/JP 세 파일의 최상단 헤더 APV가 서로 같은지. 다르면 언어별 공지가 갈라진 것. */
export function checkNoticeFilesAgree(notices: NoticeApvSet): Check {
  const id = "notice-files-agree";
  const values = [notices.en, notices.kr, notices.jp];
  const nonNull = values.filter((v): v is number => v !== null);
  const allSame = nonNull.length > 0 && nonNull.every((v) => v === nonNull[0]);
  if (!allSame) {
    return {
      id,
      name: "언어별 공지 일치",
      ok: false,
      level: "WARN",
      detail: `EN=${notices.en ?? "?"} / KR=${notices.kr ?? "?"} / JP=${notices.jp ?? "?"} — 언어별 공지가 서로 다른 버전을 가리킵니다.`,
    };
  }
  return { id, name: "언어별 공지 일치", ok: true, level: "OK", detail: `세 언어 모두 v${nonNull[0]}로 일치.` };
}

/** 대조 ①: 깃북(기준) vs 인게임 공지 헤더. 2026-07-21·08-25 2회 연속 미갱신을 잡는 본체. */
export function checkGitbookVsNotice(gitbookApv: number, noticeApv: number | null, file: NoticeFile): Check {
  const id = `gitbook-vs-notice-${file}`;
  if (noticeApv === null) {
    return { id, name: `깃북 대 ${file}`, ok: false, level: "FATAL", detail: `${file} 헤더를 파싱하지 못해 비교할 수 없습니다.` };
  }
  if (noticeApv > gitbookApv) {
    return {
      id,
      name: `깃북 대 ${file}`,
      ok: false,
      level: "FATAL",
      detail: `이상 상태: ${file}(v${noticeApv})가 깃북(${gitbookApv})보다 최신 버전을 가리킵니다.`,
    };
  }
  const gap = Math.round((gitbookApv - noticeApv) / 10);
  if (gap === 0) return { id, name: `깃북 대 ${file}`, ok: true, level: "OK", detail: `일치 (v${gitbookApv}).` };
  if (gap === 1) {
    return {
      id,
      name: `깃북 대 ${file}`,
      ok: false,
      level: "WARN",
      detail: `${file}가 1차수 뒤처져 있습니다 (공지 v${noticeApv} < 깃북 ${gitbookApv}) — 아직 게시 전일 수 있습니다.`,
    };
  }
  return {
    id,
    name: `깃북 대 ${file}`,
    ok: false,
    level: "FATAL",
    detail: `${file}가 ${gap}차수 뒤처져 있습니다 (공지 v${noticeApv} < 깃북 ${gitbookApv}) — 2026-07-21·08-25에 실제로 발생한 2회 연속 미갱신과 같은 패턴입니다. Backoffice /release-notice에서 새 공지를 등록해야 합니다.`,
  };
}

/** 대조 ②: 깃북(기준) vs 메인넷 매니페스트 APV(odin·heimdall만 — thor는 별도 정보성 취급). */
export function checkGitbookVsManifest(gitbookApv: number, manifest: ManifestApv): Check {
  const id = `gitbook-vs-manifest-${manifest.network}`;
  const name = `깃북 대 ${manifest.network}.yaml`;
  if (manifest.apv === null) {
    return { id, name, ok: false, level: "FATAL", detail: `${manifest.network}.yaml에서 appProtocolVersion을 읽지 못했습니다.` };
  }
  if (manifest.apv === gitbookApv) {
    return { id, name, ok: true, level: "OK", detail: `동기화됨 (v${gitbookApv}).` };
  }
  if (manifest.apv > gitbookApv) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: `${manifest.network}는 이미 v${manifest.apv}로 배포됐지만 깃북은 아직 v${gitbookApv}입니다 — 배포 직후 노트 작성 대기 중일 수 있습니다(24시간 유예 — 별도 항목 참고).`,
    };
  }
  return {
    id,
    name,
    ok: false,
    level: "FATAL",
    detail: `깃북(v${gitbookApv})이 ${manifest.network}.yaml(v${manifest.apv})보다 최신 버전을 가리킵니다 — APV 누락 의심(2026-06-25 v200450 결번과 같은 패턴). 9c-infra "Manage Apv" 워크플로/PR 상태를 확인하세요.`,
  };
}

/** thor는 설계 문서상 검사 대상에서 제외 — 정기적으로 갱신되지 않는 게 정상 관측이라 별도 취급.
 *  항상 정보성(WARN 이하)이며 FATAL이 되지 않는다. */
export function checkThorInfo(thorApv: number | null): Check {
  const id = "thor-info";
  if (thorApv === null) {
    return { id, name: "thor.yaml (정보성)", ok: false, level: "WARN", detail: "thor.yaml에서 appProtocolVersion을 읽지 못했습니다." };
  }
  return {
    id,
    name: "thor.yaml (정보성)",
    ok: true,
    level: "OK",
    detail: `현재 v${thorApv} — thor는 odin/heimdall과 별도 릴리즈 주기라 갱신이 뒤처져 있어도 정상입니다(게이트 대상 아님).`,
  };
}

/**
 * 대조 ④: 깃북 자체가 뒤처졌는지 — 매니페스트가 깃북보다 앞서 있는 상태(정상적인 배포 순서상
 * 발생 가능)가 24시간 이상 지속되면 별도 경고로 격상한다(설계 문서 부록 B-4). 실행마다
 * stateless이므로 append-only 로그(`--log-file`)에서 "언제부터 이 상태였는지"를 되짚는다.
 */
export function findStaleSince(log: readonly LogEntry[], current: LogEntry): string | null {
  const isMismatch = (e: LogEntry) =>
    e.gitbookApv !== null &&
    ((e.manifestApv.odin !== null && e.manifestApv.odin > e.gitbookApv) ||
      (e.manifestApv.heimdall !== null && e.manifestApv.heimdall > e.gitbookApv));

  if (!isMismatch(current)) return null;

  const sorted = [...log].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  let staleSince: string | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    if (e.gitbookApv !== current.gitbookApv || !isMismatch(e)) break;
    staleSince = e.observedAt;
  }
  return staleSince;
}

const STALE_GRACE_MS = 24 * 60 * 60 * 1000;

export function checkGitbookStaleness(current: LogEntry, staleSince: string | null, now: Date): Check {
  const id = "gitbook-staleness";
  const name = "깃북 자체 갱신 여부";
  const isMismatch =
    current.gitbookApv !== null &&
    ((current.manifestApv.odin !== null && current.manifestApv.odin > current.gitbookApv) ||
      (current.manifestApv.heimdall !== null && current.manifestApv.heimdall > current.gitbookApv));

  if (!isMismatch) return { id, name, ok: true, level: "OK", detail: "깃북이 매니페스트를 따라잡았습니다." };

  if (staleSince === null) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: "매니페스트가 깃북보다 앞서 있는 상태를 이번에 처음 관측했습니다 — 배포 직후 정상 지연 범위(24시간 유예 시작).",
    };
  }

  const elapsedMs = now.getTime() - new Date(staleSince).getTime();
  const elapsedHours = Math.floor(elapsedMs / (60 * 60 * 1000));
  if (elapsedMs >= STALE_GRACE_MS) {
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `깃북이 ${elapsedHours}시간째 갱신되지 않았습니다 (24시간 유예 초과, ${staleSince}부터 관측) — 담당자 확인 필요.`,
    };
  }
  return {
    id,
    name,
    ok: false,
    level: "WARN",
    detail: `깃북 미갱신 ${elapsedHours}시간째 (${staleSince}부터 관측) — 아직 24시간 유예 범위입니다.`,
  };
}

// ---------------------------------------------------------------------------------------
// 요약
// ---------------------------------------------------------------------------------------

export function overallLevel(checks: readonly Check[]): Level {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}
