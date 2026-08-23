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
import { CANNED_SCENARIO, requestScenario, type Scenario } from './scenario.ts';
import { narrateEvents, type NarrationLine } from './narrator.ts';
import { askSuspect, type SuspectAnswer } from './qa.ts';

export {
  CANNED_SCENARIO,
  parseScenario,
  requestScenario,
  scenarioMessages,
  type Scenario,
  type ScenarioOptions,
} from './scenario.ts';
export {
  fallbackNarration,
  narrateEvents,
  narrationMessages,
  parseNarration,
  type NarrationLine,
  type NarrationRequest,
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

export type GameMasterOptions = {
  /** Per-role model overrides. Each defaults to the client's configured model. */
  readonly models?: {
    readonly scenario?: string;
    readonly narration?: string;
    readonly qa?: string;
  };
};

export class GameMaster {
  readonly client: ChatClient;
  readonly models: NonNullable<GameMasterOptions['models']>;

  #scenario: Scenario | null = null;

  constructor(client: ChatClient, options: GameMasterOptions = {}) {
    this.client = client;
    this.models = options.models ?? {};
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
    this.#scenario = await requestScenario(this.client, {
      ...(this.models.scenario === undefined ? {} : { model: this.models.scenario }),
    });
    return this.#scenario;
  }

  /**
   * Narrate a turn's events to one player, one batched call, falling back per
   * event. The view names the viewer, and events that viewer may not see are
   * dropped before a prompt exists — passing the raw log is safe.
   */
  async narrate(view: PlayerView, events: readonly GameEvent[]): Promise<NarrationLine[]> {
    return narrateEvents(this.client, {
      scenario: this.#scenario ?? CANNED_SCENARIO,
      viewer: view.you,
      events,
      ...(this.models.narration === undefined ? {} : { model: this.models.narration }),
    });
  }

  /** Put one in-fiction question to one suspect, from the asker's view alone. */
  async ask(view: PlayerView, suspect: Suspect, question: string): Promise<SuspectAnswer> {
    return askSuspect(this.client, {
      scenario: this.#scenario ?? CANNED_SCENARIO,
      view,
      suspect,
      question,
      ...(this.models.qa === undefined ? {} : { model: this.models.qa }),
    });
  }
}

/**
 * The session's token ledger as printable lines — measured from each response's
 * own `usage` object, never estimated from string length (ADR-0002).
 *
 * Calls a provider reported no usage for are stated rather than hidden: a
 * ledger that silently drops them would understate the session.
 */
export function formatUsageLedger(usage: SessionUsage): string[] {
  if (usage.calls === 0) return ['No LLM calls were made this session.'];

  const lines = [
    `LLM usage: ${usage.calls} ${usage.calls === 1 ? 'call' : 'calls'}, ` +
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
