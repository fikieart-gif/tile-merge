#!/usr/bin/env python3
"""Стратегия Паши, Math4 — bulk-симуляция (логика index.html)."""
import math
import random
import time

MAX_LEVEL = 12
MIN_BET = 1
TILE_CRASH = -1
TILE_BONUS = -2
BONUS_TILE_COEFF = 0.91015

PASHA_DEFAULT_BET = 50
PASHA_RECOVERY_BET = 250
PASHA_WIN_RESET = 250
PASHA_CASHOUT_COEFF = 2
MAX_ROUNDS = 120
REFILL_BALANCE = 1000.0
START_BALANCE = 1000.0


def build_coeff_by_level(c1, g):
    return {lvl: c1 * (g ** (lvl - 1)) for lvl in range(1, MAX_LEVEL + 1)}


def get_base_probs(alpha):
    raw = [math.exp(-alpha * (lvl - 1)) for lvl in range(1, 11)]
    total = sum(raw)
    return [r / total for r in raw]


class Math4Profile:
    def __init__(self):
        self.coeff_by_level = build_coeff_by_level(0.02798, 1.23261)
        self.stage_thresholds = [0.17750, 0.49775, 1.550775]
        self.alpha_stages = [0.70028, 0.18708, 0.73031, 0.10306]
        self.factors_below = {"existing": 0.25013, "new": 4.32571}
        self.factors_above = {"existing": 0.30802, "new": 2.86874}

    def get_current_stage(self, total_coeff):
        for i, th in enumerate(self.stage_thresholds):
            if total_coeff < th:
                return i + 1
        return len(self.stage_thresholds) + 1

    def bomb_prob(self, total_coeff, round_num, bonus_seen):
        bomb_p = 0.09128
        if total_coeff < 0.8:
            prob = bomb_p * 0.093
            if round_num == 1:
                prob *= 0.1
            if bonus_seen:
                prob *= 7.0
        else:
            prob = bomb_p
        if round_num == 4:
            prob *= 1.2
        if round_num == 5:
            prob *= 0.9
        if round_num == 6:
            prob *= 0.91
        if bonus_seen:
            prob *= 1.5
        return prob

    def bonus_prob(self, round_num, bonus_seen):
        prob = 0.00518
        if round_num <= 2:
            prob *= 0.1
        if bonus_seen:
            prob *= 0.1
        return prob

    def pick_tile(self, stage, levels, bonus_seen, total_coeff, round_num, rng=None):
        rnd = rng if rng is not None else random
        bonus_p = self.bonus_prob(round_num, bonus_seen)
        bomb_p = self.bomb_prob(total_coeff, round_num, bonus_seen)
        r = rnd.random()
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
        r_lvl = rnd.random()
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
                total += BONUS_TILE_COEFF
            else:
                total += self.coeff_by_level.get(l, 0.0)
        return total


PROFILE = Math4Profile()


def apply_gravity(levels, spawn_mask):
    res = [0] * 9
    for col in range(3):
        col_tiles = []
        for row in range(3):
            idx = row * 3 + col
            tile = levels[idx]
            if tile == TILE_BONUS:
                res[idx] = TILE_BONUS
            elif tile > 0 or tile == TILE_CRASH:
                col_tiles.append(tile)
        row = 2
        for i in range(len(col_tiles) - 1, -1, -1):
            while row >= 0 and res[row * 3 + col] == TILE_BONUS:
                row -= 1
            if row >= 0:
                res[row * 3 + col] = col_tiles[i]
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


def process_merge_chain(levels, coeff_base):
    grid = levels[:]
    while True:
        pairs = find_pairs(grid)
        if not pairs:
            return grid, coeff_base + PROFILE.calc_round_coeff(grid)
        grid = merge_levels(grid, [pairs[0]])


