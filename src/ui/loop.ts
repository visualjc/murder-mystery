/**
 * The terminal game loop (ADR-0003).
 *
 * The loop is a reader and a printer. Every outcome it shows was decided by the
 * engine, every legality question it asks is answered by the engine, and the
 * game master is asked only for words. The three consequences that shape this
 * file:
 *
 *  - It takes an `Io` and a client FACTORY rather than reaching for stdio or the
 *    network, so a test drives the real loop over the real engine with scripted
 *    answers, and `--no-llm` is a code path that provably makes no call at all.
 *  - Every engine call is wrapped: an `IllegalActionError` is a menu that was
 *    offered when it should not have been, and the player gets the menu back
 *    rather than a stack trace.
 *  - The player is `p1`, seat 1. Everything the loop renders comes from that
 *    seat's `playerView` — the loop never touches `GameState.caseFile` or
 *    another seat's hand, so the screen cannot spill them.
 *
 * The session always ends with the token ledger, measured from each response's
 * own `usage` object (PRODUCT.md hard constraint 6).
 */

import type { Position } from '../engine/board.ts';
import { SUSPECTS, WEAPONS, ROOMS, type Card, type Suspect, type Weapon, type Room } from '../engine/cards.ts';
import { secretPassageFrom } from '../engine/board.ts';
import {
  canSuggest,
  canTakeSecretPassage,
  currentPlayer,
  endTurn,
  legalMoves,
  makeAccusation,
  makeSuggestion,
  moveTo,
  provideRefutationCard,
  rollDice,
  takeSecretPassage,
} from '../engine/actions.ts';
import { createGame } from '../engine/setup.ts';
import { IllegalActionError, type GameState } from '../engine/types.ts';
import { isVisibleTo, playerView, type PlayerView } from '../engine/view.ts';
import {
  CANNED_SCENARIO,
  GameMaster,
  buildNotebook,
  fallbackNarration,
  formatUsageLedger,
  playOpponentTurn,
  refuteAsOpponent,
} from '../gm/index.ts';
import type { ChatClient, SessionUsage } from '../llm/index.ts';
import type { Io } from './io.ts';
import {
  describeDestination,
  renderNotebook,
  renderOpening,
  renderOutcome,
  renderStatus,
  renderSuspects,
} from './render.ts';

/** Seat 1 is the human. The rest are played by the deterministic policy. */
export const HUMAN_SEAT = 'p1';

export type LoopOptions = {
  readonly seed: number | string;
  readonly players: number;
  /** False under `--no-llm`: no client is built and no request is made. */
  readonly useLlm: boolean;
};

export type LoopDeps = {
  readonly io: Io;
  /**
   * Builds the session's one chat client. Called only when `useLlm`, and a
   * throw (a missing key, most often) is a notice and an offline game, not a
   * crash — the game must be playable without a model (hard constraint 4).
   */
  readonly createClient?: () => ChatClient;
};

/** The ledger for a session that never built a client. */
const NO_USAGE: SessionUsage = {
  calls: 0,
  attempts: 0,
  failures: 0,
  callsWithUsage: 0,
  callsWithoutUsage: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  byModel: {},
};

const FALLBACK_NOTICE =
  '(the game master is not answering — the rest of this game is told in the engine\'s own words)';

type Option<T> = { readonly key: string; readonly label: string; readonly value: T };

type Action =
  | { readonly kind: 'roll' }
  | { readonly kind: 'passage' }
  | { readonly kind: 'move'; readonly position: Position }
  | { readonly kind: 'suggest' }
  | { readonly kind: 'accuse' }
  | { readonly kind: 'ask' }
  | { readonly kind: 'notes' }
  | { readonly kind: 'end' }
  | { readonly kind: 'quit' };

function option<T>(key: string, label: string, value: T): Option<T> {
  return { key, label, value };
}

/**
 * The whole command vocabulary (ADR-0003), independent of what is legal now.
 * A word from this list is always understood; whether it can be DONE is the
 * engine's call, and its refusal is what the player is shown.
 */
