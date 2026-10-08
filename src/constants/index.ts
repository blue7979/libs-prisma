/**
 * @file Prisma Constants SSoT — @infra/definitions constants/http 패턴 참조
 * ------------------------------------------------------------------
 * 개별 영역별 상수를 분리한 파일들을 import 하여
 * 단일 PRISMA namespace (const + declaration merge) 로 집계하여 export.
 *
 * 🔗 HTTP 패턴: libs/infra/definitions/src/constants/http/index.ts
 * ------------------------------------------------------------------
 */
import { CACHE_MANIFEST_VERSION, CACHE_MANIFEST_FILENAME } from './cache';
import { CLI_DEFAULT_STDIO, CLI_RETRY_MAX, CLI_RETRY_DELAY_MS } from './cli';
import { OUTPUT_REQUIRED_FILES } from './output';
import {
  PIPELINE_STAGE_ORDER,
  PIPELINE_INITIAL_STAGES,
  PIPELINE_RETRY_STAGES,
  PIPELINE_DEFAULT_STUDIO_PORT,
} from './pipeline';
import { SEED_ENTRY_PATH, SEED_SUCCESS_EXIT_CODES } from './seed';

/**
 * ------------------------------------------------------------------
 * Prisma namespace — 값(value) + 타입(type) 동시 SSoT 제공.
 * @see libs/infra/definitions/src/constants/http/index.ts (동일 패턴)
 * ------------------------------------------------------------------
 */
export const PRISMA = {
  // ===== Generate Output =====
  OUTPUT_REQUIRED_FILES,
  // ===== Cache Manifest =====
  CACHE_MANIFEST_VERSION,
  CACHE_MANIFEST_FILENAME,
  // ===== CLI Common =====
  CLI_DEFAULT_STDIO,
  CLI_RETRY_MAX,
  CLI_RETRY_DELAY_MS,
  // ===== Seed =====
  SEED_ENTRY_PATH,
  SEED_SUCCESS_EXIT_CODES,
  // ===== Pipeline (4-stage orchestrator) =====
  PIPELINE_STAGE_ORDER,
  PIPELINE_INITIAL_STAGES,
  PIPELINE_RETRY_STAGES,
  PIPELINE_DEFAULT_STUDIO_PORT,
} as const;

export namespace PRISMA {
  /** @see PRISMA.OUTPUT_REQUIRED_FILES — 값의 union type */
  export type OUTPUT_REQUIRED_FILES = (typeof OUTPUT_REQUIRED_FILES)[number];
  /** @see PRISMA.CACHE_MANIFEST_VERSION — 리터럴 타입 */
  export type CACHE_MANIFEST_VERSION = typeof CACHE_MANIFEST_VERSION;
  /** @see PRISMA.CACHE_MANIFEST_FILENAME — 리터럴 타입 */
  export type CACHE_MANIFEST_FILENAME = typeof CACHE_MANIFEST_FILENAME;
  /** @see PRISMA.CLI_DEFAULT_STDIO — 리터럴 타입 */
  export type CLI_DEFAULT_STDIO = typeof CLI_DEFAULT_STDIO;
  /** @see PRISMA.CLI_RETRY_MAX — 리터럴 타입 */
  export type CLI_RETRY_MAX = typeof CLI_RETRY_MAX;
  /** @see PRISMA.CLI_RETRY_DELAY_MS — 리터럴 타입 */
  export type CLI_RETRY_DELAY_MS = typeof CLI_RETRY_DELAY_MS;
  /** @see PRISMA.SEED_ENTRY_PATH — 리터럴 타입 */
  export type SEED_ENTRY_PATH = typeof SEED_ENTRY_PATH;
  /** @see PRISMA.SEED_SUCCESS_EXIT_CODES — 값의 union type */
  export type SEED_SUCCESS_EXIT_CODES = (typeof SEED_SUCCESS_EXIT_CODES)[number];
  /** @see PRISMA.PIPELINE_STAGE_ORDER — 전체 4스테이지 union */
  export type PIPELINE_STAGE_ORDER = (typeof PIPELINE_STAGE_ORDER)[number];
  /** @see PRISMA.PIPELINE_INITIAL_STAGES — n=0 실행 스테이지 union */
  export type PIPELINE_INITIAL_STAGES = (typeof PIPELINE_INITIAL_STAGES)[number];
  /** @see PRISMA.PIPELINE_RETRY_STAGES — n>=1 재시도 스테이지 union */
  export type PIPELINE_RETRY_STAGES = (typeof PIPELINE_RETRY_STAGES)[number];
  /** @see PRISMA.PIPELINE_DEFAULT_STUDIO_PORT — 리터럴 타입 */
  export type PIPELINE_DEFAULT_STUDIO_PORT = typeof PIPELINE_DEFAULT_STUDIO_PORT;
}
