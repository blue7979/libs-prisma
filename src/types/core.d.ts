/**
 * @infra/prisma — Core / 기반 타입
 * ------------------------------------------------------------------
 * 의존성 가장 아래에 위치하는 기본 타입 모음.
 * 다른 모든 개별 타입 파일(cli/cache/seed/studio/pipeline.d.ts)은 이 파일의
 * 타입들을 import 해서 사용하므로, 이 파일은 형제 파일 import 가 금지된다.
 *
 * 포함 그룹:
 *   - Node.js 하위 호환용 타입 (SpawnChildProcess — @types/node 버그 회피)
 *   - 제네릭 유틸 타입 (Maybe, Json*, SchemaObject)
 *   - 최상위 SSoT 파생 타입 (PrismaDatabaseType, PrismaOtsName, PrismaStdioMode, PrismaAction)
 *   - 공통 환경변수 / 레이아웃 검증 타입 (PrismaEnv, PrismaLayoutValidationEnv)
 *   - PrismaExitCode, PipelineStage, PipelineStageAttempt
 */

import type { ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';

import type { OtsInstanceName } from '@infra/config';
import type { Docker, NX } from '@infra/definitions';

/**
 * @internal TS Language Server 버전에 따라 `class ChildProcess extends EventEmitter`
 *           상속 체인 추적이 깨지는 경우 방지용 인터섹션 타입.
 *           - 런타임에는 ChildProcess가 EventEmitter를 이미 상속하므로 완전 안전.
 *           - IDE 타입 체크 레벨에서만 child.on('close' | 'error') 시그니처를 강제 노출.
 */
export type SpawnChildProcess = ChildProcess & EventEmitter;

/**
 * 제네릭 nullable 유틸 타입 — `T 또는 null` 을 명시적 이름으로 지칭.
 * - null 이 발생할 수 있는 비동기 I/O (파일 읽기, JSON parse) 함수 반환타입에 사용.
 * - 코드 리뷰 시 `T | null` 을 매번 inline 으로 적는 것보다 의도 파악 용이.
 */
export type Maybe<T> = T | null;

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type SchemaObject = Record<string, unknown>;

/**
 * Prisma 지원 DB 타입 SSoT — constants/docker.ts PRISMA_DATABASES 상수 직접 파생.
 * @example 'postgres' | 'mongodb'  (PRISMA_DATABASES 추가시 자동 확장)
 */
export type PrismaDatabaseType = Docker.Config.PrismaDatabaseType;

/**
 * Operational Target Schema (인스턴스) 이름 SSoT.
 * ✅ @infra/config SSoT 재사용 — 별도 derive chain 중복 정의하지 않고
 *    `@infra/config`의 `OtsInstanceName<T>` 타입을 그대로 alias.
 *    (JwtConfigName 패턴 — ConfigEnvironmentPaths dotted key + Template Literal infer)
 *
 * 🔒 SSoT 단일 출처 원칙:
 *   - 타입 정의 본체: @infra/config/src/types.d.ts OtsInstanceName<T>
 *   - Runtime 값: @infra/config/src/ots.ts getOtsConfig() / getOtsLocalPort()
 *   - 본 레코드(@infra/prisma/src/types/core.d.ts)에서는 오직 backward compat alias 만 정의
 *
 * ✨ 효과:
 *   - OTS 관련 derive / 인프라 설정 코드는 @infra/config 에서만 유지보수
 *   - Prisma 패키지는 import alias 만으로 강타입 이점 그대로 누릴 수 있음
 *   - 인스턴스 신규 추가시 config.local.json 수정 → generator 1회만 돌리면 양쪽 타입 자동 동기화
 *
 * @param T — 좁히고 싶은 Prisma DB 타입 (기본값: 전체 PrismaDatabaseType)
 * @example `PrismaOtsName<'postgres'>` → 'main' | 'analytics' | ... (실제 config 기반)
 * @see /libs/infra/config/src/types.d.ts — OtsInstanceName / OtsDatabaseType 본체 정의
 * @see /libs/infra/config/src/ots.ts — runtime OTS config 읽기 함수 모음
 */
export type PrismaOtsName<T extends PrismaDatabaseType = PrismaDatabaseType> = OtsInstanceName<T>;
/**
 * Prisma CLI subprocess spawn 시 stdout/stderr 스트림 연결 모드.
 * - `'pipe'` (DEFAULT / PRISMA.CLI_DEFAULT_STDIO): 로그를 Node 내에서 캡처하여
 *              retry 분류 / 에러 메시지 첨부 등 자동화 처리에 사용 (테스트 / pipeline)
 * - `'inherit'` : Prisma CLI 가 직접 사용자 터미널에 색 있는 로그 출력 (개발자 CLI 용)
 */
export type PrismaStdioMode = 'pipe' | 'inherit';

/**
 * PrismaEnv / validatePrismaProjectLayout / pipeline 오케스트레이터에서
 * "지금 어떤 액션을 수행 중인가" 를 식별하는 라벨 유니온 SSoT.
 * ✅ 상위 SSoT: `NX.PRISMA_ACTION` ('setup' | 'start' | 'generate') — nx target level 액션
 * ✅ 하위 확장  : '@infra/prisma' 패키지 내부적으로만 쓰이는 CLI-level 액션
 *                 ('db push' | 'seed' | 'studio') 을 intersection 으로 합쳐서 사용
 *
 * 나중에 migrate-deploy / db pull 등 지원시 이곳에만 추가하면 됨.
 */
export type PrismaAction = NX.PRISMA_ACTION | 'db push' | 'seed' | 'studio';

/**
 * Prisma 실행시 공통 환경변수 SSoT.
 * ✅ 상위 SSoT: `Runner.Envs.PrismaService` — nx executor / docker orchestration 에서
 *                                              실제 process.env 로 주입되는 raw 스키마
 * ✅ 하위 강타입: DATABASE_TYPE / OTS_NAME 을 definitions 에서 derive 한 강타입 union 으로
 *                 narrowing — CLI 함수 (generate/push 등) 에서는 이 좁혀진 타입을 사용
 *
 * ⚠️ 가변성 설계 의도: Runner.Envs.PrismaService 와 intersection 으로 연결하지 않음
 *   - 상위 Runner 타입은 모든 프로퍼티에 readonly modifier 가 붙어있어,
 *     buildPrismaEnv() 에서 재할당하는 순간 "Cannot assign to read-only property" 발생
 *   - 대신 구조적 타이핑으로 호환은 유지하되, 명시적 extends 는 피해 가변성 유지
 *
 * @see Runner — /libs/infra/definitions/src/types/scopes/runner.d.ts#L129-L136 PrismaService
 */
export interface PrismaEnv {
  /**
   * Prisma 지원 DB 타입 (postgres | mongodb | ...)
   * @see PrismaDatabaseType — Docker.Config.PrismaDatabaseType 에서 파생
   */
  DATABASE_TYPE: PrismaDatabaseType;
  /**
   * Operational Target Schema 인스턴스 이름 (예: 'main', 'analytics')
   * @see PrismaOtsName — 실제 config 에 정의된 인스턴스 key union 에서 파생
   */
  OTS_NAME: PrismaOtsName;
  /**
   * Prisma Client 생성 output 상대 경로 (workspace 기준)
   * @see Runner.Envs.PrismaService — process.env 주입되는 실제 키 이름과 1:1 매칭
   */
  PRISMA_CLIENT_OUTPUT: string;
  /**
   * (Optional) nx target 에서 setup | start | generate 중 하나로 주입됨
   * — CLI-level 액션('db push' | 'seed' | 'studio') 은 파라미터 레벨에서만 사용.
   * @see PrismaAction — NX.PRISMA_ACTION 기반 + CLI-level 확장 합성 union
   */
  ACTION?: PrismaAction;
  PROJECT_NAME?: string;
  /**
   * (Optional) Seed 스크립트 실행시 vite-node spawn 에 주입되는 TARGET 환경변수.
   * seeds/<ots>/<TARGET>.ts 형태로 분기된 seed 파일 지정시 사용.
   * 미지정시 기본값 = OTS_NAME.
   */
  TARGET?: PrismaOtsName;
}

/**
 * `validatePrismaProjectLayout()` env 파라미터 SSoT — PrismaEnv 에서 꼭 필요한
 * 3가지 프로퍼티만 Pick 한 named type alias.
 * env 전체를 강제하지 않고 구조적 타이핑으로 필요한 키만 요구하므로,
 * 부분 env 만 전달하는 호출부에서도 유연하게 사용 가능.
 *
 * @see PrismaEnv — 상위 전체 환경변수 타입
 * @see cli/utils.ts validatePrismaProjectLayout() — 이 타입을 직접 사용
 */
export type PrismaLayoutValidationEnv = Pick<
  PrismaEnv,
  'OTS_NAME' | 'DATABASE_TYPE' | 'PRISMA_CLIENT_OUTPUT'
>;

/**
 * Prisma CLI 단계별 실패 exit code SSoT (세분화된 retry 메시지 용도).
 * prisma.sh L256-L257 에서 `exit code 2` 를 invalid option 으로 분기하는 것과
 * 동일한 개념을 named type 으로 승격. 나중에 DB 연결 타임아웃 등 특정 코드에
 * 특화된 메시지를 확장할 때 이 곳에 리터럴 추가.
 */
export type PrismaExitCode =
  | 0
  /** Prisma CLI 가 unknown/invalid option 이라고 판단하는 코드 (--skip-generate 잔존 케이스) */
  | 2
  /** 그 외 일반적인 실패 */
  | number;

/**
 * Prisma Pipeline 실행 스테이지 리터럴 유니온 SSoT.
 * 실행 순서가 곧 value 의미:
 *   push(스키마 동기화) → generate(클라이언트 생성) → seed(초기데이터) → studio(웹UI)
 * 첫 3단계는 retry loop 안에서 수행되고, studio 는 retry 통과 후에만 마지막으로 실행.
 *
 * ✨ prisma.sh L224-L278 flow:
 *   n=0 일 때 →  push --force-reset → generate → seed
 *   n>=1 일 때 → push (no reset) → seed
 *   통과시 break → studio 백그라운드 실행
 */
export type PipelineStage = 'push' | 'generate' | 'seed' | 'studio';

/**
 * 단일 pipeline 단계 1회 실행의 실패 기록 SSoT.
 * `_classifyFailure()` / retry loop 내부 `stageFailed` / `lastAttempt` 에서
 * 공통으로 사용하는 구조체로, studio 를 제외한 실제 retry 대상 3단계(push/generate/seed)만 커버.
 * 원본 pipeline/pipeline.ts 에서 로컬 type 으로 선언되었다가 중앙 집중 이관.
 *
 * @see pipeline/pipeline.ts _StageAttempt (이관 원본)
 * @see pipeline/pipeline.ts _classifyFailure()
 */
export type PipelineStageAttempt = {
  stage: Exclude<PipelineStage, 'studio'>;
  exitCode: PrismaExitCode;
  stdout: string;
  stderr: string;
};
