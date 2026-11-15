'use strict';
/**
 * DPI and pointer: detection and caching of main screen zoom, forced zoom switch, renderer scale conversion, cursor
 * position.
 *
 * 线性化必须赶在 ready 之前 appendSwitch，所以工厂在 main.js 顶层调用；探测子进程复用同一个
 * main.js（mainPath 传入），只打一行 scaleFactor 就退出。启动时优先用缓存；缓存是旧值（串流、
 * 远程桌面改过缩放）时窗口会按错误倍数建出来，运行期靠 displays 的自查 + setPrimaryScale 纠正。
 * @module dsh-pet/runtime/electron-helper/main-dpi
 */

const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { shouldLinearize, resolveForcedScale, resolvePetScale } = require('../dpi-linearization.js');

/**
 * Create DPI/pointer ability.
 *
 * @param deps.app - Electron app (userData path and command line switches).
 * @param deps.screen - Electron screen (main screen zoom and cursor fallback).
 * The absolute path of @param deps.mainPath - main.js: detect that the child process needs to restart the same script.
 * @param deps.linuxPointer - X11 pointer provider for Linux; other platforms pass null.
 * @param deps.dpiProbe - Whether this is the detection sub-process of "Print Zoom Only".
 * @param deps.dpiMark - Marker prefix in probe output.
 * @param deps.forceDsf - DSH_PET_FORCE_DSF Original value (unset i.e. undefined).
 */
