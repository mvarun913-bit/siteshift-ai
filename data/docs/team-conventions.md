# Headless component conventions (sample)

Replace this file with your own conventions. It gives the RAG index something to cite on day one.

## Naming
Components use PascalCase and live in src/components/<Feature>/<ComponentName>.tsx. One rendering maps to one component. Template names match the component name, for example a Promo component uses a Promo template.

## Fields
Headings use Single-Line Text. Body copy uses Rich Text. Images use the Image field and must have alt text set by authors; the component never hardcodes alt text. Calls to action use General Link so authors control both URL and link text.

## Accessibility
Every component must meet WCAG 2.1 AA. Link text must describe the destination, so "Click here" is not allowed. Headings follow page order and components accept a heading level prop rather than hardcoding h2. Interactive elements need a visible focus state. Decorative images use empty alt text.

## Styling
Use Tailwind utilities only. No inline styles and no component-level CSS files unless a third-party widget requires it. Spacing follows the 4px scale.

## Analytics
Do not use inline onclick handlers. Click tracking is attached with data-track attributes that the analytics script reads, for example data-track="promo-cta".
