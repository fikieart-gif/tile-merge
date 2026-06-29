#!/usr/bin/env python3
"""Симуляция сессий Merge (та же логика, что game-math.js + session-history.js)."""
import json
import math
import random
import sys
import time
from copy import deepcopy

MAX_LEVEL = 12
TILE_CRASH = -1
TILE_BONUS = -2
BONUS_TILE_COEFF = 1.01

HISTORY_KEY = "mergeMvpSessionHistory"
AGGREGATE_KEY = "mergeMvpSessionStats"
WALLET_KEY = "mergeMvpWalletBalance"


def build_coeff_by_level(c1, g):
    return {lvl: c1 * (g ** (lvl - 1)) for lvl in range(1, MAX_LEVEL + 1)}


def get_base_probs(alpha):
    raw = [math.exp(-alpha * (lvl - 1)) for lvl in range(1, 11)]
    total = sum(raw)
    return [r / total for r in raw]


class MathProfile:
    def __init__(self, cfg):
        self.id = cfg["id"]
        self.coeff_by_level = build_coeff_by_level(cfg["c1"], cfg["g"])
        self.stage_thresholds = cfg["stage_thresholds"]
        self.alpha_stages = cfg["alpha_stages"]
        self.factors_below = cfg["factors_below"]
        self.factors_above = cfg["factors_above"]
        self.bomb_prob = cfg["bomb_prob"]
        self.bonus_prob = cfg["bonus_prob"]
        self.bonus_tile_coeff = cfg.get("bonus_tile_coeff", BONUS_TILE_COEFF)

    def get_current_stage(self, total_coeff):
        for i, th in enumerate(self.stage_thresholds):
            if total_coeff < th:
                return i + 1
        return len(self.stage_thresholds) + 1

    def pick_tile(self, stage, levels, bonus_seen, total_coeff, round_num):
        bonus_p = self.bonus_prob(round_num, bonus_seen)
        bomb_p = self.bomb_prob(total_coeff, round_num, bonus_seen)
        r = random.random()
        if r < bonus_p:
            return TILE_BONUS
        if r < bonus_p + bomb_p:
            return TILE_CRASH

        alpha = self.alpha_stages[stage - 1]
        base_probs = get_base_probs(alpha)
        factors = self.factors_below if total_coeff < 1.0 else self.factors_above
        exists = {l for l in levels if 0 < l <= 10}

        weights = []
        for lvl in range(1, 11):
            factor = factors["existing"] if lvl in exists else factors["new"]
            weights.append(base_probs[lvl - 1] * factor)
        w_sum = sum(weights)
        r_lvl = random.random()
        acc = 0.0
        for lvl in range(1, 11):
            acc += weights[lvl - 1] / w_sum
            if r_lvl <= acc:
                return lvl
        return 1

    def calc_round_coeff(self, levels):
        total = 0.0
        for l in levels:
            if not l or l == TILE_CRASH:
                continue
            if l == TILE_BONUS:
                total += self.bonus_tile_coeff
            else:
                total += self.coeff_by_level.get(l, 0.0)
        return total


PROFILES = {
    "math3": MathProfile(
        {
            "id": "math3",
            "c1": 0.02798,
            "g": 1.20661,
            "stage_thresholds": [0.17750, 0.49775, 1.70775],
            "alpha_stages": [0.70028, 0.18708, 0.73031, 0.13306],
            "factors_below": {"existing": 0.25013, "new": 4.32571},
            "factors_above": {"existing": 0.30802, "new": 2.86874},
            "bomb_prob": lambda tc, rn, seen=False: (
                0.09128 * 0.093 * (0.1 if rn == 1 else 1.0)
                if tc < 0.8
                else 0.09128
            ),
            "bonus_prob": lambda rn, seen: 0.00678
            * (0.1 if rn == 1 else 1.0)
            * (0.1 if seen else 1.0),
        }
    ),
    "math2": MathProfile(
        {
            "id": "math2",
            "c1": 0.03633,
            "g": 1.15219,
            "stage_thresholds": [0.16308, 0.52254],
            "alpha_stages": [0.68339, 0.18043, 0.60533],
            "factors_below": {"existing": 0.26814, "new": 4.98947},
            "factors_above": {"existing": 0.44646, "new": 3.14095},
            "bomb_prob": lambda tc, rn, seen=False: (
                0.07940 * 0.089 if tc < 1.0 else 0.07940
            ),
            "bonus_prob": lambda rn, seen: 0.00616
            * (0.1 if rn <= 2 else 1.0)
            * (0.1 if seen else 1.0),
        }
    ),
    "math4": MathProfile(
        {
            "id": "math4",
            "c1": 0.02798,
            "g": 1.23261,
            "bonus_tile_coeff": 0.91015,
            "stage_thresholds": [0.17750, 0.49775, 1.550775],
            "alpha_stages": [0.70028, 0.18708, 0.73031, 0.10306],
            "factors_below": {"existing": 0.25013, "new": 4.32571},
            "factors_above": {"existing": 0.30802, "new": 2.86874},
            "bomb_prob": lambda tc, rn, seen=False: (
                (lambda p: (
                    p * (1.2 if rn == 4 else 1.0)
                    * (0.9 if rn == 5 else 1.0)
                    * (0.91 if rn == 6 else 1.0)
                    * (1.5 if seen else 1.0)
                ))(
                    0.09128 * 0.093 * (0.1 if rn == 1 else 1.0) * (7.0 if seen else 1.0)
                    if tc < 0.8
                    else 0.09128
                )
            ),
            "bonus_prob": lambda rn, seen: 0.00518
            * (0.1 if rn <= 2 else 1.0)
            * (0.1 if seen else 1.0),
        }
    ),
}


