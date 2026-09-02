/**
 * announce-fanout — CURRENTLY A PARTIAL BUILD covering only the §3 9단계(정규 업데이트 →
 * 디스코드 공지 초안 변환) 절반. See SKILL.md for the full story; short version:
 *
 * 설계 문서는 이 스킬에 두 역할을 맡긴다.
 *   1. §3 9단계 — 릴리즈 노트/인게임 공지판 내용을 디스코드 공지 초안으로 변환 + 언어별
 *      불일치 제거. **이번에 만든 것.**
 *   2. §3 11단계 — 휴장(점검)·이벤트 공지 문구·일정·이미지 초안. **미착수** — 읽기 권한
 *      문제가 아니다(2026-09-01 정정: `Event.json`도 인증 없는 공개 CDN으로 서빙됨이
 *      확인됐다, release-guard 조사 참고). 그 `Event.json`엔 애초에 초안화할 문구 자체가
 *      없어 미착수다.
 *
 * `arena-announce`와 결정적으로 다른 점: `arena-announce`는 담당자가 실제로 과거에 게시한
 * 디스코드 공지 3건을 통째로 받아 그 표현을 그대로 재현하는 고정 템플릿을 만들었다
 * (`arena-announce-template.ts` 모듈 doc 참고). 이 스킬은 그런 실제 샘플을 아직 받지
 * 못했다 — 그래서 새 마케팅 문구를 창작하지 않는다. 대신 **이미 검증·게시된 인게임 공지판
 * (`TextNotice{,_KR,_JP}.json`, release-guard가 이미 공개 읽기로 검증해 둔 것과 동일
 * 소스)의 내용을 그대로 가져와 디스코드에 올리기 좋은 형태로 재포장**할 뿐이다. 문구를
 * 새로 짓지 않으므로 "근거 없는 카피 발명" 위험이 없다.
 */
import { type NoticeHead, checkNoticeEmptyContents, checkNoticeFilesAgree, type NoticeApvSet } from "./release-guard";

export interface AnnounceCheck {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: "OK" | "WARN" | "FATAL";
  readonly detail: string;
}

export interface LanguageNotice {
  readonly lang: "EN" | "KR" | "JP";
  readonly head: NoticeHead;
}

/**
 * 세 언어 본문 길이가 서로 크게 어긋나면(번역 누락 의심) WARN. 실제 번역 품질은 볼 수
 * 없으므로 "길이가 비슷한가" 정도의 아주 거친 신호만 준다 — FATAL로 올리지 않는다.
 * 기준: 가장 짧은 본문이 가장 긴 본문의 20% 미만이면 의심.
 */
export function checkLanguageLengthParity(notices: readonly LanguageNotice[]): AnnounceCheck {
  const id = "language-length-parity";
  const name = "언어별 본문 길이 균형";
  const lengths = notices.map((n) => ({ lang: n.lang, len: (n.head.contents ?? "").length })).filter((n) => n.len > 0);
  if (lengths.length < 2) {
    return { id, name, ok: true, level: "OK", detail: "비교할 본문이 2개 미만이라 건너뜀." };
  }
  const max = Math.max(...lengths.map((l) => l.len));
  const min = Math.min(...lengths.map((l) => l.len));
  if (max > 0 && min / max < 0.2) {
    const shortest = lengths.find((l) => l.len === min)!;
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail: `${shortest.lang} 본문(${min}자)이 가장 긴 본문(${max}자)의 20% 미만입니다 — 번역 누락이나 일부만 옮겨졌을 가능성. 원문 대조 필요.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `언어별 본문 길이가 비슷합니다 (최소 ${min}자 ~ 최대 ${max}자).` };
}

export interface AnnouncementDraft {
  readonly body: string;
  readonly checks: AnnounceCheck[];
}

/**
 * 이미 게시된 인게임 공지(TextNotice{,_KR,_JP}.json)의 내용을 디스코드 초안 형태로
 * 재포장한다. 문구를 새로 짓지 않는다 — 원문을 그대로 옮기고, 사람이 다듬을 자리를
 * 명시적으로 표시한다.
 */
export function buildAnnouncementDraft(en: NoticeHead, kr: NoticeHead, jp: NoticeHead): AnnouncementDraft {
  const notices: LanguageNotice[] = [
    { lang: "EN", head: en },
    { lang: "KR", head: kr },
    { lang: "JP", head: jp },
  ];

  const checks: AnnounceCheck[] = [
    checkNoticeFilesAgree({ en: en.apv, kr: kr.apv, jp: jp.apv } satisfies NoticeApvSet),
    checkNoticeEmptyContents("TextNotice", en),
    checkNoticeEmptyContents("TextNotice_KR", kr),
    checkNoticeEmptyContents("TextNotice_JP", jp),
    checkLanguageLengthParity(notices),
  ];

  const versionLine = en.apv !== null ? `v${en.apv}` : "(버전 확인 필요)";
  const sections = notices
    .map((n) => `**[${n.lang}]**\n${n.head.contents && n.head.contents.trim().length > 0 ? n.head.contents : "(본문 없음 — 채우세요)"}`)
    .join("\n\n");

  const body = [
    `📢 나인 크로니클 정기 업데이트 안내 ${versionLine}`,
    "",
    sections,
    "",
    "(⚠️ 초안입니다 — 실제 과거 디스코드 공지 샘플을 아직 확보하지 못해 arena-announce처럼 검증된 고정 템플릿이 아닙니다. 채널의 과거 게시물과 비교해 형식을 다듬은 뒤 게시하세요. 게시 채널: Planetarium Discord #announcement, 게시는 항상 사람이 직접 합니다.)",
  ].join("\n");

  return { body, checks };
}

export function overallLevel(checks: readonly AnnounceCheck[]): "OK" | "WARN" | "FATAL" {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}
