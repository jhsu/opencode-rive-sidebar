import { Command, MenuItem, Panel, type PanelTab, type Plugin, Style } from "@opencode/plugin/gui"
import css from "./panel.css?inline"
import type { definition } from "./definition"
import { RivePane } from "./pane"

export const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const key = `${ctx.id}:main`

  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("panel.title")
    },
    closable: "compact",
    fallback: true,
  }

  ctx.add(Style, css)

  ctx.add(Panel, {
    id: "main",
    region: "side",
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (props) => <RivePane session={props.session} />,
  })

  ctx.add(Command, (): Command => {
    const session = ctx.sessions.current()

    return {
      id: "toggle",
      title: ctx.t("command.toggle"),
      description: ctx.t("command.description"),
      keywords: "rive animation preview riv",
      slash: { name: "rive" },
      enabled: !!session,
      run: () => {
        if (session) ctx.layout.toggle(key, session)
      },
    }
  })

  ctx.add(MenuItem, (): MenuItem => {
    const session = ctx.sessions.current()

    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("menu.open"),
      icon: "outline-video",
      keybind: `${ctx.id}.toggle`,
      opened: !!session && ctx.layout.state(key, session) !== "closed",
      run: () => {
        if (session) ctx.layout.open(key, session)
      },
    }
  })
}
