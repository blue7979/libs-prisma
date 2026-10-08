/**
 * @infra/prisma — Seed 모듈 타입
 * ------------------------------------------------------------------
 * prisma.sh seed 단계를 vite-node 로 실행하기 위한 옵션/결과 타입.
 */

import type { PrismaEnv, PrismaStdioMode } from './core';

/**
 * `runPrismaSeed()` 함수 실행 옵션 SSoT.
 * prisma.sh L194-L200 `run_prisma_db_seed()` 함수를 typed TS로 재작성시 사용.
 * PROJECT_DIR(cwd) 기반 vite-node 실행 + TARGET env 주입 + NODE_PATH 명시적 env 전달.
 *
 * @see /libs/infra/kits/src/scripts/prisma.sh L194-L200 — 원본 shell 스크립트
 */
export interface SeedOptions {
  /**
   * Seed 스크립트(vite-node)를 실행할 프로젝트 루트 경로 (cwd).
   * ⚠️ 필수: WORKSPACE_ROOT에서 실행시 vite-node가 vite.config.mts 를 PROJECT_DIR이 아닌
   *    루트에서 찾으므로 resolve 실패 → 반드시 개별 프로젝트 경로(e.g. domains/structure) 지정.
   */
  projectRoot: string;
  /** Prisma 실행 환경변수 (OTS_NAME, DATABASE_TYPE 등) — TARGET env 주입시 사용 */
  env: PrismaEnv;
  /** stdout/stderr 스트림 모드. 기본 PRISMA.CLI_DEFAULT_STDIO ('pipe') */
  stdio?: PrismaStdioMode;
  /**
   * (Optional) vite-node NODE_PATH 환경변수 값.
   * - 생략시 `${projectRoot}/node_modules` 로 자동 resolve.
   * - spawn(shell=false) 환경에서 "NODE_PATH=xxx vite-node ..." 문자열 prefix 방지 대신
   *   env 객체에 명시적으로 넣어주기 위한 전용 필드.
   */
  nodePath?: string;
}

/**
 * Prisma Seed 스크립트 실행 결과 SSoT.
 * vite-node 프로세스의 exit code / stdout / stderr 를 묶어서 반환.
 * pipeline 오케스트레이터(Step ⑥)에서 retry 분기의 기준으로 사용.
 */
export interface SeedResult {
  /** Seed 스크립트 exit code. 0 = 성공 */
  exitCode: number;
  /** vite-node subprocess stdout buffer */
  stdout: string;
  /** vite-node subprocess stderr buffer */
  stderr: string;
}
