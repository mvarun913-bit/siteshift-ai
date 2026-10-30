# Headless component conventions

These are the conventions I follow when building Sitecore headless components in Next.js and when migrating legacy ASP.NET sites.

## Naming and structure
Components use PascalCase and live in src/components/<Feature>/<ComponentName>.tsx. One rendering maps to one component, and the template name matches the component name, so a Promo rendering uses a Promo template. Shared building blocks such as buttons and section wrappers live in src/components/ui and never fetch data themselves.

## Field choices
Headings use Single-Line Text. Body copy uses Rich Text. Short supporting text such as captions uses Multi-Line Text. Images use the Image field, and authors set alt text in Sitecore; components never hardcode alt text. Calls to action use General Link so authors control both the URL and the link text. Repeating items such as cards use a Multilist or Treelist pointing to child items rather than numbered fields like Card1, Card2.

## Rendering fields
Render Sitecore fields with the Content SDK helpers (Text, RichText, Image, Link) from @sitecore-content-sdk/nextjs so fields stay editable in Pages. Only read raw field values when the value drives logic, such as a checkbox that toggles a layout variant.

## Accessibility
Every component must meet WCAG 2.1 AA. Link text must describe the destination, so "Click here" and "Read more" on their own are not allowed. Components accept a heading level prop instead of hardcoding h2, so page outlines stay in order. Every interactive element is reachable by keyboard and has a visible focus state. Decorative images use empty alt text. Color contrast is at least 4.5:1 for body text. Forms always use real label elements tied to inputs.

## Styling
Use Tailwind utilities only. No inline styles, and no component-level CSS files unless a third-party widget requires it. Spacing follows the 4px scale. Layout is mobile-first, and every component is checked at 375px wide before review.

## Migrating legacy ASP.NET pages
Convert one rendering at a time, not whole pages. Replace server controls such as asp:Literal and asp:Image with typed props that map to Sitecore fields. Move logic out of code-behind into data fetching or small helper functions. Remove jQuery and inline scripts; replace them with React state only where interactivity is actually needed. Fix accessibility issues during the conversion rather than in a separate pass. Keep URLs stable during migration and add redirects for anything that changes.

## Configuration and secrets
Never commit secrets. API keys and tokens live in a secrets manager and reach the app as environment variables at build or runtime. Local development uses an untracked env file, and every required variable is documented in an example file.

## Deployment
Every change goes through a merge request and a CI pipeline that runs lint, type checks and a build before deploy. Sites deploy to Cloudflare, with a preview environment for each branch so content authors can review before release.

## Analytics
Do not use inline onclick handlers. Click tracking is attached with data-track attributes that the analytics script reads, for example data-track="promo-cta".
