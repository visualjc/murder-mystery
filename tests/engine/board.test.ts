import { describe, expect, test } from 'bun:test';
import {
  CORRIDOR_SEGMENTS,
  DOORS,
  ROOM_BOXES,
  SECRET_PASSAGES,
  START_SQUARES,
  buildBoard,
  corridorAt,
  inRoom,
  legalDestinations,
  parseSquareKey,
  positionKey,
  samePosition,
  secretPassageFrom,
  squareKey,
  type Destination,
  type Position,
} from '../../src/engine/board.ts';
import { ROOMS, SUSPECTS } from '../../src/engine/cards.ts';

const board = buildBoard();

const roomsIn = (destinations: readonly Destination[]) =>
  destinations
    .filter((destination) => destination.position.kind === 'room')
    .map((destination) => `${(destination.position as { room: string }).room}@${destination.steps}`)
    .sort();

const has = (destinations: readonly Destination[], position: Position) =>
  destinations.some((destination) => samePosition(destination.position, position));

describe('topology data', () => {
  test('every room has a bounding box and the boxes do not overlap', () => {
    expect(ROOM_BOXES.length).toBe(ROOMS.length);
    for (const a of ROOM_BOXES) {
      for (const b of ROOM_BOXES) {
        if (a.room === b.room) continue;
        const disjoint = a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0;
        expect(`${a.room}/${b.room}:${disjoint}`).toBe(`${a.room}/${b.room}:true`);
      }
    }
  });

  test('door counts match the classic board (17 doors in total)', () => {
    const counts = new Map<string, number>();
    for (const door of DOORS) counts.set(door.room, (counts.get(door.room) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      Study: 1,
      Hall: 3,
      Lounge: 1,
      Library: 2,
      'Dining Room': 2,
      'Billiard Room': 2,
      Ballroom: 4,
      Conservatory: 1,
      Kitchen: 1,
    });
    expect(DOORS.length).toBe(17);
  });

  test('every corridor segment is axis-aligned', () => {
    for (const [[x0, y0], [x1, y1]] of CORRIDOR_SEGMENTS) {
      expect(x0 === x1 || y0 === y1).toBe(true);
    }
  });

  test('secret passages join the diagonal corner rooms and are symmetric', () => {
    expect(SECRET_PASSAGES).toEqual({
      Study: 'Kitchen',
      Kitchen: 'Study',
      Conservatory: 'Lounge',
      Lounge: 'Conservatory',
    });
    for (const [from, to] of Object.entries(SECRET_PASSAGES)) {
      expect(secretPassageFrom(to as never)).toBe(from as never);
    }
  });

  test('rooms without a passage report null', () => {
    for (const room of ['Hall', 'Library', 'Ballroom', 'Billiard Room', 'Dining Room'] as const) {
      expect(secretPassageFrom(room)).toBeNull();
    }
  });

  test('all six suspects start on distinct corridor squares', () => {
    const keys = SUSPECTS.map((suspect) => {
      const square = START_SQUARES[suspect];
      return squareKey(square.x, square.y);
    });
    expect(new Set(keys).size).toBe(6);
    for (const key of keys) expect(board.squares.has(key)).toBe(true);
  });
});

