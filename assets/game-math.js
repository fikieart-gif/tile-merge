/**
 * Чистая математика и правила поля Merge (без DOM).
 * Профили Easy / Normal4 / Normal6 / Hard — setActiveProfile().
 */
(function (global) {
  "use strict";

  const MAX_LEVEL = 12;
  const MIN_BET = 1;
  const TILE_CRASH = -1;
  const TILE_BONUS = -2;
  const CRASH_MULT = 0;
  const BONUS_TILE_COEFF = 1.01;

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

  function det01(seedA, seedB) {
    const x = Math.imul(seedA | 0, 0x9e3779b1) ^ Math.imul(seedB | 0, 0x85ebca6b);
    const t = (x ^ (x >>> 16)) >>> 0;
    return t / 4294967296;
  }

  function mergeGlowRgbForLevel(level) {
    if (level === TILE_CRASH) return "248 113 113";
    if (level === TILE_BONUS) return "251 191 36";
    if (!level || level <= 0) return "120 130 160";
    const k = Math.min(Math.max(Math.floor(level), 1), 12);
    return MERGE_GLOW_RGB_BY_LEVEL[k] || "120 130 160";
  }

  function buildCoeffByLevel(c1, g) {
    const result = {};
    for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
      result[lvl] = c1 * Math.pow(g, lvl - 1);
    }
    return result;
  }

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

  function createMathProfile(config) {
    const COEFF_BY_LEVEL = buildCoeffByLevel(config.c1, config.g);
    const bonusTileCoeff =
      config.bonusTileCoeff != null ? config.bonusTileCoeff : BONUS_TILE_COEFF;
    const stageThresholds = config.stageThresholds.slice();
    const alphaStages = config.alphaStages.slice();

    function getCurrentStage(totalCoeff) {
      for (let i = 0; i < stageThresholds.length; i++) {
        if (totalCoeff < stageThresholds[i]) return i + 1;
      }
      return stageThresholds.length + 1;
    }

    function pickFactors(totalCoeff) {
      if (totalCoeff < 1.0) return config.factorsBelowOne;
      return config.factorsAboveOne;
    }

    function pickTileForEmptyCell(stage, existingLevels, bonusAlreadyAppeared, totalCoeff, roundNumber) {
      const round = typeof roundNumber === "number" ? roundNumber : 99;
      let bonusProb = config.computeBonusProb(round, bonusAlreadyAppeared);
      let bombProb = config.computeBombProb(
        totalCoeff,
        round,
        bonusAlreadyAppeared
      );

      const r = Math.random();
      if (r < bonusProb) return TILE_BONUS;
      if (r < bonusProb + bombProb) return TILE_CRASH;

      const alpha = alphaStages[stage - 1];
      const baseProbs = getBaseProbs(alpha);
      const factors = pickFactors(totalCoeff);

      const existsOnField = {};
      for (let i = 0; i < existingLevels.length; i++) {
        const l = existingLevels[i];
        if (l > 0 && l <= 10) existsOnField[l] = true;
      }

      const w = [];
      let wSum = 0;
      for (let lvl = 1; lvl <= 10; lvl++) {
        const factor = existsOnField[lvl] ? factors.existing : factors.new;
        const wi = baseProbs[lvl - 1] * factor;
        w.push(wi);
        wSum += wi;
      }

      const rLvl = Math.random();
      let acc = 0;
      for (let lvl = 1; lvl <= 10; lvl++) {
        acc += w[lvl - 1] / wSum;
        if (rLvl <= acc) return lvl;
      }
      return 1;
    }

    function calcRoundCoeff(levels) {
      let sum = 0;
      for (let i = 0; i < levels.length; i++) {
        const l = levels[i];
        if (!l || l === TILE_CRASH) continue;
        if (l === TILE_BONUS) {
          sum += bonusTileCoeff;
        } else {
          sum += COEFF_BY_LEVEL[l] || 0;
        }
      }
      return sum;
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

    return {
      id: config.id,
      label: config.label,
      MAX_LEVEL: MAX_LEVEL,
      MIN_BET: MIN_BET,
      TILE_CRASH: TILE_CRASH,
      TILE_BONUS: TILE_BONUS,
      CRASH_MULT: CRASH_MULT,
      BONUS_TILE_COEFF: bonusTileCoeff,
      COEFF_BY_LEVEL: COEFF_BY_LEVEL,
      getCurrentStage: getCurrentStage,
      pickTileForEmptyCell: pickTileForEmptyCell,
      calcRoundCoeff: calcRoundCoeff,
      coeffGainLabelForMerge: coeffGainLabelForMerge,
      initialSessionCoeff:
        config.initialSessionCoeff != null ? config.initialSessionCoeff : 0,
    };
  }

  function computeEasyBombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.09128;
    let prob;
    if (totalCoeff < 0.8) {
      prob = BOMB_P * 0.093;
      if (roundNumber === 1) prob *= 0.1;
      if (bonusAlreadyAppeared) prob *= 7.0;
    } else {
      prob = BOMB_P;
    }
    if (roundNumber === 4) prob *= 1.2;
    if (roundNumber === 5) prob *= 0.9;
    if (roundNumber === 6) prob *= 0.91;
    if (bonusAlreadyAppeared) prob *= 1.5;
    return prob;
  }

  function computeEasyBonusProb(roundNumber, bonusAlreadyAppeared) {
    const BONUS_P = 0.00518;
    let prob = BONUS_P;
    if (roundNumber <= 2) prob *= 0.1;
    if (bonusAlreadyAppeared) prob *= 0.1;
    return prob;
  }

  function computeNormal6BombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.13205;
    let prob;
    if (totalCoeff < 0.8) {
      prob = BOMB_P * 0.22;
      if (roundNumber === 1) prob *= 0.1;
      if (bonusAlreadyAppeared) prob *= 7.0;
    } else {
      prob = BOMB_P;
    }
    if (roundNumber === 2) prob *= 2.1;
    if (roundNumber === 3) prob *= 1.05;
    if (roundNumber === 4) prob *= 0.55;
    if (roundNumber === 5) prob *= 0.6;
    if (roundNumber === 6) prob *= 0.6;
    if (roundNumber === 7) prob *= 0.6;
    if (roundNumber === 8) prob *= 0.6;
    if (bonusAlreadyAppeared) prob *= 1.5;
    return prob;
  }

  function computeNormal6BonusProb(roundNumber, bonusAlreadyAppeared) {
    const BONUS_P = 0.00617;
    let prob = BONUS_P;
    if (roundNumber <= 1) prob *= 0.1;
    if (bonusAlreadyAppeared) prob *= 0.1;
    return prob;
  }

  function computeNormal4BombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.1405;
    let prob;
    if (totalCoeff < 0.8) {
      prob = BOMB_P * 0.22;
      if (roundNumber === 1) prob *= 0.1;
      if (bonusAlreadyAppeared) prob *= 7.0;
    } else {
      prob = BOMB_P;
    }
    if (roundNumber === 2) prob *= 1.4;
    if (roundNumber === 3) prob *= 1.1;
    if (roundNumber === 4) prob *= 0.75;
    if (roundNumber === 5) prob *= 0.8;
    if (roundNumber === 6) prob *= 0.75;
    if (roundNumber === 7) prob *= 0.6;
    if (roundNumber === 8) prob *= 0.6;
    if (bonusAlreadyAppeared) prob *= 1.5;
    return prob;
  }

  function computeNormal4BonusProb(roundNumber, bonusAlreadyAppeared) {
    const BONUS_P = 0.00617;
    let prob = BONUS_P;
    if (roundNumber <= 1) prob *= 0.1;
    if (bonusAlreadyAppeared) prob *= 0.1;
    return prob;
  }

  function computeHardBombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.08677;
    let bombProb = BOMB_P;
    if (roundNumber === 1) bombProb *= 0.9;
    if (roundNumber === 3) bombProb *= 1.2;
    if (roundNumber === 4) bombProb *= 1.15;
    if (roundNumber === 5) bombProb *= 1.15;
    if (roundNumber === 6) bombProb *= 1.1;
    if (bonusAlreadyAppeared) bombProb *= 1.5;
    return bombProb;
  }

  function computeHardBonusProb(roundNumber, bonusAlreadyAppeared) {
    const BONUS_P = 0.00836;
    let prob = BONUS_P;
    if (roundNumber <= 2) prob *= 0.05;
    if (bonusAlreadyAppeared) prob *= 0.1;
    return prob;
  }

  /** База Easy (бывш. Math4). */
  const EASY_PROFILE_SPEC = {
    c1: 0.02798,
    g: 1.23261,
    bonusTileCoeff: 0.91015,
    stageThresholds: [0.17750, 0.49775, 1.550775],
    alphaStages: [0.70028, 0.18708, 0.73031, 0.10306],
    factorsBelowOne: { existing: 0.25013, new: 4.32571 },
    factorsAboveOne: { existing: 0.30802, new: 2.86874 },
    computeBombProb: computeEasyBombProb,
    computeBonusProb: computeEasyBonusProb,
  };

  const NORMAL6_PROFILE_SPEC = {
    c1: 0.0397,
    g: 1.22002,
    bonusTileCoeff: 0.96935,
    stageThresholds: [0.36410, 0.57145, 1.550775],
    alphaStages: [0.21254, 0.15938, 0.63540, 0.33540],
    factorsBelowOne: { existing: 0.25776, new: 1.504776 },
    factorsAboveOne: { existing: 0.30668, new: 4.09397 },
    computeBombProb: computeNormal6BombProb,
    computeBonusProb: computeNormal6BonusProb,
  };

  const NORMAL4_PROFILE_SPEC = {
    c1: 0.04997,
    g: 1.18002,
    bonusTileCoeff: 0.96935,
    stageThresholds: [0.36410, 0.57145, 1.550775],
    alphaStages: [0.31254, 0.15938, 0.63540, 0.33540],
    factorsBelowOne: { existing: 0.25776, new: 4.04776 },
    factorsAboveOne: { existing: 0.30668, new: 4.09397 },
    computeBombProb: computeNormal4BombProb,
    computeBonusProb: computeNormal4BonusProb,
  };

  const HARD_PROFILE_SPEC = {
    c1: 0.01098,
    g: 1.76093,
    bonusTileCoeff: 7.0,
    initialSessionCoeff: 1.0,
    stageThresholds: [1.23249, 2.22738, 3.36854],
    alphaStages: [0.54723, 0.64005, 0.31724, 0.251724],
    factorsBelowOne: { existing: 1, new: 1 },
    factorsAboveOne: { existing: 0.31535, new: 2.18834 },
    computeBombProb: computeHardBombProb,
    computeBonusProb: computeHardBonusProb,
  };

  const EASY = createMathProfile(
    Object.assign({ id: "math4", label: "Easy" }, EASY_PROFILE_SPEC)
  );
  const NORMAL6 = createMathProfile(
    Object.assign({ id: "normal6", label: "Normal6" }, NORMAL6_PROFILE_SPEC)
  );
  const NORMAL4 = createMathProfile(
    Object.assign({ id: "normal4", label: "Normal4" }, NORMAL4_PROFILE_SPEC)
  );
  const HARD = createMathProfile(
    Object.assign({ id: "hard", label: "Hard" }, HARD_PROFILE_SPEC)
  );

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
      .forEach(function (lv) {
        const arr = positionsByLevel[lv];
        if (!arr) return;
        for (let j = 0; j + 1 < arr.length; j += 2) {
          pairs.push([arr[j], arr[j + 1]]);
        }
      });
    return pairs;
  }

  function mergeLevelsFromPairs(levels, pairs) {
    const arr = levels.slice();
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      const anchorIdx = pair[0];
      const moverIdx = pair[1];
      const l = arr[anchorIdx];
      if (!l || arr[moverIdx] !== l) continue;
      arr[anchorIdx] = Math.min(l + 1, MAX_LEVEL);
      arr[moverIdx] = 0;
    }
    return arr;
  }

  const profiles = {
    math4: EASY,
    normal4: NORMAL4,
    normal6: NORMAL6,
    hard: HARD,
  };

  let activeProfileId = "math4";

  function sharedApi() {
    return {
      det01: det01,
      mergeGlowRgbForLevel: mergeGlowRgbForLevel,
      applyGravityWithSpawnMask: applyGravityWithSpawnMask,
      applyGravity: applyGravity,
      hasAnyPair: hasAnyPair,
      isGridFullNoPairs: isGridFullNoPairs,
      findPairs: findPairs,
      mergeLevelsFromPairs: mergeLevelsFromPairs,
      profiles: profiles,
      getActiveProfileId: function () { return activeProfileId; },
      setActiveProfile: function (profileId) {
        if (!profiles[profileId]) return false;
        activeProfileId = profileId;
        Object.assign(global.MergeGameMath, profiles[profileId], sharedApi());
        return true;
      },
    };
  }

  global.MergeGameMath = Object.assign({}, EASY, sharedApi());
})(typeof window !== "undefined" ? window : globalThis);
