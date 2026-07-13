/**
 * Чистая математика и правила поля Merge (без DOM).
 * Профили Easy / Norm_b_1 / Normal8 / Hard / Hard_b_1 — setActiveProfile().
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

    function pickLevelForEmptyCell(stage, existingLevels, totalCoeff) {
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

    function pickBonusOrLevelForEmptyCell(
      stage,
      existingLevels,
      bonusAlreadyAppeared,
      totalCoeff,
      roundNumber
    ) {
      const round = typeof roundNumber === "number" ? roundNumber : 99;
      const bonusProb = config.computeBonusProb(round, bonusAlreadyAppeared);
      if (Math.random() < bonusProb) return TILE_BONUS;
      return pickLevelForEmptyCell(stage, existingLevels, totalCoeff);
    }

    function pickTileForEmptyCell(
      stage,
      existingLevels,
      bonusAlreadyAppeared,
      totalCoeff,
      roundNumber,
      roundSpawnCtx
    ) {
      if (config.singleBombRollPerRound && roundSpawnCtx) {
        if (!roundSpawnCtx.bombConsumed && roundSpawnCtx.roundHasBomb) {
          roundSpawnCtx.bombConsumed = true;
          return TILE_CRASH;
        }
        return pickBonusOrLevelForEmptyCell(
          stage,
          existingLevels,
          bonusAlreadyAppeared,
          totalCoeff,
          roundNumber
        );
      }

      const round = typeof roundNumber === "number" ? roundNumber : 99;
      const bonusProb = config.computeBonusProb(round, bonusAlreadyAppeared);
      const bombProb = config.computeBombProb(
        totalCoeff,
        round,
        bonusAlreadyAppeared
      );

      const r = Math.random();
      if (r < bonusProb) return TILE_BONUS;
      if (r < bonusProb + bombProb) return TILE_CRASH;
      return pickLevelForEmptyCell(stage, existingLevels, totalCoeff);
    }

    function createRoundSpawnContext(totalCoeff, roundNumber, bonusAlreadyAppeared) {
      if (!config.singleBombRollPerRound) return null;
      const round = typeof roundNumber === "number" ? roundNumber : 99;
      const bombProb = config.computeBombProb(totalCoeff, round, bonusAlreadyAppeared);
      return {
        roundHasBomb: Math.random() < bombProb,
        bombConsumed: false,
      };
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
      pickBonusOrLevelForEmptyCell: pickBonusOrLevelForEmptyCell,
      createRoundSpawnContext: createRoundSpawnContext,
      singleBombRollPerRound: !!config.singleBombRollPerRound,
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

  function computeNormal8BombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.0666;
    let prob;
    if (totalCoeff < 0.8) {
      prob = BOMB_P * 0.35;
      if (roundNumber === 1) prob *= 0.35;
      if (bonusAlreadyAppeared) prob *= 7.0;
    } else {
      prob = BOMB_P;
    }
    if (roundNumber === 4) prob *= 1.1;
    if (roundNumber === 5) prob *= 0.9;
    if (roundNumber === 6) prob *= 0.8;
    if (roundNumber === 7) prob *= 0.8;
    if (roundNumber === 8) prob *= 0.8;
    if (roundNumber >= 9) prob *= 0.8;
    if (bonusAlreadyAppeared) prob *= 1.5;
    return prob;
  }

  function computeNormal8BonusProb(roundNumber, bonusAlreadyAppeared) {
    const BONUS_P = 0.005;
    let prob = BONUS_P;
    if (roundNumber <= 2) prob *= 0.1;
    if (bonusAlreadyAppeared) prob *= 0.1;
    return prob;
  }

  function computeNormB1BombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.167;
    let bombProb;
    if (totalCoeff < 0.85) {
      bombProb = BOMB_P * 1.0;
      if (roundNumber === 1) bombProb *= 0.55;
      if (bonusAlreadyAppeared) bombProb *= 2.0;
    } else {
      bombProb = BOMB_P;
    }
    if (roundNumber === 2) bombProb *= 0.6;
    if (roundNumber === 3) bombProb *= 1.2;
    if (roundNumber === 4) bombProb *= 1.3;
    if (roundNumber === 5) bombProb *= 1.05;
    if (roundNumber === 6) bombProb *= 1.0;
    if (roundNumber >= 9) bombProb *= 0.75;
    if (bonusAlreadyAppeared) bombProb *= 1.5;
    return bombProb;
  }

  function computeNormB1BonusProb(roundNumber, bonusAlreadyAppeared) {
    const BONUS_P = 0.005;
    let prob = BONUS_P;
    if (roundNumber <= 2) prob *= 0.1;
    if (bonusAlreadyAppeared) prob *= 0.1;
    return prob;
  }

  function computeHardBombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.08677;
    let bombProb = BOMB_P;
    if (roundNumber === 1) bombProb *= 0.92;
    if (roundNumber === 2) bombProb *= 1.1;
    if (roundNumber === 3) bombProb *= 1.19;
    if (roundNumber === 4) bombProb *= 1.06;
    if (roundNumber === 5) bombProb *= 1.05;
    if (roundNumber === 7) bombProb *= 0.9;
    if (roundNumber === 8) bombProb *= 0.9;
    if (bonusAlreadyAppeared) bombProb *= 1.5;
    return bombProb;
  }

  function computeHardB1BombProb(totalCoeff, roundNumber, bonusAlreadyAppeared) {
    const BOMB_P = 0.3693;
    let bombProb = BOMB_P;
    if (roundNumber === 1) bombProb *= 1.28;
    if (roundNumber === 2) bombProb *= 1.15;
    if (roundNumber === 3) bombProb *= 1.13;
    if (roundNumber === 5) bombProb *= 0.9;
    if (roundNumber === 6) bombProb *= 0.535;
    if (roundNumber === 7) bombProb *= 0.5;
    if (roundNumber >= 8) bombProb *= 0.55;
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

  function computeHardB1BonusProb(roundNumber, bonusAlreadyAppeared) {
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

  const NORMAL8_PROFILE_SPEC = {
    c1: 0.00403,
    g: 1.5168294,
    bonusTileCoeff: 0.98,
    initialSessionCoeff: 0.5,
    stageThresholds: [1.0079756, 2.396, 3.550775],
    alphaStages: [0.14014, 0.52303, 0.24575, 0.104575],
    factorsBelowOne: { existing: 0.74, new: 2.15 },
    factorsAboveOne: { existing: 0.66, new: 2.206 },
    computeBombProb: computeNormal8BombProb,
    computeBonusProb: computeNormal8BonusProb,
  };

  const NORM_B_1_PROFILE_SPEC = {
    c1: 0.00403,
    g: 1.5168294,
    bonusTileCoeff: 1.0,
    initialSessionCoeff: 0.5,
    singleBombRollPerRound: true,
    stageThresholds: [0.93732, 2.25863, 5.550775],
    alphaStages: [0.14014, 0.52303, 0.24575, 0.104575],
    factorsBelowOne: { existing: 0.74, new: 2.15 },
    factorsAboveOne: { existing: 0.66, new: 2.206 },
    computeBombProb: computeNormB1BombProb,
    computeBonusProb: computeNormB1BonusProb,
  };

  const HARD_PROFILE_SPEC = {
    c1: 0.01098,
    g: 1.76093,
    bonusTileCoeff: 7.0,
    initialSessionCoeff: 1.0,
    stageThresholds: [1.23249, 2.22738, 3.36854, 13.36854],
    alphaStages: [0.54723, 0.64005, 0.31724, 0.251724, 0.0251724],
    factorsBelowOne: { existing: 1, new: 1 },
    factorsAboveOne: { existing: 0.31535, new: 2.18834 },
    computeBombProb: computeHardBombProb,
    computeBonusProb: computeHardBonusProb,
  };

  const HARD_B_1_PROFILE_SPEC = {
    c1: 0.01098,
    g: 1.76093,
    bonusTileCoeff: 7.0,
    initialSessionCoeff: 1.0,
    singleBombRollPerRound: true,
    stageThresholds: [1.23249, 2.22738, 3.36854, 13.36854],
    alphaStages: [0.54723, 0.64005, 0.31724, 0.251724, 0.1051724],
    factorsBelowOne: { existing: 1, new: 1 },
    factorsAboveOne: { existing: 0.31535, new: 2.18834 },
    computeBombProb: computeHardB1BombProb,
    computeBonusProb: computeHardB1BonusProb,
  };

  const EASY = createMathProfile(
    Object.assign({ id: "math4", label: "Easy" }, EASY_PROFILE_SPEC)
  );
  const NORMAL8 = createMathProfile(
    Object.assign({ id: "normal8", label: "Normal8" }, NORMAL8_PROFILE_SPEC)
  );
  const NORM_B_1 = createMathProfile(
    Object.assign({ id: "norm_b_1", label: "Norm_b_1" }, NORM_B_1_PROFILE_SPEC)
  );
  const HARD = createMathProfile(
    Object.assign({ id: "hard", label: "Hard" }, HARD_PROFILE_SPEC)
  );
  const HARD_B_1 = createMathProfile(
    Object.assign({ id: "hard_b_1", label: "Hard_b_1" }, HARD_B_1_PROFILE_SPEC)
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
    norm_b_1: NORM_B_1,
    normal8: NORMAL8,
    hard: HARD,
    hard_b_1: HARD_B_1,
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
