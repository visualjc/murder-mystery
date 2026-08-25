/**
 * Board topology: nine rooms opening onto a corridor grid, plus two secret
 * passages between diagonally opposite corner rooms.
 *
 * Movement is DICE-BASED, as in standard Clue: roll a die, spend up to that
 * many steps walking corridor squares, and entering a room through one of its
 * doors ends the move. This is deliberately NOT a room-adjacency graph.
 * (Orchestrator resolution 5rwbt08h overrides the room-adjacency wording in
 * PRODUCT.md's UNCONFIRMED elaboration and in ADR-0003's consequences.)
 *
 * The classic 24x25 board is simplified — faithfully in structure, loosely in
 * measurement — to a set of axis-aligned corridor SEGMENTS on the same
 * coordinate plane as the room boxes. `buildBoard` expands each segment into
 * unit corridor squares, so a token can stop anywhere along a corridor and
 * step counts are real distances, not hand-tuned constants. Door counts match
 * the classic board (Study 1, Hall 3, Lounge 1, Library 2, Billiard 2,
 * Dining 2, Conservatory 1, Ballroom 4, Kitchen 1 = 17 doors).
 */

import { ROOMS, type Room, type Suspect, SUSPECTS } from './cards.ts';

export type CorridorSquare = { readonly x: number; readonly y: number };

export type Position =
  | { readonly kind: 'room'; readonly room: Room }
  | { readonly kind: 'corridor'; readonly x: number; readonly y: number };

/** A room's inclusive bounding box on the coordinate plane. */
export type RoomBox = {
  readonly room: Room;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

/** A door: the corridor square immediately outside the named room. */
export type Door = { readonly room: Room; readonly x: number; readonly y: number };

/** An axis-aligned run of corridor squares, inclusive of both endpoints. */
export type Segment = readonly [readonly [number, number], readonly [number, number]];

export const ROOM_BOXES: readonly RoomBox[] = [
  { room: 'Study', x0: 0, y0: 0, x1: 6, y1: 3 },
  { room: 'Hall', x0: 9, y0: 0, x1: 14, y1: 6 },
  { room: 'Lounge', x0: 17, y0: 0, x1: 23, y1: 5 },
  { room: 'Library', x0: 0, y0: 6, x1: 5, y1: 10 },
  { room: 'Dining Room', x0: 17, y0: 9, x1: 23, y1: 14 },
  { room: 'Billiard Room', x0: 0, y0: 12, x1: 5, y1: 16 },
  { room: 'Ballroom', x0: 8, y0: 17, x1: 15, y1: 22 },
  { room: 'Kitchen', x0: 18, y0: 17, x1: 23, y1: 22 },
  { room: 'Conservatory', x0: 0, y0: 19, x1: 5, y1: 22 },
];

export const CORRIDOR_SEGMENTS: readonly Segment[] = [
  [[6, 4], [6, 23]], // west spine
  [[6, 4], [8, 4]], // north-west stub, past the Study to the Hall's side door
  [[6, 7], [16, 7]], // upper cross corridor
  [[16, 4], [16, 23]], // east spine
  [[6, 16], [16, 16]], // lower cross corridor
  [[6, 23], [23, 23]], // south spine
  [[6, 19], [7, 19]], // stub to the Ballroom's west door
];

export const DOORS: readonly Door[] = [
  { room: 'Study', x: 6, y: 4 },
  { room: 'Hall', x: 8, y: 4 },
  { room: 'Hall', x: 10, y: 7 },
  { room: 'Hall', x: 13, y: 7 },
  { room: 'Lounge', x: 16, y: 5 },
  { room: 'Library', x: 6, y: 7 },
  { room: 'Library', x: 6, y: 10 },
  { room: 'Dining Room', x: 16, y: 10 },
  { room: 'Dining Room', x: 16, y: 13 },
  { room: 'Billiard Room', x: 6, y: 13 },
  { room: 'Billiard Room', x: 6, y: 16 },
  { room: 'Ballroom', x: 7, y: 19 },
  { room: 'Ballroom', x: 9, y: 16 },
  { room: 'Ballroom', x: 14, y: 16 },
  { room: 'Ballroom', x: 16, y: 19 },
  { room: 'Conservatory', x: 6, y: 20 },
  { room: 'Kitchen', x: 19, y: 23 },
];

/** Secret passages join the diagonally opposite corner rooms, both ways. */
export const SECRET_PASSAGES: Readonly<Partial<Record<Room, Room>>> = {
  Study: 'Kitchen',
  Kitchen: 'Study',
  Conservatory: 'Lounge',
  Lounge: 'Conservatory',
};

/** Where each suspect's token begins the game — all distinct corridor squares. */
export const START_SQUARES: Readonly<Record<Suspect, CorridorSquare>> = {
  'Miss Scarlett': { x: 16, y: 4 },
  'Colonel Mustard': { x: 16, y: 7 },
  'Mrs. White': { x: 12, y: 16 },
  'Reverend Green': { x: 8, y: 16 },
  'Mrs. Peacock': { x: 6, y: 16 },
  'Professor Plum': { x: 6, y: 7 },
};

export type Board = {
  /** Every corridor square, keyed "x,y". */
  readonly squares: ReadonlyMap<string, CorridorSquare>;
  /** Orthogonal corridor-to-corridor adjacency, keyed "x,y". */
  readonly neighbors: ReadonlyMap<string, readonly string[]>;
  /** Corridor squares that are doors of a room, keyed by room. */
  readonly doorsByRoom: ReadonlyMap<Room, readonly string[]>;
  /** Rooms enterable from a corridor square, keyed "x,y". */
  readonly roomsByDoor: ReadonlyMap<string, readonly Room[]>;
};

export function squareKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseSquareKey(key: string): CorridorSquare {
  const [rawX, rawY] = key.split(',');
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(`not a corridor square key: ${key}`);
  }
  return { x, y };
}

