"""Render build summaries without treating missing requested platforms as success."""

import argparse
import json
from pathlib import Path

from common import INPUTS, PACKAGE, distribution_platform, read_json


def main():
    platforms = set(read_json(INPUTS / "distributions.json")["platforms"])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--platform", choices=sorted(platforms), help="Summarize one native build job")
    args = parser.parse_args()
    reports = {item["platform"]: item for path in args.directory.glob("sizes-*.json")
               if (item := read_json(path))}
    expected = {args.platform} if args.platform else platforms
    if args.platform:
        reports = {target: report for target, report in reports.items() if target == args.platform}
    version = read_json(PACKAGE / "package.json")["version"]
    lines = ["# Choose a download", "",
             "Choose the OS and architecture of the computer running DSH or the pet, not the robot.", "",
             "- `plugin`: install into DSH, or use with an existing Node.js runtime.",
             "- `desktop`: extract and run on Windows; Electron/Node is included.",
             "- `standard`: no bundled Astra Python/SDK environment.",
             "- `astra-pro-2.0-bundled`: private Python, Astra SDK and control dependencies included; no OpenCV or NumPy.",
             "- `runtime-only`: environment files only, without the pet; already included in the robot bundles.",
             "Size and validation reports are shown here only; download artifacts contain packages.", "",
             "No package bundles DSH, the powercontext-dsh plugin, or PowerContext Server.", "",
             "| Artifact group | Use | File inside |", "| --- | --- | --- |",
             f"| `dsh-pet-powercontext-plugin-standard-all-platforms` | Standard plugin | `dsh-pet-powercontext-{version}.tgz` |"]
    for target in sorted(expected):
        if target not in reports:
            continue
        group = f"dsh-pet-powercontext-astra-pro-2.0-bundles-{distribution_platform(target)}"
        for key, purpose in (("plugin", "Plugin with robot environment"),
                             ("desktopSlim", "Windows desktop with robot environment"),
                             ("desktop", "Standard Windows desktop"),
                             ("runtime", "Runtime only; no pet")):
            if key in reports[target]:
                lines.append(f"| `{group}` | {purpose} | `{reports[target][key]['file']}` |")
    lines.extend(["", "# Package sizes", "", "All sizes are MiB (1,048,576 bytes). Unpacked values count file payloads, not filesystem allocation.", "",
             "| Platform | Python before SDK | Robot runtime archive / unpacked | Slim npm archive / unpacked | Node dependencies |",
             "| --- | ---: | ---: | ---: | ---: |"])
    mib = lambda count: f"{count / 1048576:.1f}"
    pair = lambda item: f"{mib(item['compressedBytes'])} / {mib(item['unpackedBytes'])}"
    for target in sorted(expected):
        if target not in reports:
            lines.append(f"| {target} | MISSING | MISSING | MISSING | MISSING |")
            continue
        report = reports[target]
        if report["profile"] != "slim":
            raise ValueError(f"Unexpected runtime profile: {target}")
        lines.append(f"| {distribution_platform(target)} | {mib(report['pythonBytes'])} | {pair(report['runtime'])} | {pair(report['plugin'])} | {mib(report['nodeDependencyBytes'])} |")
    if (windows := reports.get("win32-x64")) and "desktop" in windows:
        lines.extend(["", f"Windows desktop baseline: **{pair(windows['desktop'])} MiB** (archive / unpacked).",
                      f"Windows desktop with slim robot runtime: **{pair(windows['desktopSlim'])} MiB**.", ""])
    lines.extend(["", "Slim npm archives include the pet, private Python, vendor SDK protocol modules, pinned control dependencies and bundled Node runtime dependencies. OpenCV and NumPy are excluded. Node/DSH itself is a prerequisite; the Windows desktop archive also includes Electron/Node.", "",
                  "Checks: dependency closure allowing only the vendor SDK's two intentionally missing OpenCV requirements; absent OpenCV/NumPy; generated SDK protocol imports; relocated and isolated interpreter; real SDK loopback status/action/group/speech/three-stop RPCs; compressed archive extraction; npm install offline with an empty cache.", "",
                  "These artifacts are previews, not npm publications. No physical robot was connected. Native OS libraries are not an operating system image."])
    for target in sorted(expected & reports.keys()):
        lines.extend(["", "<details>", f"<summary>{distribution_platform(target)}: checksums, components and validation</summary>",
                      "", "```json", json.dumps(reports[target], ensure_ascii=False, indent=2), "```", "", "</details>"])
    text = "\n".join(lines) + "\n"
    print(text)
    (args.directory / "SIZE-REPORT.md").write_text(text, encoding="utf-8")
    if set(reports) != expected:
        raise SystemExit("Not all requested native platform reports are present")


if __name__ == "__main__":
    main()
