import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path"
import type { Problem } from "./contract"

const MANIFEST = "rive.yaml"
const SEARCH_DEPTH = 2
const SEARCH_LIMIT = 500
const SKIPPED_DIRS = new Set(["node_modules", "build", "dist", "target", "vendor"])
const SCRIPT_EXTENSIONS = new Set([".luau", ".as", ".wgsl"])
const GENERATED_EXTENSIONS = new Set([".riv", ".rev", ".log"])

const skipDir = (name: string) => name.startsWith(".") || SKIPPED_DIRS.has(name)

const subdirs = (directory: string) => {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !skipDir(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** The Rive project a directory belongs to: itself, its nearest ancestor, else the first one a little below it. */
export function findProject(directory: string): string | null {
  let current = resolve(directory)

  while (true) {
    if (existsSync(join(current, MANIFEST))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  let level = [resolve(directory)]
  let visited = 0

  for (let depth = 0; depth < SEARCH_DEPTH; depth++) {
    const next: string[] = []

    for (const parent of level) {
      for (const name of subdirs(parent)) {
        const child = join(parent, name)
        if (existsSync(join(child, MANIFEST))) return child
        if (++visited >= SEARCH_LIMIT) return null
        next.push(child)
      }
    }

    level = next
  }

  return null
}

/** The manifest's top-level `name`, else the directory's. */
export function projectName(project: string, manifest = readManifest(project)): string {
  return manifest.match(/^name:[ \t]*["']?([^"'\r\n#]+?)["']?[ \t]*(?:#.*)?$/m)?.[1] ?? basename(project)
}

/** The view model property from `cursor:\n  property: <path>` in rive.yaml. */
export function cursorProperty(manifest: string): string | null {
  return manifest.match(/^cursor:[ \t]*\r?\n[ \t]+property:[ \t]*["']?([^"'\s#]+)/m)?.[1] ?? null
}

export function readManifest(project: string): string {
  try {
    return readFileSync(join(project, MANIFEST), "utf8")
  } catch {
    return ""
  }
}

/** Whether the project has sources that a web runtime refuses to run until `--publish` signs them. */
export function hasScripts(project: string): boolean {
  const pending = [project]
  let visited = 0

  while (pending.length > 0 && visited++ < SEARCH_LIMIT) {
    const directory = pending.pop()!
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDir(entry.name)) pending.push(join(directory, entry.name))
      } else if (SCRIPT_EXTENSIONS.has(extname(entry.name))) {
        return true
      }
    }
  }

  return false
}

/**
 * Whether a changed path is a source worth a rebuild, and not something a build wrote or a tool's dot-directory.
 * Both paths are relative to the project.
 */
export function isSourceChange(file: string, outputDir: string): boolean {
  const parts = file.split(sep)

  if (parts.some((part) => part.startsWith("."))) return false
  if (GENERATED_EXTENSIONS.has(extname(file))) return false

  const fromOutput = relative(outputDir, file)
  return fromOutput.startsWith("..")
}

export interface BuildReport {
  ok: boolean
  /** The built file, relative to the project. */
  riv: string | null
  buildMs: number | null
  problems: Problem[]
}

const toText = (value: unknown): string => {
  if (typeof value === "string") return value
  if (value === null || typeof value !== "object") return String(value)

  const entry = value as Record<string, unknown>
  const message = typeof entry.message === "string" ? entry.message : JSON.stringify(value)
  const file = entry.file ?? entry.path
  const line = entry.line

  return typeof file === "string" ? `${file}${typeof line === "number" ? `:${line}` : ""}: ${message}` : message
}

/** Reads the one JSON envelope `--format=json` prints on stdout, among whatever log lines surround it. */
export function parseReport(stdout: string): BuildReport | null {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    if (!line.startsWith("{")) continue

    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (typeof parsed.success !== "boolean") continue

    const problems = new Map<string, Problem>()
    const add = (severity: Problem["severity"], items: unknown) => {
      if (!Array.isArray(items)) return
      for (const item of items) {
        const message = toText(item)
        problems.set(`${severity}:${message}`, { severity, message })
      }
    }

    add("error", parsed.errors)
    add("warning", parsed.warnings)
    if (problems.size === 0 && !parsed.success && typeof parsed.error === "string") add("error", [parsed.error])

    return {
      ok: parsed.success,
      riv: typeof parsed.data?.riv === "string" ? parsed.data.riv : null,
      buildMs: typeof parsed.data?.buildMs === "number" ? parsed.data.buildMs : null,
      problems: [...problems.values()],
    }
  }

  return null
}

/** The CLI to run. Desktop apps often start without the shell's PATH, so look in Rive's install directory too. */
export function resolveBinary(configured: unknown, platform: NodeJS.Platform = process.platform): string {
  if (typeof configured === "string" && configured) return configured

  const installed = join(homedir(), ".rive", "bin", platform === "win32" ? "rive.exe" : "rive")
  return existsSync(installed) ? installed : "rive"
}
