/**
 * The LLM game master.
 *
 * Scenario, narration and in-fiction Q&A, layered over engine-decided facts —
 * plus the deterministic opponent policy that plays the suspects the human is
 * not. The model describes; it never decides (ADR-0001).
 *
 * Everything goes through ONE `ChatClient`, which is what makes the session's
 * token ledger honest: the roles may run on different models, and the ledger
 * attributes each call's `usage` figures to the model that reported them
 * (PRODUCT.md hard constraint 6, orchestrator resolution 5rwbt08h).
 */

import type { Suspect } from '../engine/cards.ts';
import type { GameEvent } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import type { ChatClient, SessionUsage } from '../llm/index.ts';
import { isVisibleTo } from '../engine/view.ts';
import { CANNED_SCENARIO, requestScenario, type Scenario } from './scenario.ts';
import { fallbackNarration, narrateEvents, type NarrationLine } from './narrator.ts';
import { askSuspect, fallbackAnswer, type SuspectAnswer } from './qa.ts';

export {
  CANNED_SCENARIO,
  parseScenario,
  requestScenario,
  scenarioMessages,
  type Scenario,
  type ScenarioOptions,
} from './scenario.ts';
export {
  CRITICAL_EVENTS,
  fallbackNarration,
  narrateEvents,
  narrationMessages,
  parseNarration,
  type NarrationLine,
  type NarrationRequest,
  type Roster,
} from './narrator.ts';
export {
  askSuspect,
  fallbackAnswer,
  questionMessages,
  visibleFactsFor,
  type QuestionRequest,
  type SuspectAnswer,
  type VisibleFacts,
} from './qa.ts';
export { buildNotebook, type Notebook } from './notebook.ts';
export {
  applyOpponentPlan,
  planOpponentAction,
  playOpponentTurn,
  refuteAsOpponent,
  type OpponentPlan,
} from './opponent.ts';

/**
 * Consecutive failed game-master calls after which the session stops calling
 * the vendor at all.
 *
 * Two, because one failure is a blip and two in a row is an endpoint that is
 * not coming back within this session — and every later call would cost the
 * player the full timeout again, once per narration flush and once per
 * question, for a reply that never arrives (panel finding, codex).
 */
const LLM_FAILURE_LIMIT = 2;

/** Said once, on the turn the breaker opens. The session is offline from then on. */
export const LLM_DISABLED_NOTICE =
  'LLM disabled for this session after repeated failures — continuing offline';

export type GameMasterOptions = {
  /** Per-role model overrides. Each defaults to the client's configured model. */
  readonly models?: {
    readonly scenario?: string;
    readonly narration?: string;
    readonly qa?: string;
  };
  /**
   * Where a session-level notice goes — the loop's `io.write`. Called at most
   * once, with {@link LLM_DISABLED_NOTICE}, if the breaker opens.
   */
  readonly onNotice?: (text: string) => void;
};

export class GameMaster {
  readonly client: ChatClient;
  readonly models: NonNullable<GameMasterOptions['models']>;

  #scenario: Scenario | null = null;
  #consecutiveFailures = 0;
  #llmDisabled = false;
  readonly #onNotice: ((text: string) => void) | undefined;

  constructor(client: ChatClient, options: GameMasterOptions = {}) {
    this.client = client;
    this.models = options.models ?? {};
    this.#onNotice = options.onNotice;
  }

  /** True once the breaker has opened: this session makes no further request. */
  get llmDisabled(): boolean {
    return this.#llmDisabled;
  }

