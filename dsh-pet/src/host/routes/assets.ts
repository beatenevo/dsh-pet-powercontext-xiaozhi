/**
 * Static asset: file retrieval and path guard for / font, / pic (including meme chain), / sound, / thumb.
 *
 * 不决定素材归属，只按各 scope 的固定次序查找（用户层优先、包内兜底）。
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-pet/src/host/routes/assets
 */
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';
import { MIME, resolveAsset, resolveExisting } from '../http.ts';
import { isValidPetId } from '../config.ts';
import { petAvatarFile } from '../pet-avatar.ts';
import { existsSync } from 'node:fs';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** Static asset field: undefined is returned on a miss and response is returned on a hit. */
export async function handleAssetsRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { assetRootFor, memeDirsFor, petConfigDir, userRoot, userRootFor } = deps;
  const { rest, url } = input;

  // Animation asset:/thumb/<asset root>/<file>, extension webm (default)/mov (macOS customized). Pets with
  // `pet/<asset-root>-animation/` will only check their own directory. If not found, it will be 404, and will never be mixed;
  // otherwise, the main asset chain will be used: user main-animation /< ext > takes priority → assets /< ext > in the
  // package (shared by all main configuration pets). mov (HEVC-with-Alpha) is not released with the package. Users
  // download GitHub Release and then play main-animation/mov /, and change the client playback constant ANIMATION_EXT
  // to . mov. font / pic are flat /< scope >/< file >, only thumb is /< scope >/< petId >/< file >: first disassemble
  // scope and then disassemble the remaining segments respectively.
  const [scope, ...restParts] = rest.split('/');

  // Plugin logo / Pet avatar: / logo → assets/logo.png in the package. Only allow this file - do not open the assets
  // root into a static directory (there is also config.jsonc in the same directory). Use it as a pet avatar in the
  // dialogue panel. With ? root =<asset root>, first look for the custom avatar of the pet (pet /<asset root>- avatar
  // .<ext>). If not, fallback to logo in the package: "Not uploaded" and "Deleted after uploading" are both fallbacked
  // by this fallback, and the front end does not need to distinguish. main does not check custom files: pet / only pet
  // pack, built-in entries always use the package logo. The parameter is called root instead of pet: what is needed
  // here is the asset root (directory prefix), not pets []. id.
  if (scope === 'logo') {
    if (restParts.length > 0) return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/logo' };
    const assetRoot = (url.searchParams.get('root') ?? '').trim();
    if (assetRoot !== '' && assetRoot !== 'main') {
      // The asset root is an identifier and not a path fragment: contains delimiter/reserved character i.e. explicit 400, earlier than any path concatenate.
      if (!isValidPetId(assetRoot)) return { kind: 'text', status: 400, body: 'dsh-pet: invalid asset root' };
      const own = petAvatarFile(petConfigDir, assetRoot);
      if (own !== undefined) return { kind: 'file', file: own.file, contentType: own.contentType };
    }
    const logo = resolveExisting(join(PACKAGE_ROOT, 'assets'), 'logo.png');
    if (logo === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: logo not found' };
    return { kind: 'file', file: logo, contentType: MIME['.png'] ?? 'image/png' };
  }

  if (scope === 'font') {
    const fontRoot = join(PACKAGE_ROOT, 'assets', 'fonts');
    const fontFile = resolveExisting(fontRoot, restParts.join('/'));
    if (fontFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: font not found' };
    const ext = fontFile.slice(fontFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: fontFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  // 通知图标、拖拽光标、玩法图：/pic/<file> → 用户层 $DSH_HOME/dsh-pet/pic/ 优先，包内 assets/pic 兜底。
  // 用户层是为了自定义图标能活过插件升级——升级重装会把包内 assets 还原成内置那套。
  // 表情包：/pic/memes/<素材根>/<名称>.png → 按素材根走 memeDirsFor 的目录链，与 /thumb 同一套
  // 归属语义；名称含中文，URL 段已在上方解码。旧的两段形式 /pic/memes/<名称>.png 保留，
  // 等价于素材根 main 的目录链。
  if (scope === 'pic') {
    if (restParts[0] === 'memes') {
      const segs = restParts.slice(1);
      // Number of segments ≥ 2 = <asset root>/<name…>; exactly 1 segment = old flat form. The name of the emoticon
      // package is the file name (excluding subdirectories), so the two forms are not ambiguous; the asset root has
      // the same rules as petId of / thumb: it contains the delimiter / reserved character, which is explicit 400.
      const scoped = segs.length >= 2;
      const assetRoot = scoped ? segs[0] : 'main';
      if (scoped && !isValidPetId(assetRoot)) {
        return { kind: 'text', status: 400, body: 'dsh-pet: invalid asset root' };
      }
      const rel = (scoped ? segs.slice(1) : segs).join('/');
      let picFile: string | undefined;
      for (const dir of memeDirsFor(assetRoot)) {
        picFile = resolveExisting(dir, rel);
        if (picFile !== undefined) break;
      }
      if (picFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: pic not found' };
      const ext = picFile.slice(picFile.lastIndexOf('.')).toLowerCase();
      return { kind: 'file', file: picFile, contentType: MIME[ext] ?? 'application/octet-stream' };
    }
    const picRel = restParts.join('/');
    // 两层同一道守卫：resolveExisting 只放行根目录内的相对路径，用户层不额外开口子
    const picFile =
      resolveExisting(join(userRoot, 'pic'), picRel) ?? resolveExisting(join(PACKAGE_ROOT, 'assets', 'pic'), picRel);
    if (picFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: pic not found' };
    const ext = picFile.slice(picFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: picFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  // Click sound effect: / dsh-pet-7340/sound /< file > → assets/sound in the package (currently only click-duck.wav).
  // The same flat form as font (< scope >/< file >): only one copy in the package, no user directory coverage.
  if (scope === 'sound') {
    const soundRoot = join(PACKAGE_ROOT, 'assets', 'sound');
    const soundFile = resolveExisting(soundRoot, restParts.join('/'));
    if (soundFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: sound not found' };
    const ext = soundFile.slice(soundFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: soundFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  if (scope !== 'thumb') {
    return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/thumb/<petId>/<file>' };
  }

  // thumb is a three-stage format: /< scope >/< petId >/< file >——From here, we can disassemble the pet id and the file name.
  const [petId, ...nameParts] = restParts;

  if (!petId || nameParts.length === 0) {
    return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/thumb/<petId>/<file>' };
  }

  // petId is an identifier (= pet/<name>-<name> of animation/, the source is the file name prefix under pet/), not a
  // path fragment: contains delimiter/reserved character i.e. explicit 400, earlier than any path concatenate
  // determination. Valid names (including Chinese) are as usual - use the invalid character class instead of the ASCII
  // whitelist. Invalid inputs no longer silently fallback to the main asset pool (attack attempts can be distinguished
  // from "no independent asset"), leaving another structural line of defense in addition to the resolveAsset below.
  if (!isValidPetId(petId)) {
    return { kind: 'text', status: 400, body: 'dsh-pet: invalid pet id' };
  }

  const fileName = nameParts.join('/');

  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

  if (ext !== '.webm' && ext !== '.mov') {
    return { kind: 'text', status: 400, body: 'dsh-pet: unsupported animation format (expected .webm or .mov)' };
  }

  // Asset ownership: If `pet/<asset-root>-animation/` exists, only check its own directory (the only exception: when mov is
  // missing, the same name webm will be returned), otherwise the main asset chain will be used. extraAnimDir must pass
  // through resolveAsset first: petId is the decoded URL segment. The backslash decoded by %5 C on Windows will not be
  // cut by split ('/'). Direct join will cause `..\..\x` to escape the user root reading disk.
  const extraAnimDir = resolveAsset(petConfigDir, petId + '-animation');

  /** Check the asset with the same name by extension (private directory takes precedence; otherwise user root → package root) */
  const findAnim = (e: string): string | undefined => {
    const name = fileName.replace(/\.(webm|mov)$/i, '') + e;
    return extraAnimDir !== undefined && existsSync(extraAnimDir)
      ? resolveExisting(extraAnimDir, name)
      : (resolveExisting(userRootFor(e), name) ?? resolveExisting(assetRootFor(e), name));
  };

  let file = findAnim(ext);

  let servedExt = ext;

  // mov (HEVC-with-Alpha, macOS customized) is not released with the package: if missing, the same name webm will be
  // returned. The host is the only party that knows whether the asset is present - it would rather have Safari
  // broadcast a black background (alpha of webm is discarded) than have the entire animation 404 (the performance is
  // that the pet is not displayed at all).
  if (file === undefined && ext === '.mov') {
    const fb = findAnim('.webm');
    if (fb !== undefined) {
      file = fb;
      servedExt = '.webm';
    }
  }

  if (file === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: asset not found' };

  return { kind: 'file', file, contentType: MIME[servedExt] ?? 'application/octet-stream' };
}