def play_step(state, rng=None):
    rnd = rng if rng is not None else random
    stage = PROFILE.get_current_stage(state["total_coeff"])
    levels = state["grid"][:]
    spawn_mask = [False] * 9
    bonus_seen = state["bonus_seen"]
    crash_spawned = False

    for i in range(9):
        if crash_spawned:
            continue
        if levels[i] == 0:
            tile = PROFILE.pick_tile(
                stage,
                levels,
                bonus_seen,
                state["total_coeff"],
                state["round_index"],
                rng=rng,
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
    grid, total_coeff = process_merge_chain(fallen, state["total_coeff"])
    step = {"round": state["round_index"], "coeff": round(total_coeff, 2)}

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


def simulate_one_session(start_balance, bet, play_mode, cashout_coeff_min=2, rng=None):
    rnd = rng if rng is not None else random
    balance_before = start_balance
    session_balance = start_balance - bet
    rounds = 0

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
        result = play_step(state, rng=rng)
        rounds += 1

        if result["kind"] == "crash":
            outcome = "crash"
            final_coeff = result["coeff"]
            break

        state["grid"] = result["grid"]
        state["total_coeff"] = result["total_coeff"]
        state["bonus_seen"] = result["bonus_seen"]

        if result["kind"] == "no_pairs":
            outcome = "no_pairs"
            win = result["win"]
            final_coeff = result["total_coeff"]
            session_balance += win
            break

        if play_mode == "until_coeff_2" and state["total_coeff"] >= cashout_coeff_min:
            outcome = "cashout"
            final_coeff = state["total_coeff"]
            win = state["session_bet"] * state["total_coeff"]
            session_balance += win
            break

        if (
            play_mode == "until_coeff_2"
            and state["round_index"] >= MAX_ROUNDS
            and state["total_coeff"] > 0
        ):
            outcome = "cashout"
            final_coeff = state["total_coeff"]
            win = state["session_bet"] * state["total_coeff"]
            session_balance += win
            break

    return {
        "balance_before": balance_before,
        "balance_end": session_balance,
        "bet": bet,
        "win": win,
        "final_coeff": final_coeff,
        "outcome": outcome,
        "rounds": rounds,
    }


def run_pasha(count, seed=42):
    random.seed(seed)
    sim_balance = START_BALANCE
    first_balance_before = None
    strategy_bet = PASHA_DEFAULT_BET
    play_mode = "until_end"

    outcomes = {"cashout": 0, "crash": 0, "no_pairs": 0}
    total_wagered = 0.0
    total_won = 0.0
    sum_coeff = 0.0
    sum_rounds = 0
    refills = 0
    bet_50 = 0
    bet_250 = 0

    t0 = time.time()
    for i in range(count):
        if sim_balance < MIN_BET:
            sim_balance = REFILL_BALANCE
            refills += 1

        bet = min(strategy_bet, max(MIN_BET, math.floor(sim_balance)))
        if bet == PASHA_DEFAULT_BET:
            bet_50 += 1
        elif bet == PASHA_RECOVERY_BET:
            bet_250 += 1

        result = simulate_one_session(
            sim_balance, bet, play_mode, PASHA_CASHOUT_COEFF
        )
        if first_balance_before is None:
            first_balance_before = result["balance_before"]

        sim_balance = result["balance_end"]
        outcomes[result["outcome"]] = outcomes.get(result["outcome"], 0) + 1
        total_wagered += result["bet"]
        total_won += max(0.0, result["win"])
        sum_coeff += max(0.0, result["final_coeff"])
        sum_rounds += result["rounds"]

        if result["outcome"] == "crash":
            strategy_bet = PASHA_RECOVERY_BET
            play_mode = "until_coeff_2"
        elif result["win"] >= PASHA_WIN_RESET:
            strategy_bet = PASHA_DEFAULT_BET
            play_mode = "until_end"

        if (i + 1) % 20000 == 0:
            elapsed = time.time() - t0
            print(f"  ... {i + 1}/{count} ({elapsed:.1f}s)", flush=True)

    elapsed = time.time() - t0
    net_balance = sim_balance - first_balance_before

    return {
        "count": count,
        "elapsed_sec": elapsed,
        "start_balance": first_balance_before,
        "final_balance": sim_balance,
        "net_balance": net_balance,
        "refills": refills,
        "outcomes": outcomes,
        "total_wagered": total_wagered,
        "total_won": total_won,
        "avg_coeff": sum_coeff / count,
        "avg_rounds": sum_rounds / count,
        "avg_bet": total_wagered / count,
        "rtp": total_won / total_wagered if total_wagered else 0,
        "bet_50_sessions": bet_50,
        "bet_250_sessions": bet_250,
    }


def main():
    count = 100_000
    print(f"Стратегия Паши · Math4 · {count:,} сессий · старт ${START_BALANCE:.0f}")
    print("Правила: $50 до упора → после бомбы $250 до x2 → win≥$250 сброс на $50")
    print()

    stats = run_pasha(count)

    o = stats["outcomes"]
    print("=== Результат ===")
    print(f"Сессий:           {stats['count']:,}")
    print(f"Время:            {stats['elapsed_sec']:.1f} с")
    print(f"Старт:            ${stats['start_balance']:.2f}")
    print(f"Финал:            ${stats['final_balance']:.2f}")
    print(f"Итог (баланс):    ${stats['net_balance']:+.2f}")
    print(f"Пополнений $1000: {stats['refills']:,}")
    print()
    print(f"Кэшаут:           {o.get('cashout', 0):,} ({100 * o.get('cashout', 0) / count:.1f}%)")
    print(f"Бомба:            {o.get('crash', 0):,} ({100 * o.get('crash', 0) / count:.1f}%)")
    print(f"Нет пар:          {o.get('no_pairs', 0):,} ({100 * o.get('no_pairs', 0) / count:.1f}%)")
    print()
    print(f"Средний x:        x{stats['avg_coeff']:.2f}")
    print(f"Средний шаг:      {stats['avg_rounds']:.1f}")
    print(f"Средняя ставка:   ${stats['avg_bet']:.2f}")
    print(f"Сессий $50:       {stats['bet_50_sessions']:,}")
    print(f"Сессий $250:      {stats['bet_250_sessions']:,}")
    print()
    print(f"Сумма ставок:     ${stats['total_wagered']:,.2f}")
    print(f"Сумма выигрышей:  ${stats['total_won']:,.2f}")
    print(f"RTP (win/wager):  {100 * stats['rtp']:.2f}%")
    print(f"Итог (win-wager): ${stats['total_won'] - stats['total_wagered']:+,.2f}")


if __name__ == "__main__":
    main()