const VOCABULARY: readonly Option<Action>[] = [
  option('roll', 'roll the die and move', { kind: 'roll' }),
  option('passage', 'take the secret passage', { kind: 'passage' }),
  option('suggest', 'make a suggestion', { kind: 'suggest' }),
  option('accuse', 'make an accusation', { kind: 'accuse' }),
  option('ask', 'question a suspect', { kind: 'ask' }),
  option('notes', 'read your notebook', { kind: 'notes' }),
  option('end', 'end your turn', { kind: 'end' }),
  option('quit', 'leave the game', { kind: 'quit' }),
];

/** The vocabulary this menu does not already show. */
function unlistedVocabulary(printed: readonly Option<Action>[]): Option<Action>[] {
  return VOCABULARY.filter((word) => !printed.some((entry) => entry.key === word.key));
}

/**
 * Resolve one typed answer against a menu: a number picks by position, a word
 * picks by keyword (exactly, or by an unambiguous prefix). Returns null when
 * the answer matches nothing, which is a reprint rather than a failure.
 */
export function resolveChoice<T>(answer: string, options: readonly Option<T>[]): Option<T> | null {
  const tidy = answer.trim().toLowerCase();
  if (tidy.length === 0) return null;

  if (/^\d+$/.test(tidy)) {
    const index = Number(tidy) - 1;
    return options[index] ?? null;
  }

  const exact = options.filter((candidate) => candidate.key.toLowerCase() === tidy);
  if (exact.length === 1) return exact[0] as Option<T>;

  const byPrefix = options.filter(
    (candidate) => candidate.key.length > 0 && candidate.key.toLowerCase().startsWith(tidy),
  );
  return byPrefix.length === 1 ? (byPrefix[0] as Option<T>) : null;
}

/**
 * Play one session to its end.
 *
 * Returns the process exit code: 0 for a game that ended or a player who left.
 */
