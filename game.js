const SIZE = 4;
const CANVAS_SIZE = 420;
const GAP = 10;
const GOLDEN_SIGIL_VALUE = -1;
const BOMB_VALUE = -2;

/** Internal values follow classic merge math; each tier shows one elemental emoji. */
const RUNE_BY_VALUE = {
  2: "✨",
  4: "💧",
  8: "🪨",
  16: "💨",
  32: "🔥",
  64: "♨️",
  128: "🌋",
  256: "⛈️",
  512: "🌟",
  1024: "🌑",
  2048: "🔮"
};

const EMOJI_FONT_STACK =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI", sans-serif';

const WIN_VALUE = 2048;

function runeLabel(value) {
  if (value === GOLDEN_SIGIL_VALUE) return "🟡";
  if (value === BOMB_VALUE) return "💣";
  return RUNE_BY_VALUE[value] || String(value);
}

function populateRuneLegend() {
  const tbody = document.getElementById("runeLegendBody");
  if (!tbody) return;
  const tiers = Object.keys(RUNE_BY_VALUE)
    .map(Number)
    .sort((a, b) => a - b);
  tbody.replaceChildren();
  const wildcardRow = document.createElement("tr");
  const wildcardStep = document.createElement("td");
  wildcardStep.className = "col-step";
  wildcardStep.textContent = "★";
  const wildcardSigil = document.createElement("td");
  wildcardSigil.className = "col-sigil";
  wildcardSigil.textContent = runeLabel(GOLDEN_SIGIL_VALUE);
  wildcardRow.append(wildcardStep, wildcardSigil);
  tbody.appendChild(wildcardRow);
  const bombRow = document.createElement("tr");
  const bombStep = document.createElement("td");
  bombStep.className = "col-step";
  bombStep.textContent = "💣";
  const bombSigil = document.createElement("td");
  bombSigil.className = "col-sigil";
  bombSigil.textContent = runeLabel(BOMB_VALUE);
  bombRow.append(bombStep, bombSigil);
  tbody.appendChild(bombRow);
  tiers.forEach((value, index) => {
    const tr = document.createElement("tr");
    const tdStep = document.createElement("td");
    tdStep.className = "col-step";
    tdStep.textContent = String(index + 1);
    const tdSigil = document.createElement("td");
    tdSigil.className = "col-sigil";
    tdSigil.textContent = RUNE_BY_VALUE[value];
    tr.append(tdStep, tdSigil);
    tbody.appendChild(tr);
  });
}

const canvas = document.getElementById("glcanvas");
const scoreEl = document.getElementById("score");
const restartBtn = document.getElementById("restart");
const overlayRestartBtn = document.getElementById("overlayRestart");
const continueBtn = document.getElementById("continueBtn");
const newGameBtn = document.getElementById("newGameBtn");
const winLayer = document.getElementById("winLayer");
const gameOverLayer = document.getElementById("gameOverLayer");
const finalScoreEl = document.getElementById("finalScore");
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const gl = canvas.getContext("webgl");
if (!gl) {
  throw new Error("WebGL is not supported by this browser.");
}

const colorVertexShaderSource = `
attribute vec2 a_position;
uniform vec2 u_resolution;
void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
}`;

const colorFragmentShaderSource = `
precision mediump float;
uniform vec4 u_color;
void main() {
  gl_FragColor = u_color;
}`;

const textVertexShaderSource = `
attribute vec2 a_position;
attribute vec2 a_texcoord;
uniform vec2 u_resolution;
varying vec2 v_texcoord;
void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
  v_texcoord = a_texcoord;
}`;

