import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/kit/vite';
import { babel } from '@rollup/plugin-babel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html'
		}),
		vite: {
			plugins: [
				babel({
					extensions: ['.js', '.mjs', '.html', '.svelte', '.ts'],
					babelHelpers: 'runtime',
					exclude: ['node_modules/**'],
					presets: [
						[
							'@babel/preset-env',
							{
								targets: '> 0.25%, not dead',
								useBuiltIns: 'usage',
								corejs: 3
							}
						]
					],
					plugins: ['@babel/plugin-transform-runtime']
				})
			]
		}
	},
	onwarn: (warning, handler) => {
		const { code, _ } = warning;
		if (code === 'css-unused-selector') return;

		handler(warning);
	}
};

export default config;