export async function runGame(options: LoopOptions, deps: LoopDeps): Promise<number> {
  const { io } = deps;

  let client: ChatClient | null = null;
  if (options.useLlm && deps.createClient !== undefined) {
    try {
      client = deps.createClient();
    } catch (error) {
      io.write(`(no game master: ${error instanceof Error ? error.message : String(error)})`);
      io.write('(playing offline — the game is the same, the prose is plainer)');
    }
  }
  // The game master's one session-level notice — the breaker opening — goes to
  // the player through the same channel as everything else it says.
  const gm = client === null ? null : new GameMaster(client, { onNotice: (text) => io.write(text) });

  let state: GameState = createGame({ seed: options.seed, playerCount: options.players });
  let narrated = 0;
  let shownTurn = -1;
  let askedOnTurn = -1;
  let llmNoticed = false;
  /** Set when stdin closes or the player quits: every menu unwinds. */
  let ended = false;

  const scenario = gm === null ? CANNED_SCENARIO : await gm.openScenario();
  for (const line of renderOpening(scenario, {
    seed: typeof options.seed === 'number' ? options.seed : Number(options.seed),
    players: options.players,
    llm: client === null ? 'offline (--no-llm)' : `game master: ${client.config.model}`,
  })) {
    io.write(line);
  }
  if (gm !== null && scenario.source === 'fallback') {
    llmNoticed = true;
    io.write(FALLBACK_NOTICE);
  }

  async function prompt(text: string): Promise<string | null> {
    const answer = await io.ask(text);
    if (answer === null) ended = true;
    return answer;
  }

  /**
   * Print a menu and read one answer. Null means "cancelled or gone".
   *
   * `hidden` options are matchable but not printed: the command vocabulary is
   * always available to type (ADR-0003), while the numbered list shows only what
   * makes sense right now. A keyword that is legal to SAY but not legal to DO
   * reaches the engine and comes back as its own refusal, which is better than
   * pretending the word does not exist.
   */
  async function choose<T>(
    title: string,
    choices: readonly Option<T>[],
    hidden: readonly Option<T>[] = [],
  ): Promise<T | null> {
    while (!ended) {
      io.write('');
      io.write(title);
      choices.forEach((entry, index) => {
        io.write(`  ${index + 1}) ${entry.key.length === 0 ? '' : `${entry.key} — `}${entry.label}`);
      });
      const answer = await prompt('> ');
      if (answer === null) return null;
      const match = resolveChoice(answer, [...choices, ...hidden]);
      if (match !== null) return match.value;
      io.write(`I do not understand "${answer}". Answer with a number, or with one of the keywords.`);
    }
    return null;
  }

  /** Show the player everything that has happened since the last time. */
  async function flush(): Promise<void> {
    const fresh = state.events.slice(narrated);
    narrated = state.events.length;
    const mine = fresh.filter((event) => isVisibleTo(event, HUMAN_SEAT));
    if (mine.length === 0) return;

    const lines =
      gm === null ? fallbackNarration(mine) : await gm.narrate(playerView(state, HUMAN_SEAT), mine);
    if (gm !== null && !llmNoticed && lines.some((line) => line.source === 'fallback')) {
      llmNoticed = true;
      io.write(FALLBACK_NOTICE);
    }
    for (const line of lines) io.write(`  ${line.text}`);
  }

  function cardOptions<T extends Card>(cards: readonly T[]): Option<T | null>[] {
    return [
      ...cards.map((card) => option<T | null>('', String(card), card)),
      option<T | null>('back', 'never mind', null),
    ];
  }

  async function doSuggest(view: PlayerView): Promise<void> {
    if (!canSuggest(state) || view.position.kind !== 'room') {
      // The word was typed when the rule does not allow it. `canSuggest` is the
      // predicate `makeSuggestion` itself checks, so this call is certain to
      // throw — and the player gets the ENGINE's reason rather than a second,
      // drifting copy of the rule kept here.
      state = makeSuggestion(state, { suspect: SUSPECTS[0] as Suspect, weapon: WEAPONS[0] as Weapon });
      return;
    }
    const room = view.position.room;
    const suspect = await choose(
      `Suggestion — who do you say was here in the ${room}?`,
      cardOptions(SUSPECTS),
    );
    if (suspect === null) return;
    const weapon = await choose(`Suggestion — with what, in the ${room}?`, cardOptions(WEAPONS));
    if (weapon === null) return;
    state = makeSuggestion(state, { suspect: suspect as Suspect, weapon: weapon as Weapon });
  }

  async function doAccuse(): Promise<void> {
    io.write('');
    io.write('An accusation is final: name it wrongly and you are out of the running.');
    const suspect = await choose('Who did it?', cardOptions(SUSPECTS));
    if (suspect === null) return;
    const weapon = await choose('With what?', cardOptions(WEAPONS));
    if (weapon === null) return;
    const room = await choose('Where?', cardOptions(ROOMS));
    if (room === null) return;
    state = makeAccusation(state, {
      suspect: suspect as Suspect,
      weapon: weapon as Weapon,
      room: room as Room,
    });
  }

  async function doAsk(view: PlayerView): Promise<void> {
    if (gm === null) throw new IllegalActionError('there is no game master to ask');
    const others = SUSPECTS.filter((suspect) => suspect !== view.character);
    const suspect = await choose('Whom will you question?', cardOptions(others));
    if (suspect === null) return;
    const question = await prompt(`Ask ${suspect}: `);
    if (question === null || question.length === 0) return;
    askedOnTurn = view.turnNumber;
    const answer = await gm.ask(view, suspect as Suspect, question);
    if (!llmNoticed && answer.source === 'fallback') {
      llmNoticed = true;
      io.write(FALLBACK_NOTICE);
    }
    io.write('');
    io.write(`  ${answer.suspect}: "${answer.text}"`);
  }

  /** The menu for the player's current phase, in the order a player wants it. */
  function actionsFor(view: PlayerView): Option<Action>[] {
    const choices: Option<Action>[] = [];

    if (view.eliminated) {
      choices.push(option('end', 'end your turn', { kind: 'end' } as const));
    } else if (state.phase === 'awaiting-move') {
      const moves = legalMoves(state);
      for (const move of moves) {
        choices.push(option('', `move to ${describeDestination(move)}`, {
          kind: 'move',
          position: move.position,
        } as const));
      }
      if (moves.length === 0) {
        choices.push(option('end', 'nowhere to go — end your turn', { kind: 'end' } as const));
      }
    } else {
      if (canTakeSecretPassage(state) && view.position.kind === 'room') {
        const through = secretPassageFrom(view.position.room);
        if (through !== null) {
          choices.push(option('passage', `take the secret passage to the ${through}`, {
            kind: 'passage',
          } as const));
        }
      }
      if (state.phase === 'awaiting-roll') {
        choices.push(option('roll', 'roll the die and move', { kind: 'roll' } as const));
      }
      if (canSuggest(state)) {
        choices.push(option('suggest', 'make a suggestion', { kind: 'suggest' } as const));
      }
      if (state.phase === 'awaiting-action') {
        choices.push(option('end', 'end your turn', { kind: 'end' } as const));
      }
    }

    if (!view.eliminated) {
      choices.push(option('accuse', 'make an accusation', { kind: 'accuse' } as const));
      if (gm !== null && askedOnTurn !== view.turnNumber) {
        choices.push(option('ask', 'question a suspect', { kind: 'ask' } as const));
      }
    }
    choices.push(option('notes', 'read your notebook', { kind: 'notes' } as const));
    choices.push(option('quit', 'leave the game', { kind: 'quit' } as const));
    return choices;
  }

  async function humanAction(): Promise<void> {
    const view = playerView(state, HUMAN_SEAT);
    if (view.turnNumber !== shownTurn) {
      shownTurn = view.turnNumber;
      for (const line of renderStatus(view)) io.write(line);
    }

    const printed = actionsFor(view);
    const action = await choose('What will you do?', printed, unlistedVocabulary(printed));
    if (action === null) return;

    try {
      switch (action.kind) {
        case 'roll':
          state = rollDice(state);
          return;
        case 'passage':
          state = takeSecretPassage(state);
          return;
        case 'move':
          state = moveTo(state, action.position);
          return;
        case 'suggest':
          await doSuggest(view);
          return;
        case 'accuse':
          await doAccuse();
          return;
        case 'ask':
          await doAsk(view);
          return;
        case 'notes':
          for (const line of renderNotebook(view, buildNotebook(view))) io.write(line);
          io.write('  Where everyone stands:');
          for (const line of renderSuspects(view)) io.write(line);
          return;
        case 'end':
          state = endTurn(state);
          return;
        case 'quit':
          ended = true;
          return;
      }
    } catch (error) {
      // A menu offered something the engine will not allow: say so plainly and
      // let the player choose again. The game never dies of a bad choice.
      if (!(error instanceof IllegalActionError)) throw error;
      io.write('');
      io.write(`That will not work: ${error.message}`);
    }
  }

  /** The player owes a refutation: which of their matching cards do they show? */
  async function humanRefutation(): Promise<void> {
    const view = playerView(state, HUMAN_SEAT);
    const pending = view.pendingRefutation;
    if (pending === null || !pending.yours || pending.options === null) return;

    const card = await choose(
      `${pending.suggester} is waiting — you must show ONE of these, privately:`,
      pending.options.map((candidate) => option('', String(candidate), candidate)),
    );
    if (card === null) return;
    try {
      state = provideRefutationCard(state, card);
    } catch (error) {
      if (!(error instanceof IllegalActionError)) throw error;
      io.write(`That will not work: ${error.message}`);
    }
  }

  // Everything that has happened is told BEFORE the next question is asked, so
  // the player never chooses without having seen the board move.
  while (!state.over && !ended) {
    await flush();
    if (state.phase === 'awaiting-refutation') {
      if (state.pendingRefutation?.refuter === HUMAN_SEAT) await humanRefutation();
      else state = refuteAsOpponent(state);
      continue;
    }
    if (currentPlayer(state).id === HUMAN_SEAT) {
      await humanAction();
      continue;
    }
    state = playOpponentTurn(state);
  }
  await flush();

  const view = playerView(state, HUMAN_SEAT);
  if (state.over) {
    for (const line of renderOutcome(view)) io.write(line);
  } else {
    io.write('');
    io.write('You leave the house with the case unsolved.');
  }

  io.write('');
  for (const line of formatUsageLedger(client === null ? NO_USAGE : client.usage)) io.write(line);
  return 0;
}
