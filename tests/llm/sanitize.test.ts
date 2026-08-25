/**
 * The vendor-text sanitizer.
 *
 * Panel finding (codex): remote-model text reached `process.stdout` untouched,
 * so ANSI/OSC sequences in a reply were executed by the player's terminal —
 * colour, cursor moves over lines already read, a rewritten window title, and
 * with OSC 52 a write into the clipboard. These tests are written as an
 * attacker would: hostile payloads in, legible words out and not one control
 * character left.
 *
 * Control characters are built with `String.fromCharCode` so the expectations
 * cannot be mangled by an editor, a diff, or a terminal rendering this file.
 */

import { describe, expect, test } from 'bun:test';

import { sanitizeVendorText } from '../../src/llm/sanitize.ts';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI_C1 = String.fromCharCode(0x9b);
const OSC_C1 = String.fromCharCode(0x9d);
const DCS_C1 = String.fromCharCode(0x90);
const ST_C1 = String.fromCharCode(0x9c);

/** Every control character left in a string, as hex, for a readable failure. */
function controlsIn(text: string): string[] {
  return [...text]
    .filter((char) => {
      const code = char.charCodeAt(0);
      if (code === 0x09 || code === 0x0a) return false;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f);
    })
    .map((char) => `0x${char.charCodeAt(0).toString(16)}`);
}

describe('sanitizeVendorText', () => {
  test('plain prose is returned byte for byte', () => {
    const prose = 'The clock struck nine, and nobody moved. "Where were you?" she asked.';
    expect(sanitizeVendorText(prose)).toBe(prose);
  });

  test('newlines and tabs survive — they are layout, not control', () => {
    const laid_out = 'first line\nsecond line\tindented\n\nlast';
    expect(sanitizeVendorText(laid_out)).toBe(laid_out);
  });

  test('an SGR colour sequence is removed and the words between it are kept', () => {
    const hostile = `${ESC}[31mThe clock struck nine.${ESC}[0m`;
    const clean = sanitizeVendorText(hostile);
    console.log('[sanitize sgr] ->', JSON.stringify(clean));
    expect(clean).toBe('The clock struck nine.');
  });

  test('cursor and erase sequences go too, including the ones with intermediates', () => {
    const hostile = `up${ESC}[2Ahome${ESC}[Hclear${ESC}[2Jwide${ESC}[?25lend`;
    expect(sanitizeVendorText(hostile)).toBe('uphomeclearwideend');
  });

  test('an OSC window-title sequence is removed whole, payload included', () => {
    const hostile = `before${ESC}]0;pwned${BEL}after`;
    const clean = sanitizeVendorText(hostile);
    console.log('[sanitize osc] ->', JSON.stringify(clean));
    expect(clean).toBe('beforeafter');
    expect(clean).not.toContain('pwned');
  });

  test('an OSC terminated by ST rather than BEL is removed whole', () => {
    const hostile = `before${ESC}]52;c;cGF5bG9hZA==${ESC}\\after`;
    const clean = sanitizeVendorText(hostile);
    expect(clean).toBe('beforeafter');
    expect(clean).not.toContain('cGF5bG9hZA==');
  });

  test('a DCS string is removed whole', () => {
    const hostile = `before${ESC}Pq#0;2;0;0;0${ESC}\\after`;
    expect(sanitizeVendorText(hostile)).toBe('beforeafter');
  });

  test('an unterminated escape takes the rest of the string with it', () => {
    // A truncated sequence is still a sequence: the terminal will happily
    // consume whatever arrives next as its payload.
    expect(sanitizeVendorText(`kept${ESC}]0;never closed`)).toBe('kept');
    expect(sanitizeVendorText(`kept${ESC}Pnever closed`)).toBe('kept');
  });

  test('single-byte C1 introducers are stripped with the sequences they start', () => {
    const hostile = `a${CSI_C1}31mb${OSC_C1}0;title${BEL}c${DCS_C1}payload${ST_C1}d`;
    const clean = sanitizeVendorText(hostile);
    console.log('[sanitize c1] ->', JSON.stringify(clean), controlsIn(clean));
    expect(clean).toBe('abcd');
    expect(clean).not.toContain('title');
    expect(clean).not.toContain('payload');
    // Not merely "the introducer byte was dropped": the parameters went with it.
    expect(clean).not.toContain('31m');
  });

  test('bare C0 controls are dropped, tab and newline aside', () => {
    const hostile = `bell${BEL}back${String.fromCharCode(0x08)}cr${String.fromCharCode(
      0x0d,
    )}nul${String.fromCharCode(0x00)}del${String.fromCharCode(0x7f)}`;
    const clean = sanitizeVendorText(hostile);
    expect(clean).toBe('bellbackcrnuldel');
    expect(controlsIn(clean)).toEqual([]);
  });

  test('a lone ESC at the end of a string does not survive', () => {
    expect(sanitizeVendorText(`trailing${ESC}`)).toBe('trailing');
    expect(controlsIn(sanitizeVendorText(`trailing${ESC}`))).toEqual([]);
  });

  test('a full hostile payload leaves the prose and nothing else', () => {
    const hostile =
      `${ESC}]0;pwned${BEL}${ESC}[31mI was on the stairs${ESC}[0m${BEL}` +
      `${CSI_C1}2K with a cold cup of tea.${ESC}[1;1H`;
    const clean = sanitizeVendorText(hostile);
    console.log('[sanitize payload] ->', JSON.stringify(clean));

    expect(controlsIn(clean)).toEqual([]);
    expect(clean).toBe('I was on the stairs with a cold cup of tea.');
  });

  test('an empty string, and a string that is nothing but escapes, come back empty', () => {
    expect(sanitizeVendorText('')).toBe('');
    expect(sanitizeVendorText(`${ESC}[31m${ESC}[0m`)).toBe('');
  });
});
