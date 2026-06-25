/**
 * Чистая математика и правила поля Merge (без DOM).
 * Подключается до основного скрипта в index.html.
 */
(function (global) {
  "use strict";

  const MAX_LEVEL = 12;
  const MIN_BET = 1;
  const TILE_CRASH = -1;
  const TILE_BONUS = -2;
  /** При краше итоговый коэффициент × 0 = 0 (игрок ничего не получает). */
  const CRASH_MULT = 0;

  function det01(seedA, seedB) {
    const x = Math.imul(seedA | 0, 0x9e3779b1) ^ Math.imul(seedB | 0, 0x85ebca6b);
    const t = (x ^ (x >>> 16)) >>> 0;
    return t / 4294967296;
  }

  // ─── Коэффициенты по уровням: геометрическая прогрессия C1 × G^(lvl-1) ───
  const C1 = 0.02905;
  const G  = 1.1823;
  const COEFF_BY_LEVEL = (function () {
    const result = {};
    for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
      result[lvl] = C1 * Math.pow(G, lvl - 1);
    }
    return result;
  })();

  /** Вклад одной бонус-ячейки в суммарный множитель. */
  const BONUS_TILE_COEFF = 1.01;

  // ─── Три стадии игры ───────────────────────────────────────────────────────
  // Стадия определяется по накопленному coeff сессии:
  //   1: coeff < 0.1876
  //   2: 0.1876 ≤ coeff < 0.5905
  //   3: coeff ≥ 0.5905
  const STAGE_THRESHOLDS = [0.1876, 0.5905];

  // Параметр alpha геометрического распределения вероятностей для каждой стадии
  const ALPHA_STAGES = [0.75384, 0.2064, 1.07238];

  // ─── Коррекция по уже существующим тайлам ─────────────────────────────────
  // Подавление пар: если уровень уже есть на поле — уменьшаем вес, иначе — увеличиваем
  const FACTOR_EXISTING = 0.29088;
  const FACTOR_NEW      = 4.32437;

  // ─── Базовые вероятности спецтайлов ───────────────────────────────────────
  const BONUS_P = 0.00985;
  const BOMB_P  = 0.0743;

  const MERGE_GLOW_RGB_BY_LEVEL = {
    1:  "148 152 162",
    2:  "148 152 162",
    3:  "120 38 58",
    4:  "72 48 118",
    5:  "100 175 235",
    6:  "228 52 52",
    7:  "0 195 255",
    8:  "255 220 55",
    9:  "100 175 235",
    10: "235 185 75",
    11: "230 165 55",
    12: "255 205 95",
  };

  function mergeGlowRgbForLevel(level) {
    if (level === TILE_CRASH) return "248 113 113";
    if (level === TILE_BONUS) return "251 191 36";
    if (!level || level <= 0) return "120 130 160";
    const k = Math.min(Math.max(Math.floor(level), 1), 12);
    return MERGE_GLOW_RGB_BY_LEVEL[k] || "120 130 160";
  }

  function getCurrentStage(totalCoeff) {
    if (totalCoeff < STAGE_THRESHOLDS[0]) return 1;
    if (totalCoeff < STAGE_THRESHOLDS[1]) return 2;
    return 3;
  }

  /**
   * Базовые вероятности уровней 1–10 для заданного alpha
   * (геометрическое распределение, нормированное в сумму 1).
   * raw[lvl] = e^(-alpha × (lvl-1)),  probs = raw / Σraw
   */
  function getBaseProbs(alpha) {
    const raw = [];
    let sum = 0;
    for (let lvl = 1; lvl <= 10; lvl++) {
      const r = Math.exp(-alpha * (lvl - 1));
      raw.push(r);
      sum += r;
    }
    return raw.map(function (r) { return r / sum; });
  }

  /**
   * Выбрать тайл для пустой ячейки.
   *
   * @param {number} stage          — текущая стадия (1–3)
   * @param {number[]} existingLevels — текущие уровни на поле
   * @param {boolean} bonusAlreadyAppeared — бонус уже появлялся в этой сессии (не используется в новой математике)
   * @param {number} totalCoeff     — накопленный коэффициент
   * @param {number} [roundNumber]  — номер текущего раунда (1-based)
   */
  function pickTileForEmptyCell(stage, existingLevels, bonusAlreadyAppeared, totalCoeff, roundNumber) {
    // Модификаторы вероятностей по номеру раунда
    let bonusProb = BONUS_P;
    let bombProb  = BOMB_P;
    const round = typeof roundNumber === "number" ? roundNumber : 99;
    if (round <= 3) bombProb  *= 0.05;
    if (round <= 1) bonusProb *= 0.1;

    // Одним броском решаем: бонус / краш / числовой уровень
    const r = Math.random();
    if (r < bonusProb) return TILE_BONUS;
    if (r < bonusProb + bombProb) return TILE_CRASH;

    // Числовой уровень: строим взвешенное распределение
    const alpha    = ALPHA_STAGES[stage - 1];
    const baseProbs = getBaseProbs(alpha);

    // Собираем флаги «уровень уже есть на поле»
    const existsOnField = {};
    for (let i = 0; i < existingLevels.length; i++) {
      const l = existingLevels[i];
      if (l > 0 && l <= 10) existsOnField[l] = true;
    }

    // Применяем коррекционные факторы и нормируем
    const w = [];
    let wSum = 0;
    for (let lvl = 1; lvl <= 10; lvl++) {
      const factor = existsOnField[lvl] ? FACTOR_EXISTING : FACTOR_NEW;
      const wi = baseProbs[lvl - 1] * factor;
      w.push(wi);
      wSum += wi;
    }

    // Сэмплирование методом накопленных сумм (inverse CDF)
    const rLvl = Math.random();
    let acc = 0;
    for (let lvl = 1; lvl <= 10; lvl++) {
      acc += w[lvl - 1] / wSum;
      if (rLvl <= acc) return lvl;
    }
    return 1;
  }

  function applyGravityWithSpawnMask(levels, spawnMask) {
    const mask = spawnMask || new Array(9).fill(false);
    const res = new Array(9).fill(0);
    const resSpawn = new Array(9).fill(false);

    for (let col = 0; col < 3; col++) {
      const colTiles = [];
      const colSpawn = [];

      for (let row = 0; row < 3; row++) {
        const idx = row * 3 + col;
        const tile = levels[idx];

        if (tile === TILE_BONUS) {
          res[idx] = TILE_BONUS;
        } else if (tile > 0 || tile === TILE_CRASH) {
          colTiles.push(tile);
          colSpawn.push(!!mask[idx]);
        }
      }

      let row = 2;
      for (let i = colTiles.length - 1; i >= 0; i--) {
        while (row >= 0 && res[row * 3 + col] === TILE_BONUS) {
          row--;
        }
        if (row >= 0) {
          const place = row * 3 + col;
          res[place] = colTiles[i];
          resSpawn[place] = colSpawn[i];
          row--;
        }
      }
    }

    return { grid: res, spawnMask: resSpawn };
  }

  function applyGravity(levels) {
    return applyGravityWithSpawnMask(levels, null).grid;
  }

  function calcRoundCoeff(levels) {
    let sum = 0;
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      if (!l || l === TILE_CRASH) continue;
      if (l === TILE_BONUS) {
        sum += BONUS_TILE_COEFF;
      } else {
        sum += COEFF_BY_LEVEL[l] || 0;
      }
    }
    return sum;
  }

  function hasAnyPair(levels) {
    const counts = {};
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      if (!l || l <= 0) continue;
      if (l !== TILE_BONUS && l !== TILE_CRASH) {
        counts[l] = (counts[l] || 0) + 1;
        if (counts[l] >= 2) return true;
      }
    }
    return false;
  }

  function isGridFullNoPairs(levels) {
    const noEmpty = levels.every(function (l) { return l !== 0; });
    return noEmpty && !hasAnyPair(levels);
  }

  function findPairs(levels) {
    const positionsByLevel = {};
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      if (l > 0 && l !== TILE_BONUS && l !== TILE_CRASH) {
        if (!positionsByLevel[l]) positionsByLevel[l] = [];
        positionsByLevel[l].push(i);
      }
    }

    const pairs = [];
    Object.keys(positionsByLevel)
      .map(function (k) { return parseInt(k, 10); })
      .filter(function (n) { return !Number.isNaN(n); })
      .sort(function (a, b) { return a - b; })
      .forEach(function (lv) {
        const arr = positionsByLevel[lv];
        if (!arr) return;
        for (let j = 0; j + 1 < arr.length; j += 2) {
          pairs.push([arr[j], arr[j + 1]]);
        }
      });
    return pairs;
  }

  function coeffGainLabelForMerge(levelL) {
    if (!levelL || levelL <= 0 || levelL === TILE_CRASH || levelL === TILE_BONUS) return null;
    const next = Math.min(levelL + 1, MAX_LEVEL);
    const c0 = COEFF_BY_LEVEL[levelL] || 0;
    const c1 = COEFF_BY_LEVEL[next] || 0;
    const delta = c1 - 2 * c0;
    const value = delta > 1e-10 ? delta : c1;
    if (!(value > 0)) return null;
    return value;
  }

  function mergeLevelsFromPairs(levels, pairs) {
    const arr = levels.slice();
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      const anchorIdx = pair[0];
      const moverIdx  = pair[1];
      const l = arr[anchorIdx];
      if (!l || arr[moverIdx] !== l) continue;
      arr[anchorIdx] = Math.min(l + 1, MAX_LEVEL);
      arr[moverIdx]  = 0;
    }
    return arr;
  }

  global.MergeGameMath = {
    MAX_LEVEL:               MAX_LEVEL,
    MIN_BET:                 MIN_BET,
    TILE_CRASH:              TILE_CRASH,
    TILE_BONUS:              TILE_BONUS,
    CRASH_MULT:              CRASH_MULT,
    BONUS_TILE_COEFF:        BONUS_TILE_COEFF,
    det01:                   det01,
    COEFF_BY_LEVEL:          COEFF_BY_LEVEL,
    mergeGlowRgbForLevel:    mergeGlowRgbForLevel,
    getCurrentStage:         getCurrentStage,
    pickTileForEmptyCell:    pickTileForEmptyCell,
    applyGravityWithSpawnMask: applyGravityWithSpawnMask,
    applyGravity:            applyGravity,
    calcRoundCoeff:          calcRoundCoeff,
    hasAnyPair:              hasAnyPair,
    isGridFullNoPairs:       isGridFullNoPairs,
    findPairs:               findPairs,
    coeffGainLabelForMerge:  coeffGainLabelForMerge,
    mergeLevelsFromPairs:    mergeLevelsFromPairs,
  };
})(typeof window !== "undefined" ? window : globalThis);
