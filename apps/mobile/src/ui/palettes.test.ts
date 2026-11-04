import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PALETTES, type Palette, THEMES } from './palettes.ts';

type Rgb = [number, number, number];

/** #RRGGBB or rgba(r,g,b,a), with rgba laid over `under`. */
function rgb(color: string, under: Rgb = [0, 0, 0]): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)) as Rgb;
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  if (!rgba) throw new Error(`unreadable colour ${color}`);
  const alpha = Number(rgba[4]);
  return [1, 2, 3].map((i, k) => Number(rgba[i]) * alpha + under[k]! * (1 - alpha)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['background', 'surface', 'surfaceRaised', 'surfaceHigh'] as const;
const TEXTS = ['text', 'textMuted', 'textFaint', 'accent', 'athleteA', 'athleteB', 'success', 'warning', 'danger'] as const;
const TINTED = [
  ['accent', 'accentSoft'],
  ['athleteA', 'athleteASoft'],
  ['athleteB', 'athleteBSoft'],
  ['success', 'successSoft'],
  ['warning', 'warningSoft'],
  ['danger', 'dangerSoft'],
] as const satisfies readonly (readonly [keyof Palette, keyof Palette])[];

for (const theme of THEMES) {
  const p = PALETTES[theme];

  test(`${theme}: every text colour reads at 4.5:1 on every surface`, () => {
    for (const surface of SURFACES) {
      for (const text of TEXTS) {
        const ratio = contrast(rgb(p[text]), rgb(p[surface]));
        assert.ok(ratio >= 4.5, `${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  });

  test(`${theme}: badge text reads at 4.5:1 on its own tint`, () => {
    for (const surface of ['surface', 'surfaceRaised'] as const) {
      for (const [text, tint] of TINTED) {
        const ratio = contrast(rgb(p[text]), rgb(p[tint], rgb(p[surface])));
        assert.ok(ratio >= 4.5, `${text} on ${tint} over ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  });

  test(`${theme}: button text and control outlines`, () => {
    const onFill = contrast(rgb(p.accentText), rgb(p.accentFill));
    assert.ok(onFill >= 4.5, `accentText on accentFill: ${onFill.toFixed(2)}`);
    for (const surface of ['surface', 'surfaceRaised'] as const) {
      const fill = contrast(rgb(p.accentFill), rgb(p[surface]));
      assert.ok(fill >= 3, `accentFill on ${surface}: ${fill.toFixed(2)}`);
      const outline = contrast(rgb(p.control), rgb(p[surface]));
      assert.ok(outline >= 3, `control on ${surface}: ${outline.toFixed(2)}`);
      const focus = contrast(rgb(p.focus), rgb(p[surface]));
      assert.ok(focus >= 3, `focus on ${surface}: ${focus.toFixed(2)}`);
    }
  });

  test(`${theme}: the accent and fill are red, not orange or pink`, () => {
    for (const key of ['accent', 'accentFill'] as const) {
      const [r, g, b] = rgb(p[key]).map((v) => v / 255) as Rgb;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const hue = d === 0 ? 0 : max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      assert.ok(hue >= 350 || hue <= 5, `${key} hue ${hue.toFixed(0)}°`);
    }
  });
}