def apply_gravity(levels, spawn_mask=None):
    mask = spawn_mask or [False] * 9
    res = [0] * 9
    for col in range(3):
        col_tiles = []
        col_spawn = []
        for row in range(3):
            idx = row * 3 + col
            tile = levels[idx]
            if tile == TILE_BONUS:
                res[idx] = TILE_BONUS
            elif tile > 0 or tile == TILE_CRASH:
                col_tiles.append(tile)
                col_spawn.append(bool(mask[idx]))
        row = 2
        for i in range(len(col_tiles) - 1, -1, -1):
            while row >= 0 and res[row * 3 + col] == TILE_BONUS:
                row -= 1
            if row >= 0:
                place = row * 3 + col
                res[place] = col_tiles[i]
                row -= 1
    return res


def has_any_pair(levels):
    counts = {}
    for l in levels:
        if not l or l <= 0 or l in (TILE_BONUS, TILE_CRASH):
            continue
        counts[l] = counts.get(l, 0) + 1
        if counts[l] >= 2:
            return True
    return False


def is_grid_full_no_pairs(levels):
    return all(l != 0 for l in levels) and not has_any_pair(levels)


def find_pairs(levels):
    positions = {}
    for i, l in enumerate(levels):
        if l > 0 and l not in (TILE_BONUS, TILE_CRASH):
            positions.setdefault(l, []).append(i)
    pairs = []
    for lv in sorted(positions):
        arr = positions[lv]
        for j in range(0, len(arr) - 1, 2):
            pairs.append([arr[j], arr[j + 1]])
    return pairs


def merge_levels(levels, pairs):
    arr = levels[:]
    for anchor, mover in pairs:
        l = arr[anchor]
        if not l or arr[mover] != l:
            continue
        arr[anchor] = min(l + 1, MAX_LEVEL)
        arr[mover] = 0
    return arr


def process_merge_chain(levels, coeff_base, profile):
    grid = levels[:]
    while True:
        pairs = find_pairs(grid)
        if not pairs:
            return grid, coeff_base + profile.calc_round_coeff(grid)
        grid = merge_levels(grid, [pairs[0]])


def play_step(state, profile):
    stage = profile.get_current_stage(state["total_coeff"])
    levels = state["grid"][:]
    spawn_mask = [False] * 9
    bonus_seen = state["bonus_seen"]
    crash_spawned = False

    for i in range(9):
        if crash_spawned:
            continue
        if levels[i] == 0:
            tile = profile.pick_tile(
                stage, levels, bonus_seen, state["total_coeff"], state["round_index"]
            )
            if tile == TILE_BONUS:
                bonus_seen = True
            if tile == TILE_CRASH:
                crash_spawned = True
            levels[i] = tile
            spawn_mask[i] = True

    if TILE_CRASH in levels:
        return {"kind": "crash", "coeff": state["total_coeff"], "bonus_seen": bonus_seen}

    fallen = apply_gravity(levels, spawn_mask)
    grid, total_coeff = process_merge_chain(fallen, state["total_coeff"], profile)
    step = {
        "round": state["round_index"],
        "coeff": round(total_coeff, 2),
    }

    if is_grid_full_no_pairs(grid):
        return {
            "kind": "no_pairs",
            "grid": grid,
            "total_coeff": total_coeff,
            "step": step,
            "bonus_seen": bonus_seen,
            "win": state["session_bet"] * total_coeff,
        }

    return {
        "kind": "continue",
        "grid": grid,
        "total_coeff": total_coeff,
        "step": step,
        "bonus_seen": bonus_seen,
    }


def should_cashout(round_index, total_coeff):
    if total_coeff <= 0:
        return False
    return random.random() < min(0.85, 0.12 + round_index * 0.04)


