/**
 * @infra/prisma — Cache 모듈 타입
 * ------------------------------------------------------------------
 * manifest atomic read/write / withSchemaCache 고차함수 / 디렉토리 탐색 옵션 등.
 */

import type { PrismaOtsName } from './core';

/** Prisma cache manifest v1 구조. */
type _SchemaManifest = {
  version: 1;
  schemaDir: string;
  schemaFiles: Record<string, { size: number; mtimeMs: number }>;
  generatedAt: string;
};

export type SchemaManifest = _SchemaManifest;

/**
 * `collectPrismaClientDirs` 고차함수 탐색 옵션.
 * @see cache/discovery.ts collectPrismaClientDirs()
 */
export interface CollectPrismaClientDirsOptions {
  /** 탐색 시작 루트 디렉토리. 기본값 workspaceRoot */
  rootDir?: string;
  /** 특정 디렉토리들만 대상으로 탐색을 제한하고 싶을 때 지정 (예: ['apps', 'libs']) */
  searchDirs?: string[];
}

/**
 * `withSchemaCache` 고차함수 파라미터 타입.
 * @see cache/manifest.ts withSchemaCache()
 */
export interface WithCacheParams {
  /** Operational Target Schema 인스턴스 이름 (PrismaOtsName 강타입) */
  otsName: PrismaOtsName;
  /** getPrismaSchemaDir 로 얻은 스키마 디렉토리 절대 경로 */
  schemaDir: string;
  /** prisma.config.ts 절대 경로 — cache hit dummy result 채울 때 사용 */
  prismaConfigPath: string;
  /** getClientOutputDir 로 얻은 Prisma Client 생성 output 디렉토리 */
  clientOutputDir: string;
  /** 프로젝트 루트. 기본값 workspaceRoot */
  projectRoot?: string;
  /** 캐시 사용 여부 (GenerateOptions.cache option 에서 온다) */
  useCache: boolean;
}
