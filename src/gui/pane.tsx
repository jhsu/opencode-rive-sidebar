import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { createKeyed, createLatest, type MountedSession, usePanel, usePlugin } from "@opencode/plugin/gui"
import { type BuildState, RivePreview } from "./contract"
import type { definition } from "./definition"
import { createPlayer, type FitMode, type Loaded } from "./player"

const FIT_MODES: readonly FitMode[] = ["contain", "cover", "layout", "none"]

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function RivePane(props: { readonly session: MountedSession }) {
  const ctx = usePlugin<typeof definition>()
  const panel = usePanel()
  const ui = ctx.ui
  const preview = ctx.main(RivePreview)

  const directory = () => props.session.directory
  const chosen = () => ctx.stores.projects.value[directory()]
  const found = createLatest(directory, (value) => preview.find(value))
  const project = () => chosen() ?? found.latest ?? undefined

  const [state, setState] = createSignal<BuildState>()
  const [loaded, setLoaded] = createSignal<Loaded>()
  const [runtimeError, setRuntimeError] = createSignal<string>()
  const [artboard, setArtboard] = createSignal<string>()
  const [stateMachine, setStateMachine] = createSignal<string>()
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()

  const choose = async () => {
    const [folder] = (await ctx.desktop?.pick({ directory: true, title: ctx.t("pick.title") })) ?? []
    if (folder) ctx.stores.projects.update((draft) => void (draft[directory()] = folder))
  }

  // Each project this pane shows gets one watch, handed back when the pane moves on.
  createKeyed(project, (value) => {
    setState(undefined)
    setLoaded(undefined)
    setRuntimeError(undefined)
    setArtboard(undefined)
    setStateMachine(undefined)

    preview.watch(value).then(
      (next) => setState((current) => current ?? next),
      (error) => setRuntimeError(message(error)),
    )
    onCleanup(
      preview.on("changed", (next) => {
        if (next.project === value) setState(next)
      }),
    )
    onCleanup(() => void preview.unwatch(value).catch(() => undefined))
  })

  const fit = () => ctx.stores.prefs.value.fit as FitMode
  let player: ReturnType<typeof createPlayer> | undefined

  const reload = async () => {
    const current = state()
    if (!player || !current || current.revision === 0) return

    try {
      const bytes = await preview.read(current.project)
      if (!bytes || state()?.project !== current.project) return
      setRuntimeError(undefined)
      player.load(bytes, { artboard: artboard(), stateMachine: stateMachine(), fit: fit() }, current.cursorProperty)
    } catch (error) {
      setRuntimeError(message(error))
    }
  }

  onMount(() => {
    const element = canvas()!
    player = createPlayer(element, {
      onLoad: (next) => {
        setRuntimeError(undefined)
        setLoaded(next)
      },
      onError: setRuntimeError,
    })

    const observer = new ResizeObserver(() => player?.resize())
    observer.observe(element)

    onCleanup(() => {
      observer.disconnect()
      player?.dispose()
      player = undefined
    })

    void reload()
  })

  const revision = createMemo(() => {
    const current = state()
    return current ? `${current.project}\n${current.revision}` : undefined
  })

  createEffect(on(revision, () => void reload(), { defer: true }))
  createEffect(on([artboard, stateMachine], () => void reload(), { defer: true }))
  createEffect(on(fit, (value) => player?.setFit(value), { defer: true }))
  createEffect(on(() => panel.visible(), (visible) => player?.setVisible(visible)))

  const needsSigning = () => {
    const current = state()
    return !!current && current.scripted && !current.signed
  }
  const errors = () => (state()?.problems ?? []).filter((problem) => problem.severity === "error")
  const warnings = () => (state()?.problems ?? []).filter((problem) => problem.severity === "warning")

  const statusText = () => {
    const current = state()
    if (!current || current.status === "building") return ctx.t("status.building")
    if (current.status === "failed") return ctx.plural("status.failed", errors().length)
    return current.buildMs === null
      ? ctx.t("status.ready")
      : ctx.t("status.built", { ms: Math.round(current.buildMs) })
  }

  const menuItems = () => {
    const current = loaded()

    return [
      {
        type: "group" as const,
        label: ctx.t("menu.fit"),
        items: FIT_MODES.map((mode) => ({
          label: `${mode === fit() ? "✓ " : ""}${ctx.t(`fit.${mode}`)}`,
          onSelect: () => ctx.stores.prefs.update((draft) => void (draft.fit = mode)),
        })),
      },
      ...(current && current.artboards.length > 1
        ? [
            {
              type: "group" as const,
              label: ctx.t("menu.artboard"),
              items: current.artboards.map((name) => ({
                label: `${name === current.artboard ? "✓ " : ""}${name}`,
                onSelect: () => {
                  setStateMachine(undefined)
                  setArtboard(name)
                },
              })),
            },
          ]
        : []),
      ...(current && current.stateMachines.length > 1
        ? [
            {
              type: "group" as const,
              label: ctx.t("menu.stateMachine"),
              items: current.stateMachines.map((name) => ({
                label: `${name === current.stateMachine ? "✓ " : ""}${name}`,
                onSelect: () => setStateMachine(name),
              })),
            },
          ]
        : []),
      { type: "separator" as const },
      { label: ctx.t("action.choose"), icon: "folder" as const, onSelect: () => void choose() },
      ...(state()?.signed
        ? [
            {
              label: ctx.t("scripted.unsign"),
              onSelect: () => void preview.setSigned({ project: project()!, signed: false }),
            },
          ]
        : []),
      ...(project()
        ? [
            {
              label: ctx.t(state()?.nativeOpen ? "action.nativeClose" : "action.nativeOpen"),
              icon: "square-arrow-top-right" as const,
              onSelect: () => void preview.toggleNative(project()!),
            },
          ]
        : []),
    ]
  }

  return (
    <div class="ocrive" data-status={state()?.status}>
      <Show when={ctx.app.platform === "desktop"} fallback={<div class="ocrive-empty">{ctx.t("empty.web")}</div>}>
        <Show when={project()}>
          <div class="ocrive-bar">
            <div class="ocrive-title" title={project()}>
              <span class="ocrive-name">{state()?.name}</span>
              <span class="ocrive-status">
                <Show when={state()?.status === "building"}>
                  <ui.Loader size="small" />
                </Show>
                {statusText()}
              </span>
            </div>
            <ui.Tooltip value={ctx.t("action.restart")}>
              <ui.IconButton icon="outline-reset" label={ctx.t("action.restart")} onClick={() => void reload()} />
            </ui.Tooltip>
            <ui.Tooltip value={ctx.t("action.rebuild")}>
              <ui.IconButton
                icon="refresh"
                label={ctx.t("action.rebuild")}
                busy={state()?.status === "building"}
                onClick={() => void preview.rebuild(project()!)}
              />
            </ui.Tooltip>
            <ui.Menu label={ctx.t("menu.label")} icon="sliders" placement="bottom-end" items={menuItems()} />
          </div>
        </Show>

        <div class="ocrive-stage" classList={{ "ocrive-hidden": !project() }}>
          <canvas ref={setCanvas} class="ocrive-canvas" data-testid="rive-canvas" />
        </div>

        <Show when={!project() && !found.loading}>
          <div class="ocrive-empty">
            <p>{ctx.t("empty.none")}</p>
            <ui.Button icon="folder" onClick={() => void choose()}>
              {ctx.t("action.choose")}
            </ui.Button>
          </div>
        </Show>

        <Show when={needsSigning()}>
          <div class="ocrive-note">
            <p>{ctx.t("scripted.note")}</p>
            <div class="ocrive-actions">
              <ui.Button size="small" onClick={() => void preview.setSigned({ project: project()!, signed: true })}>
                {ctx.t("scripted.sign")}
              </ui.Button>
              <ui.Button size="small" variant="ghost" onClick={() => void preview.toggleNative(project()!)}>
                {ctx.t(state()?.nativeOpen ? "action.nativeClose" : "action.nativeOpen")}
              </ui.Button>
            </div>
          </div>
        </Show>

        <Show when={runtimeError() || errors().length > 0 || warnings().length > 0}>
          <ul class="ocrive-problems">
            <Show when={runtimeError()}>
              <li data-severity="error">{runtimeError()}</li>
            </Show>
            <For each={[...errors(), ...warnings()]}>
              {(problem) => <li data-severity={problem.severity}>{problem.message}</li>}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  )
}
