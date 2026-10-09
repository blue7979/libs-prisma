import { relative, join } from 'node:path';

import * as utils from './utils';
import { PRISMA } from '../constants';
import type { PrismaAction, PrismaOtsName } from '../types';

describe.component('cli/utils module', () => {
  const OTS = 'main' as any as PrismaOtsName;
  const ACTION = 'generate' as PrismaAction;

  let sb: ReturnType<typeof vt.useSandbox>;

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();
  });

  // ===========================================================================
  // resolvePrismaBin — 4단계 fallback 체인
  //   existsSync를 전체적으로 spy하여 sandbox 외부의 실제 prisma 바이너리를 보지 못하게 격리
  // ===========================================================================
  describe('resolvePrismaBin (4-stage fallback)', () => {
    let existsSyncSpy: ReturnType<typeof vi.spyOn>;
    let workspaceRootSpy: ReturnType<typeof vi.spyOn>;
    const fsMod = require('node:fs');
    const nxMod = require('@nx/devkit');

    beforeEach(() => {
      existsSyncSpy = vi.spyOn(fsMod, 'existsSync');
      workspaceRootSpy = vi.spyOn(nxMod, 'workspaceRoot', 'get');
      workspaceRootSpy.mockReturnValue(sb.resolve('ws'));
    });

    afterEach(() => {
      existsSyncSpy.mockRestore();
      workspaceRootSpy.mockRestore();
    });

    function fakeExists(p: string): boolean {
      const candidates = [relative(process.cwd(), p), relative(sb.root, p), p].map((s) =>
        s.replace(/^\.\.\//, ''),
      );
      for (const rel of candidates) {
        if (rel && sb.exists(rel)) return true;
      }
      return false;
    }

    test('STAGE 1: GIVEN cwd-local prisma bin exists WHEN called THEN returns cwd-local path first', () => {
      const localBin = sb.resolve('proj/node_modules/.bin/prisma');
      sb.writeFile('proj/node_modules/.bin/prisma', '#!/bin/sh');
      existsSyncSpy.mockImplementation((p: Parameters<typeof import('node:fs').existsSync>[0]) =>
        fakeExists(String(p)),
      );

      const result = utils.resolvePrismaBin(sb.resolve('proj'));

      expect(result).toBe(localBin);
      vt.debugSnapshot({ resolved: relative(sb.root, result) });
    });

    test('STAGE 2: GIVEN cwd-local missing BUT workspace root has prisma bin WHEN called THEN returns workspace-level path', () => {
      sb.writeFile('ws/node_modules/.bin/prisma', '#!/bin/sh');
      workspaceRootSpy.mockReturnValue(sb.resolve('ws'));
      existsSyncSpy.mockImplementation((p: Parameters<typeof import('node:fs').existsSync>[0]) =>
        fakeExists(String(p)),
      );

      const wsBin = sb.resolve('ws/node_modules/.bin/prisma');
      const result = utils.resolvePrismaBin(sb.resolve('proj-no-bin'));

      expect(result).toBe(wsBin);
      vt.debugSnapshot({ resolved: relative(sb.root, result) });
    });

    test('STAGE 3: GIVEN stages 1+2 miss WHEN called THEN returns process.cwd() level bin if present', () => {
      const procBin = join(process.cwd(), 'node_modules', '.bin', 'prisma');
      existsSyncSpy.mockImplementation(
        (p: Parameters<typeof import('node:fs').existsSync>[0]) => String(p) === procBin,
      );

      const result = utils.resolvePrismaBin(sb.resolve('proj-no-bin'));
      expect(result).toBe(procBin);
      vt.debugSnapshot({ resolvedHead: result.slice(-64) });
    });

    test('STAGE 4: GIVEN stages 1~3 all miss (all resolved paths are synthetic non-existing dirs) WHEN called THEN eventually falls back to plain "prisma" string (global PATH lookup)', () => {
      // NOTE: ESM named import binding 의 한계로 existsSync 모듈 스파이는 모듈 내부 호출을 완벽히 intercept하지 못할 수 있음.
      //       → projectRoot / workspaceRoot / process.cwd() 모조리 샌드박스 경로로 지정해서
      //         stage 1~3 의 후보 경로가 "실제로 존재하지 않음" 을 보장 → stage 4 까지 반드시 도달.
      const syntheticWs = sb.resolve('empty-ws-xyz');
      const syntheticCwd = sb.resolve('empty-cwd-xyz');
      const syntheticProject = sb.resolve('empty-project-xyz');
      sb.mkdir('empty-ws-xyz');
      sb.mkdir('empty-cwd-xyz');
      sb.mkdir('empty-project-xyz');

      workspaceRootSpy.mockReturnValue(syntheticWs);
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(syntheticCwd);

      const result = utils.resolvePrismaBin(syntheticProject);

      expect(result).toBe('prisma');
      cwdSpy.mockRestore();
      vt.debugSnapshot({ resolved: result });
    });
  });

  // ===========================================================================
  // 경로 resolver 헬퍼 6종
  // ===========================================================================
  describe('path resolvers (6종)', () => {
    test('getPrismaSchemaDir → SSoT `${projectRoot}/src/prisma/${otsName}`', () => {
      const result = utils.getPrismaSchemaDir(OTS, sb.root);
      expect(result).toBe(sb.resolve(`src/prisma/${OTS}`));
      vt.debugSnapshot({ rel: relative(sb.root, result) });
    });

    test('getPrismaConfigPath → `${projectRoot}/prisma.config.ts`', () => {
      const result = utils.getPrismaConfigPath(sb.root);
      expect(result).toBe(sb.resolve('prisma.config.ts'));
      vt.debugSnapshot({ rel: relative(sb.root, result) });
    });

    test('getClientOutputDir 기본값 → `${projectRoot}/generated/prisma/${otsName}`', () => {
      const result = utils.getClientOutputDir(OTS, undefined, sb.root);
      expect(result).toBe(sb.resolve(`generated/prisma/${OTS}`));
      vt.debugSnapshot({ rel: relative(sb.root, result) });
    });

    test('getClientOutputDir env override → projectRoot 기반 resolve', () => {
      const result = utils.getClientOutputDir(OTS, 'custom/out', sb.root);
      expect(result).toBe(sb.resolve('custom/out'));
      vt.debugSnapshot({ rel: relative(sb.root, result) });
    });

    test('getManifestDir → PATH.CACHE.PRISMA + normalized projectRoot + otsName', () => {
      const result = utils.getManifestDir(OTS, sb.root);
      const normalized = sb.root.replace(/[^a-zA-Z0-9_-]/g, '_');
      expect(result.endsWith(`${normalized}/${OTS}`)).toBe(true);
      vt.debugSnapshot({ tail: result.split('/').slice(-3).join('/') });
    });

    test('getManifestPath → `${getManifestDir()}/PRISMA.CACHE_MANIFEST_FILENAME`', () => {
      const result = utils.getManifestPath(OTS, sb.root);
      const expected = join(utils.getManifestDir(OTS, sb.root), PRISMA.CACHE_MANIFEST_FILENAME);
      expect(result).toBe(expected);
      vt.debugSnapshot({
        tail: [expected.split('/').at(-2), expected.split('/').at(-1)].join('/'),
      });
    });
  });

  // ===========================================================================
  // isOutputIntact
  // ===========================================================================
  describe('isOutputIntact', () => {
    test('HAPPY: GIVEN all 3 required files exist AND non-zero size WHEN called THEN returns true', () => {
      const dir = sb.resolve('client');
      for (const file of PRISMA.OUTPUT_REQUIRED_FILES) {
        sb.writeFile(`client/${file}`, `content for ${file}`);
      }
      expect(utils.isOutputIntact(dir)).toBe(true);
      vt.debugSnapshot({ intact: true });
    });

    test('CASE missing: GIVEN one of 3 files is absent WHEN called THEN returns false', () => {
      const dir = sb.resolve('client');
      sb.writeFile(`client/${PRISMA.OUTPUT_REQUIRED_FILES[0]}`, 'data');
      sb.writeFile(`client/${PRISMA.OUTPUT_REQUIRED_FILES[2]}`, 'data');
      expect(utils.isOutputIntact(dir)).toBe(false);
      vt.debugSnapshot({ intact: false, reason: 'missing file' });
    });

    test('CASE zero-size: GIVEN file exists but size=0 WHEN called THEN returns false', () => {
      const dir = sb.resolve('client');
      for (const file of PRISMA.OUTPUT_REQUIRED_FILES) {
        sb.writeFile(`client/${file}`, file === PRISMA.OUTPUT_REQUIRED_FILES[1] ? '' : 'ok');
      }
      expect(utils.isOutputIntact(dir)).toBe(false);
      vt.debugSnapshot({ intact: false, reason: 'zero-size index.d.ts' });
    });

    test('CASE dir does not exist: WHEN called THEN returns false (no throw)', () => {
      expect(() => utils.isOutputIntact(sb.resolve('no-such-dir'))).not.toThrow();
      expect(utils.isOutputIntact(sb.resolve('no-such-dir'))).toBe(false);
      vt.debugSnapshot({ intact: false, reason: 'dir missing' });
    });
  });

  // ===========================================================================
  // buildPrismaEnv
  // ===========================================================================
  describe('buildPrismaEnv', () => {
    test('returns DATABASE_TYPE + OTS_NAME + PRISMA_CLIENT_OUTPUT unconditionally', () => {
      const env = utils.buildPrismaEnv({
        env: {
          DATABASE_TYPE: 'postgres',
          OTS_NAME: 'main',
          PRISMA_CLIENT_OUTPUT: 'out/prisma',
        },
        projectRoot: sb.resolve('project-root'),
      });

      expect(env.DATABASE_TYPE).toBe('postgres');
      expect(env.OTS_NAME).toBe('main');
      expect(env.PRISMA_CLIENT_OUTPUT).toBe('out/prisma');
      vt.debugSnapshot({ keys: Object.keys(env).sort() });
    });

    test('WHEN PROJECT_NAME is provided THEN also included; otherwise absent', () => {
      const withProj = utils.buildPrismaEnv({
        env: {
          DATABASE_TYPE: 'postgres',
          OTS_NAME: 'main',
          PRISMA_CLIENT_OUTPUT: '',
          PROJECT_NAME: 'api',
        },
        projectRoot: sb.resolve('project-root'),
      });
      const withoutProj = utils.buildPrismaEnv({
        env: {
          DATABASE_TYPE: 'postgres',
          OTS_NAME: 'main',
          PRISMA_CLIENT_OUTPUT: '',
        },
        projectRoot: sb.resolve('project-root'),
      });

      expect(withProj.PROJECT_NAME).toBe('api');
      expect((withoutProj as any).PROJECT_NAME).toBeUndefined();
      vt.debugSnapshot({
        withProject: Object.keys(withProj).sort(),
        withoutProject: Object.keys(withoutProj).sort(),
      });
    });
  });

  // ===========================================================================
  // assertResultOk
  // ===========================================================================
  describe('assertResultOk', () => {
    test('GIVEN exitCode=0 WHEN called THEN does not throw', () => {
      const result = {
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        schemaDir: '',
        prismaConfigPath: '',
        clientOutputDir: '',
      };
      expect(() => utils.assertResultOk(result, 'generate')).not.toThrow();
      vt.debugSnapshot({ asserted: true });
    });

    test('GIVEN exitCode!=0 WHEN called THEN throws Error with stderr attached + error.result field', () => {
      const result = {
        exitCode: 42,
        stdout: '',
        stderr: 'Prisma schema parse error',
        schemaDir: '',
        prismaConfigPath: '',
        clientOutputDir: '',
      };
      let caught: unknown = null;
      try {
        utils.assertResultOk(result, 'db push');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      const err = caught as Error & { result: typeof result };
      expect(err.message).toContain('db push');
      expect(err.message).toContain('exitCode=42');
      expect(err.message).toContain('Prisma schema parse error');
      expect(err.result).toBe(result);
      vt.debugSnapshot({
        exitCode: err?.result?.exitCode,
        msgHead: err?.message?.split('\n')[0],
      });
    });

    test('GIVEN exitCode!=0 AND stderr empty WHEN called THEN falls back to stdout in message', () => {
      const result = {
        exitCode: 1,
        stdout: 'something went wrong on stdout',
        stderr: '',
        schemaDir: '',
        prismaConfigPath: '',
        clientOutputDir: '',
      };
      let caught: unknown = null;
      try {
        utils.assertResultOk(result, ACTION);
      } catch (e) {
        caught = e;
      }
      const err = caught as Error;
      expect(err.message).toContain('something went wrong on stdout');
      vt.debugSnapshot({
        usesStdout: !err.message.includes('stderr'),
        msgHead: err.message.split('\n')[0],
      });
    });
  });

  // ===========================================================================
  // validatePrismaProjectLayout
  // ===========================================================================
  describe('validatePrismaProjectLayout', () => {
    function warm() {
      sb.mkdir(`src/prisma/${OTS}`);
      sb.writeFile('prisma.config.ts', `export default {};`);
    }

    test('HAPPY: GIVEN schema dir + prisma.config.ts exist WHEN called THEN returns 3-path context bundle', () => {
      warm();
      const ctx = utils.validatePrismaProjectLayout(
        { DATABASE_TYPE: 'postgres', OTS_NAME: OTS, PRISMA_CLIENT_OUTPUT: '' },
        ACTION,
        sb.root,
      );
      expect(ctx.schemaDir).toBe(sb.resolve(`src/prisma/${OTS}`));
      expect(ctx.prismaConfigPath).toBe(sb.resolve('prisma.config.ts'));
      expect(ctx.clientOutputDir).toBe(sb.resolve(`generated/prisma/${OTS}`));
      vt.debugSnapshot({
        schemaDir: relative(sb.root, ctx.schemaDir),
        prismaConfigPath: relative(sb.root, ctx.prismaConfigPath),
        clientOutputDir: relative(sb.root, ctx.clientOutputDir),
      });
    });

    test('CASE schema dir missing: throws with action prefix and path', () => {
      sb.writeFile('prisma.config.ts', `export default {};`);
      expect(() =>
        utils.validatePrismaProjectLayout(
          { DATABASE_TYPE: 'postgres', OTS_NAME: OTS, PRISMA_CLIENT_OUTPUT: '' },
          ACTION,
          sb.root,
        ),
      ).toThrow(/Schema directory not found/);
      vt.debugSnapshot({ throws: true, reason: 'schema dir missing' });
    });

    test('CASE prisma.config.ts missing: throws with action prefix', () => {
      sb.mkdir(`src/prisma/${OTS}`);
      expect(() =>
        utils.validatePrismaProjectLayout(
          { DATABASE_TYPE: 'postgres', OTS_NAME: OTS, PRISMA_CLIENT_OUTPUT: '' },
          ACTION,
          sb.root,
        ),
      ).toThrow(/prisma.config.ts not found/);
      vt.debugSnapshot({ throws: true, reason: 'prisma.config.ts missing' });
    });
  });

  // ===========================================================================
  // cleanPrismaArtifacts
  //   Precise Touch 보장: 삭제 대상은 오직 2종
  //     ① generated/prisma/<ots> client dir
  //     ② manifest 캐시 파일
  //   📌 getManifestDir / getManifestPath 는 같은 모듈 내부 호출이므로 vi.spyOn(utils, ...)으로 가로챌 수 없음.
  //   📌 PATH.CACHE.PRISMA 상수는 외부 모듈 레벨 상수라 mutable override 가려면 definitions 모듈
  //      전체를 require 해야 해서 로딩 충돌 우려가 있음.
  //      → 대안: cleanPrismaArtifacts의 otsName/projectRoot 파라미터를 잘 구성해서,
  //        getManifestDir가 반환하는 경로가 sb.root 하위로 해석되도록 projectRoot를
  //        real workspaceRoot 아래 샌드박스 경로로 유도하는 대신,
  //        PATH.CACHE.PRISMA 상수값은 고정이므로 여기에 직접 파일을 써서 테스트.
  //        (sb에 isolation은 없으나 각 테스트는 고유 normalized slug 사용하므로 충돌 안함)
  // ===========================================================================
  describe('cleanPrismaArtifacts', () => {
    const fs = require('node:fs');
    const nodePath = require('node:path');

    beforeEach(() => {
      sb.reset();
    });

    /** artifact 경로 resolver (describe-scope 외부 → beforeEach/warm 시점에 해소) */
    function manifestPaths() {
      const cacheDir = utils.getManifestDir(OTS, sb.root);
      const file = nodePath.join(cacheDir, PRISMA.CACHE_MANIFEST_FILENAME);
      return { cacheDir, file };
    }

    function cleanupManifestCache() {
      const { cacheDir } = manifestPaths();
      try {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      } catch {
        // noop
      }
    }

    beforeEach(() => cleanupManifestCache());
    afterAll(() => cleanupManifestCache());

    function warmArtifacts() {
      const clientDir = sb.mkdir('generated/prisma/main');
      sb.writeFile('generated/prisma/main/index.js', 'module.exports = {};');
      sb.writeFile('generated/prisma/main/index.d.ts', 'export {};');
      sb.writeFile('generated/prisma/main/package.json', '{}');
      const { cacheDir, file } = manifestPaths();
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file, '{}');
      expect(fs.existsSync(file)).toBe(true);
      return { clientDir, manifestPath: file };
    }

    test('dryRun=true: GIVEN artifacts exist WHEN called THEN returns removedPaths with 2 targets but fs untouched', async () => {
      const { clientDir, manifestPath } = warmArtifacts();

      const result = await utils.cleanPrismaArtifacts({
        otsName: OTS,
        projectRoot: sb.root,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.removedPaths).toEqual(expect.arrayContaining([clientDir, manifestPath]));
      expect(result.removedPaths).toHaveLength(2);
      expect(sb.exists('generated/prisma/main/index.js')).toBe(true);
      expect(fs.existsSync(manifestPath)).toBe(true);
      vt.debugSnapshot({
        removedCount: result.removedPaths.length,
        errors: result.errors.length,
        fsUntouched: true,
      });
    });

    test('dryRun=false: GIVEN artifacts exist WHEN called THEN deletes client dir + manifest', async () => {
      const { clientDir, manifestPath } = warmArtifacts();

      const result = await utils.cleanPrismaArtifacts({
        otsName: OTS,
        projectRoot: sb.root,
        dryRun: false,
      });

      expect(result.errors).toEqual([]);
      expect(result.removedPaths).toEqual(expect.arrayContaining([clientDir, manifestPath]));
      expect(result.removedPaths).toHaveLength(2);
      expect(sb.exists('generated/prisma/main')).toBe(false);
      expect(fs.existsSync(manifestPath)).toBe(false);
      vt.debugSnapshot({
        removedCount: result.removedPaths.length,
        errors: result.errors.length,
      });
    });

    test('keepManifest=true: GIVEN manifest exists WHEN called THEN preserves manifest, only client dir removed', async () => {
      const { clientDir, manifestPath } = warmArtifacts();

      const result = await utils.cleanPrismaArtifacts({
        otsName: OTS,
        projectRoot: sb.root,
        keepManifest: true,
        dryRun: false,
      });

      expect(fs.existsSync(manifestPath)).toBe(true);
      expect(sb.exists('generated/prisma/main')).toBe(false);
      expect(result.removedPaths).toEqual([clientDir]);
      vt.debugSnapshot({
        manifestKept: fs.existsSync(manifestPath),
        clientRemoved: !sb.exists('generated/prisma/main'),
        errors: result.errors.length,
      });
    });

    test('GIVEN rmSync throws EBUSY WHEN called THEN error collected in result.errors (no rethrow)', async () => {
      const { clientDir } = warmArtifacts();
      // NOTE: cleanPrismaArtifacts 는 node:fs 로부터 named import 한 `rmSync` / `existsSync` 를
      //       모듈 스코프에서 직접 참조하므로 vi.spyOn(fs, 'rmSync')가 intercept하지 못할 수 있다 (ESM binding).
      //       → 아예 client 디렉토리를 read-only (mode 0o444) + 하위 파일 존재 → recursive 삭제가 실패하도록
      //         fs 레벨에서 잠근다. macOS/Linux 에서 non-empty dir 의 rmSync recursive=true 가
      //         write 권한 없으면 실패하는 속성을 활용.
      const fsNative = require('node:fs');
      // 디렉토리/파일 권한 읽기전용으로 잠금
      try {
        fsNative.chmodSync(clientDir, 0o444);
        // 하위 파일이 있으면 recursive 삭제시 디렉토리 쓰기 권한 필요 → 삭제 실패 유도
      } catch {
        // noop, chmod 불가한 환경은 이 테스트를 건너뛴다.
      }
      let permLockOk = false;
      try {
        fsNative.chmodSync(clientDir, 0o444);
        permLockOk = true;
      } catch {
        permLockOk = false;
      }

      const result = await utils.cleanPrismaArtifacts({
        otsName: OTS,
        projectRoot: sb.root,
        dryRun: false,
      });

      // 권한 잠금이 성공해서 삭제에 실패한 경우에만 error 수집 assert
      if (permLockOk) {
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        expect(result.errors.some((e) => e.path === clientDir)).toBe(true);
      }
      // 원복: 다시 쓰기 가능하게 열고 삭제 (sandbox cleanup 보장)
      try {
        fsNative.chmodSync(clientDir, 0o755);
        fsNative.rmSync(clientDir, { recursive: true, force: true });
      } catch {
        // noop
      }
      vt.debugSnapshot({
        permLockApplied: permLockOk,
        errors: result.errors.length,
      });
    });

    test('GIVEN no artifacts exist WHEN called THEN returns empty removedPaths, no errors (honest report)', async () => {
      const result = await utils.cleanPrismaArtifacts({
        otsName: OTS,
        projectRoot: sb.root,
      });

      expect(result.removedPaths).toEqual([]);
      expect(result.errors).toEqual([]);
      vt.debugSnapshot({ removedCount: 0, errors: 0 });
    });
  });
});
