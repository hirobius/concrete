import type { Config } from 'tailwindcss';

/**
 * Hirobius Studio — Tailwind config.
 *
 * Every value here is a CSS variable, and every variable comes from
 * @hirobius/design-system/variables.css (imported first in globals.css) or the
 * generated tenant overlay beside it. There are no literals, because a literal
 * here is a copy of a system decision that nothing will ever re-check — which
 * is how this file ended up shipping headings at weight 500 where HDS says 700,
 * eyebrow tracking at 0.08em where HDS says 0.06em, and an 8px action radius
 * written as 12px under a comment naming the token it did not match.
 *
 * The only exception is the four fluid heading sizes, which are STUDIO-OWNED
 * and declared in globals.css under --studio-* names. HDS ships static desktop
 * maxima; until hds#283 decides whether it emits fluid sizes, the clamps are
 * ours. They are deliberately not named --semantic-* so nobody mistakes them
 * for system values.
 *
 * If a value you need is missing: a brand decision goes in tenant/tokens.json
 * (then `pnpm tokens:overlay`); a system decision goes upstream into HDS. It
 * does not go here.
 */

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--semantic-color-surface-page)',
        raised: 'var(--semantic-color-surface-raised)',
        overlay: 'var(--semantic-color-surface-overlay)',
        inverse: 'var(--semantic-color-surface-inverse)',
        accent: 'var(--semantic-color-surface-accent)',
        accentSubtle: 'var(--semantic-color-surface-accentSubtle)',

        primary: 'var(--semantic-color-content-primary)',
        secondary: 'var(--semantic-color-content-secondary)',
        disabled: 'var(--semantic-color-content-disabled)',
        onAccent: 'var(--semantic-color-content-onAccent)',
        contentAccent: 'var(--semantic-color-content-accent)',

        borderDefault: 'var(--semantic-color-border-default)',
        borderSubtle: 'var(--semantic-color-border-subtle)',
        borderStrong: 'var(--semantic-color-border-strong)',
        borderAccent: 'var(--semantic-color-border-accent)',

        error: 'var(--semantic-color-feedback-error)',
        success: 'var(--semantic-color-feedback-success)',
        warning: 'var(--semantic-color-feedback-warning)',
      },
      fontFamily: {
        display: 'var(--semantic-typography-display-font-family)',
        body: 'var(--semantic-typography-body-font-family)',
        mono: 'var(--semantic-typography-mono-font-family)',
      },
      fontSize: {
        // Size / line-height / weight / tracking all read from HDS. The four
        // heading SIZES use the studio-owned fluid clamps; everything else,
        // including their leading and tracking, is the system's.
        display: ['var(--studio-size-display)', {
          lineHeight: 'var(--semantic-typography-display-line-height)',
          fontWeight: 'var(--semantic-typography-display-font-weight)',
          letterSpacing: 'var(--semantic-typography-display-letter-spacing)',
        }],
        h1: ['var(--studio-size-h1)', {
          lineHeight: 'var(--semantic-typography-h1-line-height)',
          fontWeight: 'var(--semantic-typography-h1-font-weight)',
          letterSpacing: 'var(--semantic-typography-h1-letter-spacing)',
        }],
        h2: ['var(--studio-size-h2)', {
          lineHeight: 'var(--semantic-typography-h2-line-height)',
          fontWeight: 'var(--semantic-typography-h2-font-weight)',
          letterSpacing: 'var(--semantic-typography-h2-letter-spacing)',
        }],
        h3: ['var(--studio-size-h3)', {
          lineHeight: 'var(--semantic-typography-h3-line-height)',
          fontWeight: 'var(--semantic-typography-h3-font-weight)',
          letterSpacing: 'var(--semantic-typography-h3-letter-spacing)',
        }],
        body: ['var(--semantic-typography-body-font-size)', {
          lineHeight: 'var(--semantic-typography-body-line-height)',
          fontWeight: 'var(--semantic-typography-body-font-weight)',
        }],
        ui: ['var(--semantic-typography-ui-font-size)', {
          lineHeight: 'var(--semantic-typography-ui-line-height)',
          fontWeight: 'var(--semantic-typography-ui-font-weight)',
        }],
        caption: ['var(--semantic-typography-caption-font-size)', {
          lineHeight: 'var(--semantic-typography-caption-line-height)',
          fontWeight: 'var(--semantic-typography-caption-font-weight)',
        }],
        eyebrow: ['var(--semantic-typography-eyebrow-font-size)', {
          lineHeight: 'var(--semantic-typography-eyebrow-line-height)',
          fontWeight: 'var(--semantic-typography-eyebrow-font-weight)',
          letterSpacing: 'var(--semantic-typography-eyebrow-letter-spacing)',
        }],
        mono: ['var(--semantic-typography-mono-font-size)', {
          lineHeight: 'var(--semantic-typography-mono-line-height)',
          fontWeight: 'var(--semantic-typography-mono-font-weight)',
        }],
      },
      borderRadius: {
        action: 'var(--semantic-radius-action)',      // buttons, inputs, badges
        container: 'var(--primitive-radius-12)',      // cards, sheets, modals
      },
      maxWidth: {
        prose: '60ch',
        editorial: '72ch',
      },
    },
  },
  plugins: [],
};

export default config;
