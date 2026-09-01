/**
 * deploy-prep — 메인넷 배포(월간 정규 업데이트) 직전/직후 사람이 실행할 절차를 준비하는
 * 안전장치. 설계 문서("나인 크로니클 업데이트 자동화 설계") 부록 C가 요구한 것 중, 이번
 * 착수에서 실제로 만든 건 다음 셋뿐이다.
 *
 *   1. APV 결번 검사 재사용 — 깃북(기준) vs 9c-infra 메인넷 매니페스트(odin/heimdall)
 *      대조는 release-guard가 이미 순수 함수로 구현해 뒀다(`checkGitbookVsManifest`). 같은
 *      로직을 deploy-prep에서 다시 구현하지 않고 그대로 import해서 쓴다 — 두 스킬이 서로
 *      다른 결과를 낼 여지를 원천 차단한다.
 *   2. `latest.json` 롤백 스냅샷 — 부록 C: "롤백 = latest.json 되돌리기, 체크리스트엔
 *      이전 값 스냅샷을 받는다." release-guard의 `--log-file`과 같은 append-only 로컬
 *      로그 패턴을 재사용해, 지금 값과 다른 가장 최근 값을 "롤백 대상"으로 찾아준다.
 *   3. Manage Apv 워크플로 입력값 준비 — 9c-infra `Manage Apv` 워크플로(부록 C, F-16)의
 *      입력은 dir-name × file-name 조합인데, 이번 배포에 어떤 네트워크가 아직 뒤처졌는지
 *      계산해서 정확한 입력값 목록만 만들어준다. **워크플로를 트리거하지도, PR을 만들지도
 *      않는다** — D4 원칙(자동화는 라이브 상태를 바꾸는 호출을 하지 않는다)에 따라 실제
 *      실행은 항상 사람이 GitHub Actions에서 손으로 한다.
 *
 * 뺀 것 — `latest.json`의 `version` ↔ APV 인코딩 규칙. 부록 C가 "디코딩 규칙이 필요하다"고
 * 적어뒀지만, 실제 관측은 2026-08-25 시점 단 1건(v200470 ↔ 47000000011)뿐이다. 이 하나로
 * 규칙을 확정하면 근거 없는 게이트가 된다 — release-guard가 이미 같은 이유로 이 값을
 * "정보성 표시만, 어떤 판정에도 안 씀"으로 처리했고(SKILL.md 4절), deploy-prep도 같은
 * 원칙을 따른다. 두 값을 나란히 보여줄 뿐, 자동 비교·경고를 걸지 않는다.
 */
import { checkGitbookVsManifest, type Check, type ManifestApv, type ManifestNetwork } from "./release-guard";

export type { Check } from "./release-guard";

// ---------------------------------------------------------------------------------------
// latest.json 롤백 스냅샷
// ---------------------------------------------------------------------------------------

export interface LatestJsonSnapshotEntry {
  readonly observedAt: string;
  readonly version: number;
  readonly clientTimestamp: string;
}

/**
 * 지금 값과 다른 가장 최근 기록을 "롤백하면 돌아갈 값"으로 찾는다. 로그에 현재 값과 같은
 * 항목만 있으면(=아직 한 번도 바뀐 적이 없으면) null — 롤백 대상이 없다는 뜻이지 에러가
 * 아니다.
 */
export function findRollbackTarget(
  log: readonly LatestJsonSnapshotEntry[],
  currentVersion: number,
): LatestJsonSnapshotEntry | null {
  const sorted = [...log].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].version !== currentVersion) return sorted[i];
  }
  return null;
}

export function checkRollbackSnapshotAvailable(rollbackTarget: LatestJsonSnapshotEntry | null, logHasEntries: boolean): Check {
  const id = "rollback-snapshot-available";
  const name = "latest.json 롤백 스냅샷";
  if (rollbackTarget) {
    return {
      id,
      name,
      ok: true,
      level: "OK",
      detail: `롤백 대상 확보됨 — 이전 값 version=${rollbackTarget.version} (관측 ${rollbackTarget.observedAt}).`,
    };
  }
  if (!logHasEntries) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: "스냅샷 로그가 비어 있습니다 — --snapshot-log를 넘겨 이번 관측부터 기록을 시작하세요. 기록이 쌓이기 전까지는 롤백 시 참고할 이전 값이 없습니다.",
    };
  }
  return {
    id,
    name,
    ok: true,
    level: "OK",
    detail: "로그에 기록은 있지만 전부 현재와 같은 값입니다 — 아직 버전이 바뀐 적이 없어 롤백 대상이 없습니다(정상).",
  };
}

// ---------------------------------------------------------------------------------------
// Manage Apv 워크플로 입력값 준비 (트리거하지 않음 — 값만 계산)
// ---------------------------------------------------------------------------------------

