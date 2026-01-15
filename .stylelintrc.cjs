module.exports = {
    rules: {
        // allow Tailwind directives (@tailwind, @apply, @variants, @responsive, @screen, etc.)
        'at-rule-no-unknown': [
            true,
            {
                ignoreAtRules: ['tailwind', 'apply', 'variants', 'responsive', 'screen', 'layer', 'config'],
            },
        ],
    },
};