class SessionStore:
    def __init__(self):
        self.history = []
        self.aggregates = {
            "totalSessions": 0,
            "totalWagered": 0.0,
            "totalWon": 0.0,
            "cashouts": 0,
            "noPairsEnd": 0,
            "crashes": 0,
            "sumCoeff": 0.0,
            "sumRounds": 0,
            "milestones": {},
        }
        self.wallet = {"balance": 1000.0, "baseBetAmount": 10}

    def record(self, record):
        agg = self.aggregates
        agg["totalSessions"] += 1
        agg["totalWagered"] += record["bet"]
        agg["totalWon"] += max(0.0, record["win"])
        agg["sumCoeff"] += max(0.0, record["finalCoeff"])
        rounds = len(record.get("stepCoeffs") or [])
        agg["sumRounds"] += rounds
        outcome = record["outcome"]
        if outcome == "crash":
            agg["crashes"] += 1
        elif outcome == "cashout":
            agg["cashouts"] += 1
        elif outcome == "no_pairs":
            agg["noPairsEnd"] += 1

        session = deepcopy(record)
        session["sessionNumber"] = agg["totalSessions"]
        session["endedAt"] = int(time.time() * 1000)
        self.history.insert(0, session)
        if len(self.history) > 200:
            self.history = self.history[:200]

    def to_local_storage(self):
        return {
            HISTORY_KEY: json.dumps(self.history, ensure_ascii=False),
            AGGREGATE_KEY: json.dumps(self.aggregates, ensure_ascii=False),
            WALLET_KEY: json.dumps(self.wallet, ensure_ascii=False),
        }


def simulate_session(balance, bet, profile_id, store):
    profile = PROFILES[profile_id]
    balance_before = balance
    balance -= bet
    step_coeffs = []

    state = {
        "grid": [0] * 9,
        "total_coeff": 0.0,
        "round_index": 0,
        "session_bet": bet,
        "bonus_seen": False,
    }

    outcome = "unknown"
    win = 0.0
    final_coeff = 0.0

    while True:
        state["round_index"] += 1
        result = play_step(state, profile)

        if result["kind"] == "crash":
            outcome = "crash"
            final_coeff = result["coeff"]
            step_coeffs.append(
                {
                    "round": state["round_index"],
                    "coeff": round(result["coeff"], 2),
                    "crash": True,
                }
            )
            break

        step_coeffs.append(result["step"])
        state["grid"] = result["grid"]
        state["total_coeff"] = result["total_coeff"]
        state["bonus_seen"] = result["bonus_seen"]

        if result["kind"] == "no_pairs":
            outcome = "no_pairs"
            win = result["win"]
            final_coeff = result["total_coeff"]
            balance += win
            break

        if should_cashout(state["round_index"], state["total_coeff"]) or state["round_index"] >= 40:
            outcome = "cashout"
            final_coeff = state["total_coeff"]
            win = state["session_bet"] * state["total_coeff"]
            balance += win
            break

    store.record(
        {
            "balanceBefore": balance_before,
            "balanceEnd": balance,
            "bet": bet,
            "win": win,
            "finalCoeff": final_coeff,
            "outcome": outcome,
            "profile": profile_id,
            "stepCoeffs": step_coeffs,
        }
    )
    store.wallet = {"balance": balance, "baseBetAmount": bet}
    return outcome, win, final_coeff, balance


def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    bet = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    store = SessionStore()
    balance = 1000.0
    outcomes = {"cashout": 0, "crash": 0, "no_pairs": 0}

    for _ in range(count):
        if balance < bet:
            balance = 1000.0
        profile_id = random.choice(["math2", "math3", "math4"])
        outcome, win, coeff, balance = simulate_session(balance, bet, profile_id, store)
        outcomes[outcome] = outcomes.get(outcome, 0) + 1

    agg = store.aggregates
    out_file = "scripts/simulated-localStorage.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(store.to_local_storage(), f, ensure_ascii=False, indent=2)

    print(f"=== Симуляция: {count} сессий ===")
    print(f"Ставка: ${bet}")
    print(f"Итоговый баланс: ${balance:.2f}")
    print(
        f"Кэшаут: {outcomes['cashout']} | Бомба: {outcomes['crash']} | Нет пар: {outcomes['no_pairs']}"
    )
    print(f"Средний x: x{agg['sumCoeff'] / agg['totalSessions']:.2f}")
    print(f"Средний шаг: {agg['sumRounds'] / agg['totalSessions']:.1f}")
    print(f"Итог: ${agg['totalWon'] - agg['totalWagered']:.2f}")
    print()
    print(f"Данные: {out_file}")
    print()
    print("Вставить в браузер (консоль на странице игры):")
    print(
        "fetch('scripts/simulated-localStorage.json').then(r=>r.json()).then(d=>{"
        "Object.entries(d).forEach(([k,v])=>localStorage.setItem(k,v)); location.reload();})"
    )


if __name__ == "__main__":
    main()
