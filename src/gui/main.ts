import { type ChildProcess, execFile, spawn } from "node:child_process"
import { existsSync, type FSWatcher, watch } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import type { BrowserWindow } from "electron"
import type { Plugin } from "@opencode/plugin/gui"
import { type BuildState, RivePreview } from "./contract"
import {
  cursorProperty,
  findProject,
  hasScripts,
  isSourceChange,
  parseReport,
  projectName,
  readManifest,
  resolveBinary,
} from "./project"

const DEBOUNCE_MS = 150
const BUILD_TIMEOUT_MS = 60_000
const SIGNED_BUILD_TIMEOUT_MS = 180_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

interface Watched {
  state: BuildState
  /** How many panels hold this project, by window. */
  holders: Map<number, number>
  watcher: FSWatcher | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  build: ChildProcess | undefined
  queued: boolean
  outputDir: string
  riv: string | undefined
  native: ChildProcess | undefined
}

export const main: Plugin.MainSetup = (ctx) => {
  const binary = resolveBinary(ctx.options.rive)
  const projects = new Map<string, Watched>()

  const update = (item: Watched, patch: Partial<BuildState>) => {
    item.state = { ...item.state, ...patch }
    provider.emit("changed", item.state)
  }

  const finish = (item: Watched, error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => {
    item.build = undefined
    const report = parseReport(stdout)
    const scripted = hasScripts(item.state.project)

    if (report?.ok && report.riv) {
      item.riv = resolve(item.state.project, report.riv)
      item.outputDir = dirname(item.riv)
      update(item, {
        status: "ready",
        revision: item.state.revision + 1,
        buildMs: report.buildMs,
        problems: report.problems,
        scripted,
      })
    } else {
      const missing = error?.code === "ENOENT"
      const fallback = missing
        ? `The Rive CLI was not found at "${binary}". Install it, or set the plugin's "rive" option to its path.`
        : stderr.trim() || error?.message || "The build failed."
      update(item, {
        status: "failed",
        problems: report?.problems.length ? report.problems : [{ severity: "error", message: fallback }],
        scripted,
      })
    }

    if (item.queued) {
      item.queued = false
      build(item)
    }
  }

  const build = (item: Watched) => {
    if (item.build) {
      item.queued = true
      return
    }

    update(item, { status: "building" })
    item.build = execFile(
      binary,
      [item.state.project, item.state.signed ? "--publish=local" : "--once", "--format=json"],
      {
        cwd: item.state.project,
        timeout: item.state.signed ? SIGNED_BUILD_TIMEOUT_MS : BUILD_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (error, stdout, stderr) => {
        if (projects.get(item.state.project) === item) finish(item, error, stdout, stderr)
      },
    )
  }

  const startWatching = (item: Watched) => {
    const { project } = item.state

    try {
      item.watcher = watch(project, { recursive: true }, (_event, file) => {
        if (file && !isSourceChange(file.toString(), relative(project, item.outputDir))) return
        clearTimeout(item.timer)
        item.timer = setTimeout(() => build(item), DEBOUNCE_MS)
      })
      item.watcher.on("error", (error) => ctx.log.write("warn", "rive watcher failed", { project, error: `${error}` }))
    } catch (error) {
      ctx.log.write("warn", "rive watcher failed", { project, error: `${error}` })
    }
  }

  const stop = (item: Watched) => {
    clearTimeout(item.timer)
    item.watcher?.close()
    item.build?.kill()
    item.native?.kill()
    projects.delete(item.state.project)
  }

  const acquire = (project: string, window: number) => {
    const existing = projects.get(project)

    if (existing) {
      existing.holders.set(window, (existing.holders.get(window) ?? 0) + 1)
      return existing
    }

    const manifest = readManifest(project)
    const item: Watched = {
      state: {
        project,
        name: projectName(project, manifest),
        status: "building",
        revision: 0,
        buildMs: null,
        problems: [],
        scripted: hasScripts(project),
        signed: false,
        cursorProperty: cursorProperty(manifest),
        nativeOpen: false,
      },
      holders: new Map([[window, 1]]),
      watcher: undefined,
      timer: undefined,
      build: undefined,
      queued: false,
      outputDir: join(project, "build"),
      riv: undefined,
      native: undefined,
    }

    projects.set(project, item)
    startWatching(item)
    build(item)

    return item
  }

  const release = (item: Watched, window: number, all = false) => {
    const held = item.holders.get(window) ?? 0

    if (all || held <= 1) item.holders.delete(window)
    else item.holders.set(window, held - 1)

    if (item.holders.size === 0) stop(item)
  }

  const provider = ctx.provide(RivePreview, {
    find: (directory) => findProject(directory),
    watch: (project, caller) => {
      if (!existsSync(project)) throw new Error(`No such directory: ${project}`)
      return acquire(project, caller.window).state
    },
    unwatch: (project, caller) => {
      const item = projects.get(project)
      if (item) release(item, caller.window)
    },
    rebuild: (project) => {
      const item = projects.get(project)
      if (item) build(item)
    },
    setSigned: ({ project, signed }) => {
      const item = projects.get(project)
      if (!item) return
      update(item, { signed })
      build(item)
    },
    read: async (project) => {
      const riv = projects.get(project)?.riv
      return riv ? new Uint8Array(await readFile(riv)) : null
    },
    toggleNative: (project) => {
      const item = projects.get(project)
      if (!item) return

      if (item.native) {
        item.native.kill()
        return
      }

      const child = spawn(binary, [project], { cwd: project, stdio: "ignore" })
      const closed = () => {
        if (item.native !== child) return
        item.native = undefined
        update(item, { nativeOpen: false })
      }

      item.native = child
      child.on("error", closed)
      child.on("exit", closed)
      update(item, { nativeOpen: true })
    },
  })

  // A closing window is already destroyed and can't report its id, so remember each one while it's alive.
  const windowIds = new WeakMap<BrowserWindow, number>()
  const remember = (window: BrowserWindow) => void windowIds.set(window, window.id)

  ctx.windows.list().forEach(remember)
  ctx.onCleanup(ctx.windows.on("open", remember))
  ctx.onCleanup(
    ctx.windows.on("close", (window) => {
      const id = windowIds.get(window)
      if (id === undefined) return
      for (const item of [...projects.values()]) release(item, id, true)
    }),
  )
  ctx.onCleanup(() => {
    for (const item of [...projects.values()]) stop(item)
  })
}