/** A stable identity string for any position, room or corridor. */
export function positionKey(position: Position): string {
  return position.kind === 'room' ? `room:${position.room}` : `corridor:${position.x},${position.y}`;
}

export function samePosition(a: Position, b: Position): boolean {
  return positionKey(a) === positionKey(b);
}

export function corridorAt(x: number, y: number): Position {
  return { kind: 'corridor', x, y };
}

export function inRoom(room: Room): Position {
  return { kind: 'room', room };
}

function expandSegment(segment: Segment): CorridorSquare[] {
  const [[x0, y0], [x1, y1]] = segment;
  if (x0 !== x1 && y0 !== y1) {
    throw new Error(`corridor segment is not axis-aligned: ${JSON.stringify(segment)}`);
  }
  const squares: CorridorSquare[] = [];
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const length = Math.abs(x1 - x0) + Math.abs(y1 - y0);
  for (let i = 0; i <= length; i += 1) {
    squares.push({ x: x0 + stepX * i, y: y0 + stepY * i });
  }
  return squares;
}

function boxContains(box: RoomBox, x: number, y: number): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}

function isOrthogonallyAdjacentToBox(box: RoomBox, x: number, y: number): boolean {
  return (
    boxContains(box, x + 1, y) ||
    boxContains(box, x - 1, y) ||
    boxContains(box, x, y + 1) ||
    boxContains(box, x, y - 1)
  );
}

/**
 * Expand the authored topology into a walkable graph, validating it on the way.
 *
 * Throws if a corridor square falls inside a room box, if a door's corridor
 * square is missing from the corridor, or if a door is not actually adjacent to
 * its room — all of which would be authoring mistakes in the data above.
 */
