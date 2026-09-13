import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = () =>
	json({
		ok: true,
		service: 'transferpilot',
		target: process.env.VERCEL ? 'vercel' : 'local',
		time: new Date().toISOString()
	});
