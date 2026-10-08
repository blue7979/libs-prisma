/**
 * @file Prisma CLI — 공통 기본값 상수
 */
const CLI_DEFAULT_STDIO = 'pipe' as const;
const CLI_RETRY_MAX = 30 as const;
const CLI_RETRY_DELAY_MS = 3_000 as const;

export { CLI_DEFAULT_STDIO, CLI_RETRY_MAX, CLI_RETRY_DELAY_MS };
