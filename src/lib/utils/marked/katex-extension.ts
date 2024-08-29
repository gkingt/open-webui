import katex from 'katex';

const DELIMITER_LIST = [
	{ left: '\\(', right: '\\)', display: false },
	{ left: '\\[', right: '\\]', display: true },
	{ left: '$$', right: '$$', display: true },
	{ left: '$', right: '$', display: false },
	{ left: '(', right: ')', display: false },
	{ left: '{', right: '}', display: false },
	{ left: '[', right: ']', display: true },
	{ left: "\\begin{equation}", right: "\\end{equation}", display: true },
	{ left: "\\begin{align}", right: "\\end{align}", display: true },
	{ left: "\\begin{alignat}", right: "\\end{alignat}", display: true },
	{ left: "\\begin{gather}", right: "\\end{gather}", display: true },
	{ left: "\\begin{CD}", right: "\\end{CD}", display: true },
	{ left: "\\begin{matrix}", right: "\\end{matrix}", display: true },
	{ left: "\\begin{pmatrix}", right: "\\end{pmatrix}", display: true },
	{ left: "\\begin{bmatrix}", right: "\\end{bmatrix}", display: true },
	{ left: "\\begin{vmatrix}", right: "\\end{vmatrix}", display: true },
	{ left: "\\begin{Bmatrix}", right: "\\end{Bmatrix}", display: true },
	{ left: "\\begin{cases}", right: "\\end{cases}", display: true },
	{ left: "\\begin{array}", right: "\\end{array}", display: true },
	{ left: "\\begin{aligned}", right: "\\end{aligned}", display: true },
	{ left: "\\begin{gathered}", right: "\\end{gathered}", display: true },
	{ left: "\\begin{split}", right: "\\end{split}", display: true },
	{ left: "\\begin{smallmatrix}", right: "\\end{smallmatrix}", display: false },
	{ left: "\\begin{multline}", right: "\\end{multline}", display: true },
	{ left: "\\langle", right: "\\rangle", display: false },
	{ left: "\\lvert", right: "\\rvert", display: false },
	{ left: "\\lVert", right: "\\rVert", display: false },
	{ left: "\\text{", right: "}", display: false },
	{ left: "\\mbox{", right: "}", display: false },
	{ left: "\\begin{theorem}", right: "\\end{theorem}", display: true },
	{ left: "\\begin{lemma}", right: "\\end{lemma}", display: true },
	{ left: "\\begin{proof}", right: "\\end{proof}", display: true },
	{ left: "\\begin{verbatim}", right: "\\end{verbatim}", display: true },
	{ left: "\\begin{tabular}", right: "\\end{tabular}", display: true }
];

// const DELIMITER_LIST = [
//     { left: '$$', right: '$$', display: false },
//     { left: '$', right: '$', display: false },
// ];

// const inlineRule = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\1(?=[\s?!\.,:？！。，：]|$)/;
// const blockRule = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;

let inlinePatterns = [];
let blockPatterns = [];

function escapeRegex(string) {
	return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function generateRegexRules(delimiters) {
	delimiters.forEach((delimiter) => {
		const { left, right } = delimiter;
		// Ensure regex-safe delimiters
		const escapedLeft = escapeRegex(left);
		const escapedRight = escapeRegex(right);

		// Inline pattern - Capture group $1, token content, followed by end delimiter and normal punctuation marks.
		// Example: $text$
		inlinePatterns.push(
			`${escapedLeft}((?:\\\\.|[^\\\\\\n])*?(?:\\\\.|[^\\\\\\n${escapedRight}]))${escapedRight}`
		);

		// Block pattern - Starts and ends with the delimiter on new lines. Example:
		// $$\ncontent here\n$$
		blockPatterns.push(`${escapedLeft}\n((?:\\\\[^]|[^\\\\])+?)\n${escapedRight}`);
	});

	const inlineRule = new RegExp(`^(${inlinePatterns.join('|')})(?=[\\s?!.,:？！。，：]|$)`, 'u');
	const blockRule = new RegExp(`^(${blockPatterns.join('|')})(?:\n|$)`, 'u');

	return { inlineRule, blockRule };
}

const { inlineRule, blockRule } = generateRegexRules(DELIMITER_LIST);

export default function (options = {}) {
	return {
		extensions: [
			inlineKatex(options, createRenderer(options, false)),
			blockKatex(options, createRenderer(options, true))
		]
	};
}

function createRenderer(options, newlineAfter) {
	return (token) =>
		katex.renderToString(token.text, { ...options, displayMode: token.displayMode }) +
		(newlineAfter ? '\n' : '');
}

function inlineKatex(options, renderer) {
	const ruleReg = inlineRule;
	return {
		name: 'inlineKatex',
		level: 'inline',
		start(src) {
			let index;
			let indexSrc = src;

			while (indexSrc) {
				index = indexSrc.indexOf('$');
				if (index === -1) {
					return;
				}
				const f = index === 0 || indexSrc.charAt(index - 1) === ' ';
				if (f) {
					const possibleKatex = indexSrc.substring(index);

					if (possibleKatex.match(ruleReg)) {
						return index;
					}
				}

				indexSrc = indexSrc.substring(index + 1).replace(/^\$+/, '');
			}
		},
		tokenizer(src, tokens) {
			const match = src.match(ruleReg);

			if (match) {
				const text = match
					.slice(2)
					.filter((item) => item)
					.find((item) => item.trim());

				return {
					type: 'inlineKatex',
					raw: match[0],
					text: text
				};
			}
		},
		renderer
	};
}

function blockKatex(options, renderer) {
	return {
		name: 'blockKatex',
		level: 'block',
		tokenizer(src, tokens) {
			const match = src.match(blockRule);

			if (match) {
				const text = match
					.slice(2)
					.filter((item) => item)
					.find((item) => item.trim());

				return {
					type: 'blockKatex',
					raw: match[0],
					text: text
				};
			}
		},
		renderer
	};
}