export function buildBoard(): Board {
  const squares = new Map<string, CorridorSquare>();
  for (const segment of CORRIDOR_SEGMENTS) {
    for (const square of expandSegment(segment)) {
      const box = ROOM_BOXES.find((candidate) => boxContains(candidate, square.x, square.y));
      if (box) {
        throw new Error(
          `corridor square ${squareKey(square.x, square.y)} lies inside ${box.room}`,
        );
      }
      squares.set(squareKey(square.x, square.y), square);
    }
  }

  const neighbors = new Map<string, string[]>();
  for (const [key, square] of squares) {
    const adjacent: string[] = [];
    const candidates: CorridorSquare[] = [
      { x: square.x + 1, y: square.y },
      { x: square.x - 1, y: square.y },
      { x: square.x, y: square.y + 1 },
      { x: square.x, y: square.y - 1 },
    ];
    for (const candidate of candidates) {
      const candidateKey = squareKey(candidate.x, candidate.y);
      if (squares.has(candidateKey)) adjacent.push(candidateKey);
    }
    neighbors.set(key, adjacent);
  }

  const doorsByRoom = new Map<Room, string[]>();
  const roomsByDoor = new Map<string, Room[]>();
  for (const door of DOORS) {
    const key = squareKey(door.x, door.y);
    if (!squares.has(key)) {
      throw new Error(`door of ${door.room} at ${key} is not a corridor square`);
    }
    const box = ROOM_BOXES.find((candidate) => candidate.room === door.room);
    if (!box) throw new Error(`door names an unknown room: ${door.room}`);
    if (!isOrthogonallyAdjacentToBox(box, door.x, door.y)) {
      throw new Error(`door of ${door.room} at ${key} is not adjacent to the room`);
    }
    const forRoom = doorsByRoom.get(door.room) ?? [];
    forRoom.push(key);
    doorsByRoom.set(door.room, forRoom);
    const forDoor = roomsByDoor.get(key) ?? [];
    forDoor.push(door.room);
    roomsByDoor.set(key, forDoor);
  }

  for (const room of ROOMS) {
    if (!doorsByRoom.has(room)) throw new Error(`room ${room} has no door`);
  }
  for (const suspect of SUSPECTS) {
    const start = START_SQUARES[suspect];
    if (!squares.has(squareKey(start.x, start.y))) {
      throw new Error(`start square for ${suspect} is not a corridor square`);
    }
  }

  return { squares, neighbors, doorsByRoom, roomsByDoor };
}

/** The room reachable from `room` by secret passage, or null if there is none. */
export function secretPassageFrom(room: Room): Room | null {
  return SECRET_PASSAGES[room] ?? null;
}

export type Destination = { readonly position: Position; readonly steps: number };

/**
 * Every square or room the mover may legally finish on, spending at most
 * `steps` of movement.
 *
 * Rules encoded here:
 * - Leaving a room costs one step, landing on one of its door squares.
 * - Entering a room costs one step from its door square and ENDS the move, so
 *   no path is allowed to pass through a room.
 * - Corridor squares hold one token: an occupied square can be neither entered
 *   nor walked through. Rooms hold any number of tokens.
 * - A mover who starts in a room may not finish in that same room.
 * - Standing still is not a move: every destination costs at least one step.
 */
export function legalDestinations(
  board: Board,
  from: Position,
  steps: number,
  occupied: Iterable<Position> = [],
): Destination[] {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError(`steps must be a non-negative integer, got ${steps}`);
  }

  const blocked = new Set<string>();
  for (const position of occupied) {
    if (position.kind === 'corridor') blocked.add(squareKey(position.x, position.y));
  }
  if (from.kind === 'corridor') blocked.delete(squareKey(from.x, from.y));

  const originRoom = from.kind === 'room' ? from.room : null;
  const distance = new Map<string, number>();
  const roomDistance = new Map<Room, number>();
  const queue: string[] = [];

  if (from.kind === 'corridor') {
    const key = squareKey(from.x, from.y);
    if (!board.squares.has(key)) throw new Error(`not a corridor square: ${key}`);
    distance.set(key, 0);
    queue.push(key);
  } else {
    for (const doorKey of board.doorsByRoom.get(from.room) ?? []) {
      if (blocked.has(doorKey) || distance.has(doorKey) || steps < 1) continue;
      distance.set(doorKey, 1);
      queue.push(doorKey);
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const key = queue[head] as string;
    const cost = distance.get(key) as number;

    for (const room of board.roomsByDoor.get(key) ?? []) {
      if (room === originRoom) continue;
      if (cost + 1 > steps) continue;
      const known = roomDistance.get(room);
      if (known === undefined || cost + 1 < known) roomDistance.set(room, cost + 1);
    }

    if (cost >= steps) continue;
    for (const neighbor of board.neighbors.get(key) ?? []) {
      if (blocked.has(neighbor) || distance.has(neighbor)) continue;
      distance.set(neighbor, cost + 1);
      queue.push(neighbor);
    }
  }

  const destinations: Destination[] = [];
  for (const [key, cost] of distance) {
    if (cost < 1 || cost > steps) continue;
    const square = board.squares.get(key) as CorridorSquare;
    destinations.push({ position: corridorAt(square.x, square.y), steps: cost });
  }
  for (const [room, cost] of roomDistance) {
    destinations.push({ position: inRoom(room), steps: cost });
  }
  destinations.sort((a, b) => positionKey(a.position).localeCompare(positionKey(b.position)));
  return destinations;
}
