/**
 * Симуляция N сессий с рандомным кэшаутом (без DOM).
 * node scripts/simulate-sessions.mjs [count] [bet]
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const storage = {};
const sandbox = {
  globalThis: null,
  window: null,
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => {
      storage[k] = String(v);
    },
    removeItem: (k) => {
      delete storage[k];
    },
  },
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

function loadScript(relativePath) {
  const code = fs.readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(code, vm.createContext(sandbox));
}

loadScript("assets/game-math.js");
loadScript("assets/session-history.js");

const math = sandbox.MergeGameMath;
const history = sandbox.MergeSessionHistory;

const TILE_CRASH = math.TILE_CRASH;
const TILE_BONUS = math.TILE_BONUS;
const SESSION_COUNT = Number(process.argv[2]) || 50;
const BET = Number(process.argv[3]) || 10;
const PROFILES = ["math2", "math3", "math4"];

function processMergeChainSync(levels, coeffBase) {
  let grid = levels.slice();
  while (true) {
    const pairs = math.findPairs(grid);
    if (!pairs.length) {
      return {
        grid,
        totalCoeff: coeffBase + math.calcRoundCoeff(grid),
      };
    }
    grid = math.mergeLevelsFromPairs(grid, [pairs[0]]);
  }
}

function playStep(state) {
  const stage = math.getCurrentStage(state.totalCoeff);
  const levels = state.grid.slice();
  const spawnMask = new Array(9).fill(false);
  let bonusTileAppeared = state.bonusTileAppeared;
  let crashSpawned = false;

  for (let i = 0; i < 9; i++) {
    if (crashSpawned) continue;
    if (levels[i] === 0) {
      const tile = math.pickTileForEmptyCell(
        stage,
        levels,
        bonusTileAppeared,
        state.totalCoeff,
        state.roundIndex
      );
      if (tile === TILE_BONUS) bonusTileAppeared = true;
      if (tile === TILE_CRASH) crashSpawned = true;
      levels[i] = tile;
      spawnMask[i] = true;
    }
  }

  if (levels.some((l) => l === TILE_CRASH)) {
    return {
      kind: "crash",
      coeff: state.totalCoeff,
      bonusTileAppeared,
    };
  }

  const { grid: fallen } = math.applyGravityWithSpawnMask(levels, spawnMask);
  const { grid: finalGrid, totalCoeff } = processMergeChainSync(
    fallen,
    state.totalCoeff
  );

  const step = {
    round: state.roundIndex,
    coeff: Math.round(totalCoeff * 100) / 100,
  };

  if (math.isGridFullNoPairs(finalGrid)) {
    return {
      kind: "no_pairs",
      grid: finalGrid,
      totalCoeff,
      step,
      bonusTileAppeared,
      win: state.sessionBet * totalCoeff,
    };
  }

  return {
    kind: "continue",
    grid: finalGrid,
    totalCoeff,
    step,
    bonusTileAppeared,
  };
}

function shouldRandomCashout(roundIndex, totalCoeff) {
  if (totalCoeff <= 0) return false;
  const base = 0.12;
  const perStep = 0.04;
  const chance = Math.min(0.85, base + roundIndex * perStep);
  return Math.random() < chance;
}

function simulateSession(balance, bet, profileId) {
  math.setActiveProfile(profileId);
  const balanceBefore = balance;
  balance -= bet;

  const sessionLog = {
    balanceBefore,
    bet,
    stepCoeffs: [],
    profile: profileId,
  };

  let state = {
    grid: new Array(9).fill(0),
    totalCoeff: 0,
    roundIndex: 0,
    sessionBet: bet,
    bonusTileAppeared: false,
  };

  let outcome = "unknown";
  let win = 0;
  let finalCoeff = 0;

  while (true) {
    state.roundIndex += 1;
    const result = playStep(state);

    if (result.kind === "crash") {
      outcome = "crash";
      finalCoeff = result.coeff;
      sessionLog.stepCoeffs.push({
        round: state.roundIndex,
        coeff: Math.round(result.coeff * 100) / 100,
        crash: true,
      });
      break;
    }

    sessionLog.stepCoeffs.push(result.step);
    state.grid = result.grid;
    state.totalCoeff = result.totalCoeff;
    state.bonusTileAppeared = result.bonusTileAppeared;

    if (result.kind === "no_pairs") {
      outcome = "no_pairs";
      win = result.win;
      finalCoeff = result.totalCoeff;
      balance += win;
      break;
    }

    if (shouldRandomCashout(state.roundIndex, state.totalCoeff)) {
      outcome = "cashout";
      finalCoeff = state.totalCoeff;
      win = state.sessionBet * state.totalCoeff;
      balance += win;
      break;
    }

    if (state.roundIndex >= 40) {
      outcome = "cashout";
      finalCoeff = state.totalCoeff;
      win = state.sessionBet * state.totalCoeff;
      balance += win;
      break;
    }
  }

  history.recordSession({
    balanceBefore: sessionLog.balanceBefore,
    balanceEnd: balance,
    bet,
    win,
    finalCoeff,
    outcome,
    profile: profileId,
    stepCoeffs: sessionLog.stepCoeffs,
    endedAt: Date.now() + Math.floor(Math.random() * 1000),
  });

  history.saveWallet({ balance, baseBetAmount: bet });

  return { outcome, win, finalCoeff, balance, rounds: sessionLog.stepCoeffs.length };
}

function run() {
  history.clearAll();
  let balance = 1000;
  const results = [];

  for (let i = 0; i < SESSION_COUNT; i++) {
    if (balance < BET) {
      balance = 1000;
    }
    const profileId = PROFILES[Math.floor(Math.random() * PROFILES.length)];
    const session = simulateSession(balance, BET, profileId);
    balance = session.balance;
    results.push(session);
  }

  const agg = history.loadAggregates();
  const outPath = path.join(root, "scripts", "simulated-localStorage.json");
  fs.writeFileSync(outPath, JSON.stringify(storage, null, 2));

  const byOutcome = { cashout: 0, crash: 0, no_pairs: 0 };
  results.forEach((r) => {
    byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
  });

  console.log("=== Симуляция: " + SESSION_COUNT + " сессий ===");
  console.log("Ставка: $" + BET);
  console.log("Итоговый баланс: $" + balance.toFixed(2));
  console.log("Кэшаут:", byOutcome.cashout, "| Бомба:", byOutcome.crash, "| Нет пар:", byOutcome.no_pairs);
  console.log("Средний x:", (agg.sumCoeff / agg.totalSessions).toFixed(2));
  console.log("Средний шаг:", (agg.sumRounds / agg.totalSessions).toFixed(1));
  console.log("Итог (выигрыш - ставки): $" + (agg.totalWon - agg.totalWagered).toFixed(2));
  console.log("");
  console.log("localStorage dump:", outPath);
  console.log("");
  console.log("Вставить в браузер на странице игры (консоль):");
  console.log(
    "fetch('/scripts/simulated-localStorage.json').then(r=>r.json()).then(d=>Object.entries(d).forEach(([k,v])=>localStorage.setItem(k,v)))"
  );
}

run();
