import { isAliveSync } from '../../src/core/registry/liveness.ts';

/**
 * PIDs that signal 0 reads as dead. Starts at the top of the 31-bit range and steps by 4
 * because Windows ignores the low two PID bits, so neighbours would alias one another.
 */
export function deadPids(count: number): number[] {
  const found: number[] = [];
  for (let pid = 0x7ffffffc; found.length < count && pid > 0; pid -= 4) {
    if (!isAliveSync(pid)) found.push(pid);
  }
  return found;
}
