/**
 * @file Prisma Seed — seed script 실행 관련 상수
 */
/**
 * vite-node 로 실행할 seed entry point 상대 경로 (projectRoot 기준).
 * package.json "prisma": { "seed": "npx vite-node src/seeds/index.ts" } 와 1:1 매칭.
 * 변경시 package.json 쪽도 함께 동기화 필요.
 */
const SEED_ENTRY_PATH = 'src/seeds/index.ts' as const;
/**
 * Seed 결과가 성공으로 간주되는 exit code 리터럴.
 * 현재 0 (성공) 만 허용하며, 나중에 seed skip 을 별도 코드로 분리할 경우 이 곳에 추가.
 */
const SEED_SUCCESS_EXIT_CODES = [0] as const;

export { SEED_ENTRY_PATH, SEED_SUCCESS_EXIT_CODES };