/** 부록 C: 검사 대상 파일 집합은 고정 — `9c-main/network/{odin,heimdall}.yaml`만.
 *  general.yaml은 appProtocolVersion 키 자체가 없고, thor.yaml은 별도 릴리즈 주기라 게이트
 *  대상에서 제외(release-guard와 동일 결정). */
export interface ManageApvWorkflowInput {
  readonly dirName: "9c-main";
  readonly fileName: "odin" | "heimdall";
  readonly targetApv: number;
}

/** 깃북(기준)보다 뒤처진 네트워크만 골라 워크플로 입력값을 만든다. 이미 동기화됐거나
 *  깃북보다 앞선(정상 배포 지연) 네트워크는 만들 게 없다 — 빈 배열을 반환. */
export function planManageApvWorkflowInputs(
  gitbookApv: number,
  odin: ManifestApv,
  heimdall: ManifestApv,
): ManageApvWorkflowInput[] {
  const inputs: ManageApvWorkflowInput[] = [];
  for (const m of [odin, heimdall] as const) {
    if (m.apv !== null && m.apv < gitbookApv) {
      inputs.push({ dirName: "9c-main", fileName: m.network as "odin" | "heimdall", targetApv: gitbookApv });
    }
  }
  return inputs;
}

// ---------------------------------------------------------------------------------------
// 배포 전/후 체크리스트
// ---------------------------------------------------------------------------------------

export interface DeployChecklistParams {
  readonly gitbookApv: number;
  readonly odin: ManifestApv;
  readonly heimdall: ManifestApv;
  readonly clientBuild: { readonly version: number; readonly timestamp: string } | null;
  readonly rollbackTarget: LatestJsonSnapshotEntry | null;
  readonly manageApvInputs: readonly ManageApvWorkflowInput[];
}

export function buildDeployChecklist(p: DeployChecklistParams): string[] {
  const items: string[] = [];

  if (p.manageApvInputs.length === 0) {
    const ahead = [p.odin, p.heimdall].filter((m) => m.apv !== null && m.apv > p.gitbookApv);
    if (ahead.length > 0) {
      items.push(
        `[ ] ${ahead.map((m) => m.network).join(", ")} 매니페스트가 이미 깃북(v${p.gitbookApv})보다 앞선 버전을 배포 중입니다 — Manage Apv 실행 불필요, 대신 깃북 릴리즈 노트를 갱신해야 합니다(정상적인 배포 후 지연이면 release-guard의 24시간 유예 판정 참고).`,
      );
    } else {
      items.push(`[x] odin/heimdall 매니페스트 APV가 이미 깃북(v${p.gitbookApv})과 동기화돼 있습니다 — Manage Apv 실행 불필요.`);
    }
  } else {
    for (const inp of p.manageApvInputs) {
      items.push(
        `[ ] 9c-infra "Manage Apv" 워크플로 실행 — dir=${inp.dirName}, file=${inp.fileName}, target APV=${inp.targetApv} (사람이 GitHub Actions에서 직접 트리거·PR 머지)`,
      );
    }
  }

  items.push("[ ] Manage Apv PR이 실제로 클러스터에 반영됐는지 배포 후 재확인 (PR 머지 ≠ 클러스터 반영, 설계 문서 부록 B 주석 2 참고)");

  if (p.clientBuild) {
    items.push(
      `[ ] latest.json 갱신 직전 현재 값을 --snapshot-log로 기록 (지금 값: version=${p.clientBuild.version}, timestamp=${p.clientBuild.timestamp}) — 이 값이 다음 배포 때의 롤백 대상이 됩니다.`,
    );
    items.push(
      `[참고, 정보성] APV(v${p.gitbookApv}) ↔ latest.json version(${p.clientBuild.version}) 인코딩 규칙은 관측 1건뿐이라 자동 대조하지 않습니다 — 사람이 눈으로 "이 버전이 이번 릴리즈가 맞는지" 확인하세요.`,
    );
  } else {
    items.push("[ ] latest.json 조회 실패 — 직접 https://release.nine-chronicles.com/main/player/latest.json 확인 필요.");
  }

  if (p.rollbackTarget) {
    items.push(`[x] 롤백 대상 확보됨 — 문제 발생 시 version=${p.rollbackTarget.version}(${p.rollbackTarget.observedAt} 관측)로 되돌릴 수 있습니다.`);
  } else {
    items.push("[ ] 롤백 대상 없음 — 배포 전 반드시 --snapshot-log로 현재 latest.json을 한 번 더 기록해두세요.");
  }

  return items;
}

export function overallLevel(checks: readonly Check[]): "OK" | "WARN" | "FATAL" {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}

export { checkGitbookVsManifest };
export type { ManifestApv, ManifestNetwork };
