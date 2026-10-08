/**
 * @file Prisma Studio 백그라운드 실행 모듈
 * ------------------------------------------------------------------
 * prisma.sh L273-L278 shell 로직을 typed TS로 재작성.
 * Pipeline 오케스트레이터는 retry loop 를 통과한 뒤에 마지막으로 이 함수를
 * 호출하여 Prisma Studio 를 detached 백그라운드 프로세스로 실행한다.
 *
 * 🚨 key 설계:
 *   - Studio는 장시간 백그라운드에 떠있어야 하므로 (장기 실행)
 *     반드시 `detached: true` + subprocess.unref() 를 호출해서
 *     부모 Node.js 프로세스가 종료되어도 Studio는 계속 살아있도록 한다.
 *   - `--browser none` 옵션 필수: 사용자가 직접 브라우저를 열도록 가이드하고
 *     내부 브라우저 자동 실행은 막아야 서버 환경에서 안전.
 *   - studioPort 기본값 3000 은 PRISMA.PIPELINE_DEFAULT_STUDIO_PORT SSoT 상수.
 *   - CLI 실행은 WORKSPACE_ROOT에서 수행 (CWD 가 client output이 아닌 루트여야
 *     Prisma 바이너리 / prisma.config.ts absolute path 가 정상 resolve)
 */

import { spawn } from 'node:child_process';

import { workspaceRoot } from '@nx/devkit';

import { resolvePrismaBin } from '../cli/utils';
import { PRISMA } from '../constants';
import type { PrismaStdioMode, SpawnChildProcess, StudioOptions } from '../types';

/**
 * Prisma Studio 를 백그라운드에서 실행하고 reference 를 반환한다.
 *
 * ✨ Life Cycle:
 *   - Studio 프로세스는 **detached 상태로 unref** 되어 호출한 Node 프로세스가 exit
 *     하더라도 백그라운드에서 계속 살아있음 → 개발자는 nx executor 종료 후에도
 *     Studio 웹 UI에 계속 접근 가능.
 *   - return 된 child process 로 나중에 `process.kill()` 등으로 수동 종료 가능.
 *
 * @param options - StudioOptions (prismaConfigPath 필수, 나머지 SSoT 기본값 존재)
 * @returns SpawnChildProcess — detached + unref() 가 이미 호출된 상태의 Studio 프로세스
 *
 * @example
 * ```ts
 * const studio = startPrismaStudio({
 *   prismaConfigPath: '/workspace/domains/structure/prisma.config.ts',
 *   studioPort: 3000,
 * });
 * console.log(`Studio PID: ${studio.pid}`);
 * // → 나중에 종료하려면 studio.kill()
 * ```
 */
export function startPrismaStudio(options: StudioOptions): SpawnChildProcess {
  const port = options.studioPort ?? PRISMA.PIPELINE_DEFAULT_STUDIO_PORT;
  const cwd = options.cwd ?? workspaceRoot;
  const stdio: PrismaStdioMode = options.stdio ?? 'inherit';

  const prismaBin: string = options.prismaBinPath ?? resolvePrismaBin(cwd);

  const prismaArgs: string[] = [
    'studio',
    '--config',
    options.prismaConfigPath,
    '--port',
    String(port),
    '--browser',
    'none',
  ];

  const studioChild = spawn(prismaBin, prismaArgs, {
    cwd,
    shell: false,
    stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    detached: true,
  }) as SpawnChildProcess;

  // 부모 프로세스가 종료되어도 Studio는 살아있도록 unref.
  // detached + unref 는 Node.js 공식 docs에서 "장기 실행 백그라운드 프로세스"
  // 패턴으로 권장되는 방식.
  studioChild.unref();

  return studioChild;
}
