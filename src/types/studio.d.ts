/**
 * @infra/prisma — Studio 모듈 타입
 * ------------------------------------------------------------------
 * Prisma Studio 를 detached 백그라운드 프로세스로 실행하기 위한 옵션 타입.
 */

import type { PrismaOtsName, PrismaStdioMode } from './core';

/**
 * Prisma Studio 실행 옵션 SSoT.
 * @see studio/studio.ts startPrismaStudio()
 */
export interface StudioOptions {
  /** OTS 이름 (로깅 / 식별 용) */
  otsName?: PrismaOtsName;
  /** prisma.config.ts 절대 경로 */
  prismaConfigPath: string;
  /** Prisma CLI 절대 경로. 미전달시 resolvePrismaBin() 으로 루트에서 resolve */
  prismaBinPath?: string;
  /** Prisma Studio Web UI 포트 @default PRISMA.PIPELINE_DEFAULT_STUDIO_PORT (3000) */
  studioPort?: number;
  /** stdout/stderr 스트림 모드 @default 'inherit' (Studio는 사용자에게 로그를 직접 보여줌) */
  stdio?: PrismaStdioMode;
  /**
   * Studio 프로세스를 실행할 Working Directory.
   * Prisma CLI / pnpm prisma binary resolve 를 위해 기본 workspaceRoot 사용.
   * @default workspaceRoot
   */
  cwd?: string;
}
