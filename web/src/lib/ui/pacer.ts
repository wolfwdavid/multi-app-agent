// Play / pause / step / speed / cancel gate for replay pacing. Pure: no $app/svelte imports.

export class ReplayCancelled extends Error {
	constructor() {
		super('replay cancelled');
		this.name = 'ReplayCancelled';
	}
}

export interface PacerOptions {
	intervalMs?: number;
	sleep?: (ms: number) => Promise<void>;
	playing?: boolean;
}

export interface Pacer {
	/** Resolves when the next row may appear; rejects with ReplayCancelled after cancel(). */
	pace(): Promise<void>;
	play(): void;
	pause(): void;
	/** Release exactly one waiting pace (manual stepping while paused). */
	step(): void;
	cancel(): void;
	reset(): void;
	setIntervalMs(ms: number): void;
	readonly playing: boolean;
	readonly intervalMs: number;
	onChange(fn: (playing: boolean) => void): () => void;
}

type Waiter = { resolve: () => void; reject: (err: Error) => void };

export function createPacer(opts: PacerOptions = {}): Pacer {
	let intervalMs = opts.intervalMs ?? 400;
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	let playing = opts.playing ?? true;
	let cancelled = false;
	let waiters: Waiter[] = [];
	const listeners = new Set<(playing: boolean) => void>();

	const enqueue = () => new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));

	const setPlaying = (next: boolean) => {
		if (playing === next) return;
		playing = next;
		for (const fn of listeners) fn(next);
	};

	return {
		async pace() {
			if (cancelled) throw new ReplayCancelled();
			if (playing) {
				await sleep(intervalMs);
				if (cancelled) throw new ReplayCancelled();
				if (playing) return;
			}
			return enqueue();
		},
		play() {
			setPlaying(true);
			const w = waiters;
			waiters = [];
			for (const x of w) x.resolve();
		},
		pause() {
			setPlaying(false);
		},
		step() {
			waiters.shift()?.resolve();
		},
		cancel() {
			cancelled = true;
			const w = waiters;
			waiters = [];
			for (const x of w) x.reject(new ReplayCancelled());
		},
		reset() {
			cancelled = false;
		},
		setIntervalMs(ms: number) {
			intervalMs = ms;
		},
		get playing() {
			return playing;
		},
		get intervalMs() {
			return intervalMs;
		},
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}
	};
}