describe('buildBoard', () => {
  test('produces a fully connected corridor', () => {
    const first = board.squares.keys().next().value as string;
    const seen = new Set([first]);
    const queue = [first];
    for (let head = 0; head < queue.length; head += 1) {
      for (const neighbor of board.neighbors.get(queue[head] as string) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    expect(seen.size).toBe(board.squares.size);
    expect(board.squares.size).toBeGreaterThan(50);
  });

  test('no corridor square falls inside a room box', () => {
    for (const square of board.squares.values()) {
      for (const box of ROOM_BOXES) {
        const inside =
          square.x >= box.x0 && square.x <= box.x1 && square.y >= box.y0 && square.y <= box.y1;
        expect(`${squareKey(square.x, square.y)}/${box.room}:${inside}`).toBe(
          `${squareKey(square.x, square.y)}/${box.room}:false`,
        );
      }
    }
  });

  test('every room is reachable through at least one door square', () => {
    for (const room of ROOMS) {
      const doors = board.doorsByRoom.get(room) ?? [];
      expect(doors.length).toBeGreaterThan(0);
      for (const door of doors) expect(board.squares.has(door)).toBe(true);
    }
  });

  test('adjacency is symmetric and orthogonal only', () => {
    for (const [key, neighbors] of board.neighbors) {
      const self = parseSquareKey(key);
      for (const neighbor of neighbors) {
        const other = parseSquareKey(neighbor);
        expect(Math.abs(self.x - other.x) + Math.abs(self.y - other.y)).toBe(1);
        expect(board.neighbors.get(neighbor)).toContain(key);
      }
    }
  });

  test('is a pure build: two boards are structurally identical', () => {
    const other = buildBoard();
    expect([...other.squares.keys()].sort()).toEqual([...board.squares.keys()].sort());
  });
});

describe('square and position keys', () => {
  test('squareKey and parseSquareKey round-trip', () => {
    expect(parseSquareKey(squareKey(6, 17))).toEqual({ x: 6, y: 17 });
  });

  test('parseSquareKey rejects nonsense', () => {
    expect(() => parseSquareKey('nowhere')).toThrow(TypeError);
  });

  test('positionKey distinguishes rooms from corridor squares', () => {
    expect(positionKey(inRoom('Study'))).toBe('room:Study');
    expect(positionKey(corridorAt(6, 4))).toBe('corridor:6,4');
    expect(positionKey(inRoom('Study'))).not.toBe(positionKey(corridorAt(0, 0)));
  });

  test('samePosition compares by value', () => {
    expect(samePosition(inRoom('Hall'), { kind: 'room', room: 'Hall' })).toBe(true);
    expect(samePosition(corridorAt(6, 4), corridorAt(6, 5))).toBe(false);
    expect(samePosition(inRoom('Hall'), corridorAt(6, 4))).toBe(false);
  });
});

describe('legalDestinations — dice movement', () => {
  test('a roll of 1 out of the Study reaches only its single door square', () => {
    const destinations = legalDestinations(board, inRoom('Study'), 1);
    expect(destinations).toEqual([{ position: corridorAt(6, 4), steps: 1 }]);
  });

  test('a roll of 0 goes nowhere — standing still is not a move', () => {
    expect(legalDestinations(board, inRoom('Study'), 0)).toEqual([]);
    expect(legalDestinations(board, corridorAt(6, 7), 0)).toEqual([]);
  });

  test('the mover never stays on the square it started from', () => {
    const destinations = legalDestinations(board, corridorAt(6, 7), 4);
    expect(has(destinations, corridorAt(6, 7))).toBe(false);
    expect(destinations.every((destination) => destination.steps >= 1)).toBe(true);
  });

  test('a bigger roll never reaches less than a smaller one', () => {
    const smaller = legalDestinations(board, corridorAt(6, 16), 3);
    const bigger = legalDestinations(board, corridorAt(6, 16), 6);
    for (const destination of smaller) {
      expect(`${positionKey(destination.position)}:${has(bigger, destination.position)}`).toBe(
        `${positionKey(destination.position)}:true`,
      );
    }
    expect(bigger.length).toBeGreaterThan(smaller.length);
  });

  test('entering a room costs a step and ends the move — no walking through rooms', () => {
    // The Ballroom's north-west door (9,16) and west door (7,19) are one step
    // apart through the room, but eight steps apart around the corridor.
    const short = legalDestinations(board, corridorAt(9, 16), 4);
    expect(roomsIn(short)).toContain('Ballroom@1');
    expect(has(short, corridorAt(7, 19))).toBe(false);

    const long = legalDestinations(board, corridorAt(9, 16), 8);
    expect(has(long, corridorAt(7, 19))).toBe(true);
  });

  test('a mover leaving a room may not finish in the room they left', () => {
    const destinations = legalDestinations(board, inRoom('Ballroom'), 6);
    expect(roomsIn(destinations).some((entry) => entry.startsWith('Ballroom@'))).toBe(false);
    // but every one of its four doors is one step away
    for (const square of [corridorAt(9, 16), corridorAt(14, 16), corridorAt(16, 19), corridorAt(7, 19)]) {
      expect(has(destinations, square)).toBe(true);
    }
  });

  test('a room is reported at its shortest step cost', () => {
    const destinations = legalDestinations(board, corridorAt(6, 7), 5);
    expect(roomsIn(destinations)).toEqual(['Hall@5', 'Library@1', 'Study@4']);
  });

  test('a token on a corridor square blocks both landing there and passing through', () => {
    const open = legalDestinations(board, inRoom('Study'), 6);
    expect(roomsIn(open)).toContain('Library@5');

    const chokepoint = corridorAt(6, 6);
    const blocked = legalDestinations(board, inRoom('Study'), 6, [chokepoint]);
    expect(has(blocked, chokepoint)).toBe(false);
    expect(roomsIn(blocked)).not.toContain('Library@5');
    // the north-west stub is still open
    expect(has(blocked, corridorAt(8, 4))).toBe(true);
  });

  test('a room whose every door is blocked cannot be left', () => {
    expect(legalDestinations(board, inRoom('Study'), 6, [corridorAt(6, 4)])).toEqual([]);
  });

  test('rooms hold any number of tokens — only corridor squares block', () => {
    const destinations = legalDestinations(board, corridorAt(6, 7), 2, [inRoom('Library')]);
    expect(roomsIn(destinations)).toContain('Library@1');
  });

  test("the mover's own square never blocks them", () => {
    const here = corridorAt(6, 16);
    const destinations = legalDestinations(board, here, 3, [here]);
    expect(destinations.length).toBeGreaterThan(0);
  });

  test('rejects a negative or fractional roll', () => {
    expect(() => legalDestinations(board, inRoom('Study'), -1)).toThrow(RangeError);
    expect(() => legalDestinations(board, inRoom('Study'), 2.5)).toThrow(RangeError);
  });

  test('rejects a corridor origin that is not on the board', () => {
    expect(() => legalDestinations(board, corridorAt(99, 99), 3)).toThrow();
  });

  test('from every room, some destination exists on a roll of 6', () => {
    for (const room of ROOMS) {
      expect(`${room}:${legalDestinations(board, inRoom(room), 6).length > 0}`).toBe(`${room}:true`);
    }
  });
});
