import { Theme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TUI, type Component, type Terminal } from "@earendil-works/pi-tui";

export const plainTheme = new Theme({
  accent: "", border: "", borderAccent: "", borderMuted: "", success: "", error: "", warning: "", muted: "", dim: "", text: "", thinkingText: "",
  userMessageText: "", customMessageText: "", customMessageLabel: "", toolTitle: "", toolOutput: "", mdHeading: "", mdLink: "", mdLinkUrl: "", mdCode: "", mdCodeBlock: "", mdCodeBlockBorder: "", mdQuote: "", mdQuoteBorder: "", mdHr: "", mdListBullet: "", toolDiffAdded: "", toolDiffRemoved: "", toolDiffContext: "", syntaxComment: "", syntaxKeyword: "", syntaxFunction: "", syntaxVariable: "", syntaxString: "", syntaxNumber: "", syntaxType: "", syntaxOperator: "", syntaxPunctuation: "", thinkingOff: "", thinkingMinimal: "", thinkingLow: "", thinkingMedium: "", thinkingHigh: "", thinkingXhigh: "", bashMode: "",
}, { selectedBg: "", userMessageBg: "", customMessageBg: "", toolPendingBg: "", toolSuccessBg: "", toolErrorBg: "" }, "truecolor");
plainTheme.fg = (_tone, text) => text;
plainTheme.bold = (text) => text;

type SetWidget = ExtensionContext["ui"]["setWidget"];
type Content = string[] | Parameters<SetWidget>[1];
type Options = Parameters<SetWidget>[2];
type View = Component & { dispose?: () => void };

export function createWidgetHost(onChange: (key: string, lines: string[] | undefined) => void = () => {}, width = 120) {
  const widgets = new Map<string, View>();
  const registrations: { key: string; content: Content; options: Options }[] = [];
  const terminal: Terminal = {
    columns: width, rows: 40, kittyProtocolActive: false,
    start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  const unsupported = (): never => { throw new Error("Unexpected mock TUI operation"); };
  const tui: TUI = {
    terminal, mode: "regular", children: [], fullRedraws: 0,
    render: unsupported, invalidate: unsupported, addChild: unsupported, removeChild: unsupported, clear: unsupported,
    getShowHardwareCursor: unsupported, setShowHardwareCursor: unsupported, getClearOnShrink: unsupported, setClearOnShrink: unsupported,
    setFocus: unsupported, showOverlay: unsupported, hideOverlay: unsupported, hasOverlay: unsupported,
    start: unsupported, stop: unsupported, renderNow: unsupported, addInputListener: unsupported, removeInputListener: unsupported,
    onTerminalColorSchemeChange: unsupported, setTerminalColorSchemeNotifications: unsupported, queryTerminalColors: unsupported,
    requestRender() { for (const [key, component] of widgets) onChange(key, component.render(tui.terminal.columns)); },
  };
  const setWidget: SetWidget = (key: string, content: Content, options?: Options) => {
    registrations.push({ key, content, options });
    widgets.get(key)?.dispose?.();
    widgets.delete(key);
    if (content === undefined) { onChange(key, undefined); return; }
    const component = typeof content === "function" ? content(tui, plainTheme) : { render: () => content, invalidate() {} };
    widgets.set(key, component);
    onChange(key, component.render(tui.terminal.columns));
  };
  return { widgets, registrations, tui, setWidget };
}