function createDpi({ app, screen, mainPath, linuxPointer, dpiProbe, dpiMark, forceDsf }) {
  /**
   * Current cursor position (DIP). Linux : X11 Live value (physical pixels ÷ scale) of QueryPointer; not yet ready for
   * other platforms or queries: Electron native API .
   */
  function currentPointer() {
    const raw = linuxPointer && linuxPointer.get();
    if (!raw) return screen.getCursorScreenPoint();
    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    return scale === 1 ? raw : { x: Math.round(raw.x / scale), y: Math.round(raw.y / scale) };
  }

  /** Home screen zoom cache file (userData is available before ready) */
  function dpiCacheFile() {
    return path.join(app.getPath('userData'), 'primary-scale.json');
  }

  function readCachedPrimaryScale() {
    try {
      const v = Number(JSON.parse(readFileSync(dpiCacheFile(), 'utf8')).scaleFactor);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return 0; // First startup/file corruption: Treat as no cache, re-detect
    }
  }

  /**
   * 写缓存。
   *
   * @param value - 主屏缩放。
   * @returns 是否写成功；写不进去时调用方要能说清「下次冷启动仍会读到旧值」。
   */
  function writeCachedPrimaryScale(value) {
    try {
      writeFileSync(dpiCacheFile(), JSON.stringify({ scaleFactor: value }), 'utf8');
      return true;
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] write dpi cache failed:', String(e && e.message ? e.message : e));
      return false;
    }
  }

  /** Catch scaleFactor from the output of the probing child process (0 = not caught) */
  function parseProbeOutput(text) {
    const m = new RegExp(dpiMark + '([0-9.]+)').exec(String(text || ''));
    const v = m ? Number(m[1]) : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  /** 探测子进程的环境与超时设置 */
  function dpiProbeOptions() {
    return {
      env: { ...process.env, DSH_PET_DPI_PROBE: '1', DSH_PET_BRIDGE: '0', DSH_PET_SMOKE: '0' },
      timeout: 20000,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
  }

  /**
   * 探测子进程的命令行开关。
   *
   * 必须与主进程同一套：沙箱起不来的机器上，宿主的自动回退会改用 --no-sandbox，不带上的话探测
   * 子进程一启动就 0x80000003，主进程活着、缓存却永远写不出来，每次开机都要白探一次。
   */
  function dpiProbeArgs() {
    return app.commandLine.hasSwitch('no-sandbox') ? ['--no-sandbox'] : [];
  }

  /** Start the detection sub-process to read the main screen scaleFactor (the same electron + the same main.js, take the dpiProbe branch) */
  function probePrimaryScale() {
    let out = '';
    try {
      out = execFileSync(process.execPath, [...dpiProbeArgs(), mainPath, '--dsh-pet-dpi-probe'], dpiProbeOptions());
    } catch (e) {
      // Only stdout is recognized, but the exit code is not recognized: The Electron process call app.exit() without
      // opening a window occasionally produces 0xC0000005 (exit period access violation) on Windows, but the value
      // has already been written out at that time, and throwing it away is a waste of a cold start.
      out = e && e.stdout ? String(e.stdout) : '';
      if (!parseProbeOutput(out)) {
        const detail = [
          e && e.status !== undefined ? 'status=' + e.status : '',
          e && e.stderr ? 'stderr=' + String(e.stderr).trim().slice(0, 300) : '',
        ]
          .filter(Boolean)
          .join(' ');
        console.error(
          '[dsh-pet-desktop-helper] dpi probe failed:',
          String(e && e.message ? e.message : e).split('\n')[0],
          detail,
        );
        return 0; // Detection failed: switch is not added and returns to screen-by-screen DIP behavior
      }
    }
    const v = parseProbeOutput(out);
    if (v > 0) writeCachedPrimaryScale(v);
    return v;
  }

  /**
   * 异步探一次真实主屏缩放。
   *
   * 运行期自查发生在宠物已经在动的时候，不能像启动那样阻塞主进程 0.3–0.6 秒。本函数不写缓存，
   * 调用方比对后自行决定是否 writeCachedPrimaryScale。
   *
   * @returns 真实缩放；探测失败或输出里没有值时 0（不抛）。
   */
  function probePrimaryScaleAsync() {
    return new Promise((resolve) => {
      const done = (error, stdout) => {
        // 与同步版同一口径：退出码不作数，stdout 里有值就算数（退出期访问违例不影响已写出的值）
        const value = parseProbeOutput(stdout);
        if (!(value > 0) && error) {
          console.error(
            '[dsh-pet-desktop-helper] dpi probe failed:',
            String(error && error.message ? error.message : error).split('\n')[0],
          );
        }
        resolve(value);
      };
      try {
        execFile(process.execPath, [...dpiProbeArgs(), mainPath, '--dsh-pet-dpi-probe'], dpiProbeOptions(), done);
      } catch (error) {
        console.error(
          '[dsh-pet-desktop-helper] dpi probe failed:',
          String(error && error.message ? error.message : error).split('\n')[0],
        );
        resolve(0);
      }
    });
  }

  /** Real home screen scaleFactor (detected; 0 = unknown). After linearization is turned on, screen API will only report 1, so you can only rely on it. */
  let PRIMARY_SCALE = 0;
  /** Actual forced scaling (0 = not enabled, the coordinate system maintains the screen-by-screen DIP before repair) */
  let FORCED_SCALE = 0;
  if (shouldLinearize({ platform: process.platform, dpiProbe, forceDsf })) {
    // Detection failure can only be degraded to "no compensation", and the entire helper cannot be taken away: under
    // restricted token
    // Both getPath (' userData ') and the detection subprocess may fail, and the process will end directly before
    // ready without logs.
    try {
      PRIMARY_SCALE = readCachedPrimaryScale() || probePrimaryScale();
      const forced = resolveForcedScale({ forceDsf, primaryScale: PRIMARY_SCALE });
      if (forced > 0) {
        app.commandLine.appendSwitch('force-device-scale-factor', String(forced));
        FORCED_SCALE = forced;
      }
    } catch (error) {
      console.error(
        '[dsh-pet-desktop-helper] DPI detection failed; continuing without compensation:',
        String(error && error.message ? error.message : error),
      );
      PRIMARY_SCALE = 0;
      FORCED_SCALE = 0;
    }
  }

  /**
   * 校正运行中的主屏缩放。调用方须在之后重建窗口，petScale() 才会落进新窗口。
   *
   * @param value - 探测到的真实缩放；非数字或非正数时忽略。
   */
  function setPrimaryScale(value) {
    const scale = Number(value);
    if (Number.isFinite(scale) && scale > 0) PRIMARY_SCALE = scale;
  }

  /**
   * CONFIG.scale of renderer: Baseline × physical pixel compensation given by host. After linearization is turned on,
   * 1 logical pixel = 1 physical pixel, and the pet zooms back to the original look and feel according to the home
   * screen.
   */
  function petScale() {
    return resolvePetScale({
      baseScale: process.env.DSH_PET_SCALE,
      primaryScale: PRIMARY_SCALE,
      forcedScale: FORCED_SCALE,
    });
  }

  return {
    currentPointer,
    petScale,
    probePrimaryScale,
    probePrimaryScaleAsync,
    readCachedPrimaryScale,
    setPrimaryScale,
    writeCachedPrimaryScale,
    get primaryScale() {
      return PRIMARY_SCALE;
    },
    get forcedScale() {
      return FORCED_SCALE;
    },
  };
}

module.exports = { createDpi };
