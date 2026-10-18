export function createWidgetHost(onChange = () => {}, width = 120) {
	const widgets = new Map();
	const theme = { fg: (_tone, text) => text, bold: (text) => text };
	const registrations = [];
	const tui = {
		terminal: { columns: width },
		requestRender() {
			for (const [key, component] of widgets) onChange(key, component.render(tui.terminal.columns));
		},
	};
	return {
		widgets,
		registrations,
		tui,
		setWidget(key, content, options) {
			registrations.push({ key, content, options });
			widgets.get(key)?.dispose?.();
			widgets.delete(key);
			if (content === undefined) {
				onChange(key, undefined);
				return;
			}
			const component =
				typeof content === "function"
					? content(tui, theme)
					: { render: () => content, invalidate() {} };
			widgets.set(key, component);
			onChange(key, component.render(tui.terminal.columns));
		},
	};
}
