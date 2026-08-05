/**
 * Runs once per test file. Fixture trees are temp directories — the cold-start tree is
 * ~250 MB — so they are deleted when the file finishes rather than left behind.
 */

import { afterAll } from 'vitest';
import { cleanupFixtureTrees } from './fixtures/builders.ts';

afterAll(async () => {
  await cleanupFixtureTrees();
});
