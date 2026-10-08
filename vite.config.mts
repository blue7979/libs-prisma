/// <reference types='vitest' />
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - TS cannot resolve files outside rootDir that are required by vite config before path aliases
import { defineConfig } from 'vitest/config';
// nx-ignore-next-line
import { libViteConfig } from '../infra/kits/src/presets/vite/lib.vite';

export default defineConfig(() => {
  const config = libViteConfig(import.meta.dirname);
  return {
    ...config,
  };
});
