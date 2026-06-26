/**
 * История сессий и агрегаты — localStorage, общий для index.html и stats.html.
 */
(function (global) {
  "use strict";

  const HISTORY_KEY = "mergeMvpSessionHistory";
  const AGGREGATE_KEY = "mergeMvpSessionStats";
  const ACTIVE_SESSION_KEY = "mergeMvpActiveSession";
  const WALLET_KEY = "mergeMvpWalletBalance";
  const MAX_SESSIONS = 200;
  const MILESTONES = [10, 50, 100];

  function createEmptyAggregates() {
    return {
      totalSessions: 0,
      totalWagered: 0,
      totalWon: 0,
      cashouts: 0,
      noPairsEnd: 0,
      crashes: 0,
      sumCoeff: 0,
      sumRounds: 0,
      milestones: {},
    };
  }

  function loadAggregates() {
    try {
      const raw = global.localStorage.getItem(AGGREGATE_KEY);
      if (!raw) return createEmptyAggregates();
      const parsed = JSON.parse(raw);
      const base = createEmptyAggregates();
      Object.keys(base).forEach(function (key) {
        if (key === "milestones") {
          if (parsed.milestones && typeof parsed.milestones === "object") {
            base.milestones = parsed.milestones;
          }
          return;
        }
        const n = Number(parsed[key]);
        if (Number.isFinite(n) && n >= 0) base[key] = n;
      });
      return base;
    } catch (e) {
      return createEmptyAggregates();
    }
  }

  function saveAggregates(stats) {
    try {
      global.localStorage.setItem(AGGREGATE_KEY, JSON.stringify(stats));
    } catch (e) {
      void e;
    }
  }

  function loadHistory() {
    try {
      const raw = global.localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      global.localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {
      void e;
    }
  }

  function buildAggregateSnapshot(stats) {
    const n = stats.totalSessions;
    return {
      totalSessions: n,
      totalWagered: stats.totalWagered,
      totalWon: stats.totalWon,
      cashouts: stats.cashouts,
      noPairsEnd: stats.noPairsEnd,
      crashes: stats.crashes,
      avgCoeff: n > 0 ? stats.sumCoeff / n : 0,
      avgRounds: n > 0 ? stats.sumRounds / n : 0,
    };
  }

  function maybeSaveMilestone(stats) {
    if (MILESTONES.indexOf(stats.totalSessions) < 0) return;
    if (!stats.milestones) stats.milestones = {};
    stats.milestones[String(stats.totalSessions)] = buildAggregateSnapshot(stats);
  }

  function normalizeSessionRecord(record) {
    const stepCoeffs = Array.isArray(record.stepCoeffs) ? record.stepCoeffs : [];
    return {
      sessionNumber: record.sessionNumber,
      balanceBefore: Number(record.balanceBefore) || 0,
      balanceEnd: Number(record.balanceEnd) || 0,
      bet: Number(record.bet) || 0,
      win: Number(record.win) || 0,
      finalCoeff: Number(record.finalCoeff) || 0,
      outcome: record.outcome || "unknown",
      profile: record.profile || "math3",
      stepCoeffs: stepCoeffs.map(function (step) {
        return {
          round: Number(step.round) || 0,
          coeff: Number(step.coeff) || 0,
          crash: !!step.crash,
        };
      }),
      endedAt: record.endedAt || Date.now(),
    };
  }

  function recordSession(record) {
    if (!record || !(record.bet > 0)) return null;

    const aggregates = loadAggregates();
    aggregates.totalSessions += 1;
    aggregates.totalWagered += record.bet;
    aggregates.totalWon += Math.max(0, record.win || 0);
    aggregates.sumCoeff += Math.max(0, record.finalCoeff || 0);
    const rounds =
      record.stepCoeffs && record.stepCoeffs.length
        ? record.stepCoeffs.length
        : 0;
    aggregates.sumRounds += rounds;
    if (record.outcome === "crash") aggregates.crashes += 1;
    else if (record.outcome === "cashout") aggregates.cashouts += 1;
    else if (record.outcome === "no_pairs") aggregates.noPairsEnd += 1;
    maybeSaveMilestone(aggregates);
    saveAggregates(aggregates);

    const session = normalizeSessionRecord(
      Object.assign({}, record, { sessionNumber: aggregates.totalSessions })
    );
    const history = loadHistory();
    history.unshift(session);
    if (history.length > MAX_SESSIONS) {
      history.length = MAX_SESSIONS;
    }
    saveHistory(history);
    return session;
  }

  function getMilestones() {
    return MILESTONES.slice();
  }

  function normalizeActiveSession(state) {
    if (!state || !(Number(state.sessionBet) > 0)) return null;
    if (!Array.isArray(state.currentGrid) || state.currentGrid.length !== 9) {
      return null;
    }
    const sessionLog = state.sessionLog && typeof state.sessionLog === "object"
      ? state.sessionLog
      : {};
    const stepCoeffs = Array.isArray(sessionLog.stepCoeffs)
      ? sessionLog.stepCoeffs
      : [];
    return {
      balance: Number(state.balance) || 0,
      totalCoeff: Number(state.totalCoeff) || 0,
      roundIndex: Number(state.roundIndex) || 0,
      currentGrid: state.currentGrid.map(function (level) {
        return Number(level) || 0;
      }),
      sessionAlive: state.sessionAlive !== false,
      sessionBet: Number(state.sessionBet) || 0,
      bonusTileAppeared: !!state.bonusTileAppeared,
      baseBetAmount: Number(state.baseBetAmount) || Number(state.sessionBet) || 0,
      sessionLog: {
        balanceBefore: Number(sessionLog.balanceBefore) || 0,
        bet: Number(sessionLog.bet) || Number(state.sessionBet) || 0,
        profile: sessionLog.profile || "math3",
        stepCoeffs: stepCoeffs.map(function (step) {
          return {
            round: Number(step.round) || 0,
            coeff: Number(step.coeff) || 0,
            crash: !!step.crash,
          };
        }),
      },
      savedAt: Number(state.savedAt) || Date.now(),
    };
  }

  function loadActiveSession() {
    try {
      const raw = global.localStorage.getItem(ACTIVE_SESSION_KEY);
      if (!raw) return null;
      return normalizeActiveSession(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function saveActiveSession(state) {
    const normalized = normalizeActiveSession(state);
    try {
      if (!normalized) {
        global.localStorage.removeItem(ACTIVE_SESSION_KEY);
        return;
      }
      global.localStorage.setItem(
        ACTIVE_SESSION_KEY,
        JSON.stringify(normalized)
      );
    } catch (e) {
      void e;
    }
  }

  function loadWallet() {
    try {
      const raw = global.localStorage.getItem(WALLET_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const balance = Number(parsed.balance);
      const baseBetAmount = Number(parsed.baseBetAmount);
      if (!Number.isFinite(balance)) return null;
      return {
        balance: balance,
        baseBetAmount:
          Number.isFinite(baseBetAmount) && baseBetAmount > 0
            ? baseBetAmount
            : null,
      };
    } catch (e) {
      return null;
    }
  }

  function saveWallet(data) {
    if (!data) return;
    const balance = Number(data.balance);
    if (!Number.isFinite(balance)) return;
    const baseBetAmount = Number(data.baseBetAmount);
    try {
      global.localStorage.setItem(
        WALLET_KEY,
        JSON.stringify({
          balance: balance,
          baseBetAmount:
            Number.isFinite(baseBetAmount) && baseBetAmount > 0
              ? baseBetAmount
              : 10,
        })
      );
    } catch (e) {
      void e;
    }
  }

  function clearWallet() {
    try {
      global.localStorage.removeItem(WALLET_KEY);
    } catch (e) {
      void e;
    }
  }

  function clearActiveSession() {
    try {
      global.localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch (e) {
      void e;
    }
  }

  function clearAll() {
    try {
      global.localStorage.removeItem(HISTORY_KEY);
      global.localStorage.removeItem(AGGREGATE_KEY);
      global.localStorage.removeItem(ACTIVE_SESSION_KEY);
      global.localStorage.removeItem(WALLET_KEY);
    } catch (e) {
      void e;
    }
  }

  global.MergeSessionHistory = {
    loadHistory: loadHistory,
    loadAggregates: loadAggregates,
    recordSession: recordSession,
    getMilestones: getMilestones,
    loadActiveSession: loadActiveSession,
    saveActiveSession: saveActiveSession,
    clearActiveSession: clearActiveSession,
    loadWallet: loadWallet,
    saveWallet: saveWallet,
    clearWallet: clearWallet,
    clearAll: clearAll,
  };
})(typeof window !== "undefined" ? window : globalThis);
