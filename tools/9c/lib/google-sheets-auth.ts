/**
 * google-sheets-auth.ts — 구글 서비스 계정 인증(JWT 서명 + OAuth 토큰 교환).
 *
 * 이 저장소는 `@resvg/resvg-js` 외 의존성이 없고, 구글 연동(gviz)도 전부 `fetch` 직접 호출로만
 * 되어 있다. 그 관례를 그대로 이어가려고 `googleapis`/`google-auth-library` 같은 패키지를
 * 추가하지 않고, Node/Bun 내장 `node:crypto`로 서비스 계정 JWT(RS256)를 직접 서명한다 — 새
 * 의존성 0개.
 *
 * 서비스 계정 키 파일은 절대 이 저장소에 커밋하지 않는다. 경로는 CLI 플래그가 아니라
 * `GOOGLE_SHEETS_SA_KEY_PATH` 환경변수로만 주입한다(설계 배경: docs/sheet-write-automation-design.md).
 */
import { createSign } from "node:crypto";

const TOKEN_URI = "https://oauth2.googleapis.com/token";

export interface ServiceAccountCredentials {
  readonly clientEmail: string;
  readonly privateKey: string;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 서비스 계정 키로 OAuth JWT-bearer assertion을 서명한다(순수 함수 — `now`를 인자로 받으므로
 * 테스트에서 시간을 고정할 수 있다). 만료는 발급 시점으로부터 1시간(구글 OAuth 서버의 고정
 * 상한)으로 못박는다.
 */
export function signServiceAccountJwt(sa: ServiceAccountCredentials, scope: string, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: sa.clientEmail, scope, aud: TOKEN_URI, iat, exp };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(sa.privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

export interface AccessToken {
  readonly accessToken: string;
  /** epoch seconds. */
  readonly expiresAt: number;
}

/** 얇은 네트워크 래퍼 — 테스트 제외(기존 `datasheet-validate.ts`의 `readInput` 등과 같은 위치). */
export async function fetchAccessToken(jwt: string): Promise<AccessToken> {
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`구글 OAuth 토큰 발급 실패: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresAt: Math.floor(Date.now() / 1000) + body.expires_in };
}

/** 얇은 파일 I/O 래퍼 — 테스트 제외. `GOOGLE_SHEETS_SA_KEY_PATH`가 가리키는 서비스 계정 키
 *  JSON(구글 콘솔에서 발급하는 그대로의 형식)을 읽는다. */
export async function loadServiceAccountKeyFile(path: string): Promise<ServiceAccountCredentials> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`서비스 계정 키 파일을 찾을 수 없습니다: ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    throw new Error(`서비스 계정 키 파일이 올바른 JSON이 아닙니다: ${e instanceof Error ? e.message : e}`);
  }
  const obj = raw as { client_email?: unknown; private_key?: unknown };
  if (typeof obj.client_email !== "string" || typeof obj.private_key !== "string") {
    throw new Error(`서비스 계정 키 파일에 client_email/private_key(둘 다 문자열)가 없습니다: ${path}`);
  }
  return { clientEmail: obj.client_email, privateKey: obj.private_key };
}
