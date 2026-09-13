import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapterStatic from '@sveltejs/adapter-static';
import adapterVercel from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';

// VERCEL=1 is set by Vercel at build time -> serverless build. Otherwise static build for GitHub Pages (BASE_PATH=/multi-app-agent) and the HF Space (base '').
const isVercel = !!process.env.VERCEL;

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: isVercel ? adapterVercel() : adapterStatic({ fallback: '404.html' }),
			// GitHub Pages serves from /<repo>; set BASE_PATH in CI, leave empty locally.
			paths: { base: (isVercel ? '' : (process.env.BASE_PATH ?? '')) as '' | `/${string}` }
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
