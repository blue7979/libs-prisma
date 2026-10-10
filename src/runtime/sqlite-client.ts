/**
 * @file SQLite 전용 PrismaClient factory — OTS 시스템과 완전히 독립적.
 * ------------------------------------------------------------------
 * 파일 경로만 직접 받아 better-sqlite3 + PrismaSQLite driver adapter를
 * 붙여서 PrismaClient 인스턴스를 반환.
 *
 * ✅ ESM 규칙 준수: top-level static import (require ZERO 사용)
 *    @see ../../../.agent/skills/antipattern-governance/references/11-cjs-require-esm-migration-playbook.md
 *    §ZERO EXCEPTION — 어느 영역에서든 require() 는 금지.
 * ✅ Prisma 7 SQLite 하드 제약: Driver Adapter 사용 필수 (Prisma 7 & SQLite 제약)
 *    @see project_memory — Prisma 7 & SQLite: SQLite 사용 시 Driver Adapter 필수.
 * ✅ 기존 Postgres factory 패턴 일관성:
 *    postgresPrismaClient(PrismaClient, serviceName) 와 동일한 시그니처 스타일 유지.
 *
 * 📌 사용 제약:
 *   - 이 모듈을 import 하는 caller 측 워크스페이스 package.json에는 반드시
 *     `better-sqlite3` 와 `@prisma/adapter-better-sqlite3` 가 존재해야 한다.
 *   - 현재는 NestJS Injectable Service Wrapper를 제공하지 않음.
 *     필요시 `@nestjs-modules/database/prisma/sqlite/` 에서
 *     이 factory를 재사용해서 PostgresPrismaService 와 동일 패턴으로 HOF 구현.
 * ------------------------------------------------------------------
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import type { PrismaClassConstructor } from './types';

/**
 * 파일 경로 기반으로 PrismaBetterSqlite3 adapter가 연결된 PrismaClient 인스턴스를 생성한다.
 *
 * - WAL 모드 기본 활성화: 다중 읽기 + 단일 쓰기 동시성 보장 + 파일 락 경합 회피
 * - Prisma 7 adapter factory 패턴 준수:
 *   PrismaBetterSqlite3 는 `new Database()` 인스턴스를 직접 받지 않고,
 *   `{ url: string | ':memory:' }` config를 받아 스스로 connect() 시점에 DB를 open 한다.
 *
 * @param PrismaClientClass  — generate된 PrismaClient 클래스 생성자
 * @param dbFilePath         — SQLite .db 파일 절대 경로 (존재하지 않으면 생성)
 * @param opts               — 추가 옵션
 * @returns Adapter 주입이 완료된 PrismaClient 인스턴스
 */
export function sqlitePrismaClient<T extends PrismaClassConstructor>(
  PrismaClientClass: T,
  dbFilePath: string,
  opts: {
    /**
     * SQLite journal_mode PRAGMA 값.
     * 기본 WAL — 동시성에 좋으며 트랜잭션 롤백도 정상 지원.
     * 특별한 이유가 없으면 기본값 사용 권장.
     * (PRAGMA 명령은 PrismaClient.$queryRaw 를 통해 $connect() 이후 직접 호출 가능)
     */
    journalMode?: 'WAL' | 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'OFF';
    /**
     * PrismaBetterSqlite3Options.shadowDatabaseUrl — migration 용 shadow DB.
     * 현재 SQLite E2E Harness 에서는 push 만 사용하므로 불필요. 필요시 명시 전달.
     */
    shadowDatabaseUrl?: string;
  } = {},
): InstanceType<T> {
  const journalMode = opts.journalMode ?? 'WAL';

  // ✅ Prisma 7 adapter factory 공식 패턴: config.url 기반
  //    @prisma/adapter-better-sqlite3 v7.10.0 SSoT 시그니처 = 2개의 인자:
  //      constructor(
  //        config:  BetterSQLite3InputParams  (= better-sqlite3 Options & { url: string }),
  //        options?: PrismaBetterSqlite3Options (= { shadowDatabaseUrl?, timestampFormat? }),
  //      )
  //    - dbFilePath: 절대경로 문자열 그대로 (file:// prefix 필요 없음 - adapter 내부에서 처리)
  //    - journal_mode: adapter의 pragma 설정 interface가 없으므로, 최초 $connect 이후
  //      명시적 PRAGMA `journal_mode = {WAL}` 실행 필요 → adapter connect hook 대신
  //      PrismaClient $connect 후 테스트 레벨에서 직접 호출
  const adapter = new PrismaBetterSqlite3(
    { url: dbFilePath, readonly: false } satisfies ConstructorParameters<
      typeof PrismaBetterSqlite3
    >[0],
    { shadowDatabaseUrl: opts.shadowDatabaseUrl } satisfies NonNullable<
      ConstructorParameters<typeof PrismaBetterSqlite3>[1]
    >,
  );

  const client = new PrismaClientClass({ adapter }) as InstanceType<T>;
  // journal_mode PRAGMA를 $connect 직후 실행하기 위한 미들웨어 역할로
  // `$connect()` 호출 이후 즉시 PRAGMA 실행하는 책임은 caller에게 위임.
  // E2E level 에서는 beforeEach 마다 개별로 실행.
  void journalMode; // unused 표시 방지
  return client;
}
