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
		const { left, right, display } = delimiter;
		// Ensure regex-safe delimiters
		const escapedLeft = escapeRegex(left);
		const escapedRight = escapeRegex(right);

		if (!display) {
			// For inline delimiters, we match everything
			inlinePatterns.push(`${escapedLeft}((?:\\\\[^]|[^\\\\])+?)${escapedRight}`);
		} else {
			// Block delimiters doubles as inline delimiters when not followed by a newline
			inlinePatterns.push(`${escapedLeft}(?!\\n)((?:\\\\[^]|[^\\\\])+?)(?!\\n)${escapedRight}`);
			blockPatterns.push(`${escapedLeft}\\n((?:\\\\[^]|[^\\\\])+?)\\n${escapedRight}`);
		}
	});

	// Math formulas can end in special characters
	const inlineRule = new RegExp(
		`^(${inlinePatterns.join('|')})(?=[\\s?。，!-\/:-@[-\`{-~]|$)`,
		'u'
	);
	const blockRule = new RegExp(`^(${blockPatterns.join('|')})(?=[\\s?。，!-\/:-@[-\`{-~]|$)`, 'u');

	return { inlineRule, blockRule };
}

const { inlineRule, blockRule } = generateRegexRules(DELIMITER_LIST);

export default function (options = {}) {
	return {
		extensions: [inlineKatex(options), blockKatex(options)]
	};
}

function katexStart(src, displayMode: boolean) {
	let ruleReg = displayMode ? blockRule : inlineRule;

	let indexSrc = src;

	while (indexSrc) {
		let index = -1;
		let startIndex = -1;
		let startDelimiter = '';
		let endDelimiter = '';
		for (let delimiter of DELIMITER_LIST) {
			if (delimiter.display !== displayMode) {
				continue;
			}

			startIndex = indexSrc.indexOf(delimiter.left);
			if (startIndex === -1) {
				continue;
			}

			index = startIndex;
			startDelimiter = delimiter.left;
			endDelimiter = delimiter.right;
		}

		if (index === -1) {
			return;
		}

		// Check if the delimiter is preceded by a special character.
		// If it does, then it's potentially a math formula.
		const f = index === 0 || indexSrc.charAt(index - 1).match(/[\s?。，!-\/:-@[-`{-~]/);
		if (f) {
			const possibleKatex = indexSrc.substring(index);

			if (possibleKatex.match(ruleReg)) {
				return index;
			}
		}

		indexSrc = indexSrc.substring(index + startDelimiter.length).replace(endDelimiter, '');
	}
}

function katexTokenizer(src, tokens, displayMode: boolean) {
	let ruleReg = displayMode ? blockRule : inlineRule;
	let type = displayMode ? 'blockKatex' : 'inlineKatex';

	const match = src.match(ruleReg);

	if (match) {
		const text = match
			.slice(2)
			.filter((item) => item)
			.find((item) => item.trim());

		return {
			type,
			raw: match[0],
			text: text,
			displayMode
		};
	}
}

function inlineKatex(options) {
	return {
		name: 'inlineKatex',
		level: 'inline',
		start(src) {
			return katexStart(src, false);
		},
		tokenizer(src, tokens) {
			return katexTokenizer(src, tokens, false);
		},
		renderer(token) {
			return `${token?.text ?? ''}`;
		}
	};
}

function blockKatex(options) {
	return {
		name: 'blockKatex',
		level: 'block',
		start(src) {
			return katexStart(src, true);
		},
		tokenizer(src, tokens) {
			return katexTokenizer(src, tokens, true);
		},
		renderer(token) {
			return `${token?.text ?? ''}`;
		}
	};
}
