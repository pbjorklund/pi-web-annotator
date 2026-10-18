import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

export type WidgetUI = Pick<ExtensionContext["ui"], "setWidget">;
type Factory = Exclude<Parameters<WidgetUI["setWidget"]>[1], undefined>;
type Content = string[] | Factory | undefined;
type Options = Parameters<WidgetUI["setWidget"]>[2];

// Pi removes and reinserts widget keys on setWidget; refresh the mounted view instead.
export function createStableWidget() {
	type Mounted = Map<
		string,
		{
			content: Exclude<Content, undefined>;
			placement: Options;
			update(content: Exclude<Content, undefined>): void;
		}
	>;
	// PI's bound setWidget capability survives fresh turn contexts and UI prompt wrappers.
	const owners = new WeakMap<WidgetUI["setWidget"], Mounted>();
	return (ui: WidgetUI | undefined, key: string, content: Content, options?: Options): void => {
		if (!ui?.setWidget) return;
		const mounted: Mounted = owners.get(ui.setWidget) ?? new Map();
		owners.set(ui.setWidget, mounted);
		const previous = mounted.get(key);
		if (content === undefined) {
			ui.setWidget(key, undefined);
			mounted.delete(key);
			return;
		}
		if (previous && previous.placement?.placement === options?.placement) {
			const previousContent = previous.content;
			if (
				Array.isArray(content) &&
				Array.isArray(previousContent) &&
				content.length === previousContent.length &&
				content.every((line, index) => line === previousContent[index])
			)
				return;
			previous.update(content);
			return;
		}
		const entry = {
			content: Array.isArray(content) ? [...content] : content,
			placement: options,
			update: (_content: Exclude<Content, undefined>) => {},
		};
		ui.setWidget(
			key,
			(tui, theme) => {
				const build = (value: Exclude<Content, undefined>) => {
					if (!Array.isArray(value)) return value(tui, theme);
					// Match Pi's string-array padding, wrapping and ten-line cap.
					const container = new Container();
					for (const line of value.slice(0, 10)) container.addChild(new Text(line, 1, 0));
					if (value.length > 10)
						container.addChild({
							render: (width) =>
								new Text(theme.fg("muted", "... (widget truncated)"), 1, 0).render(width),
							invalidate() {},
						});
					return container;
				};
				let view = build(entry.content);
				let disposed = false;
				entry.update = (value) => {
					if (disposed) return;
					const next = build(value);
					if ("dispose" in view && typeof view.dispose === "function") view.dispose();
					entry.content = Array.isArray(value) ? [...value] : value;
					view = next;
					view.invalidate();
					tui.requestRender();
				};
				return {
					render: (width: number) => view.render(width),
					invalidate: () => view.invalidate(),
					dispose() {
						if (disposed) return;
						disposed = true;
						if ("dispose" in view && typeof view.dispose === "function") view.dispose();
						if (mounted.get(key) === entry) mounted.delete(key);
					},
				};
			},
			options,
		);
		mounted.set(key, entry);
	};
}
