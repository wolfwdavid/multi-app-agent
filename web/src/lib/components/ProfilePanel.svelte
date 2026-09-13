<script lang="ts">
	import type { Profile } from '$lib/core/schemas';
	import { DATASET, DEMO_PROFILES, type DemoProfileId } from '$lib/ui/dataset';
	import {
		parseProfile,
		setField,
		toggleTarget,
		targetOptions,
		fieldIssues,
		unmappedIssues,
		type ProfileIssue
	} from '$lib/ui/profile-form';
	import { fictionalChip } from '$lib/ui/status';
	import StatusChip from './StatusChip.svelte';

	let {
		profile = $bindable(null),
		valid = $bindable(true),
		pristine = $bindable(true),
		targetsEmpty = $bindable(false)
	}: { profile?: Profile | null; valid?: boolean; pristine?: boolean; targetsEmpty?: boolean } = $props();

	const pretty = (p: Profile) => JSON.stringify(p, null, 2);
	const initialText = pretty(DEMO_PROFILES[0].profile);
	const options = targetOptions(DATASET);

	let source = $state<DemoProfileId>('demo');
	let pristineText = $state(initialText);
	let profileText = $state(initialText);
	let lastValid = $state<Profile>(DEMO_PROFILES[0].profile);

	const parsed = $derived(parseProfile(profileText));
	const issues = $derived<ProfileIssue[]>(parsed.ok ? [] : parsed.issues);
	const unmapped = $derived(unmappedIssues(issues));
	const has = (path: string) => fieldIssues(issues, path).length > 0;
	const errs = $derived({
		major: has('intended_major'),
		gpa: has('gpa'),
		completed: has('units.completed'),
		inProgress: has('units.in_progress'),
		system: has('units.system'),
		terms: has('terms_remaining'),
		targets: has('targets')
	});

	// Fields mirror the raw JSON when it is syntactically valid (even if schema-invalid), else the last valid profile.
	type Loose = {
		intended_major?: unknown;
		gpa?: unknown;
		units?: { completed?: unknown; in_progress?: unknown; system?: unknown } | null;
		terms_remaining?: unknown;
		targets?: unknown;
	};
	const raw = $derived.by((): unknown => {
		try {
			return JSON.parse(profileText);
		} catch {
			return undefined;
		}
	});
	const editable = $derived(raw !== null && typeof raw === 'object' && !Array.isArray(raw));
	const view = $derived<Loose>(editable ? (raw as Loose) : lastValid);
	const selectedTargets = $derived(
		new Set(
			Array.isArray(view.targets)
				? (view.targets as { program_id?: unknown }[]).map((t) => (t && typeof t === 'object' ? t.program_id : null))
				: []
		)
	);

	const num = (v: unknown) => (typeof v === 'number' ? v : '');
	const str = (v: unknown) => (typeof v === 'string' ? v : '');

	$effect(() => {
		if (parsed.ok) {
			lastValid = parsed.profile;
			profile = parsed.profile;
			valid = true;
		} else {
			valid = false;
		}
		pristine = profileText === pristineText && source === 'demo';
		targetsEmpty =
			!parsed.ok &&
			parsed.issues.length > 0 &&
			parsed.issues.every((i) => i.path === 'targets' || i.path.startsWith('targets'));
	});

	function update(path: string, value: unknown) {
		if (!editable) return;
		profileText = setField(profileText, path, value);
	}

	function updateNumber(path: string, el: HTMLInputElement) {
		// Partial input such as "3." is not a number yet; wait for the next keystroke instead of clearing it.
		if (el.validity.badInput) return;
		update(path, el.value === '' ? NaN : el.valueAsNumber);
	}

	function pickSource(id: DemoProfileId, el: HTMLInputElement) {
		const opt = DEMO_PROFILES.find((p) => p.id === id)!;
		if (profileText !== pristineText && !confirm(`Discard your profile edits and load the ${opt.label} profile?`)) {
			el.closest('fieldset')
				?.querySelectorAll<HTMLInputElement>('input[name="pf-source"]')
				.forEach((r) => (r.checked = r.value === source));
			return;
		}
		source = id;
		pristineText = pretty(opt.profile);
		profileText = pristineText;
	}

	const inputBase = 'w-full rounded-md text-base';
</script>

