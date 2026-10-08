/**
 * @infra/prisma — Prisma Client output / Schema 디렉토리 discovery 유틸
 * ------------------------------------------------------------------
 * @migrated from @infra/runtime/src/generator/prisma/discovery.ts (2026-10-07)
 * ------------------------------------------------------------------
 * 워크스페이스 전체를 재귀적으로 walk 하여 다음 두 종류의 디렉토리를 찾아냄:
 *   - `generated/prisma/<ots>` 와 같이 최종 Prisma Client 가 generate 된 output dir
 *   - `src/prisma/<ots>` 와 같이 schema `.prisma` 파일들이 모여있는 source dir
 *
 * `entry === 'node_modules'` / `.git*` 로 시작하는 디렉토리는 자동 skip.
 * 심볼릭 링크나 접근 불가 디렉토리는 catch 로 무시 → walk 중간에 throw 하지 않음.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { workspaceRoot } from '@nx/devkit';

import type { CollectPrismaClientDirsOptions } from '../types';

/**
 * 워크스페이스 전체 (혹은 지정된 searchDirs 하위) 를 재귀 탐색하여
 * 이름이 `.prisma` 로 끝나는 모든 디렉토리 경로를 오름차순 정렬하여 반환한다.
 *
 * @param options - {@link CollectPrismaClientDirsOptions} 탐색 옵션
 * @returns 찾은 Prisma 관련 디렉토리 경로 배열 (절대경로, 정렬 완료)
 */
export function collectPrismaClientDirs(options: CollectPrismaClientDirsOptions = {}): string[] {
  const baseDir = options.rootDir ? resolve(options.rootDir) : resolve(workspaceRoot);
  const searchTargets =
    options.searchDirs && options.searchDirs.length > 0
      ? options.searchDirs.map((d) => resolve(baseDir, d))
      : [baseDir];

  const results: string[] = [];
  const visited = new Set<string>();

  function walk(dir: string): void {
    const real = resolve(dir);
    if (visited.has(real)) return;
    visited.add(real);

    let entries: string[];
    try {
      entries = readdirSync(real);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.git')) continue;
      const full = join(real, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (entry.endsWith('.prisma')) {
        results.push(full);
      } else {
        walk(full);
      }
    }
  }

  for (const target of searchTargets) {
    walk(target);
  }

  return results.sort();
}
