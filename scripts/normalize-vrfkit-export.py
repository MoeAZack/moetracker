#!/usr/bin/env python3
"""Normalize a pinned vrfkit export into MoeTracker review-only evidence.

This intentionally ignores profile/crosshair names. VALORANT's ProfileName field is
not a player name, so replay identities are private, replay-scoped pseudonyms.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from bisect import bisect_right
from collections import Counter, defaultdict
from pathlib import Path

try:
    import pyarrow.parquet as pq
except ImportError as exc:  # pragma: no cover - exercised by deployment preflight
    raise SystemExit("pyarrow is required for vrfkit normalization") from exc

ROUND_FIELD = re.compile(r"^RoundResults\[(\d+)]\.(RoundNumber|WinningTeam|WinningTeamRole|RoundResult)$")
RELEVANT = {
    "AssignedTeamState", "AggregateKills", "AggregateDeaths", "AggregateAssists",
    "BombPlantedRPC.BombPlanter", "BombDefusedRPC.DefusingCharacter", "Wins",
}
MAP_NAMES = {"/Game/Maps/Triad/Triad": "Haven"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def packed_ref(raw: bytes | None, width: int | None) -> int | None:
    if raw is None or not isinstance(width, int) or width <= 0 or len(raw) != (width + 7) // 8:
        return None
    value = 0
    consumed = 0
    for index, byte in enumerate(raw[:5]):
        consumed += 8
        value |= (byte >> 1) << (7 * index)
        if not byte & 1:
            return value if consumed >= width else None
    return None


def little_i32(raw: bytes | None) -> int | None:
    return int.from_bytes(raw, "little", signed=True) if raw is not None and len(raw) == 4 else None


def value(status: bool, item, source: str, confidence: float = 1.0):
    return {"value": item if status else None, "status": "available" if status else "unavailable",
            "source": source, "confidence": confidence if status else None}


def safe_map_name(asset: str | None):
    return MAP_NAMES.get(asset or "")


def pseudonym(replay_sha: str, subject: str) -> str:
    return "player-" + hashlib.sha256(f"{replay_sha}\0{subject}".encode()).hexdigest()[:16]


def accepted_side_pair(winner: str, loser: str, winning_role: str):
    winner_side = "attack" if winning_role == "attacker" else "defense"
    return {winner: winner_side, loser: "defense" if winner_side == "attack" else "attack"}


def trusted_manifest_roster_is_complete(quality_complete, mapping_valid, subjects, participant_records,
                                        valid_players, identities, player_actors, actor_team_ref, replay_sha):
    return (
        quality_complete and mapping_valid and len(subjects) == len(valid_players)
        and len(participant_records) >= len(subjects) >= 2
        and all(pseudonym(replay_sha, subject) in valid_players for subject in subjects)
        and len({item["teamId"] for item in identities}) == 2
        and all(len({actor_team_ref.get(actor) for actor in player_actors[player_id] if actor in actor_team_ref}) == 1
                for player_id in valid_players)
    )


def read_relevant_fields(export: Path):
    columns = ["time_ms", "packet_id", "actor_net_guid", "field_name", "bit_count", "raw_bits", "value_i64", "value_str"]
    rows = []
    for batch in pq.ParquetFile(export / "fields.parquet").iter_batches(batch_size=65536, columns=columns):
        for row in batch.to_pylist():
            name = row["field_name"]
            if name in RELEVANT or (isinstance(name, str) and ROUND_FIELD.match(name)):
                rows.append(row)
    return rows


def targeted_quality_complete(manifest: dict) -> bool:
    quality = manifest.get("quality") or {}
    net = quality.get("net") or {}
    sink = quality.get("sink") or {}
    required_zero = [
        quality.get("content_blocks_lost"), quality.get("event_layout_mismatches"),
        quality.get("event_trailing_bytes"), quality.get("replay_data_trailing_bytes"),
        net.get("malformed_packets"), net.get("content_block_framing_failures"),
        net.get("malformed_content_blocks"), net.get("transform_failures"), net.get("field_stream_failures"),
        sink.get("struct_blobs_failed"), sink.get("overlay_decoded_err"), sink.get("array_leaf_decode_errors"),
        sink.get("array_truncations"), sink.get("array_errors"), sink.get("truncated_rpcs"),
    ]
    return all(item == 0 for item in required_zero)


def build(args):
    export = Path(args.export).resolve()
    manifest_path = export / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    quality_complete = targeted_quality_complete(manifest)
    fields = read_relevant_fields(export)
    events = pq.read_table(export / "events.parquet", columns=["id", "group", "time1", "word0", "word1"]).to_pylist()

    # A subject may reconnect and receive a new PlayerState. Only entries with an
    # observed character are participants; duplicate subjects collapse to one identity.
    actor_to_player = {}
    pawn_to_player = {}
    player_actors = defaultdict(list)
    manifest_players = manifest.get("players") or []
    participant_records = [item for item in manifest_players if isinstance(item.get("character_net_guid"), int)]
    manifest_subjects = set()
    manifest_mapping_valid = True
    for item in manifest_players:
        actor = item.get("actor_net_guid")
        pawn = item.get("character_net_guid")
        subject = item.get("subject")
        if not isinstance(pawn, int):
            continue
        if not isinstance(actor, int) or not isinstance(subject, str) or not subject:
            manifest_mapping_valid = False
            continue
        manifest_subjects.add(subject)
        player_id = pseudonym(args.replay_sha256, subject)
        actor_to_player[actor] = player_id
        pawn_to_player[pawn] = player_id
        player_actors[player_id].append(actor)

    # Team refs are packed ObjectNetGuids. Connect replay color names to those refs
    # through elimination rounds: the final victim's team is the loser and the
    # other complete team is the RoundResults winner. This avoids guessing enum IDs
    # or assuming the BaseTeamState actor uses the same reference as assignment.
    actor_team_ref = {}
    for row in fields:
        if row["field_name"] == "AssignedTeamState" and row["actor_net_guid"] in actor_to_player:
            ref = packed_ref(row["raw_bits"], row["bit_count"])
            if ref is not None:
                actor_team_ref[row["actor_net_guid"]] = ref

    round_parts = defaultdict(dict)
    for row in fields:
        matched = ROUND_FIELD.match(str(row["field_name"]))
        if matched:
            index, field = int(matched.group(1)), matched.group(2)
            round_parts[index][field] = row["value_i64"] if field == "RoundNumber" else row["value_str"]
    round_results = [round_parts[index] for index in sorted(round_parts)
                     if {"RoundNumber", "WinningTeam", "WinningTeamRole", "RoundResult"} <= round_parts[index].keys()]
    team_refs = sorted(set(actor_team_ref.values()))
    player_team_ref = {actor_to_player[actor]: ref for actor, ref in actor_team_ref.items() if actor in actor_to_player}
    starts = sorted((row["time1"], int(row["word0"]) + 1) for row in events
                    if row["group"] == "roundStarted" and isinstance(row["time1"], int) and isinstance(row["word0"], int))
    start_times = [item[0] for item in starts]
    round_by_time = lambda time: starts[bisect_right(start_times, time) - 1][1] if starts and time >= starts[0][0] else None
    death_rows = [row for row in events if row["group"] == "characterDeath"]
    color_votes = defaultdict(Counter)
    if len(team_refs) == 2:
        by_round = defaultdict(list)
        for row in death_rows:
            if isinstance(row.get("time1"), int) and row.get("word1") in pawn_to_player:
                by_round[round_by_time(row["time1"])].append(row)
        for item in round_results:
            round_number = int(item["RoundNumber"]) + 1 if isinstance(item.get("RoundNumber"), int) else None
            if item.get("RoundResult") != "elimination" or item.get("WinningTeam") not in ("Red", "Blue") or not by_round.get(round_number):
                continue
            victim = pawn_to_player[sorted(by_round[round_number], key=lambda row: (row["time1"], row["id"]))[-1]["word1"]]
            losing_ref = player_team_ref.get(victim)
            if losing_ref in team_refs:
                winning_ref = next(ref for ref in team_refs if ref != losing_ref)
                color_votes[item["WinningTeam"].lower()][winning_ref] += 1
    ref_to_team = {}
    red = color_votes["red"].most_common()
    blue = color_votes["blue"].most_common()
    if red and blue and red[0][0] != blue[0][0] and (len(red) == 1 or red[0][1] > red[1][1]) and (len(blue) == 1 or blue[0][1] > blue[1][1]):
        ref_to_team[red[0][0]] = "team-red"
        ref_to_team[blue[0][0]] = "team-blue"
    else:
        ref_to_team = {ref: f"team-{index + 1}" for index, ref in enumerate(team_refs)}
    player_team = {}
    for actor, player_id in actor_to_player.items():
        ref = actor_team_ref.get(actor)
        if ref in ref_to_team:
            player_team[player_id] = ref_to_team[ref]

    identities = [{"playerId": player_id, "teamId": player_team[player_id]}
                  for player_id in sorted(player_actors) if player_id in player_team]
    valid_players = {item["playerId"] for item in identities}
    # Roster completeness is sourced independently from manifest.players, not inferred
    # from whichever actors happen to appear in the elimination stream. Any missing,
    # ambiguous, or conflicting manifest mapping suppresses life-state derivations.
    manifest_roster_complete = trusted_manifest_roster_is_complete(
        quality_complete, manifest_mapping_valid, manifest_subjects, participant_records,
        valid_players, identities, player_actors, actor_team_ref, args.replay_sha256)
    pawn_to_player = {pawn: player for pawn, player in pawn_to_player.items() if player in valid_players}
    actor_to_player = {actor: player for actor, player in actor_to_player.items() if player in valid_players}

    # Final scoreboard counters are monotonically replicated aggregates. Absence is
    # unavailable, never zero. The latest packet wins for each player/counter.
    stat_names = {"AggregateKills": "kills", "AggregateDeaths": "deaths", "AggregateAssists": "assists"}
    latest = {}
    for row in fields:
        metric = stat_names.get(row["field_name"])
        player_id = actor_to_player.get(row["actor_net_guid"])
        if metric and player_id and isinstance(row["value_i64"], int) and row["value_i64"] >= 0:
            key = (player_id, metric)
            prior = latest.get(key)
            if prior is None or (row["time_ms"], row["packet_id"]) > prior[:2]:
                latest[key] = (row["time_ms"], row["packet_id"], row["value_i64"])

    eliminations = defaultdict(list)
    elimination_complete = quality_complete and bool(starts) and all(
        isinstance(row["time1"], int) and row.get("word0") in pawn_to_player and row.get("word1") in pawn_to_player
        and round_by_time(row["time1"]) is not None for row in death_rows)
    if elimination_complete:
        for sequence, row in enumerate(sorted(death_rows, key=lambda item: (item["time1"], item["id"]))):
            killer = pawn_to_player[row["word0"]]
            victim = pawn_to_player[row["word1"]]
            if killer == victim or player_team.get(killer) == player_team.get(victim):
                elimination_complete = False
                break
            round_number = round_by_time(row["time1"])
            eliminations[round_number].append({
                "eventId": hashlib.sha256(str(row["id"]).encode()).hexdigest()[:24],
                "roundNumber": round_number, "sequence": sequence, "timestampMs": row["time1"],
                "kind": "player-elimination", "killerPlayerId": killer, "victimPlayerId": victim,
                "killerTeamId": player_team[killer], "victimTeamId": player_team[victim], "identityStatus": "resolved",
            })
    if not elimination_complete:
        eliminations.clear()

    result_by_round = {int(item["RoundNumber"]) + 1: item for item in round_results if isinstance(item.get("RoundNumber"), int)}
    winners_complete = quality_complete and len(result_by_round) == len(starts) and all(
        item.get("WinningTeam") in ("Red", "Blue") and item.get("WinningTeamRole") in ("attacker", "defender")
        for item in result_by_round.values())
    rounds = []
    participants = sorted(valid_players)
    for _, round_number in starts:
        result = result_by_round.get(round_number)
        winner_team = f"team-{result['WinningTeam'].lower()}" if winners_complete else None
        role = result.get("WinningTeamRole") if winners_complete else None
        side = None
        if winner_team and set(player_team.values()) == {"team-red", "team-blue"}:
            loser = "team-blue" if winner_team == "team-red" else "team-red"
            side = accepted_side_pair(winner_team, loser, role)
        rounds.append({
            "roundNumber": round_number, "sequenceCompleteFromStart": elimination_complete,
            "events": eliminations.get(round_number, []), "participantPlayerIds": participants,
            "participantCoverage": {
                "status": "complete" if manifest_roster_complete else "partial",
                "expectedPlayerCount": len(manifest_subjects) if manifest_subjects else None,
                "source": "manifest.players trusted subject/actor/character mapping",
                "expectedPlayerIdsSha256": hashlib.sha256("\0".join(sorted(valid_players)).encode()).hexdigest()
                if manifest_roster_complete else None,
            },
            "winnerTeamId": winner_team, "endReason": result.get("RoundResult") if winners_complete else None,
            **({"sideByTeam": side} if side else {}),
        })

    objective_fields = {
        "BombPlantedRPC.BombPlanter": ("plant", "spikePlanted"),
        "BombDefusedRPC.DefusingCharacter": ("defuse", "spikeDefused"),
    }
    objective_rows = {signal: [] for signal, _ in objective_fields.values()}
    observations = []
    objective_complete = {}
    for field_name, (signal, event_group) in objective_fields.items():
        source_rows = [row for row in fields if row["field_name"] == field_name]
        authoritative = [row for row in events if row["group"] == event_group]
        complete = quality_complete and len(source_rows) == len(authoritative) and all(
            row.get("value_i64") in pawn_to_player and round_by_time(row["time_ms"]) is not None for row in source_rows)
        objective_complete[signal] = complete
        if complete:
            for row in source_rows:
                player_id = pawn_to_player[row["value_i64"]]
                round_number = round_by_time(row["time_ms"])
                objective_rows[signal].append(player_id)
                observations.append({
                    "observationId": hashlib.sha256(f"{signal}:{row['time_ms']}:{row['packet_id']}:{player_id}".encode()).hexdigest()[:24],
                    "roundNumber": round_number, "signal": signal, "grade": "event-log", "explicitlyPresent": True,
                    "confidence": 1.0, "occurredAtMs": row["time_ms"], "playerId": player_id,
                    "teamId": player_team[player_id], "attributes": {"sourceField": field_name},
                })

    capabilities = []
    capabilities.append({"signal": "eliminations", "support": "complete" if elimination_complete else "unsupported",
                         "grade": "event-log", "details": "characterDeath events with exact replay identity joins"})
    capabilities.append({"signal": "round-winner", "support": "complete" if winners_complete else "unsupported",
                         "grade": "event-log", "details": "RoundResults typed child rows"})
    capabilities.append({"signal": "side", "support": "complete" if winners_complete else "unsupported",
                         "grade": "event-log", "details": "RoundResults winning role plus opposing side"})
    for signal in ("plant", "defuse"):
        capabilities.append({"signal": signal, "support": "complete" if objective_complete[signal] else "unsupported",
                             "grade": "event-log", "details": "authoritative objective event count cross-checked to typed RPC actor"})

    score_counts = Counter(item["WinningTeam"] for item in round_results if item.get("WinningTeam") in ("Red", "Blue"))
    score_available = winners_complete and sum(score_counts.values()) == len(starts)
    first_bloods = Counter()
    first_deaths = Counter()
    if elimination_complete:
        for round_number in sorted(eliminations):
            if eliminations[round_number]:
                first = min(eliminations[round_number], key=lambda item: (item["timestampMs"], item["eventId"]))
                first_bloods[first["killerPlayerId"]] += 1
                first_deaths[first["victimPlayerId"]] += 1

    players = []
    unavailable = set()
    for identity in identities:
        player_id = identity["playerId"]
        row = {"playerId": player_id,
               "displayName": value(False, None, "unavailable: replay does not expose a verified player display name"),
               "teamId": identity["teamId"]}
        unavailable.add("players.displayName")
        for metric in ("kills", "deaths", "assists"):
            record = latest.get((player_id, metric))
            row[metric] = value(record is not None, record[2] if record else None, f"fields.parquet BasicCombatStatsComponent.{metric}")
            if record is None:
                unavailable.add(f"players.{metric}")
        row["firstBloods"] = value(elimination_complete, first_bloods[player_id], "events.parquet first valid characterDeath per round")
        row["firstDeaths"] = value(elimination_complete, first_deaths[player_id], "events.parquet first valid characterDeath per round")
        row["plants"] = value(objective_complete["plant"], Counter(objective_rows["plant"])[player_id], "BombPlantedRPC.BombPlanter")
        row["defuses"] = value(objective_complete["defuse"], Counter(objective_rows["defuse"])[player_id], "BombDefusedRPC.DefusingCharacter")
        for metric in ("firstBloods", "firstDeaths", "plants", "defuses"):
            if row[metric]["status"] == "unavailable":
                unavailable.add(f"players.{metric}")
        players.append(row)

    summary_players = []
    for player in players:
        if player["kills"]["status"] == player["deaths"]["status"] == "available":
            summary_players.append({"playerId": player["playerId"], "kills": player["kills"]["value"], "deaths": player["deaths"]["value"]})
    asset_path = next((item.get("name") for item in manifest.get("level_names_and_times") or [] if item.get("time_ms") == 0), None)
    map_name = safe_map_name(asset_path)
    if not map_name:
        unavailable.add("map.friendlyName")
    summary = {"map": map_name or asset_path, "roundCount": len(rounds), "players": summary_players}
    if score_available:
        summary["finalScore"] = {"teamA": score_counts["Red"], "teamB": score_counts["Blue"]}

    parser_input = {
        "parser": {"name": "vrfkit", "version": args.binary_version},
        "provenance": {"replaySha256": args.replay_sha256, "binarySha256": args.binary_sha256,
                       "binaryCommit": args.binary_commit, "manifestSha256": sha256(manifest_path),
                       "replayBuild": manifest.get("replay_build"), "checkpoints": True, "reviewRequired": True},
        "file": {"format": "vrf", "support": "supported" if quality_complete else "incomplete"},
        "identities": identities, "summary": summary, "rounds": rounds, "capabilities": capabilities,
        "observations": observations, "derivation": {"tradeWindowMs": 5000},
    }
    result = {
        "schemaVersion": 1,
        "parserInput": parser_input,
        "scoreboard": {
            "reviewRequired": True,
            "map": {**value(map_name is not None, map_name, "manifest level asset path with reviewed map-name mapping"), "assetPath": asset_path},
            "durationMs": value(isinstance(manifest.get("duration_ms"), int), manifest.get("duration_ms"), "manifest duration_ms"),
            "finalScore": {
                "teamA": {"teamId": "team-red", "score": value(score_available, score_counts["Red"], "RoundResults.WinningTeam count")},
                "teamB": {"teamId": "team-blue", "score": value(score_available, score_counts["Blue"], "RoundResults.WinningTeam count")},
            },
            "players": players, "unavailableFields": sorted(unavailable),
        },
        "diagnostics": {
            "replaySha256": args.replay_sha256, "binarySha256": args.binary_sha256,
            "binaryVersion": args.binary_version, "binaryCommit": args.binary_commit,
            "manifestSha256": sha256(manifest_path), "replayBuild": manifest.get("replay_build"),
            "outputFileCount": 0, "outputBytes": 0,
        },
    }
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--replay-sha256", required=True)
    parser.add_argument("--binary-sha256", required=True)
    parser.add_argument("--binary-version", required=True)
    parser.add_argument("--binary-commit", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{64}", args.replay_sha256) or not re.fullmatch(r"[a-f0-9]{64}", args.binary_sha256):
        raise SystemExit("invalid SHA-256 provenance")
    output = Path(args.out).resolve()
    if output.exists():
        raise SystemExit("output must not already exist")
    output.write_text(json.dumps(build(args), separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
