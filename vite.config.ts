import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import babel from '@rollup/plugin-babel';

// /** @type {import('vite').Plugin} */
// const viteServerConfig = {
// 	name: 'log-request-middleware',
// 	configureServer(server) {
// 		server.middlewares.use((req, res, next) => {
// 			res.setHeader('Access-Control-Allow-Origin', '*');
// 			res.setHeader('Access-Control-Allow-Methods', 'GET');
// 			res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
// 			res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
// 			next();
// 		});
// 	}
// };

export default defineConfig({
	plugins: [
		sveltekit(),
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
	],
	define: {
		APP_VERSION: JSON.stringify(process.env.npm_package_version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	build: {
		sourcemap: true
	},
	worker: {
		format: 'es'
	}
});
