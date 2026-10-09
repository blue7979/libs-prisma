/**
 * @infra/prisma — Entry Point
 * ------------------------------------------------------------------
 * Prisma 관련 TypeScript 기반 실행 모음 (Shell Script prisma.sh 의 TS 재작성본)
 *
 * 모듈 계층 구조 (위에서 아래로 의존):
 *   - constants/         : PRISMA.* namespace 상수 (SSoT 패턴, definitions 와 동일 스타일)
 *   - types/index.d.ts   : PrismaEnv, PrismaOtsName, GenerateOptions 등 공유 타입 (barrel)
 *   - cli/utils.ts       : Prisma CLI spawn / 경로 유틸 / 환경변수 빌더 / cleanup
 *   - cli/generate.ts    : generate prisma client + manifest cache (Step ④ 이관 완료)
 *   - cli/push.ts        : prisma db push (forceReset / acceptDataLoss) (Step ④ 이관 완료)
 *   - cache/             : atomic tmp→rename schema manifest (Step ③ 이관 완료)
 *   - seed/              : prisma seed script 실행 (Step ⑤ 신규 구현 완료)
 *   - pipeline/          : push → generate → seed → studio 4단계 오케스트레이터 (Step ⑥ 신규 구현 완료)
 *   - studio/            : Prisma Studio 백그라운드 실행 (Step ⑥에서 함께 구현 완료)
 *   - connection/        : Prisma 전용 DB URL builder (Step ⑦ Option C — 완전 분리 구현 완료)
 * ------------------------------------------------------------------
 * 🔒 SSoT 패턴 (Single Source of Truth)
 *   - PrismaDatabaseType : @infra/definitions Docker.Config.PrismaDatabaseType
 *   - PrismaOtsName      : @infra/config OtsInstanceName<T> alias (ConfigEnvironmentPaths derive)
 *   → constants/docker.ts / config.local.json 수정시 타입 자동 동기화
 */

export * from './constants';
export type * from './types';
export * from './cli';
export * from './cache';
export * from './seed';
export * from './pipeline';
export * from './studio';
export * from './connection';
export * from './runtime';