const textFragmentShaderSource = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_texcoord;
void main() {
  gl_FragColor = texture2D(u_texture, v_texcoord);
}`;

function createShader(ctx, type, source) {
  const shader = ctx.createShader(type);
  ctx.shaderSource(shader, source);
  ctx.compileShader(shader);
  if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
    throw new Error(ctx.getShaderInfoLog(shader) || "Shader compile failed");
  }
  return shader;
}

function createProgram(ctx, vsSource, fsSource) {
  const nextProgram = ctx.createProgram();
  const vs = createShader(ctx, ctx.VERTEX_SHADER, vsSource);
  const fs = createShader(ctx, ctx.FRAGMENT_SHADER, fsSource);
  ctx.attachShader(nextProgram, vs);
  ctx.attachShader(nextProgram, fs);
  ctx.linkProgram(nextProgram);
  if (!ctx.getProgramParameter(nextProgram, ctx.LINK_STATUS)) {
    throw new Error(ctx.getProgramInfoLog(nextProgram) || "Program link failed");
  }
  return nextProgram;
}

const colorProgram = createProgram(gl, colorVertexShaderSource, colorFragmentShaderSource);
const textProgram = createProgram(gl, textVertexShaderSource, textFragmentShaderSource);

const colorPositionLocation = gl.getAttribLocation(colorProgram, "a_position");
const colorResolutionLocation = gl.getUniformLocation(colorProgram, "u_resolution");
const colorLocation = gl.getUniformLocation(colorProgram, "u_color");

const textPositionLocation = gl.getAttribLocation(textProgram, "a_position");
const textTexcoordLocation = gl.getAttribLocation(textProgram, "a_texcoord");
const textResolutionLocation = gl.getUniformLocation(textProgram, "u_resolution");
const textSamplerLocation = gl.getUniformLocation(textProgram, "u_texture");

const positionBuffer = gl.createBuffer();
const texcoordBuffer = gl.createBuffer();

const textTextureCanvas = document.createElement("canvas");
const textTextureCtx = textTextureCanvas.getContext("2d");
if (!textTextureCtx) {
  throw new Error("2D canvas context is not available.");
}
const textTextureCache = new Map();

gl.viewport(0, 0, canvas.width, canvas.height);

let grid = createEmptyGrid();
let score = 0;
let gameOver = false;
let winShown = false;
let winOverlayVisible = false;

function createEmptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function updateScore() {
  scoreEl.textContent = `Счёт: ${score}`;
}

function randomEmptyCell() {
  const empty = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) empty.push([r, c]);
    }
  }
  if (empty.length === 0) return null;
  return empty[Math.floor(Math.random() * empty.length)];
}

function addRandomTile() {
  const cell = randomEmptyCell();
  if (!cell) return false;
  const [r, c] = cell;
  const roll = Math.random();
  if (roll < 0.01) {
    grid[r][c] = BOMB_VALUE;
  } else if (roll < 0.06) {
    grid[r][c] = GOLDEN_SIGIL_VALUE;
  } else {
    grid[r][c] = roll < 0.9 ? 2 : 4;
  }
  return true;
}

function setGameOverState(isOver) {
  gameOver = isOver;
  gameOverLayer.classList.toggle("hidden", !isOver);
  finalScoreEl.textContent = `Финальный счёт: ${score}`;
}

function setWinState(isVisible) {
  winOverlayVisible = isVisible;
  winLayer.classList.toggle("hidden", !isVisible);
}

function hasWinningTile() {
  return grid.some((row) => row.some((value) => value >= WIN_VALUE));
}

function compressAndMerge(line) {
  const values = line.filter((x) => x !== 0);
  const out = [];
  let gained = 0;
  for (let i = 0; i < values.length; i++) {
    if (canMergeTiles(values[i], values[i + 1])) {
      const merged = mergeTiles(values[i], values[i + 1]);
      if (merged !== 0) {
        out.push(merged);
        gained += merged;
      }
      i++;
    } else {
      out.push(values[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { out, gained };
}

function canMergeTiles(a, b) {
  if (a == null || b == null) return false;
  if (a === 0 || b === 0) return false;
  if (a === GOLDEN_SIGIL_VALUE || b === GOLDEN_SIGIL_VALUE) return true;
  if (a === BOMB_VALUE || b === BOMB_VALUE) return true;
  return a === b;
}

function mergeTiles(a, b) {
  if (a === BOMB_VALUE || b === BOMB_VALUE) {
    return 0;
  }
  if (a === GOLDEN_SIGIL_VALUE && b === GOLDEN_SIGIL_VALUE) {
    return 4;
  }
  if (a === GOLDEN_SIGIL_VALUE) return b * 2;
  if (b === GOLDEN_SIGIL_VALUE) return a * 2;
  return a * 2;
}

function moveLeft() {
  let moved = false;
  for (let r = 0; r < SIZE; r++) {
    const oldRow = grid[r].slice();
    const { out, gained } = compressAndMerge(oldRow);
    grid[r] = out;
    score += gained;
    if (!moved && oldRow.some((v, i) => v !== out[i])) moved = true;
  }
  return moved;
}

function rotateClockwise(mat) {
  const res = createEmptyGrid();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      res[c][SIZE - 1 - r] = mat[r][c];
    }
  }
  return res;
}

function rotateCounterClockwise(mat) {
  return rotateClockwise(rotateClockwise(rotateClockwise(mat)));
}

function rotate180(mat) {
  return rotateClockwise(rotateClockwise(mat));
}

function move(direction) {
  if (gameOver || winOverlayVisible) return;

  const before = grid.map((row) => row.slice());
  if (direction === "left") {
    moveLeft();
  } else if (direction === "right") {
    grid = rotate180(grid);
    moveLeft();
    grid = rotate180(grid);
  } else if (direction === "up") {
    grid = rotateCounterClockwise(grid);
    moveLeft();
    grid = rotateClockwise(grid);
  } else if (direction === "down") {
    grid = rotateClockwise(grid);
    moveLeft();
    grid = rotateCounterClockwise(grid);
  }

  const changed = grid.some((row, r) => row.some((v, c) => v !== before[r][c]));
  if (!changed) return;

  addRandomTile();
  updateScore();
  draw();

  if (!winShown && hasWinningTile()) {
    winShown = true;
    setWinState(true);
    return;
  }

  if (isGameOver()) {
    setGameOverState(true);
  }
}

function isGameOver() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c];
      if (v === 0) return false;
      if (c + 1 < SIZE && canMergeTiles(v, grid[r][c + 1])) return false;
      if (r + 1 < SIZE && canMergeTiles(v, grid[r + 1][c])) return false;
    }
  }
  return true;
}

function fontSizeForTileGlyph(value, cellSize) {
  if (RUNE_BY_VALUE[value] || value === GOLDEN_SIGIL_VALUE || value === BOMB_VALUE) {
    return Math.floor(cellSize * 0.52);
  }
  const s = String(value);
  if (s.length <= 2) return Math.floor(cellSize * 0.40);
  if (s.length <= 3) return Math.floor(cellSize * 0.32);
  return Math.floor(cellSize * 0.26);
}

function setRectVertices(x, y, w, h) {
  const x1 = x;
  const x2 = x + w;
  const y1 = y;
  const y2 = y + h;
  const vertices = new Float32Array([
    x1, y1,
    x2, y1,
    x1, y2,
    x1, y2,
    x2, y1,
    x2, y2
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function getTextTexture(value, cellSize) {
  const label = runeLabel(value);
  const key = `${label}-${Math.round(cellSize)}`;
  const cached = textTextureCache.get(key);
  if (cached) return cached;

  const rounded = Math.max(1, Math.round(cellSize));
  textTextureCanvas.width = rounded;
  textTextureCanvas.height = rounded;
  textTextureCtx.clearRect(0, 0, rounded, rounded);
  textTextureCtx.textAlign = "center";
  textTextureCtx.textBaseline = "middle";
  const fontPx = fontSizeForTileGlyph(value, rounded);
  textTextureCtx.font = `${fontPx}px ${EMOJI_FONT_STACK}`;
  textTextureCtx.fillStyle = "rgba(255,255,255,0.96)";
  textTextureCtx.fillText(label, rounded / 2, rounded / 2 + 1);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textTextureCanvas);

  textTextureCache.set(key, texture);
  return texture;
}

function drawRect(x, y, w, h, color) {
  gl.useProgram(colorProgram);
  gl.uniform2f(colorResolutionLocation, canvas.width, canvas.height);
  setRectVertices(x, y, w, h);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(colorPositionLocation);
  gl.vertexAttribPointer(colorPositionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.uniform4fv(colorLocation, color);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawText(value, x, y, cellSize) {
  if (value === 0) return;
  const texture = getTextTexture(value, cellSize);

  gl.useProgram(textProgram);
  gl.uniform2f(textResolutionLocation, canvas.width, canvas.height);
  setRectVertices(x, y, cellSize, cellSize);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(textPositionLocation);
  gl.vertexAttribPointer(textPositionLocation, 2, gl.FLOAT, false, 0, 0);

  const texcoords = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    0, 1,
    1, 0,
    1, 1
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(textTexcoordLocation);
  gl.vertexAttribPointer(textTexcoordLocation, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(textSamplerLocation, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function getColor(value) {
  const colors = {
    0: [0.16, 0.18, 0.28, 1.0],
    [-1]: [0.76, 0.62, 0.14, 1.0],
    [-2]: [0.3, 0.0, 0.0, 1.0],
    2: [0.32, 0.36, 0.52, 1.0],
    4: [0.18, 0.38, 0.58, 1.0],
    8: [0.28, 0.34, 0.30, 1.0],
    16: [0.26, 0.42, 0.48, 1.0],
    32: [0.52, 0.22, 0.20, 1.0],
    64: [0.35, 0.40, 0.48, 1.0],
    128: [0.48, 0.24, 0.18, 1.0],
    256: [0.32, 0.26, 0.52, 1.0],
    512: [0.48, 0.42, 0.22, 1.0],
    1024: [0.22, 0.20, 0.38, 1.0],
    2048: [0.42, 0.20, 0.48, 1.0]
  };
  return colors[value] || [0.14, 0.16, 0.22, 1.0];
}

function draw() {
  gl.disable(gl.BLEND);
  gl.clearColor(0.09, 0.10, 0.16, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const cellSize = (canvas.width - GAP * (SIZE + 1)) / SIZE;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const x = GAP + c * (cellSize + GAP);
      const y = GAP + r * (cellSize + GAP);
      drawRect(x, y, cellSize, cellSize, getColor(grid[r][c]));
    }
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const value = grid[r][c];
      const x = GAP + c * (cellSize + GAP);
      const y = GAP + r * (cellSize + GAP);
      drawText(value, x, y, cellSize);
    }
  }
  gl.disable(gl.BLEND);
}

function resetGame() {
  grid = createEmptyGrid();
  score = 0;
  winShown = false;
  updateScore();
  setWinState(false);
  setGameOverState(false);
  addRandomTile();
  addRandomTile();
  draw();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    move("left");
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    move("right");
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    move("up");
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    move("down");
  }
});

restartBtn.addEventListener("click", resetGame);
overlayRestartBtn.addEventListener("click", resetGame);
continueBtn.addEventListener("click", () => setWinState(false));
newGameBtn.addEventListener("click", resetGame);
populateRuneLegend();
resetGame();