/**
 * @infra/prisma — Pipeline 오케스트레이터 타입
 * ------------------------------------------------------------------
 * 4단계 (push → generate → seed → studio) retry 오케스트레이터 전용 타입 묶음.
 */

import type {
  PipelineStage,
  PrismaAction,
  PrismaEnv,
  PrismaExitCode,
  PrismaStdioMode,
} from './core';

/**
 * `runPrismaPipeline()` 실행 옵션 SSoT.
 * 기존 prisma.sh 의 환경변수 기반 설정을 typed 객체로 승격.
 * NX executor (prisma.task.ts) 에서 가져다 쓸 때 편하도록 named parameter 스타일 유지.
 */
export interface PipelineOptions {
  /** Prisma 실행 환경변수 (OTS_NAME, DATABASE_TYPE 등 layout 검증 / seed TARGET 매핑에 사용) */
  env: PrismaEnv;
  /**
   * NX executor level 액션 SSoT.
   * - 'setup' : n=0 브랜치 (--force-reset + generate + seed + studio)
   * - 'start' : 재시도 가능한 일반 모드. 첫 실행은 force-reset 이후 재시도는 일반 push + seed
   * - 'generate' : DB 단계 skip, generate 만 단독 실행 후 종료 (studio 없음)
   */
  action: PrismaAction;
  /**
   * Prisma 프로젝트 루트 경로.
   * WORKING_DIR 개념 — schema prisma.config.ts, seeds 폴더, generated client 모두 이 경로 기준 resolve
   * @default workspaceRoot
   */
  projectRoot?: string;
  /** Prisma CLI absolute 경로. resolvePrismaBin() 으로 미리 resolve 한 값을 전달 권장 */
  prismaBinPath?: string;
  /** stdout/stderr 기본 모드. @default PRISMA.CLI_DEFAULT_STDIO = 'pipe' */
  stdio?: PrismaStdioMode;
  /** 최대 재시도 횟수 @default PRISMA.CLI_RETRY_MAX = 30 */
  maxRetry?: number;
  /** 재시도 사이 대기 ms @default PRISMA.CLI_RETRY_DELAY_MS = 3_000 */
  retryDelayMs?: number;
  /** Prisma Studio 실행시 사용할 포트 @default 3000 */
  studioPort?: number;
  /**
   * 스테이지가 완료될 때마다 호출되는 Hook.
   * pipeline 오케스트레이터가 어디서 멈췄는지 로깅하거나,
   * metrics 를 수집하거나, stdout 을 파싱하는 등 커스텀 로직 삽입용.
   */
  onStage?: (info: PipelineStageHookInfo) => void | Promise<void>;
  /** 재시도 직전에 호출되는 Hook. retry message 세분화 로직을 override 하고 싶을 때 사용 */
  onRetry?: (info: PipelineRetryHookInfo) => void | Promise<void>;
}

/**
 * onStage hook 호출시 전달되는 컨텍스트 SSoT.
 */
export interface PipelineStageHookInfo {
  /** 완료된 스테이지 */
  stage: PipelineStage;
  /** 현재 재시도 회차 (0 = 첫 실행) */
  attempt: number;
  /** 스테이지 exit code */
  exitCode: PrismaExitCode;
  /** stdout (stdio='pipe' 일 때만 채워짐) */
  stdout: string;
  /** stderr (stdio='pipe' 일 때만 채워짐) */
  stderr: string;
  /** 해당 스테이지가 재시도 끝에 최종 성공했는가? */
  ok: boolean;
}

/**
 * onRetry hook 호출시 전달되는 컨텍스트 SSoT.
 * prisma.sh L254-L264 메시지 세분화 로직과 동일한 정보를 typed 로 노출.
 */
export interface PipelineRetryHookInfo {
  /** 현재 재시도 회차 (1부터 시작 — 1 = 첫 재시도) */
  attempt: number;
  /** maxRetry 대비 남은 재시도 횟수 */
  remaining: number;
  /** 실패한 가장 마지막 스테이지 (push → generate → seed 중 하나) */
  failedStage: Exclude<PipelineStage, 'studio'>;
  /** failedStage 에서 실패한 exit code */
  exitCode: PrismaExitCode;
  /** 마지막 실패 시 stdout */
  stdout: string;
  /** 마지막 실패 시 stderr */
  stderr: string;
  /**
   * ✨ 프레임워크 단에서 미리 분류한 failure reason.
   * prisma.sh L255-L264 if/else 3분기 로직을 그대로 named enum 화.
   */
  reason:
    | 'PUSH_INVALID_OPTION'
    | 'PUSH_DB_OR_SCHEMA_ERROR'
    | 'SEED_SCRIPT_FAILED'
    | 'GENERATE_OUTPUT_CORRUPT';
  /** 추천하는 재시도 지연 ms (retryDelayMs 기본값 사용해도 됨, override 가능) */
  suggestedDelayMs: number;
}

/**
 * `runPrismaPipeline()` 반환 결과 SSoT.
 */
export interface PipelineResult {
  /** 실행한 액션 SSoT */
  action: PrismaAction;
  /** 성공 여부 (true = 스테이지 전부 통과) */
  ok: boolean;
  /** 수행한 총 재시도 횟수 (0 = 첫 시도만에 통과) */
  totalAttempts: number;
  /** true 이면 마지막에 Prisma Studio 가 백그라운드 실행됨 */
  studioStarted: boolean;
  /** 실패했을 경우 마지막으로 기록된 스테이지 에러 정보. 성공시 undefined */
  lastFailure?: Pick<
    PipelineRetryHookInfo,
    'failedStage' | 'exitCode' | 'stdout' | 'stderr' | 'reason'
  >;
}