  /**
   * Run one game-master call behind the breaker, degrading to `offline` text
   * once it has opened.
   *
   * A call is judged by the shared client's own ledger: failures went up and no
   * response completed. The delta is what makes the judgement honest for an
   * operation that makes more than one request — the scenario's 4xx retry can
   * fail and then succeed, and that is a success, not a failure.
   */
  async #guarded<T>(offline: () => T, call: () => Promise<T>): Promise<T> {
    if (this.#llmDisabled) return offline();

    const before = this.client.usage;
    const value = await call();
    const after = this.client.usage;

    if (after.failures === before.failures || after.calls > before.calls) {
      this.#consecutiveFailures = 0;
      return value;
    }

    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= LLM_FAILURE_LIMIT && !this.#llmDisabled) {
      this.#llmDisabled = true;
      this.#onNotice?.(LLM_DISABLED_NOTICE);
    }
    return value;
  }

  /** The session's token ledger, straight from the shared client. */
  get usage(): SessionUsage {
    return this.client.usage;
  }

  /** The scenario opened for this session, or null before `openScenario`. */
  get scenario(): Scenario | null {
    return this.#scenario;
  }

  /**
   * Generate the session's scenario, once. Repeat calls return the same value
   * without spending another token — the fiction is fixed for the session.
   */
  async openScenario(): Promise<Scenario> {
    if (this.#scenario !== null) return this.#scenario;
    this.#scenario = await this.#guarded(
      () => CANNED_SCENARIO,
      () =>
        requestScenario(this.client, {
          ...(this.models.scenario === undefined ? {} : { model: this.models.scenario }),
        }),
    );
    return this.#scenario;
  }

  /**
   * Narrate a turn's events to one player, one batched call, falling back per
   * event. The view names the viewer, and events that viewer may not see are
   * dropped before a prompt exists — passing the raw log is safe.
   */
  async narrate(view: PlayerView, events: readonly GameEvent[]): Promise<NarrationLine[]> {
    return this.#guarded(
      // Offline narration is filtered to the viewer exactly as the online path
      // filters it: the breaker changes the WORDS, never who may read them.
      () => fallbackNarration(events.filter((event) => isVisibleTo(event, view.you))),
      () =>
        narrateEvents(this.client, {
          scenario: this.#scenario ?? CANNED_SCENARIO,
          viewer: view.you,
          events,
          // Public seating, straight off the player's own screen: the model
          // needs it to write "Colonel Mustard" where the engine writes "p2".
          roster: [
            { id: view.you, character: view.character },
            ...view.opponents.map((seat) => ({ id: seat.id, character: seat.character })),
          ],
          ...(this.models.narration === undefined ? {} : { model: this.models.narration }),
        }),
    );
  }

  /** Put one in-fiction question to one suspect, from the asker's view alone. */
  async ask(view: PlayerView, suspect: Suspect, question: string): Promise<SuspectAnswer> {
    return this.#guarded(
      () => fallbackAnswer(suspect),
      () =>
        askSuspect(this.client, {
          scenario: this.#scenario ?? CANNED_SCENARIO,
          view,
          suspect,
          question,
          ...(this.models.qa === undefined ? {} : { model: this.models.qa }),
        }),
    );
  }
}

/**
 * The session's token ledger as printable lines — measured from each response's
 * own `usage` object, never estimated from string length (ADR-0002).
 *
 * Calls a provider reported no usage for are stated rather than hidden: a
 * ledger that silently drops them would understate the session. So are FAILED
 * calls (panel finding, agy): a request that errored still left the machine and
 * may still have been paid for, so a session where everything failed reports
 * its failed attempts rather than claiming no call was made.
 *
 * And so are RETRIES (panel finding, codex): `attempts` counts HTTP exchanges,
 * `calls` counts completions, and a 429 retried into a success leaves those two
 * numbers apart with no failed CALL to show for it. Reporting the call alone
 * told the player the vendor was asked once when it was asked twice, so the
 * attempt count is printed whenever it differs from the call count.
 */
export function formatUsageLedger(usage: SessionUsage): string[] {
  if (usage.calls === 0 && usage.failures === 0) return ['No LLM calls were made this session.'];

  // `failures` counts failed CALLS (a call may span a retry, i.e. two
  // exchanges) — naming them attempts misled on units (epic round 2, codex).
  const failed = `${usage.failures} failed ${usage.failures === 1 ? 'call' : 'calls'}`;
  if (usage.calls === 0) {
    // Nothing completed, so every exchange failed: naming the failed calls alone
    // would still hide a retry inside one of them.
    const exchanges = ` over ${usage.attempts} ${usage.attempts === 1 ? 'exchange' : 'exchanges'}`;
    return [
      `LLM usage: 0 completed calls, ${failed}${exchanges} — no tokens were reported for this session.`,
    ];
  }

  const extra =
    usage.attempts <= usage.calls
      ? ''
      : ` (${usage.attempts} attempts${
          usage.failures === 0
            ? ''
            : `, ${usage.failures} failed ${usage.failures === 1 ? 'call' : 'calls'}`
        })`;
  const lines = [
    `LLM usage: ${usage.calls} ${usage.calls === 1 ? 'call' : 'calls'}${extra}, ` +
      `${usage.total_tokens} tokens (${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion)`,
  ];
  for (const model of Object.keys(usage.byModel).sort()) {
    const totals = usage.byModel[model];
    if (totals === undefined) continue;
    lines.push(
      `  ${model}: ${totals.calls} ${totals.calls === 1 ? 'call' : 'calls'}, ` +
        `${totals.total_tokens} tokens (${totals.prompt_tokens} prompt + ${totals.completion_tokens} completion)`,
    );
  }
  if (usage.callsWithoutUsage > 0) {
    lines.push(
      `  ${usage.callsWithoutUsage} ${usage.callsWithoutUsage === 1 ? 'call' : 'calls'} reported no usage and ${
        usage.callsWithoutUsage === 1 ? 'is' : 'are'
      } not counted above`,
    );
  }
  return lines;
}
