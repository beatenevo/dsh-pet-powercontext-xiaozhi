/** External pet addresses resolve to stable instance IDs, preserving history and remote memory ownership. */

/** Resolve either an internal ID or a configured API ID; ambiguous addresses fail closed. */
export function resolveApiPetId(config: Record<string, Record<string, unknown>>, address: string): string | null {
  const matches: string[] = [];
  for (const conf of Object.values(config)) {
    for (const pet of (Array.isArray(conf.pets) ? conf.pets : []) as Record<string, unknown>[]) {
      if (pet.id === address || pet.apiId === address) matches.push(String(pet.id));
    }
  }
  return matches.length > 1 ? null : (matches[0] ?? address);
}

/** Detect cross-entry alias and internal-ID collisions before saving an edited entry. */
export function petAddressConflicts(
  config: Record<string, Record<string, unknown>>,
  entry: string,
  pets: readonly Record<string, unknown>[],
): string[] {
  const owners = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const [key, conf] of Object.entries({ ...config, [entry]: { pets } })) {
    const list = (Array.isArray(conf.pets) ? conf.pets : []) as Record<string, unknown>[];
    for (const pet of list) {
      const owner = JSON.stringify([key, pet.id]);
      for (const address of new Set([String(pet.id), ...(pet.apiId ? [String(pet.apiId)] : [])])) {
        if (owners.has(address) && owners.get(address) !== owner) conflicts.add(address);
        owners.set(address, owner);
      }
    }
  }
  return [...conflicts];
}
