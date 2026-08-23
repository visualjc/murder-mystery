/**
 * Strip terminal control sequences out of vendor-sourced text.
 *
 * The game prints model output straight to a terminal. A remote model — or
 * anything able to influence one — can therefore emit ANSI/OSC escapes that
 * repaint the screen, rewrite the window title, move the cursor back over lines
 * the player has already read, or (with OSC 52) reach the clipboard. None of
 * that is prose, and none of it is anything the engine asks for, so it is
 * removed at the boundary rather than trusted.
 *
 * What survives: printable text, newline and tab. What does not:
 *   - C0 controls other than newline and tab, and DEL;
 *   - C1 controls (0x80-0x9F), including the single-byte CSI/OSC/DCS
 *     introducers — folded into their two-byte ESC forms first, so the sequence
 *     they start is removed whole rather than left behind as loose text;
 *   - every ESC-initiated sequence, wholesale: CSI, OSC (to BEL or ST), the
 *     string sequences DCS/SOS/PM/APC (to ST), and two-character escapes. An
 *     unterminated sequence is removed to the end of the string — a truncated
 *     escape is still an escape once the terminal reads the next chunk.
 *
 * Patterns are built from `String.fromCharCode` rather than written as literal
 * escapes so that this file contains no control characters of its own: an
 * editor, a diff or a terminal showing the source cannot mangle what the
 * patterns mean.
 *
 * This is deliberately NOT a whitespace tidy: a caller that wants one line
 * collapses whitespace itself, and a caller that wants a paragraph keeps its
 * newlines.
 */

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
/** Pattern for the String Terminator in its two-byte form: ESC then a backslash. */
const ST = `${ESC}\\\\`;

/** A character-class range, e.g. `range(0x20, 0x2f)` for the CSI intermediates. */
function range(from: number, to: number): string {
  return `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
}

/** C0 controls, minus tab (0x09) and newline (0x0A), plus DEL (0x7F). */
const C0_CONTROLS = new RegExp(
  `[${range(0x00, 0x08)}${range(0x0b, 0x1f)}${String.fromCharCode(0x7f)}]`,
  'g',
);

/** `ESC ]` ... terminated by BEL or ST — window titles, and OSC 52's clipboard. */
const OSC_SEQUENCE = new RegExp(`${ESC}\\][\\s\\S]*?(?:${BEL}|${ST}|$)`, 'g');

/** `ESC P|X|^|_` ... terminated by ST — DCS, SOS, PM and APC strings. */
const STRING_SEQUENCE = new RegExp(`${ESC}[PX^_][\\s\\S]*?(?:${ST}|$)`, 'g');

/** `ESC [` parameters, intermediates, final byte — colour, cursor, erase. */
const CSI_SEQUENCE = new RegExp(
  `${ESC}\\[[${range(0x30, 0x3f)}]*[${range(0x20, 0x2f)}]*[${range(0x40, 0x7e)}]?`,
  'g',
);

/** Anything else an ESC starts: a two-character escape, or a lone trailing ESC. */
const ESCAPE_SEQUENCE = new RegExp(`${ESC}[${range(0x20, 0x7e)}]?`, 'g');

const C1_CONTROLS = new RegExp(`[${range(0x80, 0x9f)}]`, 'g');

/**
 * Fold the C1 controls away: 0x90-0x9F become their `ESC <char>` equivalents so
 * the sequence stripping below sees them, and the rest are dropped outright.
 */
function foldC1(text: string): string {
  return text.replace(C1_CONTROLS, (char) => {
    const code = char.charCodeAt(0);
    return code >= 0x90 ? `${ESC}${String.fromCharCode(code - 0x40)}` : '';
  });
}

/** Remove every terminal control sequence from one vendor-sourced string. */
export function sanitizeVendorText(text: string): string {
  return foldC1(text)
    .replace(OSC_SEQUENCE, '')
    .replace(STRING_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESCAPE_SEQUENCE, '')
    .replace(C0_CONTROLS, '');
}