{#snippet errorText(id: string, path: string)}
	{#each fieldIssues(issues, path) as issue, i (i)}
		<p id={i === 0 ? `${id}-error` : undefined} class="text-sm text-danger">{issue.message}</p>
	{/each}
{/snippet}

<div class="space-y-4 pt-2">
	<div role="status" class="text-sm text-danger">
		{#if !parsed.ok}
			{#if parsed.jsonError}
				<p>
					Invalid JSON at line {parsed.jsonError.line}, column {parsed.jsonError.column}: {parsed.jsonError.message}
				</p>
			{:else}
				<p>Profile has {parsed.issues.length} error(s). Fix the highlighted fields to update the gap report.</p>
			{/if}
		{/if}
		<ul id="pf-unmapped" class="space-y-1">
			{#each unmapped as issue, i (i)}
				<li><span class="font-mono">{issue.path || '(root)'}</span>: {issue.message}</li>
			{/each}
		</ul>
	</div>

	<fieldset class="space-y-2">
		<legend class="text-sm font-semibold">Start from</legend>
		<div class="grid grid-cols-2 gap-2">
			{#each DEMO_PROFILES as opt (opt.id)}
				<label class="min-h-11 rounded-lg border border-border p-2 flex items-start gap-2 text-sm">
					<input
						type="radio"
						name="pf-source"
						value={opt.id}
						checked={source === opt.id}
						onchange={(e) => pickSource(opt.id, e.currentTarget)}
						class="mt-0.5 text-accent"
					/>
					<span>{opt.label}</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<div class="space-y-4">
		{#if !editable}
			<p class="text-sm text-fg-muted">Fix the JSON below to edit these fields.</p>
		{/if}

		<div class="space-y-1">
			<label for="pf-major" class="text-sm">Intended major</label>
			<input
				id="pf-major"
				type="text"
				class={[inputBase, errs.major ? 'border-danger' : 'border-border']}
				value={str(view.intended_major)}
				disabled={!editable}
				aria-invalid={errs.major ? 'true' : undefined}
				aria-describedby={errs.major ? 'pf-major-error' : undefined}
				oninput={(e) => update('intended_major', e.currentTarget.value)}
			/>
			{@render errorText('pf-major', 'intended_major')}
		</div>

		<div class="space-y-1">
			<label for="pf-gpa" class="text-sm">GPA (0–4)</label>
			<input
				id="pf-gpa"
				type="number"
				step="0.01"
				inputmode="decimal"
				class={[inputBase, errs.gpa ? 'border-danger' : 'border-border']}
				value={num(view.gpa)}
				disabled={!editable}
				aria-invalid={errs.gpa ? 'true' : undefined}
				aria-describedby={errs.gpa ? 'pf-gpa-error' : undefined}
				oninput={(e) => updateNumber('gpa', e.currentTarget)}
			/>
			{@render errorText('pf-gpa', 'gpa')}
		</div>

		<div class="grid grid-cols-2 gap-2">
			<div class="space-y-1">
				<label for="pf-units-completed" class="text-sm">Units completed</label>
				<input
					id="pf-units-completed"
					type="number"
					step="0.5"
					inputmode="decimal"
					class={[inputBase, errs.completed ? 'border-danger' : 'border-border']}
					value={num(view.units?.completed)}
					disabled={!editable}
					aria-invalid={errs.completed ? 'true' : undefined}
					aria-describedby={errs.completed ? 'pf-units-completed-error' : undefined}
					oninput={(e) => updateNumber('units.completed', e.currentTarget)}
				/>
				{@render errorText('pf-units-completed', 'units.completed')}
			</div>
			<div class="space-y-1">
				<label for="pf-units-in-progress" class="text-sm">Units in progress</label>
				<input
					id="pf-units-in-progress"
					type="number"
					step="0.5"
					inputmode="decimal"
					class={[inputBase, errs.inProgress ? 'border-danger' : 'border-border']}
					value={num(view.units?.in_progress)}
					disabled={!editable}
					aria-invalid={errs.inProgress ? 'true' : undefined}
					aria-describedby={errs.inProgress ? 'pf-units-in-progress-error' : undefined}
					oninput={(e) => updateNumber('units.in_progress', e.currentTarget)}
				/>
				{@render errorText('pf-units-in-progress', 'units.in_progress')}
			</div>
		</div>

		<div class="space-y-1">
			<label for="pf-unit-system" class="text-sm">Unit system</label>
			<select
				id="pf-unit-system"
				class={[inputBase, errs.system ? 'border-danger' : 'border-border']}
				value={str(view.units?.system)}
				disabled={!editable}
				aria-invalid={errs.system ? 'true' : undefined}
				aria-describedby={errs.system ? 'pf-unit-system-error' : undefined}
				onchange={(e) => update('units.system', e.currentTarget.value)}
			>
				<option value="semester">Semester</option>
				<option value="quarter">Quarter</option>
			</select>
			{@render errorText('pf-unit-system', 'units.system')}
		</div>

		<div class="space-y-1">
			<label for="pf-terms" class="text-sm">Terms remaining before transfer</label>
			<input
				id="pf-terms"
				type="number"
				step="1"
				inputmode="decimal"
				class={[inputBase, errs.terms ? 'border-danger' : 'border-border']}
				value={num(view.terms_remaining)}
				disabled={!editable}
				aria-invalid={errs.terms ? 'true' : undefined}
				aria-describedby={errs.terms ? 'pf-terms-error' : undefined}
				oninput={(e) => updateNumber('terms_remaining', e.currentTarget)}
			/>
			{@render errorText('pf-terms', 'terms_remaining')}
		</div>

		<fieldset class="space-y-1" aria-describedby={errs.targets ? 'pf-targets-error' : undefined}>
			<legend class="text-sm">Target programs</legend>
			{#each options as opt (opt.programId)}
				<label class="min-h-11 py-2 flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						aria-invalid={errs.targets ? 'true' : undefined}
						class={['size-5 shrink-0 mt-0.5 rounded text-accent', errs.targets ? 'border-danger' : 'border-fg-muted']}
						checked={selectedTargets.has(opt.programId)}
						disabled={!editable}
						onchange={() => editable && (profileText = toggleTarget(profileText, opt, DATASET))}
					/>
					<span class="min-w-0 flex-1 space-y-1">
						<span class="block">{opt.label}</span>
						{#if opt.isFictional}<StatusChip chip={fictionalChip()} />{/if}
					</span>
				</label>
			{/each}
			{@render errorText('pf-targets', 'targets')}
		</fieldset>
	</div>

	<details class="space-y-2">
		<summary class="min-h-11 cursor-pointer text-sm">Advanced: edit the full profile JSON</summary>
		<textarea
			bind:value={profileText}
			spellcheck="false"
			rows="16"
			class="font-mono text-sm w-full rounded-md border-border"
			aria-label="Profile JSON"
			aria-invalid={parsed.ok ? undefined : 'true'}
			aria-describedby="pf-json-help pf-unmapped"
		></textarea>
		<p id="pf-json-help" class="text-sm text-fg-muted">Validated against the Profile schema as you type.</p>
	</details>

	<p class="text-sm text-fg-muted">Demo data only. Edits stay in this browser tab.</p>
</div>
