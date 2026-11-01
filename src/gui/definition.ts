import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"

export const definition = Plugin.define({
  stores: {
    /** Projects the user chose, by session directory. Without one, the panel finds the directory's own. */
    projects: Store.global(Schema.Record(Schema.String, Schema.String), {}),
    prefs: Store.global(Schema.Struct({ fit: Schema.String }), { fit: "contain" }),
  },
  i18n: {
    en: {
      "panel.title": "Rive",
      "command.toggle": "Toggle Rive preview",
      "command.description": "Show the session's Rive project, live, in the side panel",
      "menu.open": "Rive preview",
      "menu.label": "Preview options",
      "menu.fit": "Fit",
      "menu.artboard": "Artboard",
      "menu.stateMachine": "State machine",
      "fit.contain": "Contain",
      "fit.cover": "Cover",
      "fit.layout": "Layout",
      "fit.none": "Actual size",
      "action.restart": "Restart",
      "action.rebuild": "Rebuild",
      "action.choose": "Choose project…",
      "action.nativeOpen": "Open native preview",
      "action.nativeClose": "Close native preview",
      "pick.title": "Choose a Rive project folder",
      "status.building": "Building…",
      "status.ready": "Ready",
      "status.built": "Built in {{ms}} ms",
      "status.failed.one": "{{count}} build error",
      "status.failed.other": "{{count}} build errors",
      "empty.none": "No rive.yaml found in this session's directory.",
      "empty.web": "The Rive preview needs OpenCode Desktop.",
      "scripted.note":
        "This project has scripts or shaders, which this preview's web runtime won't run unsigned. Signing uploads them to Rive on every rebuild and needs `rive login`. The native preview runs them unsigned.",
      "scripted.sign": "Sign builds",
      "scripted.unsign": "Stop signing builds",
    },
  },
})
