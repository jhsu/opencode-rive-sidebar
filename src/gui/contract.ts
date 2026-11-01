import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

export const Problem = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  message: Schema.String,
})
export type Problem = typeof Problem.Type

export const BuildState = Schema.Struct({
  project: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["building", "ready", "failed"]),
  /** Counts successful builds. The panel reloads the file whenever this changes. */
  revision: Schema.Number,
  buildMs: Schema.NullOr(Schema.Number),
  problems: Schema.Array(Problem),
  /** The project has script or shader sources, which web runtimes reject unless signed. */
  scripted: Schema.Boolean,
  signed: Schema.Boolean,
  /** The view model property named by `cursor.property` in rive.yaml. */
  cursorProperty: Schema.NullOr(Schema.String),
  nativeOpen: Schema.Boolean,
})
export type BuildState = typeof BuildState.Type

export const RivePreview = Ipc.define({
  id: "opencode-rive-sidebar.preview",
  methods: {
    find: { input: Schema.String, output: Schema.NullOr(Schema.String) },
    watch: { input: Schema.String, output: BuildState },
    unwatch: { input: Schema.String },
    rebuild: { input: Schema.String },
    setSigned: { input: Schema.Struct({ project: Schema.String, signed: Schema.Boolean }) },
    read: { input: Schema.String, output: Schema.NullOr(Schema.Uint8Array) },
    toggleNative: { input: Schema.String },
  },
  events: {
    changed: BuildState,
  },
})
