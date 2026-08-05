/**
 * Emits `assets/icons/` from the same drawing code the tray uses at runtime
 * (`src/main/tray-icons.ts`), so the packaged icon and the live icon can never diverge.
 *
 *   npm run icons
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { TRAY_URGENCY_ORDER } from '../src/core/model/status.ts';
import { encodeIco, renderAppIcon, renderTrayIcon } from '../src/main/tray-icons.ts';

const outDir = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')), '..', 'assets', 'icons');

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const states = [...TRAY_URGENCY_ORDER, 'none'] as const;
  for (const state of states) {
    await writeFile(join(outDir, `tray-${state}.png`), renderTrayIcon(state, 0, 32));
    // One badge variant per state, as a visual reference for the badge geometry (F4).
    await writeFile(join(outDir, `tray-${state}-badge.png`), renderTrayIcon(state, 3, 32));
  }

  const appPng = renderAppIcon(256);
  await writeFile(join(outDir, 'app.png'), appPng);
  await writeFile(
    join(outDir, 'app.ico'),
    encodeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: renderAppIcon(size) }))),
  );

  process.stdout.write(`icons written to ${outDir}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
