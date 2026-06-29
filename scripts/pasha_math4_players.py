#!/usr/bin/env python3
"""100 000 игроков × 50 игр — стратегия Паши, Math4."""
import math
import random
import statistics
import time

from pasha_math4_100k import (
    MIN_BET,
    PASHA_CASHOUT_COEFF,
    PASHA_DEFAULT_BET,
    PASHA_RECOVERY_BET,
    PASHA_WIN_RESET,
    REFILL_BALANCE,
    START_BALANCE,
    simulate_one_session,
)

PLAYERS = 100_000
SESSIONS_PER_PLAYER = 50


def run_pasha_for_player(rng, sessions=SESSIONS_PER_PLAYER, allow_refill=True):
    sim_balance = START_BALANCE
    strategy_bet = PASHA_DEFAULT_BET
    play_mode = "until_end"
    refills = 0
    outcomes = {"cashout": 0, "crash": 0, "no_pairs": 0}
    total_wagered = 0.0
    total_won = 0.0
    games_played = 0

    for _ in range(sessions):
        if sim_balance < MIN_BET:
            if allow_refill:
                sim_balance = REFILL_BALANCE
                refills += 1
            else:
                break

        bet = min(strategy_bet, max(MIN_BET, math.floor(sim_balance)))
        result = simulate_one_session(
            sim_balance, bet, play_mode, PASHA_CASHOUT_COEFF, rng=rng
        )
        games_played += 1
        sim_balance = result["balance_end"]
        outcomes[result["outcome"]] = outcomes.get(result["outcome"], 0) + 1
        total_wagered += result["bet"]
        total_won += max(0.0, result["win"])

        if result["outcome"] == "crash":
            strategy_bet = PASHA_RECOVERY_BET
            play_mode = "until_coeff_2"
        elif result["win"] >= PASHA_WIN_RESET:
            strategy_bet = PASHA_DEFAULT_BET
            play_mode = "until_end"

    return {
        "final_balance": sim_balance,
        "net": sim_balance - START_BALANCE,
        "refills": refills,
        "games_played": games_played,
        "busted": games_played < sessions and sim_balance < MIN_BET,
        "outcomes": outcomes,
        "total_wagered": total_wagered,
        "total_won": total_won,
    }


def percentile(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def main():
    import sys

    allow_refill = "--no-refill" not in sys.argv
    total_sessions = PLAYERS * SESSIONS_PER_PLAYER
    mode_label = "с пополнениями" if allow_refill else "без пополнений (банкрот = выбыл)"
    print(
        f"Стратегия Паши · Math4 · {PLAYERS:,} игроков × до {SESSIONS_PER_PLAYER} игр "
        f"({mode_label})"
    )
    print(f"Старт каждого игрока: ${START_BALANCE:.0f}")
    print()

    finals = []
    nets = []
    refills_total = 0
    games_played_total = 0
    busted_players = 0
    outcomes = {"cashout": 0, "crash": 0, "no_pairs": 0}
    total_wagered = 0.0
    total_won = 0.0
    profitable = 0
    broke_end = 0
    doubled = 0
    lost_half = 0

    t0 = time.time()
    for player in range(PLAYERS):
        rng = random.Random(player + 1_000_003)
        stats = run_pasha_for_player(rng, allow_refill=allow_refill)

        finals.append(stats["final_balance"])
        nets.append(stats["net"])
        refills_total += stats["refills"]
        games_played_total += stats["games_played"]
        if stats["busted"]:
            busted_players += 1
        total_wagered += stats["total_wagered"]
        total_won += stats["total_won"]
        for k, v in stats["outcomes"].items():
            outcomes[k] = outcomes.get(k, 0) + v

        if stats["net"] > 0:
            profitable += 1
        if stats["final_balance"] < MIN_BET:
            broke_end += 1
        if stats["final_balance"] >= START_BALANCE * 2:
            doubled += 1
        if stats["final_balance"] <= START_BALANCE * 0.5:
            lost_half += 1

        if (player + 1) % 20000 == 0:
            elapsed = time.time() - t0
            print(f"  ... {player + 1:,}/{PLAYERS:,} игроков ({elapsed:.1f}s)", flush=True)

    elapsed = time.time() - t0
    finals.sort()
    nets.sort()
    total_starting = PLAYERS * START_BALANCE
    total_final = sum(finals)
    house_profit = total_wagered - total_won
    player_net_wallets = total_final - total_starting

    print()
    print("=== Когорта игроков ===")
    print(f"Игроков:              {PLAYERS:,}")
    print(f"Лимит игр на игрока:   {SESSIONS_PER_PLAYER}")
    print(f"Фактически сыграно:    {games_played_total:,} сессий")
    print(f"Среднее игр/игрок:     {games_played_total / PLAYERS:.1f}")
    print(f"Выбыли (банкрот):      {busted_players:,} ({100 * busted_players / PLAYERS:.1f}%)")
    print(f"Время:                 {elapsed:.1f} с")
    print()
    print("=== Деньги ===")
    print(f"Игроки внесли (старт): ${total_starting:,.2f}")
    print(f"Балансы в конце:       ${total_final:,.2f}")
    print(f"Игроки выиграли (нет): ${player_net_wallets:+,.2f}")
    print(f"Игра выиграла (нет):   ${-player_net_wallets:+,.2f}")
    print()
    print(f"Сумма ставок:          ${total_wagered:,.2f}")
    print(f"Сумма выплат:          ${total_won:,.2f}")
    print(f"Игра заработала (GGR): ${house_profit:+,.2f}")
    print(f"Игроки потеряли (GGR): ${-house_profit:+,.2f}")
    print(f"RTP:                   {100 * total_won / total_wagered:.2f}%")
    if allow_refill:
        print(f"Пополнений:            {refills_total:,}")
    print()
    print("=== Баланс после игр ===")
    print(f"Средний:               ${statistics.mean(finals):,.2f}")
    print(f"Медиана:               ${statistics.median(finals):,.2f}")
    print(f"Мин / Макс:            ${finals[0]:,.2f} / ${finals[-1]:,.2f}")
    print(f"P10 / P25 / P75 / P90: ${percentile(finals, 10):,.2f} / ${percentile(finals, 25):,.2f} / "
          f"${percentile(finals, 75):,.2f} / ${percentile(finals, 90):,.2f}")
    print()
    print(f"В плюсе:               {profitable:,} ({100 * profitable / PLAYERS:.1f}%)")
    print(f"Удвоили (≥$2000):      {doubled:,} ({100 * doubled / PLAYERS:.1f}%)")
    print(f"Потеряли ≥50%:         {lost_half:,} ({100 * lost_half / PLAYERS:.1f}%)")
    print(f"Банкрот в конце:       {broke_end:,} ({100 * broke_end / PLAYERS:.1f}%)")
    print()
    print("=== Исходы сессий ===")
    ts = games_played_total
    print(f"Кэшаут:                {outcomes.get('cashout', 0):,} ({100 * outcomes.get('cashout', 0) / ts:.1f}%)")
    print(f"Бомба:                 {outcomes.get('crash', 0):,} ({100 * outcomes.get('crash', 0) / ts:.1f}%)")
    print(f"Нет пар:               {outcomes.get('no_pairs', 0):,} ({100 * outcomes.get('no_pairs', 0) / ts:.1f}%)")


if __name__ == "__main__":
    main()
