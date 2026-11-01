import { Alignment, Fit, Layout, Rive, RuntimeLoader } from "@rive-app/webgl2"
import wasmDataUrl from "@rive-app/webgl2/rive.wasm?inline"

export type FitMode = "contain" | "cover" | "layout" | "none"

const FITS: Record<FitMode, Fit> = {
  contain: Fit.Contain,
  cover: Fit.Cover,
  layout: Fit.Layout,
  none: Fit.None,
}

const CURSORS: Record<string, string> = {
  arrow: "default",
  pointer: "pointer",
  resizehorizontal: "ew-resize",
  resizevertical: "ns-resize",
  text: "text",
  hidden: "none",
}

export interface Selection {
  artboard?: string
  stateMachine?: string
  fit: FitMode
}

export interface Loaded {
  artboards: readonly string[]
  stateMachines: readonly string[]
  artboard: string
  stateMachine: string | undefined
}

const layoutFor = (fit: FitMode) => new Layout({ fit: FITS[fit], alignment: Alignment.Center })

let wasmReady = false

// The app loads one bundle and no second file, so the runtime ships inside it and decodes on first use.
const loadWasm = () => {
  if (wasmReady) return
  wasmReady = true
  // A file opens idle before `onLoad` picks its state machine, which this warning takes for a missing choice.
  Rive.suppressDeprecationWarnings = ["default-state-machine"]
  const base64 = wasmDataUrl.slice(wasmDataUrl.indexOf(",") + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  RuntimeLoader.setWasmBinary(bytes.buffer)
}

/** One Rive instance on one canvas, reloaded in place as builds and selections change. */
export function createPlayer(
  canvas: HTMLCanvasElement,
  hooks: { onLoad(loaded: Loaded): void; onError(message: string): void },
) {
  let rive: Rive | undefined
  let cursorProperty: string | null = null
  let visible = true

  const applyCursor = (value: unknown) => {
    const name = String(value ?? "").replace(/[-_]/g, "").toLowerCase()
    canvas.style.cursor = CURSORS[name] ?? "default"
  }

  const bindCursor = (instance: Rive) => {
    canvas.style.cursor = ""
    const viewModel = instance.viewModelInstance
    if (!cursorProperty || !viewModel) return

    const property = viewModel.string(cursorProperty) ?? viewModel.enum(cursorProperty)
    if (!property) return

    applyCursor(property.value)
    property.on(() => applyCursor(property.value))
  }

  const dispose = () => {
    rive?.cleanup()
    rive = undefined
  }

  const load = (bytes: Uint8Array, selection: Selection, cursor: string | null) => {
    loadWasm()
    dispose()
    cursorProperty = cursor

    // Only the loaded file can say what a selection resolves to, so it opens idle and starts from `onLoad`.
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    let started = false
    const instance: Rive = new Rive({
      buffer,
      canvas,
      autoplay: false,
      autoBind: true,
      layout: layoutFor(selection.fit),
      onLoad: () => {
        if (started || rive !== instance) return
        started = true

        const artboards = instance.contents.artboards ?? []
        const artboard = artboards.find((item) => item.name === selection.artboard) ?? artboards[0]
        if (!artboard) {
          hooks.onError("This file has no artboards.")
          return
        }

        const stateMachines = artboard.stateMachines.map((item) => item.name)
        const stateMachine = stateMachines.includes(selection.stateMachine ?? "")
          ? selection.stateMachine
          : stateMachines[0]

        instance.reset({ artboard: artboard.name, stateMachine, autoplay: true, autoBind: true })
        instance.resizeDrawingSurfaceToCanvas()
        bindCursor(instance)
        if (!visible) instance.stopRendering()

        hooks.onLoad({ artboards: artboards.map((item) => item.name), stateMachines, artboard: artboard.name, stateMachine })
      },
      onLoadError: (event) => {
        if (rive === instance) hooks.onError(typeof event.data === "string" ? event.data : "Rive could not load this file.")
      },
    })

    rive = instance
  }

  return {
    load,
    resize: () => rive?.resizeDrawingSurfaceToCanvas(),
    setFit: (fit: FitMode) => {
      if (!rive) return
      rive.layout = layoutFor(fit)
      rive.resizeDrawingSurfaceToCanvas()
    },
    setVisible: (next: boolean) => {
      visible = next
      if (next) rive?.startRendering()
      else rive?.stopRendering()
    },
    dispose,
  }
}
