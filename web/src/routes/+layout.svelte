<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { appState, initApp } from '$lib/ui/mode.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ModeBanner from '$lib/components/ModeBanner.svelte';

	let { children } = $props();

	onMount(() => {
		initApp(page.url, base);
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<a
	href="#main"
	class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 rounded-md bg-surface px-4 py-2"
	>Skip to content</a
>
<AppHeader mode={appState.mode} />
{#if appState.mode === 'replay'}
	<ModeBanner hero={appState.hero} />
{/if}
<main id="main" tabindex="-1" class="mx-auto w-full max-w-6xl px-4 sm:px-6 pb-16">
	{@render children()}
</main>
