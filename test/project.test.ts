import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { cursorProperty, findProject, hasScripts, isSourceChange, parseReport, projectName } from "../src/gui/project"

const roots: string[] = []

const scaffold = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "rive-sidebar-"))
  roots.push(root)

  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(join(file, ".."), { recursive: true })
    writeFileSync(file, content)
  }

  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("findProject", () => {
  test("finds the directory itself", () => {
    const root = scaffold({ "rive.yaml": "name: a\n" })
    expect(findProject(root)).toBe(root)
  })

  test("finds the nearest ancestor", () => {
    const root = scaffold({ "rive.yaml": "name: a\n", "scenes/deep/x.rml": "" })
    expect(findProject(join(root, "scenes/deep"))).toBe(root)
  })

  test("finds a project two levels below", () => {
    const root = scaffold({ "apps/anim/rive.yaml": "name: a\n" })
    expect(findProject(root)).toBe(join(root, "apps/anim"))
  })

  test("skips dependencies and dot directories", () => {
    const root = scaffold({ "node_modules/pkg/rive.yaml": "", ".cache/pkg/rive.yaml": "" })
    expect(findProject(root)).toBeNull()
  })
})

test("projectName reads the manifest, else the directory", () => {
  expect(projectName("/x/dir", 'logs:\n  file: a\nname: "my-scene" # note\n')).toBe("my-scene")
  expect(projectName("/x/dir", "logs:\n  name: nested\n")).toBe("dir")
})

test("cursorProperty reads the cursor block only", () => {
  expect(cursorProperty("name: a\ncursor:\n  property: ui/cursor\n")).toBe("ui/cursor")
  expect(cursorProperty("name: a\nother:\n  property: nope\n")).toBeNull()
})

test("hasScripts looks at sources, not build output", () => {
  expect(hasScripts(scaffold({ "scripts/main.luau": "" }))).toBe(true)
  expect(hasScripts(scaffold({ "fx.wgsl": "" }))).toBe(true)
  expect(hasScripts(scaffold({ "scene.rml": "", "build/old.luau": "", "node_modules/a.as": "" }))).toBe(false)
})

test("isSourceChange ignores what a build writes", () => {
  expect(isSourceChange("scene.rml", "build")).toBe(true)
  expect(isSourceChange("art/logo.png", "build")).toBe(true)
  expect(isSourceChange("build/states/a.png", "build")).toBe(false)
  expect(isSourceChange("build", "build")).toBe(false)
  expect(isSourceChange("custom.log", "build")).toBe(false)
  expect(isSourceChange(".git/HEAD", "build")).toBe(false)
})

describe("parseReport", () => {
  test("reads a success among log lines", () => {
    const stdout = `[10:09:14.939] rive  built build/a.riv\n{"success": true, "command": "build", "data": {"riv": "./build/a.riv", "bytes": 1, "buildMs": 47.0, "problems": []}, "errors": [], "warnings": []}\n`
    expect(parseReport(stdout)).toEqual({ ok: true, riv: "./build/a.riv", buildMs: 47, problems: [] })
  })

  test("reads located problems and drops duplicates", () => {
    const stdout = JSON.stringify({
      success: false,
      errors: [{ file: "scene.rml", line: 3, message: "bad" }, { file: "scene.rml", line: 3, message: "bad" }, "plain"],
      warnings: ["careful"],
    })
    expect(parseReport(stdout)?.problems).toEqual([
      { severity: "error", message: "scene.rml:3: bad" },
      { severity: "error", message: "plain" },
      { severity: "warning", message: "careful" },
    ])
  })

  test("is null without a report", () => {
    expect(parseReport("rive: command not found\n")).toBeNull()
  })
})
