/**
 * @infra/prisma — 공통 타입 SSoT Entry Point (Barrel ONLY)
 * ------------------------------------------------------------------
 * 🔒 이 파일에는 export 재집계 이외의 구현 코드 / 타입 정의가 들어갈 수 없다.
 * 세부 타입 정의는 같은 폴더 내 각 도메인별 파일에 작성한다.
 *
 * 분할 규칙 (type-definitions.md §2):
 *   - 500줄 초과시 논리 그룹으로 같은 폴더에 .d.ts 분산
 *   - 의존성: core.d.ts (최하단 기반) → cli/cache/seed/studio/pipeline/connection
 *   - Upward Dep 금지: core.d.ts 는 형제 파일 import ❌
 *   - 형제 간 중복 타입: 부모 레벨(여기 또는 core.d.ts)로 승격 강제
 *
 * 하위 파일 목록:
 *   - ./core.d.ts       : 기반 타입 (SSoT derive / env / util)
 *   - ./cli.d.ts        : CLI / generate / push / cleanup 타입
 *   - ./cache.d.ts      : Cache manifest / discovery 타입
 *   - ./seed.d.ts       : Seed 스크립트 실행 타입
 *   - ./studio.d.ts     : Prisma Studio 백그라운드 실행 타입
 *   - ./pipeline.d.ts   : 4단계 retry 오케스트레이터 타입
 *   - ./connection.d.ts : Prisma 전용 Connection URL 빌더 타입
 */

export * from './core';
export * from './cli';
export * from './cache';
export * from './seed';
export * from './studio';
export * from './pipeline';
export * from './connection';
