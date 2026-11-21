// Model-switch detection for hosts without an extension `model_select`.
//
// OMP never raises model_select to extensions. The session model is
// recorded when the session starts (pi's "restore", which never toasts) and
// compared with the model each prompt is about to run on; a difference is a
// switch the user made since. It surfaces at the next prompt, not at the
// moment of selection, and cannot tell "set" from "cycle".

export interface ModelIdentity {
	provider: string;
	id: string;
	api?: string;
}

export class ModelChangeTracker {
	#lastKey: string | undefined;

	/** Record the model the session starts or resumes on. Never reported as a change. */
	baseline(model: ModelIdentity | undefined): void {
		this.#lastKey = model ? `${model.provider}/${model.id}` : undefined;
	}

	/** The model a prompt is about to run on: returned once when it differs from the last model seen. */
	observe(model: ModelIdentity | undefined): ModelIdentity | undefined {
		const key = model ? `${model.provider}/${model.id}` : undefined;
		if (key === this.#lastKey) return undefined;
		this.#lastKey = key;
		return model;
	}

	/** Re-baseline on OMP's `session_switch` (raised by /resume, /new and /fork,
	 *  which restore the target session's model). pi's ExtensionAPI typings
	 *  have no such event, so the registration goes through `Reflect`. */
	baselineOnSessionSwitch(pi: object): void {
		const on: unknown = Reflect.get(pi, "on");
		if (typeof on !== "function") return;
		const handler = (_event: unknown, ctx: { model?: ModelIdentity }): void => this.baseline(ctx.model);
		Reflect.apply(on, pi, ["session_switch", handler]);
	}
}
