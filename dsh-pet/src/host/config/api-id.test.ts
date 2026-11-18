/** API address changes preserve the instance and its existing history and PowerContext scope. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { petAddressConflicts, resolveApiPetId } from './api-id.ts';
import { readAllConfig, findPetInstance, saveUserConfig } from '../config.ts';
import { createPetRouter } from '../routes/index.ts';
import type { PetRouteDeps } from '../routes/types.ts';

test('aliases resolve before history, memory and action routing, while disk identity stays unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pet-api-id-'));
  const configPaths = {
    defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
    userFile: join(root, 'main-config.jsonc'),
    petDir: join(root, 'pet'),
  };
  const memoryPath = join(root, 'memory.json');
  try {
    const base = readAllConfig(configPaths);
    const pet = (base.main.pets as Record<string, unknown>[])[0];
    const id = String(pet.id);
    const messages = [
      { role: 'user', content: 'I like tea', ts: 1 },
      { role: 'assistant', content: 'Remembered', ts: 1 },
    ];
    const journal = {
      main: {
        [id]: {
          messages,
          powercontext: { target: { scopeId: 'existing-scope', pending: [{ id: 'pending-source' }] } },
        },
      },
    };
    writeFileSync(memoryPath, JSON.stringify(journal));
    const before = readFileSync(memoryPath, 'utf8');
    const deps = {
      configPaths,
      memoryPath,
      log: { error() {} },
      memoryRounds: () => 10,
      readMemory: async () => JSON.parse(readFileSync(memoryPath, 'utf8')),
      sleepBlocked: () => null,
      requirePet(params: URLSearchParams) {
        const petId = params.get('pet')!;
        const found = findPetInstance(readAllConfig(configPaths), petId);
        assert.ok(found);
        return { ok: true, petId, ...found };
      },
      memoryStatus: async (petId: string) => journal.main[petId].powercontext.target,
      syncMemory: async () => {},
    } as unknown as PetRouteDeps;
    const route = createPetRouter(deps);
    for (const apiId of ['demo-fish', 'demo-fish-new']) {
      const saved = saveUserConfig({ pets: [{ ...pet, apiId }] });
      assert.ok(saved);
      writeFileSync(configPaths.userFile, JSON.stringify(saved));
      const config = readAllConfig(configPaths);
      assert.equal(resolveApiPetId(config, apiId), id);
      const response = await route(new URL(`http://localhost/?pet=${apiId}`), 'chat', 'GET');
      assert.equal(response.kind, 'json');
      if (response.kind === 'json') assert.deepEqual((response.obj as { messages: unknown }).messages, messages);
      const memory = await route(new URL(`http://localhost/?pet=${apiId}`), 'chat/powercontext', 'GET');
      if (memory.kind !== 'json') throw new Error('Expected memory response');
      assert.deepEqual(memory.obj, journal.main[id].powercontext.target);
      assert.equal(readFileSync(memoryPath, 'utf8'), before);
      // Older settings clients that omit the alias must not silently erase it.
      assert.equal((saveUserConfig({ pets: [pet] }, saved)!.pets[0] as Record<string, unknown>).apiId, apiId);
    }
    assert.equal(resolveApiPetId(readAllConfig(configPaths), 'demo-fish'), 'demo-fish');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reject duplicate aliases and collisions with internal IDs across entries', () => {
  const config = { main: { pets: [{ id: 'a', apiId: 'fish' }] }, pack: { pets: [{ id: 'b' }] } };
  assert.deepEqual(petAddressConflicts(config, 'pack', [{ id: 'b', apiId: 'fish' }]), ['fish']);
  assert.deepEqual(petAddressConflicts(config, 'main', [{ id: 'a', apiId: 'b' }]), ['b']);
  assert.equal(
    resolveApiPetId(
      {
        main: {
          pets: [
            { id: 'a', apiId: 'x' },
            { id: 'b', apiId: 'x' },
          ],
        },
      },
      'x',
    ),
    null,
  );
});
