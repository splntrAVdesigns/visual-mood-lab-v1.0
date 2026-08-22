/**
 * grid-snake — a self-playing snake that pathfinds to food across a grid
 * and leaves a fading tail.
 *
 * Ported from a supplied "Grid Snake Follow" component that was already
 * canvas2D and already deterministic (a seeded RNG, BFS pathfinding, no
 * external state) — the most direct port of anything in this batch. The
 * outer React props/lifecycle layer is what's replaced; the simulation
 * itself — BFS toward food, flood-fill fallback into the most open space
 * when no path exists, a blink-and-restart on a genuine dead end — carries
 * over almost unchanged.
 *
 * Interactive food placement: clicking (or tapping) anywhere on the board
 * queues that cell as where the NEXT food appears, once the current one
 * is eaten — it doesn't relocate the food the snake is already pathing
 * toward mid-approach, which would read as the target randomly jumping
 * away. The queued cell is re-validated at the moment it's actually
 * used, not just at click time, since the snake may have grown into it
 * by then; an invalid queued cell silently falls back to the normal
 * random placement rather than erroring or leaving food nowhere.
 */

export const params = {
  cellSize: { kind: 'slider', label: 'Cell size', min: 16, max: 80, step: 1, default: 34, unit: 'px' },
  gap: { kind: 'slider', label: 'Gap', min: 0, max: 6, step: 0.5, default: 1, unit: 'px' },
  rounded: { kind: 'slider', label: 'Corner rounding', min: 0, max: 20, step: 1, default: 0 },
  speed: { kind: 'slider', label: 'Speed', min: 1, max: 30, step: 0.5, default: 10, modulatable: true, hint: 'Cells moved per second.' },
  startLength: { kind: 'stepper', label: 'Start length', min: 1, max: 12, step: 1, default: 1 },
  growth: { kind: 'stepper', label: 'Growth per food', min: 1, max: 8, step: 1, default: 1 },
  fade: { kind: 'slider', label: 'Tail fade', min: 0, max: 100, step: 1, default: 32, unit: '%' },
  snakeColor: { kind: 'color', label: 'Snake', default: { r: 1, g: 1, b: 1, a: 1 } },
  foodColor: { kind: 'color', label: 'Food', default: { r: 0.98, g: 0.45, b: 0.1, a: 1 }, hint: 'Click anywhere on the tile to choose where the next food appears, once the current one is eaten.' },
  boardColor: { kind: 'color', label: 'Board', default: { r: 1, g: 1, b: 1, a: 0.06 } },
};

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DEATH_FLASH_MS = 540;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function sketch(p, get) {
  const rand = mulberry32(0xc0ffee);
  let cols = 0, rows = 0, cellW = 0, cellH = 0, pitchX = 0, pitchY = 0;
  let snake = [];
  let food = -1;
  // Player-clicked cell, waiting to become the next food once the
  // current one is eaten — see advance()'s consumption logic and
  // placeFoodAt() below. -1 means nothing queued (normal random
  // placement applies).
  let queuedFood = -1;
  let dying = 0;
  let acc = 0;
  let builtFor = '';

  const idx = (c, r) => r * cols + c;
  const colOf = (i) => i % cols;
  const rowOf = (i) => Math.floor(i / cols);

  function neighbours(cell) {
    const c = colOf(cell), r = rowOf(cell), out = [];
    for (const [dx, dy] of STEPS) {
      const nc = c + dx, nr = r + dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      out.push(idx(nc, nr));
    }
    return out;
  }

  function placeFood() {
    const body = new Set(snake);
    const free = [];
    for (let i = 0; i < cols * rows; i++) if (!body.has(i)) free.push(i);
    food = free.length ? free[Math.floor(rand() * free.length)] : -1;
  }

  /** Converts a click/tap position to a grid cell and queues it as the
      next food, if it's a valid, currently-unoccupied cell. Silently
      does nothing for a click outside the board or on the snake's own
      body — no error, no feedback beyond simply not queuing anything,
      matching how a miss should feel (ignored, not rejected). */
  function placeFoodAt(x, y) {
    if (cols <= 0 || rows <= 0) return;
    const col = Math.floor(x / pitchX);
    const row = Math.floor(y / pitchY);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    const cell = idx(col, row);
    const body = new Set(snake);
    if (body.has(cell)) return;
    queuedFood = cell;
  }

  function reset() {
    const midCol = Math.floor(cols / 2), midRow = Math.floor(rows / 2);
    const length = Math.min(Math.max(1, Math.round(get('startLength'))), Math.max(1, cols - 2));
    snake = [];
    for (let i = 0; i < length; i++) snake.push(idx(Math.max(0, midCol - i), midRow));
    placeFood();
  }

  function blocked(ahead) {
    const keep = Math.max(0, snake.length - ahead);
    return new Set(snake.slice(0, keep));
  }

  function stepTowardFood() {
    if (food < 0) return -1;
    const head = snake[0];
    const walls = blocked(1);
    const prev = new Map();
    const seen = new Set([head]);
    let frontier = [head];
    while (frontier.length) {
      const next = [];
      for (const cell of frontier) {
        for (const n of neighbours(cell)) {
          if (seen.has(n) || walls.has(n)) continue;
          seen.add(n);
          prev.set(n, cell);
          if (n === food) {
            let at = n;
            while (prev.get(at) !== head) at = prev.get(at);
            return at;
          }
          next.push(n);
        }
      }
      frontier = next;
    }
    return -1;
  }

  function room(from) {
    const walls = blocked(1);
    const seen = new Set([from]);
    let frontier = [from], count = 0;
    while (frontier.length && count < cols * rows) {
      const next = [];
      for (const cell of frontier) {
        count++;
        for (const n of neighbours(cell)) {
          if (seen.has(n) || walls.has(n)) continue;
          seen.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
    return count;
  }

  function advance() {
    if (!snake.length) return;
    let target = stepTowardFood();
    if (target < 0) {
      const walls = blocked(1);
      let best = -1, bestRoom = -1;
      for (const n of neighbours(snake[0])) {
        if (walls.has(n)) continue;
        const space = room(n);
        if (space > bestRoom) { bestRoom = space; best = n; }
      }
      target = best;
    }
    if (target < 0) { dying = DEATH_FLASH_MS; return; }

    snake.unshift(target);
    if (target === food) {
      // Sound accent on the exact moment of eating — layered on top of
      // whatever the continuous chase-arp is already doing (see
      // grid-snake preset comments in presets.ts). ArpEngine's pluck()
      // works independently of scheduled mode; it doesn't need — and
      // doesn't check — triggerMode, so this fires as a genuine payoff
      // accent regardless of whether the preset is scheduled or event.
      // Normalized by the food's actual grid column, same left-low/
      // right-high spatial convention every other pluck-driven tile uses.
      if (typeof p.pluck === 'function') p.pluck(colOf(target) / Math.max(1, cols - 1));
      const tail = snake[snake.length - 1];
      for (let i = 1; i < Math.max(1, Math.round(get('growth'))); i++) snake.push(tail);
      // A player-queued cell takes priority over the normal random
      // placement — but only if it's still valid NOW, not just at click
      // time; the snake may have grown into it in the meantime (growth
      // just pushed a new tail segment on the very line above, for one).
      // An invalid queued cell is dropped silently and falls through to
      // the same random placement it would have used if nothing had
      // been queued at all.
      if (queuedFood >= 0) {
        const body = new Set(snake);
        if (!body.has(queuedFood)) {
          food = queuedFood;
          queuedFood = -1;
        } else {
          queuedFood = -1;
          placeFood();
        }
      } else {
        placeFood();
      }
    } else {
      snake.pop();
    }
  }

  function build() {
    const pitch = get('cellSize') + get('gap');
    cols = Math.max(4, Math.floor((p.width + get('gap')) / pitch));
    rows = Math.max(4, Math.floor((p.height + get('gap')) / pitch));
    cellW = Math.max(1, (p.width - get('gap') * (cols - 1)) / cols);
    cellH = Math.max(1, (p.height - get('gap') * (rows - 1)) / rows);
    pitchX = cellW + get('gap');
    pitchY = cellH + get('gap');
    reset();
  }

  function tile(col, row) {
    const x = col * pitchX, y = row * pitchY;
    const rr = (Math.min(cellW, cellH) / 2) * (Math.min(20, Math.max(0, get('rounded'))) / 20);
    if (rr > 0) p.rect(x, y, cellW, cellH, rr);
    else p.rect(x, y, cellW, cellH);
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noStroke();
    p.cursor(p.HAND);
    build();
    builtFor = `${get('cellSize')}:${get('gap')}`;
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); build(); builtFor = `${get('cellSize')}:${get('gap')}`; };

  // p.mousePressed covers mouse input; p5 doesn't reliably also fire it
  // for touch once a sketch defines its own touchStarted, so both are
  // defined explicitly rather than assuming one covers both input types.
  // Returning false from touchStarted is the standard p5 way to suppress
  // the browser's own default touch behavior (scrolling, zoom) on the
  // canvas.
  p.mousePressed = () => placeFoodAt(p.mouseX, p.mouseY);
  p.touchStarted = () => {
    if (p.touches.length) placeFoodAt(p.touches[0].x, p.touches[0].y);
    return false;
  };

  p.draw = () => {
    const key = `${get('cellSize')}:${get('gap')}`;
    if (key !== builtFor) { build(); builtFor = key; }

    const dt = Math.min(p.deltaTime, 200);
    const board = get('boardColor');
    const snakeCol = get('snakeColor');
    const foodCol = get('foodColor');
    const tailFade = get('fade') / 100;

    if (dying > 0) {
      dying -= dt;
      if (dying <= 0) { dying = 0; acc = 0; reset(); }
    } else {
      const stepEvery = 1000 / Math.max(1, get('speed'));
      acc += dt;
      while (acc >= stepEvery && dying <= 0) { acc -= stepEvery; advance(); }
    }

    p.background(0);
    p.fill(board.r, board.g, board.b, board.a);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tile(c, r);

    if (dying > 0) {
      const lit = Math.floor(dying / 180) % 2 === 0;
      if (!lit) return;
    } else if (food >= 0) {
      p.fill(foodCol.r, foodCol.g, foodCol.b, foodCol.a);
      tile(colOf(food), rowOf(food));
    }

    // Dim preview of a player-queued cell, distinct from the active
    // food so it never reads as "there are two food items right now" —
    // it's clearly a fainter marker, not a second target the snake is
    // pathing toward.
    if (queuedFood >= 0 && queuedFood !== food) {
      p.fill(foodCol.r, foodCol.g, foodCol.b, foodCol.a * 0.35);
      tile(colOf(queuedFood), rowOf(queuedFood));
    }

    for (let i = 0; i < snake.length; i++) {
      const cell = snake[i];
      const along = snake.length > 1 ? i / (snake.length - 1) : 0;
      p.fill(snakeCol.r, snakeCol.g, snakeCol.b, snakeCol.a * (1 - along * tailFade));
      tile(colOf(cell), rowOf(cell));
    }
  };
}
