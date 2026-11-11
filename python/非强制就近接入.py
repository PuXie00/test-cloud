"""非强制单Move接入。入口calculate_nonforced_entry(parameters)，输入输出保持原版格式。
每模型完整H/P/Y三行entry_moves共用同一发送时刻，组装为一条三轴准备Move。
无中间换速、无退回助跑、无额外交接指令；后面只有原表本来存在的Move。
搜索连续曲线候选，验证共同时间的位置/有符号速度以及其后整段自然续跑。
使用真实最大V/A/D，不用默认值覆盖；最终参数0.1精度，未参与轴保留实际位置。
并非每个指定帧都能用单Move自然接续，无方案时返回infeasible，不输出多Move补救。
原帧表里超能力/超行程的Move之前（含）不接入（预检，不再逐帧回放）；有停止参考帧时，
接入帧沿运行方向最多比参考帧靠后entry_max_skip_ms（默认3000ms，参考帧之前的接入点不受限）。
有参考帧时只搜当前段和运行方向后续段，不回头兜底到动作起点；接不上返回infeasible。
"""

import bisect
import heapq
import json
import math
import sys
from contextvars import ContextVar
from time import perf_counter as _clock
from pathlib import Path
from collections import OrderedDict

ALGORITHM_VERSION = "nonforced_single_move_join_20261110_fast_5s_skip_limit"
AXIS_NAMES = ("H", "P", "Y")
COEFFICIENT_NAMES = ("a", "b", "c", "d", "e", "f")
_EPS = 1e-9
# 与 adjust_speed.py 的 _profile 判定“刹不住”的容差一致
_PROFILE_TOL = 1e-6
# 曲线上判定“速度为 0 / 衔接处在动”的速度容差
_MOTION_SPEED_EPS = 1e-6
# 内部编码回放误差容差，不增加公共输入字段。
_ENTRY_MATCH_VELOCITY_TOLERANCE = 0.05

# 本算法自己的设置（都可在 settings 里覆盖）；系数单位、帧步长沿用公共 settings
DEFAULT_SETTINGS = {
    # 静止轴在位判定、接入核对的位置容差（协议 0.1 的一半）
    "entry_position_tolerance": 0.05,
    # 判定曲线静止的速度容差
    "entry_velocity_tolerance": 1e-6,
    # 按协议 0.1 精度量化下发的 Move 参数（与 C++ / adjust_speed.py 一致）
    "entry_quantize_protocol": True,
    # 下发时刻保留的小数位（毫秒）
    "entry_send_time_decimals": 3,
    # 接上曲线所需时间相差不超过这么多（毫秒）算同分，取运行方向先遇到的 t0
    "entry_lead_tie_ms": 1,
    # 兼容原设置字段；本版准备能力始终取真实max，不用default覆盖
    "entry_acceleration_source": "max",
    # 结果里附上从曲线还原出的 Move 帧表（便于与上位机下发的对照）
    "include_move_table": False,
    # 就近且有停止参考帧时，接入帧沿运行方向最多比参考帧靠后多少毫秒（null为不限）；
    # 参考帧之前的接入点不受此限
    "entry_max_skip_ms": 3000,
}


# 每次计算独立计时；不增加JSON参数，默认最多计算5秒。
_CALCULATION_TIMEOUT_SECONDS = 5.0
_ENTRY_DEADLINE = ContextVar("nonforced_entry_deadline", default=None)


class EntryCalculationTimeout(RuntimeError):
    pass


def _check_deadline():
    deadline = _ENTRY_DEADLINE.get()
    if deadline is not None and _clock() >= deadline:
        raise EntryCalculationTimeout


def _timeout_result(parameters):
    raw = parameters.get("command") if isinstance(parameters, dict) else None
    command = raw if isinstance(raw, dict) else {}
    reference = command.get("stopped_time_ms")
    if command.get("use_specified_time") is True:
        mode = "specified_frame"
    elif command.get("nearest_start", True) is False:
        mode = "action_boundary"
    else:
        mode = "current_segment_first" if reference is not None else "nearest_whole_action"
    return _infeasible({"reverse": command.get("reverse") is True}, mode, reference,
                       "计算超时（超过5秒），本次未生成可执行接入方案",
                       [], ["本次搜索未完成，不代表轨迹无解；不得下发未完成的准备参数"])


class EntryInfeasible(ValueError):
    """这个 t0 接不上；reasons 是每个轴的原因。"""

    def __init__(self, reasons):
        super().__init__("；".join(reasons))
        self.reasons = list(reasons)


###############################################################################
# 一、基础：数值校验、取整、真实 Move 积分
###############################################################################

def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name}须为有限数值")
    return float(value)


def _triple(values, name, nonnegative=False):
    if not isinstance(values, (list, tuple)) or len(values) != 3:
        raise ValueError(f"{name}须为H/P/Y三个数")
    first, second, third = values
    native = (int, float)
    if (type(first) in native and type(second) in native and type(third) in native
            and math.isfinite(first) and math.isfinite(second) and math.isfinite(third)):
        if nonnegative and (first < 0 or second < 0 or third < 0):
            raise ValueError(f"{name}不能为负数")
        return [float(first), float(second), float(third)]
    result = [_number(value, f"{name}[{AXIS_NAMES[index]}]") for index, value in enumerate(values)]
    if nonnegative and any(value < 0 for value in result):
        raise ValueError(f"{name}不能为负数")
    return result


def quantize(value):
    """协议 0.1 精度，半格远离 0 取整（与 adjust_speed.py 的 _quant 相同）。"""
    return math.copysign(math.floor(abs(value) * 10 + .5 + 1e-10) / 10, value)


def _quantize_behind(value, direction):
    """量化到 0.1，并保证落在运动方向的后面（正向向下取、反向向上取）。"""
    scaled = value * 10
    return (math.floor(scaled + 1e-9) if direction > 0 else math.ceil(scaled - 1e-9)) / 10


def _js_round(value):
    """JavaScript Math.round：半格向正无穷取整。"""
    return math.floor(value + .5)


def _round_coordinate(value):
    """上位机 roundProjectCoordinate：保留 1 位小数。"""
    rounded = _js_round(value * 10) / 10
    return 0. if rounded == 0 else rounded


def _round_speed(value):
    """上位机 move-commands.ts 的 roundSpeed：保留 3 位小数。"""
    return _js_round(value * 1000) / 1000


def _ceil_rate(value):
    """上位机 move-commands.ts 的 ceilRate：加减速度向上取到 3 位小数。"""
    return math.ceil(value * 1000 - 1e-6) / 1000


def move_profile(q0, v0, target, cap, acc, dec):
    """无 Jerk 的真实 Move（与 adjust_speed.py 的 _profile 同一规则）。

    从 (q0, v0) 下发 (target, cap, acc, dec)：背向目标先减到 0；刹不住先停再折返；超速先降到 cap；
    然后按 acc 提速、匀速、按 dec 减速停在 target。返回 [(时长s, 起点q, 起点v, 加速度)]。
    """
    if min(cap, acc, dec) <= 0:
        raise ValueError("有效Move的速度和加减速度须大于0")
    phases = []
    q, v = float(q0), float(v0)

    def run(seconds, acceleration):
        nonlocal q, v
        if seconds <= 1e-14:
            return
        phases.append((seconds, q, v, acceleration))
        q += v * seconds + .5 * acceleration * seconds * seconds
        v += acceleration * seconds

    for _ in range(4):
        direction = 1 if target > q else -1 if target < q else 0
        if not direction:
            if abs(v) <= _PROFILE_TOL:
                return phases
            direction = 1 if v > 0 else -1
        speed = direction * v
        if speed < -_PROFILE_TOL:
            run(-speed / dec, direction * dec)
            v, speed = 0., 0.
        distance = direction * (target - q)
        if distance < speed * speed / (2 * dec) - _PROFILE_TOL:
            run(speed / dec, -direction * dec)
            v = 0.
            continue
        if speed > cap + _PROFILE_TOL:
            run((speed - cap) / dec, -direction * dec)
            speed = cap
            distance = direction * (target - q)
        peak = min(cap, math.sqrt(max(0., (2 * acc * dec * distance + dec * speed * speed) / (acc + dec))))
        if peak < speed - _PROFILE_TOL:
            run(speed / dec, -direction * dec)
            v = 0.
            continue
        acceleration_distance = max(0., (peak * peak - speed * speed) / (2 * acc))
        deceleration_distance = peak * peak / (2 * dec)
        run(max(0., peak - speed) / acc, direction * acc)
        run(max(0., distance - acceleration_distance - deceleration_distance) / peak if peak else 0., 0.)
        run(peak / dec, -direction * dec)
        return phases
    raise ValueError("Move积分没有收敛")


def profile_duration(phases):
    return sum(phase[0] for phase in phases)


###############################################################################
# 二、从 models 的分段系数还原每个轴的运动阶段
###############################################################################

def _pieces_of(model, unit_ms):
    """模型的全部系数阶段，按时间排好：[(起始帧, 结束帧, {a..f: [H,P,Y]})]。"""
    segments = model.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError(f"模型{model.get('model_id')}没有segments")
    pieces = []
    for segment in segments:
        _check_deadline()
        if not isinstance(segment, dict):
            raise ValueError("segments元素须为对象")
        items = segment.get("coefficient_segments") or [segment]
        for item in items:
            _check_deadline()
            start = _number(item.get("start_frame"), "start_frame")
            end = _number(item.get("end_frame"), "end_frame")
            if end <= start:
                raise ValueError(f"模型{model.get('model_id')}的系数阶段时间无效")
            if "a" not in item:
                raise ValueError(f"模型{model.get('model_id')}的系数阶段缺少a")
            coefficients = {name: _triple(item[name], name) if name in item else (0., 0., 0.)
                            for name in COEFFICIENT_NAMES}
            if any(abs(value) > 1e-12 for name in ("d", "e", "f") if name in item for value in coefficients[name]):
                raise ValueError("非强制曲线须为恒加速度分段（d/e/f须为0）")
            pieces.append((start, end, coefficients))
    pieces.sort(key=lambda piece: piece[0])
    for left, right in zip(pieces, pieces[1:]):
        if right[0] < left[1] - 1e-6:
            raise ValueError(f"模型{model.get('model_id')}的系数阶段重叠")
    return pieces


def _piece_state(piece, axis, frame, unit_ms):
    start, _, coefficients = piece
    u = (frame - start) / unit_ms
    scale = 1000 / unit_ms
    position = coefficients["a"][axis] + coefficients["b"][axis] * u + coefficients["c"][axis] * u * u
    velocity = (coefficients["b"][axis] + 2 * coefficients["c"][axis] * u) * scale
    return position, velocity


def _axis_phases(pieces, axis, unit_ms):
    """一个轴的恒加速度阶段：被其它轴、关键帧切开的同一阶段合并回来，速度过零处分开。"""
    scale = 1000 / unit_ms
    phases = []
    for piece in pieces:
        _check_deadline()
        start, end, coefficients = piece
        velocity = coefficients["b"][axis] * scale
        acceleration = 2 * coefficients["c"][axis] * scale * scale
        last = phases[-1] if phases else None
        if (last is not None and abs(last["end"] - start) <= 1e-6 and abs(velocity) > _MOTION_SPEED_EPS
                and abs(last["acceleration"] - acceleration) <= 1e-9 * max(1., abs(acceleration))):
            last["end"] = end
            last["pieces"].append(piece)
            continue
        phases.append({"start": start, "end": end, "velocity": velocity, "acceleration": acceleration,
                       "position": coefficients["a"][axis], "pieces": [piece]})
    return phases


def _axis_runs(pieces, axis, unit_ms):
    """按停点切成连续运动：[{phases: [(起始帧, 结束帧, 起速, 末速)], start_pos, end_pos, start_speed, end_speed}]。

    阶段速度为绝对值；一段连续运动内方向不变。衔接处速度不为 0 的相邻阶段属于同一段运动。
    """
    phases = _axis_phases(pieces, axis, unit_ms)
    runs, current = [], None
    for index, phase in enumerate(phases):
        _check_deadline()
        moving = abs(phase["velocity"]) > _MOTION_SPEED_EPS or abs(phase["acceleration"]) > _EPS
        if not moving:
            current = None
            continue
        following = phases[index + 1] if index + 1 < len(phases) else None
        joined = following is not None and abs(following["end"] - following["start"]) > 0 \
            and abs(following["start"] - phase["end"]) <= 1e-6 and abs(following["velocity"]) > _MOTION_SPEED_EPS
        start_speed = abs(phase["velocity"])
        if joined:
            end_speed = abs(following["velocity"])
        else:
            last_piece = phase["pieces"][-1]
            end_speed = abs(_piece_state(last_piece, axis, last_piece[1], unit_ms)[1])
            if end_speed <= _MOTION_SPEED_EPS:
                end_speed = 0.
        if current is None:
            current = {"phases": [], "start_pos": phase["position"], "start_speed": start_speed}
            runs.append(current)
        current["phases"].append((phase["start"], phase["end"], start_speed, end_speed))
        last_piece = phase["pieces"][-1]
        current["end_pos"] = _piece_state(last_piece, axis, last_piece[1], unit_ms)[0]
        current["end_speed"] = end_speed
        if not joined:
            current = None
    return runs


###############################################################################
# 三、Move 帧表：与上位机 move-commands.ts 逐行同一规则（含取整）
###############################################################################

_SPEED_EPS = 1e-9
_RATE_EPS = 1e-9
# 降速时减速度不够要加大，留 5% 余量，避免正好卡在驱动器判定的停车点
_SLOWDOWN_MARGIN = 1.05
# 加大了减速度的降速在过程中与曲线的偏差，超过这个值就拆成几级
_SLOWDOWN_TOLERANCE = 0.1
_MAX_SLOWDOWN_STEPS = 5


class _Phase:
    __slots__ = ("at_ms", "from_speed", "to_speed", "duration", "distance", "seam", "direction", "step_deceleration")

    def __init__(self, at_ms, from_speed, to_speed, duration, seam, direction, step_deceleration=None, distance=None):
        self.at_ms, self.from_speed, self.to_speed, self.duration = at_ms, from_speed, to_speed, duration
        self.distance = duration * (from_speed + to_speed) / 2 if distance is None else distance
        self.seam, self.direction, self.step_deceleration = seam, direction, step_deceleration


def _same(left, right, eps):
    return abs(left - right) <= eps * max(1., abs(left), abs(right))


def _is_slowdown(phase):
    return phase.to_speed < phase.from_speed - _SPEED_EPS


def _rate(phase):
    return abs(phase.to_speed - phase.from_speed) / phase.duration


def _stop_need(speed, distance):
    return speed * speed / (2 * distance) if distance > 0 else 0.


def _run_profile(phases):
    remaining = [0.] * (len(phases) + 1)
    later = [0.] * (len(phases) + 1)
    for index in range(len(phases) - 1, -1, -1):
        phase = phases[index]
        remaining[index] = remaining[index + 1] + phase.distance
        final = index == len(phases) - 1
        later[index] = max(later[index + 1], _rate(phase) if final or _is_slowdown(phase) else 0.)
    return remaining, later


def _slowdown_need(phase, remaining_start, remaining_end):
    return max(_stop_need(phase.from_speed, remaining_start), _stop_need(phase.to_speed, remaining_end))


def _centered_deceleration(phase, remaining):
    speed = phase.from_speed
    spare = 2 * remaining - speed * phase.duration
    if not spare > 0:
        return math.inf
    return (_SLOWDOWN_MARGIN * speed * speed - speed * (phase.from_speed - phase.to_speed)) / spare


def _raise_slowdown(phase, remaining, at_end, ceiling, previous):
    speed = phase.from_speed
    drop = phase.from_speed - phase.to_speed
    ramp = phase.duration
    deceleration = (phase.step_deceleration if phase.step_deceleration is not None
                    else max(_rate(phase), at_end, min(_centered_deceleration(phase, remaining), ceiling)))
    center = (ramp - drop / deceleration) / 2
    own = (remaining - (_SLOWDOWN_MARGIN * speed * speed) / (2 * deceleration)) / speed
    before = ((remaining - (speed * speed * (1 + _RATE_EPS)) / (2 * previous["deceleration"])) / speed
              if previous is not None and previous["deceleration"] is not None else math.inf)
    delay = max(0., min(center, own, before)) if previous is not None else 0.
    return {"deceleration": deceleration, "delay_ms": delay * 1000,
            "previous_need": _stop_need(speed, remaining - speed * delay),
            "deviation": drop * max(0., ramp - drop / deceleration) / 8}


def _split_gentle_slowdowns(phases):
    remaining, later = _run_profile(phases)
    result = []
    for index, phase in enumerate(phases):
        if index == len(phases) - 1 or not _is_slowdown(phase):
            result.append(phase)
            continue
        at_end = _stop_need(phase.to_speed, remaining[index + 1])
        if _rate(phase) >= _slowdown_need(phase, remaining[index], remaining[index + 1]) * (1 + _RATE_EPS):
            result.append(phase)
            continue
        deviation = _raise_slowdown(phase, remaining[index], at_end, later[index], None)["deviation"]
        steps = min(_MAX_SLOWDOWN_STEPS, max(1, math.ceil(math.sqrt(deviation / _SLOWDOWN_TOLERANCE))))
        if steps == 1:
            result.append(phase)
            continue
        drop = (phase.from_speed - phase.to_speed) / steps
        duration = phase.duration / steps
        parts = []
        for step in range(steps):
            from_speed = phase.from_speed - drop * step
            to_speed = phase.to_speed if step == steps - 1 else from_speed - drop
            parts.append(_Phase(phase.at_ms + phase.direction * duration * 1000 * step, from_speed, to_speed,
                                duration, phase.seam and step == 0, phase.direction))
        before = remaining[index]
        shared = max(_rate(phase), at_end)
        for part in parts:
            shared = max(shared, _centered_deceleration(part, before), _stop_need(part.to_speed, before - part.distance))
            before -= part.distance
        step_deceleration = min(shared, later[index])
        for part in parts:
            part.step_deceleration = step_deceleration
        result.extend(parts)
    return result


def _phase_needs(phases):
    remaining, later = _run_profile(phases)
    needs = []
    for index, phase in enumerate(phases):
        rate = _rate(phase)
        if index == len(phases) - 1:
            needs.append({"velocity": phase.from_speed, "acceleration": None, "deceleration": rate,
                          "min_deceleration": 0., "adjusted": False, "delay_ms": None})
            continue
        at_end = _stop_need(phase.to_speed, remaining[index + 1])
        if phase.to_speed > phase.from_speed + _SPEED_EPS:
            needs.append({"velocity": phase.to_speed, "acceleration": rate, "deceleration": None,
                          "min_deceleration": at_end, "adjusted": False, "delay_ms": None})
            continue
        if not _is_slowdown(phase):
            needs.append({"velocity": phase.from_speed, "acceleration": None, "deceleration": None,
                          "min_deceleration": at_end, "adjusted": False, "delay_ms": None})
            continue
        needed = _slowdown_need(phase, remaining[index], remaining[index + 1])
        if rate >= needed * (1 + _RATE_EPS):
            needs.append({"velocity": phase.to_speed, "acceleration": None, "deceleration": rate,
                          "min_deceleration": needed, "adjusted": False, "delay_ms": None})
            continue
        previous = None if phase.seam or index == 0 else needs[index - 1]
        raised = _raise_slowdown(phase, remaining[index], at_end, later[index], previous)
        if previous is not None:
            previous["min_deceleration"] = max(previous["min_deceleration"], raised["previous_need"])
        needs.append({"velocity": phase.to_speed, "acceleration": None, "deceleration": raised["deceleration"],
                      "min_deceleration": needed, "adjusted": True,
                      "delay_ms": raised["delay_ms"] if raised["delay_ms"] > 0 else None})
    return needs


def _deceleration_fits(window, need):
    tolerance = 1 - _RATE_EPS
    if window["deceleration"] is not None and need["deceleration"] is not None:
        return _same(window["deceleration"], need["deceleration"], _RATE_EPS)
    if window["deceleration"] is not None:
        return window["deceleration"] >= need["min_deceleration"] * tolerance
    if need["deceleration"] is not None:
        return need["deceleration"] >= window["min_deceleration"] * tolerance
    return True


def _command_windows(phases):
    needs = _phase_needs(phases)
    windows = []
    for phase, need in zip(phases, needs):
        current = windows[-1] if windows else None
        fits = (current is not None and not phase.seam
                and _same(current["velocity"], need["velocity"], _SPEED_EPS)
                and (need["acceleration"] is None or current["acceleration"] is None
                     or _same(current["acceleration"], need["acceleration"], _RATE_EPS))
                and _deceleration_fits(current, need))
        if not fits:
            windows.append({**need, "phases": [phase]})
            continue
        current["phases"].append(phase)
        if current["acceleration"] is None:
            current["acceleration"] = need["acceleration"]
        if current["deceleration"] is None:
            current["deceleration"] = need["deceleration"]
        current["min_deceleration"] = max(current["min_deceleration"], need["min_deceleration"])
        current["adjusted"] = current["adjusted"] or need["adjusted"]
    return windows


def _settle_rates(windows):
    later = 0.
    for window in reversed(windows):
        if window["deceleration"] is None:
            window["deceleration"] = max(window["min_deceleration"], later)
        later = max(later, window["deceleration"])
    previous = next((window["acceleration"] for window in windows if window["acceleration"] is not None), None)
    for window in windows:
        if window["acceleration"] is None:
            window["acceleration"] = previous if previous is not None else window["deceleration"]
        previous = window["acceleration"]


def _run_commands(phases, target):
    # 完整静止到静止梯形/三角形：原window合并过程必然得到同一条Move。
    # 仅严格匹配时走快路；带速多级曲线、接缝及任何疑点继续原算法。
    if len(phases) in (2,3):
        first, last = phases[0], phases[-1]
        peak = first.to_speed
        if (first.from_speed == 0. and last.to_speed == 0. and peak > _SPEED_EPS
                and last.from_speed == peak
                and (len(phases) == 2 or phases[1].from_speed == phases[1].to_speed == peak)
                and all(not p.seam and p.direction == first.direction and p.duration > 0 for p in phases)):
            acceleration, deceleration = _rate(first), _rate(last)
            remaining, needed = 0., 0.
            for phase in reversed(phases):
                if phase is not last:
                    needed = max(needed, _stop_need(phase.to_speed,remaining))
                remaining += phase.distance
            if (0 < acceleration < math.inf and 0 < deceleration < math.inf
                    and deceleration >= needed*(1-_RATE_EPS)):
                return [{"atMs": _round_coordinate(first.at_ms), "target": _round_coordinate(target),
                         "velocity": _round_speed(peak), "acceleration": _ceil_rate(acceleration),
                         "deceleration": _ceil_rate(deceleration), "passSpeed": _round_speed(first.from_speed),
                         "adjusted": False}]
    windows = _command_windows(_split_gentle_slowdowns(phases))
    _settle_rates(windows)
    commands = []
    for window in windows:
        first = window["phases"][0]
        commands.append({
            "atMs": _round_coordinate(first.at_ms + first.direction * (window["delay_ms"] or 0.)),
            "target": _round_coordinate(target),
            "velocity": _round_speed(window["velocity"]),
            "acceleration": _ceil_rate(window["acceleration"] or 0.),
            "deceleration": _ceil_rate(window["deceleration"] or 0.),
            "passSpeed": _round_speed(first.from_speed),
            "adjusted": window["adjusted"],
        })
    # 时刻取整后撞在一起的，保留运行方向上后下发的那条
    return [command for index, command in enumerate(commands)
            if index + 1 >= len(commands) or commands[index + 1]["atMs"] != command["atMs"]]


def axis_move_commands(runs, reverse=False, loop=False):
    """一个轴整条动作的 Move（原曲线时刻升序），与上位机 axisMoveCommands 相同。

    反向时按倒走的曲线生成：目标是每段连续运动的起点，时刻仍是原曲线时刻。
    循环动作首尾以非 0 速度衔接时，末尾这段和下一圈开头是同一段连续运动。
    """
    seam_joined = (loop and len(runs) > 1 and runs[-1]["end_speed"] > 0 and runs[0]["start_speed"] > 0)
    if seam_joined:
        tail, head = runs[-1], runs[0]
        joined = [({"phases": tail["phases"] + head["phases"], "start_pos": tail["start_pos"],
                    "end_pos": head["end_pos"]}, len(tail["phases"]))]
        joined += [(run, -1) for run in runs[1:-1]]
    else:
        joined = [(run, -1) for run in runs]
    commands = []
    for run, seam_at in joined:
        _check_deadline()
        if reverse:
            phases = []
            for index in range(len(run["phases"]) - 1, -1, -1):
                start, end, from_speed, to_speed = run["phases"][index]
                duration = (end - start) / 1000
                phases.append(_Phase(start + duration * 1000, to_speed, from_speed, duration,
                                     index == seam_at - 1, -1))
            commands.extend(_run_commands(phases, run["start_pos"]))
        else:
            phases = [_Phase(start, from_speed, to_speed, (end - start) / 1000, index == seam_at, 1)
                      for index, (start, end, from_speed, to_speed) in enumerate(run["phases"])]
            commands.extend(_run_commands(phases, run["end_pos"]))
    return sorted(commands, key=lambda command: command["atMs"])


###############################################################################
# 四、帧表回放：按 C++ 的下发规则，把每个轴的 Move 积分成分段轨迹
###############################################################################

class Segment:
    """一段恒加速度运动；u0/u1 为运行方向上的毫秒，command 为当时生效的 Move（起步前为 None）。"""

    __slots__ = ("u0", "u1", "q0", "v0", "a", "command")

    def __init__(self, u0, u1, q0, v0, a, command):
        self.u0, self.u1, self.q0, self.v0, self.a, self.command = u0, u1, q0, v0, a, command

    def state(self, u):
        if not self.v0 and not self.a:
            return self.q0, 0.
        dt = (u - self.u0) / 1000
        return self.q0 + self.v0 * dt + .5 * self.a * dt * dt, self.v0 + self.a * dt


class AxisTrack:
    """一个轴从 anchor 静止开始、依次执行 sends 得到的轨迹。sends = [(u_ms, Move)] 按 u 递增。"""

    def __init__(self, anchor, sends):
        self.anchor = anchor
        self.sends = list(sends)
        self.send_times = [u for u, _ in self.sends]
        self.segments = []
        active_u, active_phases, active_target, active_command = -math.inf, [], anchor, None
        for u, command in self.sends:
            _check_deadline()
            q, v = self._active_state(active_u, active_phases, active_target, u)
            self._emit(active_u, active_phases, active_target, active_command, u)
            active_u, active_target, active_command = u, command["pos"], command
            active_phases = move_profile(q, v, command["pos"], command["vel"], command["accVel"], command["decVel"])
        self._emit(active_u, active_phases, active_target, active_command, math.inf)
        self.starts = [segment.u0 for segment in self.segments]

    def _active_state(self, active_u, phases, target, u):
        if active_u == -math.inf:
            return self.anchor, 0.
        remaining = (u - active_u) / 1000
        for duration, q, v, a in phases:
            if remaining <= duration:
                return q + v * remaining + .5 * a * remaining * remaining, v + a * remaining
            remaining -= duration
        return target, 0.

    def _emit(self, active_u, phases, target, command, until):
        if active_u == -math.inf:
            self.segments.append(Segment(-math.inf, until, self.anchor, 0., 0., None))
            return
        u = active_u
        for duration, q, v, a in phases:
            end = u + duration * 1000
            if u >= until:
                return
            if end > u:
                self.segments.append(Segment(u, min(end, until), q, v, a, command))
            u = end
        if u < until:
            self.segments.append(Segment(u, until, target, 0., 0., command))

    def segment_containing(self, u):
        index = max(0, bisect.bisect_right(self.starts, u) - 1)
        return self.segments[index]

    def state(self, u):
        return self.segment_containing(u).state(u)

    def left_segment(self, u):
        """u 落在 (u0, u1] 里的段：u 左侧的运动。"""
        index = bisect.bisect_left(self.starts, u) - 1
        return self.segments[index] if index >= 0 else None

    def right_segment(self, u):
        """u 落在 [u0, u1) 里的段：u 右侧的运动。"""
        index = bisect.bisect_right(self.starts, u) - 1
        segment = self.segments[index] if index >= 0 else None
        return segment if segment is not None and u < segment.u1 else None

    def cruise_at(self, u, velocity_tolerance):
        """u 处可以接入的匀速段：左侧匀速，或右侧匀速且与左侧是同一条 Move（刚加速完）。"""
        left, right = self.left_segment(u), self.right_segment(u)
        if left is not None and _is_cruise(left, velocity_tolerance):
            return left
        if right is not None and _is_cruise(right, velocity_tolerance) and (left is None or right.command is left.command):
            return right
        return None

    def boundaries(self, lower, upper):
        first = max(0,bisect.bisect_right(self.starts,lower)-1)
        last = bisect.bisect_left(self.starts,upper)
        return [value for segment in self.segments[first:last] for value in (segment.u0,segment.u1)
                if lower < value < upper and math.isfinite(value)]


def _is_cruise(segment, velocity_tolerance):
    return segment.a == 0 and abs(segment.v0) > velocity_tolerance and segment.command is not None


def _is_rest(segment, velocity_tolerance):
    return segment.a == 0 and abs(segment.v0) <= velocity_tolerance


###############################################################################
# 五、输入整理（公共参数格式）
###############################################################################

def _settings_of(parameters):
    supplied = parameters.get("settings") or {}
    if not isinstance(supplied, dict):
        raise ValueError("settings须为对象")
    settings = {**DEFAULT_SETTINGS, **{key: supplied[key] for key in DEFAULT_SETTINGS if key in supplied}}
    unit = supplied.get("forced_coefficient_time_unit_ms", supplied.get("curve_time_unit_ms", 100))
    settings["unit_ms"] = _number(unit, "forced_coefficient_time_unit_ms")
    resolution = supplied.get("nonforced_frame_step_ms", 1)
    if settings["unit_ms"] <= 0:
        raise ValueError("系数时间单位须为正数")
    if isinstance(resolution, bool) or not isinstance(resolution, int) or resolution <= 0:
        raise ValueError("nonforced_frame_step_ms须为正整数")
    settings["frame_resolution_ms"] = resolution
    for key in ("entry_position_tolerance", "entry_velocity_tolerance", "entry_lead_tie_ms"):
        if _number(settings[key], key) < 0:
            raise ValueError(f"{key}不能为负数")
    for key in ("entry_quantize_protocol", "include_move_table"):
        if type(settings[key]) is not bool:
            raise ValueError(f"{key}须为布尔值")
    if settings["entry_acceleration_source"] not in ("max", "default"):
        raise ValueError("entry_acceleration_source只能是max或default")
    if settings["entry_max_skip_ms"] is not None and _number(settings["entry_max_skip_ms"], "entry_max_skip_ms") < 0:
        raise ValueError("entry_max_skip_ms不能为负数")
    return settings


def _command_of(parameters):
    command = parameters.get("command")
    if not isinstance(command, dict):
        raise ValueError("缺少command")
    if command.get("trajectory_run") is True:
        raise ValueError("强制轨迹请用 新就近算法/就近接入计算.py；本算法只处理非强制（trajectory_run=false）")
    reverse = command.get("reverse", False)
    nearest = command.get("nearest_start", True)
    specified = command.get("use_specified_time", False)
    if type(reverse) is not bool or type(nearest) is not bool or type(specified) is not bool:
        raise ValueError("reverse、nearest_start、use_specified_time须为布尔值")
    stopped = command.get("stopped_time_ms")
    stopped = None if stopped is None else _number(stopped, "stopped_time_ms")
    specified_time = _number(command.get("specified_time_ms"), "specified_time_ms") if specified else None
    loop_count = command.get("loop_count", 1)
    if isinstance(loop_count, bool) or not isinstance(loop_count, int) or loop_count < 0:
        raise ValueError("loop_count须为非负整数（0为一直循环）")
    loop = loop_count != 1 and command.get("loop_once") is not True
    return {"reverse": reverse, "nearest_start": nearest, "stopped_time_ms": stopped,
            "use_specified_time": specified, "specified_time_ms": specified_time, "loop": loop}


def _runtime_states(parameters):
    runtime = parameters.get("runtime")
    if not isinstance(runtime, dict) or not isinstance(runtime.get("models"), list):
        raise ValueError("缺少runtime.models（各模型当前位置）")
    states = {}
    for state in runtime["models"]:
        _check_deadline()
        if not isinstance(state, dict) or type(state.get("model_id")) is not int:
            raise ValueError("runtime.models[].model_id须为整数")
        states[(str(state.get("plc_id", "")), state["model_id"])] = state
        states.setdefault(("*", state["model_id"]), state)
    return states


# 只缓存与反馈/能力/行程无关的原曲线编译结果。内容指纹覆盖原地修改，容量双重受限。
_COMPILED_CURVES = OrderedDict()
_COMPILED_CURVE_PIECES = 0
_COMPILED_CURVE_MAX_ENTRIES = 256
_COMPILED_CURVE_MAX_PIECES = 100000


def _compiled_curve(pieces, unit, direction, run_origin, loop, settings):
    global _COMPILED_CURVE_PIECES
    _check_deadline()
    signature = (unit,direction,run_origin,loop,settings["entry_quantize_protocol"],
                 tuple((start,end,*(tuple(coefficients[name]) for name in COEFFICIENT_NAMES))
                       for start,end,coefficients in pieces))
    _check_deadline()
    cached = _COMPILED_CURVES.pop(signature,None)
    if cached is not None:
        _COMPILED_CURVES[signature] = cached
        return cached[1],cached[2]
    start_positions = [_piece_state(pieces[0],axis,pieces[0][0],unit)[0] for axis in range(3)]
    end_positions = [_piece_state(pieces[-1],axis,pieces[-1][1],unit)[0] for axis in range(3)]
    all_commands,all_tracks = [],[]
    for axis in range(3):
        _check_deadline()
        commands = axis_move_commands(_axis_runs(pieces,axis,unit),reverse=direction<0,loop=loop)
        ordered = list(reversed(commands)) if direction<0 else commands
        sends = [(direction*(command["atMs"]-run_origin),_wire_move(command,settings)) for command in ordered]
        anchor = end_positions[axis] if direction<0 else start_positions[axis]
        all_commands.append(commands)
        all_tracks.append(AxisTrack(anchor,sends))
    weight = len(pieces)
    if weight <= _COMPILED_CURVE_MAX_PIECES:
        _COMPILED_CURVES[signature] = (weight,all_commands,all_tracks)
        _COMPILED_CURVE_PIECES += weight
        while (len(_COMPILED_CURVES)>_COMPILED_CURVE_MAX_ENTRIES
               or _COMPILED_CURVE_PIECES>_COMPILED_CURVE_MAX_PIECES):
            _,removed = _COMPILED_CURVES.popitem(last=False)
            _COMPILED_CURVE_PIECES -= removed[0]
    return all_commands,all_tracks


class _Device:
    """一个模型：当前状态、能力参数、原动作段，以及按帧表回放出的各轴轨迹。"""

    def __init__(self, model, states, direction, run_origin, loop, settings, pieces=None):
        if not isinstance(model, dict) or type(model.get("model_id")) is not int:
            raise ValueError("models[].model_id须为整数")
        self.model_id = model["model_id"]
        self.plc_id = str(model.get("plc_id", ""))
        self.device_id = model.get("device_id", self.model_id)
        label = f"模型{self.model_id}"
        state = states.get((self.plc_id, self.model_id)) or states.get(("*", self.model_id))
        if state is None:
            raise ValueError(f"runtime.models里缺少模型{self.model_id}的当前位置")
        self.current = _triple(state.get("position_HPY"), f"{label} position_HPY")
        velocity = _triple(state.get("velocity_HPY", [0, 0, 0]), f"{label} velocity_HPY")
        if state.get("standstill") is False or any(abs(value) > settings["entry_velocity_tolerance"] for value in velocity):
            raise ValueError(f"{label}还在运动，须停稳后再计算接入")
        axes = model.get("prepare_axes") or model.get("follow_axes") or model.get("active_axes") or list(AXIS_NAMES)
        if not isinstance(axes, list) or any(name not in AXIS_NAMES for name in axes):
            raise ValueError(f"{label}的prepare_axes只能是H/P/Y")
        self.active = [name in axes for name in AXIS_NAMES]
        source = "max_acceleration_HPY"  # 准备统一按真实最大能力；兼容旧设置字段但不以default覆盖
        self.entry_acceleration = _triple(model.get(source), f"{label} {source}", True)
        self.reposition_velocity = _triple(model.get("max_velocity_HPY"), f"{label} max_velocity_HPY", True)
        self.reposition_acceleration = _triple(model.get("max_acceleration_HPY"), f"{label} max_acceleration_HPY", True)
        self.reposition_deceleration = _triple(model.get("max_deceleration_HPY", model.get("max_acceleration_HPY")),
                                               f"{label} max_deceleration_HPY", True)
        if settings["entry_quantize_protocol"]:
            for name in ("entry_acceleration", "reposition_velocity", "reposition_acceleration", "reposition_deceleration"):
                setattr(self, name, [math.floor(value * 10 + 1e-8) / 10 for value in getattr(self, name)])
        self.lower = (_triple(model["min_position_HPY"], f"{label} min_position_HPY")
                      if "min_position_HPY" in model else [-math.inf] * 3)
        self.upper = (_triple(model["max_position_HPY"], f"{label} max_position_HPY")
                      if "max_position_HPY" in model else [math.inf] * 3)
        self.prepare_caps = [(_floor_rate(self.reposition_velocity[i], settings["entry_quantize_protocol"]),
                              _floor_rate(self.reposition_acceleration[i], settings["entry_quantize_protocol"]),
                              _floor_rate(self.reposition_deceleration[i], settings["entry_quantize_protocol"]))
                             for i in range(3)]
        self.axis_labels = [f"模型{self.model_id} {axis}" for axis in AXIS_NAMES]
        self.current_in_range = [self.lower[i]-_EPS <= self.current[i] <= self.upper[i]+_EPS for i in range(3)]
        self.rest_tail_failures = set()
        unit = settings["unit_ms"]
        pieces = _pieces_of(model, unit) if pieces is None else pieces
        self.first, self.last = pieces[0][0], pieces[-1][1]
        self.keyframes = sorted({_number(segment[name], name) for segment in model["segments"]
                                 for name in ("start_frame", "end_frame")})
        self.commands, compiled_tracks = _compiled_curve(pieces,unit,direction,run_origin,loop,settings)
        self.tracks = []
        for axis,(commands,track) in enumerate(zip(self.commands,compiled_tracks)):
            if not self.active[axis] or (not commands and self.reposition_velocity[axis] == 0):
                if commands:
                    raise ValueError(f"模型{self.model_id} {AXIS_NAMES[axis]}有运动曲线却未列入准备轴")
                self.active[axis] = False
                track = AxisTrack(self.current[axis],[])
            self.tracks.append(track)
        self.moves = any(self.active[axis] and self.tracks[axis].sends for axis in range(3))
        # 帧表能力预检：接入后要执行的原表Move超能力/超行程时，与准备方式无关，_verify必然失败。
        # 记下每轴最后一条这样的Move（运行时刻），在它之前或同时的接入点直接判不可行。
        self.table_limit_u = [-math.inf]*3
        self.table_limit_reasons = [None]*3
        for axis, track in enumerate(self.tracks):
            for u, command in track.sends:
                problem = _table_move_problem(command, self, axis)
                if problem is not None:
                    self.table_limit_u[axis] = u
                    self.table_limit_reasons[axis] = f"原帧表{_ms_text(run_origin+direction*u)}ms处Move的{problem}"


def _ms_text(value):
    return format(round(value, 3), ".3f").rstrip("0").rstrip(".")


def _table_move_problem(command, device, index):
    """原表Move是否必然通不过_verify的指令检查；口径与_verify相同。

    能力为0的轴在原地保持时_verify另有放行，与准备方式有关，这里不判，仍交给_verify。
    """
    if not device.lower[index]-1e-8 <= command["pos"] <= device.upper[index]+1e-8:
        return f"目标{_ms_text(command['pos'])}超出行程"
    if not -214748364.8 <= command["pos"] <= 214748364.7:
        return f"目标{_ms_text(command['pos'])}超出协议范围"
    for key, maximum in (("vel", device.reposition_velocity[index]),
                         ("accVel", device.reposition_acceleration[index]),
                         ("decVel", device.reposition_deceleration[index])):
        if command[key] > _RATE_LIMIT+1e-8:
            return f"{key}={_ms_text(command[key])}超出协议上限{_RATE_LIMIT}"
        if maximum > 0 and command[key] > maximum+1e-8:
            return f"{key}={_ms_text(command[key])}超过最大能力{_ms_text(maximum)}"
    return None


def _wire_move(command, settings):
    """还原出的一条 Move → C++ 实际下发的参数（协议 0.1 量化）。"""
    move = {"pos": command["target"], "vel": command["velocity"], "accVel": command["acceleration"],
            "decVel": command["deceleration"]}
    if settings["entry_quantize_protocol"]:
        move = {key: quantize(value) for key, value in move.items()}
    if min(move["vel"], move["accVel"], move["decVel"]) <= 0:
        raise ValueError("曲线里有Move的V/A/D量化后为0（低于协议0.1精度）")
    return move


###############################################################################
# 六、单Move准备：只有共同起点一条指令，接入后自然沿原表运行
###############################################################################


_RATE_LIMIT = 6553.5
_ARRIVAL_TOLERANCE_MS = 1.0


def _floor_rate(value, quantized):
    value = min(value, _RATE_LIMIT)
    return math.floor(value * 10 + 1e-8) / 10 if quantized else value


def _rates_near(value, limit, settings, radius=1):
    if not math.isfinite(value) or value <= 0 or limit <= 0:
        return []
    if not settings["entry_quantize_protocol"]:
        return [min(value, limit)]
    center = quantize(value)
    # 距离相同时取较小值，不依赖set的迭代顺序（TS移植可逐条对数）
    return sorted({round(center + k / 10, 1) for k in range(-radius, radius + 1)
                   if .1 - 1e-9 <= center + k / 10 <= limit + 1e-8}, key=lambda x: (abs(x-value), x))


def _target_on_wire(value, device, index, settings):
    if not settings["entry_quantize_protocol"]:
        return value
    target = quantize(value)
    lower, upper = device.lower[index], device.upper[index]
    if target < lower:
        target = math.ceil(lower * 10 - 1e-8) / 10
    if target > upper:
        target = math.floor(upper * 10 + 1e-8) / 10
    return target


def _profile_at(phases, target, seconds):
    for duration, position, velocity, acceleration in phases:
        if seconds <= duration:
            return (position+velocity*seconds+.5*acceleration*seconds*seconds,
                    velocity+acceleration*seconds)
        seconds -= duration
    return target, 0.


def _axis_request(device, index, u0, settings):
    track = device.tracks[index]
    segment = track.segment_containing(u0)
    q, v = segment.state(u0)
    current = device.current[index]
    label = device.axis_labels[index]
    # _verify核对u0之后（含容差）的全部原表Move，这里用同一边界
    if u0 <= device.table_limit_u[index]+1e-9:
        raise EntryInfeasible([f"{label}{device.table_limit_reasons[index]}，只能在它之后接入"])
    if not device.current_in_range[index]:
        raise EntryInfeasible([f"{label}当前位置超出行程"])
    if not device.lower[index] - _EPS <= q <= device.upper[index] + _EPS:
        raise EntryInfeasible([f"{label}接入位置超出行程"])
    quantized = settings["entry_quantize_protocol"]
    V, A, D = device.prepare_caps[index]
    command = segment.command
    w = abs(v)
    request = {"device": device, "index": index, "u0": u0, "current": current,
               "q": q, "v": v, "w": w, "V": V, "A": A, "D": D, "command": command}
    if w <= settings["entry_velocity_tolerance"]:
        request.update(v=0., w=0.)
        if abs(current-q) <= settings["entry_position_tolerance"] and abs(segment.a) <= 1e-10:
            request.update(family="hold", minimum=0., maximum=math.inf)
            return request
    if min(V, A, D) <= 0:
        raise EntryInfeasible([f"{label}需要运动，但可编码最大V/A/D为0"])
    if command is not None and any(command[key] > limit + 1e-8 for key, limit in
                                  (("vel", V), ("accVel", A), ("decVel", D))):
        raise EntryInfeasible([f"{label}原Move超过真实最大V/A/D，不能用默认值代替最大能力"])
    send_index = bisect.bisect_left(track.send_times, u0)
    at_original_send = ((send_index < len(track.send_times) and abs(track.send_times[send_index]-u0) <= 1e-8)
                        or (send_index > 0 and abs(track.send_times[send_index-1]-u0) <= 1e-8))
    if not request["w"]:
        if abs(segment.a) > 1e-10 and not at_original_send:
            raise EntryInfeasible([f"{label}零速转折点不能由一条准备Move自然接续"])
        target = _target_on_wire(q, device, index, settings)
        distance = abs(target-current)
        if distance <= 1e-12:
            request.update(family="hold", minimum=0., maximum=math.inf)
            return request
        minimum = profile_duration(move_profile(current, 0., target, V, A, D))
        smallest = .1 if quantized else 1e-9
        maximum = profile_duration(move_profile(current, 0., target, smallest, smallest, smallest))
        request.update(family="rest", L=distance, target=target, minimum=minimum, maximum=maximum,
                       s=1 if target > current else -1)
        return request
    direction = 1 if v > 0 else -1
    L = direction * (q-current)
    request.update(s=direction, L=L)
    if w > V + 1e-8 or L < w*w/(2*A) - 1e-9:
        raise EntryInfeasible([f"{label}单Move距离或速度能力不足；不输出退回/途中覆盖"])
    alpha = direction * segment.a
    if at_original_send:
        family, dec = "endpoint", D
    elif alpha > 1e-10:
        if abs(L-w*w/(2*alpha)) > settings["entry_position_tolerance"] + 1e-9:
            raise EntryInfeasible([f"{label}加速段单Move无法自然贴合后续原加速度"])
        request.update(family="acceleration", minimum=w/alpha, maximum=w/alpha,
                       dec=command["decVel"], target=command["pos"])
        return request
    elif abs(alpha) <= 1e-10:
        if command is None or abs(w-command["vel"]) > 1e-6:
            raise EntryInfeasible([f"{label}当前状态不能按单Move匀速接续"])
        request.update(family="cruise", minimum=L/w+w/(2*A), maximum=2*L/w,
                       dec=command["decVel"], target=command["pos"])
        return request
    else:
        dec = abs(segment.a)
        natural = command is not None and abs(direction*(command["pos"]-q)-w*w/(2*dec)) <= 1e-5
        if natural:
            family = "deceleration"
            request["target"] = command["pos"]
        else:
            next_index = bisect.bisect_right(track.send_times, u0+1e-8)
            next_send = track.send_times[next_index] if next_index < len(track.send_times) else math.inf
            if next_send > segment.u1 + 1e-8:
                raise EntryInfeasible([f"{label}降到非零速度的减速段没有单Move自然接续方案"])
            family = "transient_deceleration"
            request["target"] = _target_on_wire(q+direction*w*w/(2*dec), device, index, settings)
    peak = min(V, math.sqrt(max(0., (2*A*dec*L+A*w*w)/(A+dec))))
    if peak < w - 1e-8:
        raise EntryInfeasible([f"{label}单Move峰值速度不足"])
    # 平方一律写成乘法：x**2 走C库pow，末位与x*x偶有不同，TS移植无法逐位对上
    minimum = (L+peak*peak/(2*A)+(peak-w)*(peak-w)/(2*dec))/peak
    request.update(family=family, dec=dec, minimum=minimum, maximum=2*L/w)
    return request


def _candidate_moves(request, seconds, settings):
    family = request["family"]
    device, index = request["device"], request["index"]
    V, A, D = (request[key] for key in ("V", "A", "D"))
    q, current, w = (request[key] for key in ("q", "current", "w"))
    if family == "hold":
        # 无运动/不存在的虚轴也填真实位置，不能用pos=0当跳过标志。
        yield {"pos": _target_on_wire(current, device, index, settings),
               "vel": V or .1, "accVel": A or .1, "decVel": D or .1}
        return
    if family == "acceleration":
        yield dict(request["command"])
        return
    if seconds <= 0:
        return
    if family == "cruise":
        denominator = 2*(w*seconds-request["L"])
        if denominator > 0:
            for acc in _rates_near(w*w/denominator, A, settings, 2):
                yield {"pos": request["target"], "vel": w, "accVel": acc, "decVel": request["dec"]}
        return
    if family == "rest":
        distance, target = request["L"], request["target"]
        ratio = seconds/request["minimum"]
        fastest = min(V, math.sqrt(2*A*D*distance/(A+D)))
        for cap in _rates_near(fastest/ratio, V, settings, 1):
            for acc in _rates_near(A/(ratio*ratio), A, settings, 1):
                for dec in _rates_near(D/(ratio*ratio), D, settings, 1):
                    yield {"pos": target, "vel": cap, "accVel": acc, "decVel": dec}
        harmonic = seconds*seconds/(2*distance)
        triangle_acc = {A, min(A, 4*distance/(seconds*seconds)), min(A, A/(ratio*ratio))}
        low = max(.1 if settings["entry_quantize_protocol"] else 1e-9,
                  1/max(1e-15, harmonic-1/D))
        if low <= A:
            triangle_acc.update(low+(A-low)*k/32 for k in range(33))
        for ideal_acc in sorted(triangle_acc):
            for acc in _rates_near(ideal_acc, A, settings, 1):
                remain = harmonic-1/acc
                if remain <= 0:
                    continue
                for dec in _rates_near(1/remain, D, settings, 1):
                    yield {"pos": target, "vel": V, "accVel": acc, "decVel": dec}
        # 有匀速段的单Move：取编码A/D反求峰速。无中途发送。
        accelerations = {A, min(A, max(.1, A/(ratio*ratio))), min(A, max(.1, 8*distance/(seconds*seconds)))}
        decelerations = {D, min(D, max(.1, D/(ratio*ratio))), min(D, max(.1, 8*distance/(seconds*seconds)))}
        for a in sorted(accelerations):
            for acc in _rates_near(a, A, settings, 1):
                for d in sorted(decelerations):
                    for dec in _rates_near(d, D, settings, 1):
                        discriminant = seconds*seconds-2*distance*(1/acc+1/dec)
                        if discriminant < -1e-10:
                            continue
                        peak = 2*distance/(seconds+math.sqrt(max(0., discriminant)))
                        for cap in _rates_near(peak, V, settings, 1):
                            yield {"pos": target, "vel": cap, "accVel": acc, "decVel": dec}
        return
    L = request["L"]
    decelerations = [request["dec"]]
    if family == "endpoint":
        decelerations += [D/2, D/4, D/10]
        command = request["command"]
        if command is not None:
            yield dict(command)
    for ideal_dec in decelerations:
        for dec in _rates_near(ideal_dec, D, settings, 0):
            if family != "endpoint" and abs(dec-request["dec"]) > 1e-8:
                continue
            target = request.get("target", _target_on_wire(q+request["s"]*w*w/(2*dec), device, index, settings))
            B, C, K = seconds+w/dec, (1/A+1/dec)/2, L+w*w/(2*dec)
            discriminant = B*B-4*C*K
            if discriminant < -1e-8:
                continue
            peak = 2*K/(B+math.sqrt(max(0., discriminant)))
            caps = set(_rates_near(max(w, peak), V, settings, 2))
            caps.update(_rates_near(w, V, settings, 1))
            effective = request["s"]*(target-current)-w*w/(2*dec)
            for cap in sorted(caps):
                if cap < w-1e-9:
                    continue
                denominator = 2*(cap*seconds-(cap-w)*(cap-w)/(2*dec)-effective)
                if denominator <= 0:
                    continue
                for acc in _rates_near(cap*cap/denominator, A, settings, 2):
                    yield {"pos": target, "vel": cap, "accVel": acc, "decVel": dec}
            # 接入时仍在加速：瞬时速度允许小于协议最小指令速度0.1。
            for cap in _rates_near(max(w, .1), V, settings, 1):
                if cap < w-1e-9:
                    continue
                for acc in _rates_near(w/seconds, A, settings, 1):
                    yield {"pos": target, "vel": cap, "accVel": acc, "decVel": dec}


def _entry_for_time(request, seconds, u0, settings):
    device, index = request["device"], request["index"]
    family = request["family"]
    kind = "in_place" if family == "hold" else ("run_up" if request["v"] else "reposition")
    seen = set()
    for move in _candidate_moves(request, seconds, settings):
        _check_deadline()
        key = tuple(move[name] for name in ("pos", "vel", "accVel", "decVel"))
        if key in seen:
            continue
        seen.add(key)
        if min(key[1:]) <= 0 or max(key[1:]) > _RATE_LIMIT+1e-8:
            continue
        if not device.lower[index]-_EPS <= move["pos"] <= device.upper[index]+_EPS:
            continue
        if family != "hold" and any(move[name] > request[cap]+1e-8 for name, cap in
                                    (("vel", "V"), ("accVel", "A"), ("decVel", "D"))):
            continue
        phases = move_profile(request["current"], 0., *key)
        q, v = _profile_at(phases, move["pos"], seconds)
        if (abs(q-request["q"]) > settings["entry_position_tolerance"]+1e-9
                or abs(v-request["v"]) > _ENTRY_MATCH_VELOCITY_TOLERANCE+1e-9):
            continue
        if family == "rest" and seconds-profile_duration(phases) > _ARRIVAL_TOLERANCE_MS/1000+1e-9:
            continue
        # 同一接入帧若已停在同一停车点，后续与准备V/A/D无关。
        # 只复用已由完整回放证实的失败；非零速度或尚未停稳一律不能用这个缓存。
        actual_seconds = (u0-round(u0-seconds*1000, settings["entry_send_time_decimals"]))/1000
        actual_q, actual_v = _profile_at(phases, move["pos"], actual_seconds)
        if actual_v == 0. and actual_q == move["pos"] and (index, u0, actual_q) in device.rest_tail_failures:
            continue
        entry = {"axis": AXIS_NAMES[index], "index": index, "kind": kind,
                 "lead_ms": 0. if kind == "in_place" else seconds*1000,
                 "join": (request["q"], request["v"]),
                 "moves": [{"role": "run_up" if request["v"] else "reposition", "at": "clock_start", "move": move}]}
        if kind != "in_place":
            entry["distance"] = request["L"]
        if kind == "run_up":
            entry["run_up_distance"] = request["w"]*request["w"]/(2*move["accVel"])
        plan = _materialize({"u0": u0, "lead_ms": seconds*1000, "entries": [(device, entry)]}, settings)
        if _verify(plan, settings, fail_fast=True)["passed"]:
            return entry
    return None


def _materialize(plan, settings):
    plan["clock_start_u"] = round(plan["u0"]-plan["lead_ms"], settings["entry_send_time_decimals"])
    for _, entry in plan["entries"]:
        for move in entry["moves"]:
            move["send_u"] = plan["clock_start_u"]
    return plan


def _plan_at(devices, u0, settings, allow_two_step=False, requests=None):
    # 兼容旧私有调用签名；allow_two_step不再启用多Move。
    requests = requests if requests is not None else [_axis_request(device, index, u0, settings)
                                                    for device in devices for index in range(3)]
    lower = max((request["minimum"] for request in requests), default=0.)
    upper = min((request["maximum"] for request in requests), default=math.inf)
    if lower > upper+1e-9:
        raise EntryInfeasible(["所有虚轴的单Move准备时间无公共可行区间"])
    times = {lower}
    for request in requests:
        _check_deadline()
        if request["family"] == "cruise":
            w, L = request["w"], request["L"]
            denominator = 2*(w*lower-L)
            if denominator > 0:
                for acc in _rates_near(w*w/denominator, request["A"], settings, 3):
                    times.add(L/w+w/(2*acc))
        if request["family"] in ("endpoint", "deceleration", "transient_deceleration"):
            L, w, A, D = (request[key] for key in ("L", "w", "A", "dec"))
            peak = min(request["V"], math.sqrt((2*A*D*L+A*w*w)/(A+D)))
            for cap in _rates_near(peak, request["V"], settings, 2):
                if cap >= w:
                    times.add((L+cap*cap/(2*A)+(cap-w)*(cap-w)/(2*D))/cap)
    # 编码邻点时间，不以停等或额外指令填补。
    times.update(lower+k/10000 for k in range(1, 11))
    if math.isfinite(upper):
        times.add(upper)
        times.update(lower+(upper-lower)*k/16 for k in range(1, 16))
    else:
        times.update(lower+k/1000 for k in (2, 5, 10, 20, 50, 100))
    # 固定T的各轴核验互相独立；先试最近失败的轴，成功后仍按原模型/轴顺序输出。
    order = list(range(len(requests)))
    priority = getattr(devices[0], "_entry_failure_order", [])
    slots = {(id(request["device"]),request["index"]):slot for slot,request in enumerate(requests)}
    preferred = [slots[key] for key in priority if key in slots]
    order = preferred+[slot for slot in order if slot not in preferred]
    for seconds in sorted(t for t in times if lower-1e-9 <= t <= upper+1e-9):
        _check_deadline()
        entries = [None]*len(requests)
        for slot in order:
            request = requests[slot]
            entry = _entry_for_time(request, seconds, u0, settings)
            if entry is None:
                key = (id(request["device"]),request["index"])
                if key in priority:
                    priority.remove(key)
                priority.insert(0,key)
                del priority[12:]
                devices[0]._entry_failure_order = priority
                order.remove(slot)
                order.insert(0,slot)
                break
            entries[slot] = (request["device"], entry)
        else:
            plan = _materialize({"u0": u0, "lead_ms": seconds*1000, "entries": entries}, settings)
            if _verify(plan, settings)["passed"]:
                return plan
    raise EntryInfeasible(["该帧无可编码的同时起步单Move自然接续方案"])


###############################################################################
# 七、连续选点，当前原动作段优先，比较单Move的共同准备时间
###############################################################################


def _requests_at(devices, u, settings, stop_on_empty=False, observer=None):
    requests = []
    lower, upper = 0., math.inf
    lower_owner = upper_owner = None
    try:
        for device in devices:
            _check_deadline()
            for index in range(3):
                request = _axis_request(device, index, u, settings)
                requests.append(request)
                if observer is not None:
                    if request["minimum"] > lower:
                        lower_owner = device
                    if request["maximum"] < upper:
                        upper_owner = device
                lower = max(lower, request["minimum"])
                upper = min(upper, request["maximum"])
                if stop_on_empty and lower > upper+1e-9:
                    if observer is not None:
                        observer(lower_owner, upper_owner, device)
                    return None
    except EntryInfeasible:
        if observer is not None:
            observer(lower_owner, upper_owner, device)
        return None
    if observer is not None:
        observer(lower_owner, upper_owner)
    return requests, lower, upper


def _phase_is_monotone(devices, first, last, settings):
    """只对可证明单调的开放phase使用二分；边界/容差疑点保守走原网格。"""
    middle = (first+last)/2
    tolerance = settings["entry_velocity_tolerance"]
    for device in devices:
        _check_deadline()
        for index, track in enumerate(device.tracks):
            segment = track.segment_containing(middle)
            if first < segment.u0 or last >= segment.u1:
                return False
            q1, v1 = segment.state(first)
            q2, v2 = segment.state(last)
            if min(q1,q2) < device.lower[index]-_EPS or max(q1,q2) > device.upper[index]+_EPS:
                return False
            if segment.a == 0 and v1 == 0. and v2 == 0.:
                continue
            if min(abs(v1),abs(v2)) <= tolerance or v1*v2 <= 0:
                return False
            V, A, D = device.prepare_caps[index]
            if max(abs(v1),abs(v2)) > V+1e-8:
                return False
            for u in (first,last):
                at = bisect.bisect_left(track.send_times,u)
                if ((at < len(track.send_times) and abs(track.send_times[at]-u) <= 1e-8)
                        or (at and abs(track.send_times[at-1]-u) <= 1e-8)):
                    return False
            direction = 1 if v1 > 0 else -1
            alpha = direction*segment.a
            vscale = max(1.,abs(segment.v0),abs(segment.a*(first-segment.u0)/1000),
                         abs(segment.a*(last-segment.u0)/1000))
            vguard = 64*math.ulp(vscale)
            if min(abs(v1),abs(v2)) <= tolerance+vguard:
                return False
            qscale = max(1.,abs(q1),abs(q2),abs(device.current[index]))
            qguard = max(1e-14,64*math.ulp(qscale))
            if A > 0:
                kinetic1,kinetic2 = v1*v1/(2*A),v2*v2/(2*A)
                reachguard = max(1e-14,64*math.ulp(max(qscale,abs(kinetic1),abs(kinetic2))))
                reach2 = direction*(q2-device.current[index])-kinetic2
                if abs(reach2+1e-9) <= reachguard:
                    return False
            rates = [rate for rate in (A,D,abs(alpha)) if rate > 0]
            noise = qguard/min(abs(v1),abs(v2))+(vguard/min(rates) if rates else 0.)
            if noise > settings["frame_resolution_ms"]/1000/64:
                return False
            if alpha > 0:
                errors = [abs(direction*(q-device.current[index])-v*v/(2*alpha))
                          for q,v in ((q1,v1),(q2,v2))]
                edge = settings["entry_position_tolerance"]
                guard = max(1e-7,64*math.ulp(max(qscale,v1*v1/(2*alpha),v2*v2/(2*alpha))))
                if min(errors) <= edge+guard and max(errors) >= edge-guard:
                    return False
            elif alpha < 0:
                if segment.command is None:
                    return False
                dec = abs(segment.a)
                errors = [abs(direction*(segment.command["pos"]-q)-v*v/(2*dec))
                          for q,v in ((q1,v1),(q2,v2))]
                guard = max(1e-7,64*math.ulp(max(qscale,v1*v1/(2*dec),v2*v2/(2*dec))))
                if min(errors) <= 1e-5+guard and max(errors) >= 1e-5-guard:
                    return False
    return True


def _search_window(devices, lower, upper, to_curve, to_run, settings):
    if not any(device.moves for device in devices):
        try:
            return _plan_at(devices,lower,settings), 1
        except EntryInfeasible:
            return None,1
    resolution = settings["frame_resolution_ms"]
    forward = to_run(1.) > to_run(0.)
    points = {lower,upper}
    for device in devices:
        _check_deadline()
        for track in device.tracks:
            points.update(track.boundaries(lower,upper))
    points = sorted(points)
    boundary_frames = {to_curve(u) for u in points}
    # 子集只给保守下界，绝不用子集决定可执行；真正候选仍验证所有模型。
    base_indices = (list(range(len(devices))) if len(devices) <= 8 else
                    [round(k*(len(devices)-1)/7) for k in range(8)])
    priority = getattr(devices[0], "_probe_indices", [])
    device_indices = {id(device): index for index, device in enumerate(devices)}
    sample = []
    sample_key = None
    def get_sample():
        nonlocal sample, sample_key
        key = tuple(dict.fromkeys(priority+base_indices))
        if key != sample_key:
            sample = [devices[index] for index in key]
            sample_key = key
        return sample
    def observe(*owners):
        for owner in owners:
            if owner is not None:
                index = device_indices[id(owner)]
                if index not in priority:
                    priority.append(index)
        if len(priority) > 12:
            del priority[:-12]
        devices[0]._probe_indices = priority
    heap,serial,evaluated = [],0,0
    def push(bound,u,kind,payload):
        nonlocal serial
        heapq.heappush(heap,(bound,u,serial,kind,payload))
        serial += 1
    def hint_point(frame,cursor=None):
        u = to_run(frame)
        computed = _requests_at(get_sample(),u,settings,True)
        if computed is not None:
            push(computed[1]*1000,u,"point_hint",(frame,cursor))
            return True
        return False
    def exact_point(frame,cursor=None):
        u = to_run(frame)
        computed = _requests_at(devices,u,settings,True,observe)
        if computed is not None:
            requests,lo,hi = computed
            push(lo*1000,u,"point",(requests,cursor))
            return True
        return False
    def advance(cursor):
        grid,index,end = cursor
        while index <= end:
            _check_deadline()
            if exact_point(grid[index],(grid,index+1,end)):
                return
            index += 1
    def materialize_interval(grid,lo,hi):
        first,last = to_run(grid[lo]),to_run(grid[hi])
        if not _phase_is_monotone(devices,first,last,settings):
            for index in range(lo,hi+1):
                if grid[index] not in boundary_frames:
                    hint_point(grid[index])
            return
        computed = _requests_at(devices,last,settings,observer=observe)
        if computed is None:
            return
        requests,_,_ = computed
        moving = [r for r in requests if r["family"] not in ("hold","rest")]
        resting = [r for r in requests if r["family"] in ("hold","rest")]
        moving_min = max((r["minimum"] for r in moving),default=0.)
        fixed_max = min((r["maximum"] for r in moving if r["family"] == "acceleration"),default=math.inf)
        joint_guard = max(1e-12,64*math.ulp(max(1.,abs(moving_min),
                          abs(fixed_max) if math.isfinite(fixed_max) else 1.)))
        if math.isfinite(fixed_max) and abs((moving_min-fixed_max)-1e-9) <= joint_guard:
            for index in range(lo,hi+1):
                hint_point(grid[index])
            return
        rest_min = max((r["minimum"] for r in resting),default=0.)
        rest_max = min((r["maximum"] for r in resting),default=math.inf)
        if rest_min > rest_max+1e-9:
            return
        if moving and math.isfinite(rest_max):
            C = max(r["minimum"]-last/1000 for r in moving)
            cut = math.floor(((rest_max-C)*1000-first)/resolution)+lo
            for index in range(max(lo,cut-2),min(hi,cut+2)+1):
                hint_point(grid[index])
            hi = min(hi,cut-3)
            if hi < lo:
                return
        if _requests_at(devices,to_run(grid[hi]),settings,True,observe) is None:
            return
        begin,end = lo,hi
        while lo < hi:
            middle = (lo+hi)//2
            if _requests_at(devices,to_run(grid[middle]),settings,True,observe) is None:
                lo = middle+1
            else:
                hi = middle
        advance((grid,max(begin,lo-1),end))
    def interval_bound(grid,lo,hi):
        first,last = to_run(grid[lo]),to_run(grid[hi])
        subset = get_sample()
        if not _phase_is_monotone(subset,first,last,settings):
            return 0.
        computed = _requests_at(subset,last,settings)
        if computed is None:
            return None
        requests,lower_at_end,_ = computed
        moving_upper = min((r["maximum"] for r in requests
                            if r["family"] not in ("hold","rest")),default=math.inf)
        guard_sec = max(1e-12,64*math.ulp(max(1.,abs(lower_at_end),
                          abs(moving_upper) if math.isfinite(moving_upper) else 1.)))
        # 安全phase中，运动轴的共同可行性只能由False变True；右端仍冲突则整段无解。
        if lower_at_end > moving_upper+1e-9+guard_sec:
            return None
        bound = max((r["minimum"] if r["family"] in ("hold","rest")
                     else r["minimum"]-(last-first)/1000 for r in requests),default=0.)*1000
        rounding_guard = max([1e-4]+[64*math.ulp(max(1.,abs(r["minimum"])*1000,abs(last-first)))
                                    for r in requests])
        bound = max(0.,bound-rounding_guard)
        rest_max = min((r["maximum"] for r in requests
                        if r["family"] in ("hold","rest")),default=math.inf)
        if bound/1000 > rest_max+1e-9+guard_sec:
            return None
        return bound
    for frame in sorted(boundary_frames,key=to_run):
        _check_deadline()
        hint_point(frame)
    for left,right in zip(points,points[1:]):
        _check_deadline()
        low_curve,high_curve = sorted((to_curve(left),to_curve(right)))
        low_grid = math.ceil(low_curve/resolution)*resolution
        high_grid = math.floor(high_curve/resolution)*resolution
        grid = (range(low_grid,high_grid+1,resolution) if forward
                else range(high_grid,low_grid-1,-resolution))
        if not grid:
            continue
        lo,hi = 0,len(grid)-1
        while lo <= hi and (grid[lo] in boundary_frames or not left < to_run(grid[lo]) < right):
            lo += 1
        while lo <= hi and (grid[hi] in boundary_frames or not left < to_run(grid[hi]) < right):
            hi -= 1
        if lo > hi:
            continue
        if hi-lo < 3:
            for index in range(lo,hi+1):
                hint_point(grid[index])
            continue
        bound = interval_bound(grid,lo,hi)
        if bound is not None:
            push(bound,to_run(grid[lo]),"interval_hint",(grid,lo,hi))
    plans,shortest = [],math.inf
    tie = settings["entry_lead_tie_ms"]
    while heap:
        _check_deadline()
        bound,u,_,kind,payload = heapq.heappop(heap)
        if bound > shortest+tie+1e-8:
            break
        # 已有方案同时更快且帧更早时，该节点及安全后继都不会成为最终结果。
        # 预留_plan_at允许低于解析lower 1e-9秒的浮点容差，不能用宽松达界判断。
        if any(plan["u0"] <= u and plan["lead_ms"]+max(
                1e-5,64*math.ulp(max(1.,abs(bound),abs(plan["lead_ms"])))) <= bound for plan in plans):
            continue
        if kind == "point_hint":
            frame,cursor = payload
            if not exact_point(frame,cursor) and cursor is not None:
                advance(cursor)
            continue
        if kind == "interval_hint":
            strengthened = interval_bound(*payload)
            if strengthened is None:
                continue
            if strengthened > bound+1e-8:
                push(strengthened,u,kind,payload)
                continue
            materialize_interval(*payload)
            continue
        requests,cursor = payload
        evaluated += 1
        try:
            plan = _plan_at(devices,u,settings,requests=requests)
        except EntryInfeasible:
            pass
        else:
            plans.append(plan)
            shortest = min(shortest,plan["lead_ms"])
        if cursor is not None:
            advance(cursor)
    best = min((p for p in plans if p["lead_ms"] <= shortest+tie+1e-8),
               key=lambda p:p["u0"],default=None)
    return best,evaluated


def _windows(devices, first, last, reverse, reference):
    boundaries = {first, last}
    for device in devices:
        if device.moves:
            boundaries.update(frame for frame in device.keyframes if first <= frame <= last)
    boundaries = sorted(boundaries)
    windows = list(zip(boundaries, boundaries[1:])) or [(first, last)]
    if reference is None:
        return [(first, last, "whole_action")]
    if not reverse:
        index = next((i for i,(low,high) in enumerate(windows) if low <= reference < high), len(windows)-1)
        ordered = windows[index:]
    else:
        index = next((i for i,(low,high) in enumerate(windows) if low < reference <= high), 0)
        ordered = list(reversed(windows[:index+1]))
    # 有参考帧（继续/反向回）时只查当前段和运行方向后续段，不再回头搜参考帧之前的整条轨迹：
    # 自动退回起点重跑操作者难以预料，接不上就返回不可行，由操作者改选从头开始或指定位置。
    return [(low,high,"current_segment" if i == 0 else "directional_fallback")
            for i,(low,high) in enumerate(ordered)]


###############################################################################
# 八、最终编码回放：位置、速度、后续整段、行程、能力和同时起步均纳入通过条件
###############################################################################


def _candidate_witness_cache(device, index, entry, u0, settings):
    if len(entry["moves"]) != 1:
        return None, None
    groups = getattr(device, "_trajectory_error_witnesses", None)
    if groups is None:
        groups = [{}, {}, {}]
        device._trajectory_error_witnesses = groups
    track = device.tracks[index]
    item = entry["moves"][0]
    move = item["move"]
    next_send = bisect.bisect_left(track.send_times, u0-1e-9)
    key = (id(track), device.current[index], item["send_u"],
           move["pos"], move["vel"], move["accVel"], move["decVel"], next_send,
           settings["entry_position_tolerance"], _ENTRY_MATCH_VELOCITY_TOLERANCE)
    return groups[index], key



def _capture_error_witness(sink, u, actual_segment, reference_segment, aq, av, rq, rv, limits):
    if sink is None or sink:
        return
    qscale, vscale = max(1., abs(aq), abs(rq)), max(1., abs(av), abs(rv))
    for segment in (actual_segment, reference_segment):
        qscale = max(qscale, abs(segment.q0))
        vscale = max(vscale, abs(segment.v0))
        if segment.v0 or segment.a:
            dt = (u-segment.u0)/1000
            qscale = max(qscale, abs(segment.v0*dt), abs(.5*segment.a*dt*dt))
            vscale = max(vscale, abs(segment.a*dt))
    # 临界浮点点不用于跨帧证书，仍走完整判定；留宽松舍入余量。
    qguard = max(1e-10, 256*math.ulp(qscale))
    vguard = max(1e-10, 256*math.ulp(vscale))
    qe, ve = abs(aq-rq), abs(av-rv)
    if qe > limits[0]+qguard or ve > limits[1]+vguard:
        sink.append((u, qe, ve))



def _trajectory_errors_sweep(actual, track, u0, stop_limits=None, witness_sink=None, witness_limits=None):
    """完整顺序合并AxisTrack相位，边界取右段，包含位置误差内部极值。"""
    actual_segments, reference_segments = actual.segments, track.segments
    ai = max(0, bisect.bisect_right(actual.starts, u0)-1)
    ri = max(0, bisect.bisect_right(track.starts, u0)-1)
    last = u0
    # AxisTrack末段为停稳后的[有限起点,+inf)；保留通用的反向有限边界查找。
    for segments in (actual_segments, reference_segments):
        for segment in reversed(segments):
            values = [value for value in (segment.u0, segment.u1) if math.isfinite(value)]
            if values:
                last = max(last, max(values))
                break
    horizon = last+1000
    limits = stop_limits if stop_limits is not None else witness_limits
    worst_position, worst_velocity = 0., 0.
    left = u0
    while True:
        _check_deadline()
        # 与AxisTrack.state的bisect_right相同：相位切换时刻用右段。
        while ai+1 < len(actual_segments) and actual_segments[ai+1].u0 <= left:
            ai += 1
        while ri+1 < len(reference_segments) and reference_segments[ri+1].u0 <= left:
            ri += 1
        actual_segment, reference_segment = actual_segments[ai], reference_segments[ri]
        aq, av = actual_segment.state(left)
        rq, rv = reference_segment.state(left)
        worst_position = max(worst_position, abs(aq-rq))
        worst_velocity = max(worst_velocity, abs(av-rv))
        if limits is not None and (abs(aq-rq) > limits[0] or abs(av-rv) > limits[1]):
            _capture_error_witness(witness_sink,left,actual_segment,reference_segment,aq,av,rq,rv,limits)
        if stop_limits is not None and (worst_position > stop_limits[0] or worst_velocity > stop_limits[1]):
            return worst_position, worst_velocity
        if left >= horizon:
            return worst_position, worst_velocity
        right = min(actual_segment.u1, reference_segment.u1, horizon)
        acceleration = actual_segment.a-reference_segment.a
        if abs(acceleration) > 1e-12:
            extremum = left-(av-rv)/acceleration*1000
            if left < extremum < right:
                aq, av = actual_segment.state(extremum)
                rq, rv = reference_segment.state(extremum)
                worst_position = max(worst_position, abs(aq-rq))
                worst_velocity = max(worst_velocity, abs(av-rv))
                if limits is not None and (abs(aq-rq) > limits[0] or abs(av-rv) > limits[1]):
                    _capture_error_witness(witness_sink,extremum,actual_segment,reference_segment,aq,av,rq,rv,limits)
                if stop_limits is not None and (worst_position > stop_limits[0] or worst_velocity > stop_limits[1]):
                    return worst_position, worst_velocity
        left = right



def _verify(plan, settings, fail_fast=False):
    # 同一候选的单轴已完整验证；聚合/输出只复用相同最终时刻与指令的证书。
    entries = plan["entries"]
    if len(entries) != 1:
        results = [_verify({"u0": plan["u0"], "clock_start_u": plan["clock_start_u"],
                            "entries": [(device, entry)]}, settings, fail_fast=fail_fast) for device, entry in entries]
        return {"max_position_error": max((r["max_position_error"] for r in results), default=0.),
                "max_velocity_error": max((r["max_velocity_error"] for r in results), default=0.),
                **{key: all(r[key] for r in results) for key in
                   ("entry_monotonic", "simultaneous_start", "limits_passed", "passed")}}
    device, entry = entries[0]
    index = entry["index"]
    key = (plan["u0"], plan["clock_start_u"], entry["kind"], entry["join"],
           tuple((m["send_u"], *(m["move"][n] for n in ("pos", "vel", "accVel", "decVel")))
                 for m in entry["moves"]), settings["entry_position_tolerance"],
           _ENTRY_MATCH_VELOCITY_TOLERANCE, id(device.tracks[index]), device.current[index],
           device.lower[index], device.upper[index], *device.prepare_caps[index])
    cached = entry.get("_verification_certificate")
    if cached is not None and cached[0] == key:
        return cached[1]
    # 失败见证可提前返回，但不能把不完整失败指标放进完整验证证书。
    result = _verify_uncached(plan, settings, fail_fast=fail_fast)
    if not fail_fast or result["passed"]:
        entry["_verification_certificate"] = (key, result)
    return result



def _verify_uncached(plan, settings, fail_fast=False):
    u0 = plan["u0"]
    worst_position, worst_velocity = 0., 0.
    monotonic, limits_ok, simultaneous = True, True, True
    for device, entry in plan["entries"]:
        _check_deadline()
        index = entry["index"]
        track = device.tracks[index]
        witness_cache, witness_key = _candidate_witness_cache(device,index,entry,u0,settings)
        cached_witness = witness_cache.get(witness_key) if witness_cache is not None else None
        if fail_fast and cached_witness is not None and u0 <= cached_witness[0]:
            # 相同准备指令/时刻/初态/原表后继即相同actual轨迹，区间仍包含已超限点。
            return {"max_position_error": cached_witness[1], "max_velocity_error": cached_witness[2],
                    "entry_monotonic": True, "simultaneous_start": True,
                    "limits_passed": True, "passed": False}
        sends = [(move["send_u"], move["move"]) for move in entry["moves"]]
        sends += [(u, command) for u, command in track.sends if u >= u0 - 1e-9]
        sends.sort(key=lambda item: item[0])
        actual = AxisTrack(device.current[index], sends)
        preparation = entry["moves"]
        simultaneous &= len(preparation) == 1 and abs(preparation[0]["send_u"] - plan["clock_start_u"]) <= 1e-8
        if entry["kind"] != "in_place":
            simultaneous &= bool(preparation) and abs(preparation[0]["send_u"] - plan["clock_start_u"]) <= 1e-8
        stop_limits = ((settings["entry_position_tolerance"]+1e-9,
                        _ENTRY_MATCH_VELOCITY_TOLERANCE+1e-9) if fail_fast else None)
        witness = []
        witness_limits = (settings["entry_position_tolerance"]+1e-9, _ENTRY_MATCH_VELOCITY_TOLERANCE+1e-9)
        axis_position, axis_velocity = _trajectory_errors_sweep(actual,track,u0,stop_limits=stop_limits,
                                                              witness_sink=witness,witness_limits=witness_limits)
        if witness and witness_cache is not None:
            previous = witness_cache.get(witness_key)
            if previous is None or witness[0][0] > previous[0]:
                if previous is None and len(witness_cache) >= 4096:
                    witness_cache.pop(next(iter(witness_cache)))
                witness_cache[witness_key] = witness[0]
        worst_position = max(worst_position,axis_position)
        worst_velocity = max(worst_velocity,axis_velocity)
        if fail_fast and (worst_position > stop_limits[0] or worst_velocity > stop_limits[1]):
            # 误差最大值只增不减：已有超限见证足以拒绝，不再扫描余下限制。
            # 完全停在同一停车点的接后失败仍是可安全复用的未来失败证据。
            aq, av = actual.state(u0)
            if av == 0. and aq == entry["moves"][0]["move"]["pos"]:
                device.rest_tail_failures.add((index, u0, aq))
            return {"max_position_error": worst_position, "max_velocity_error": worst_velocity,
                    "entry_monotonic": bool(monotonic), "simultaneous_start": bool(simultaneous),
                    "limits_passed": bool(limits_ok), "passed": False}
        direction = (1 if entry["join"][1] > 0 else -1) if entry["join"][1] else (
            1 if entry["join"][0] >= device.current[index] else -1)
        for segment in actual.segments:
            _check_deadline()
            left, right = max(segment.u0, plan["clock_start_u"]), segment.u1
            if right <= left or not math.isfinite(left):
                continue
            if not math.isfinite(right):
                right = left
            left_q, left_v = segment.state(left)
            right_q, right_v = segment.state(right)
            positions = [left_q,right_q]
            velocities = [left_v,right_v]
            if segment.a:
                zero = segment.u0 - segment.v0 / segment.a * 1000
                if left < zero < right:
                    positions.append(segment.state(zero)[0])
            limits_ok &= (min(positions) >= device.lower[index] - 1e-8
                          and max(positions) <= device.upper[index] + 1e-8
                          and max(abs(value) for value in velocities) <= device.reposition_velocity[index] + 1e-8)
            limit = device.reposition_acceleration[index] if segment.a * sum(velocities) >= 0 else device.reposition_deceleration[index]
            limits_ok &= abs(segment.a) <= limit + 1e-8
            if left < u0 - 1e-8 and entry["kind"] != "in_place":
                end = min(right, u0)
                if entry["kind"] != "reposition_then_run_up":
                    monotonic &= min(segment.state(left)[1] * direction, segment.state(end)[1] * direction) >= -1e-7
                # 不规划停等或延迟起步；静止目标只允许1ms以内的编码停稳时差。
                rounding_ms = max(_ARRIVAL_TOLERANCE_MS, 10 ** (-settings["entry_send_time_decimals"]))
                simultaneous &= not (end > left + rounding_ms + 1e-7 and abs(segment.a) < 1e-10 and abs(segment.state(left)[1]) < 1e-10)
        for _, command in sends:
            _check_deadline()
            limits_ok &= device.lower[index] - 1e-8 <= command["pos"] <= device.upper[index] + 1e-8
            limits_ok &= -214748364.8 <= command["pos"] <= 214748364.7
            limits_ok &= max(command[key] for key in ("vel", "accVel", "decVel")) <= _RATE_LIMIT + 1e-8
            for key, maximum in (("vel", device.reposition_velocity[index]),
                                 ("accVel", device.reposition_acceleration[index]),
                                 ("decVel", device.reposition_deceleration[index])):
                # 不存在的虚轴max=0仅允许当前位置保持；真实运动仍在上面按0能力验证。
                limits_ok &= command[key] <= maximum + 1e-8 or (entry["kind"] == "in_place" and maximum == 0)
    if (worst_position > settings["entry_position_tolerance"]+1e-9
            or worst_velocity > _ENTRY_MATCH_VELOCITY_TOLERANCE+1e-9):
        aq, av = actual.state(u0)
        if av == 0. and aq == entry["moves"][0]["move"]["pos"]:
            device.rest_tail_failures.add((index, u0, aq))
    return {"max_position_error": worst_position, "max_velocity_error": worst_velocity,
            "entry_monotonic": bool(monotonic), "simultaneous_start": bool(simultaneous),
            "limits_passed": bool(limits_ok),
            "passed": bool(worst_position <= settings["entry_position_tolerance"] + 1e-9
                           and worst_velocity <= _ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9
                           and monotonic and simultaneous and limits_ok)}



###############################################################################
# 九、对外入口
###############################################################################

def calculate_nonforced_entry(parameters):
    """输入公共参数字典，返回接入方案；不修改输入。status：planned / infeasible / invalid_input。"""
    token = _ENTRY_DEADLINE.set(_clock()+_CALCULATION_TIMEOUT_SECONDS)
    try:
        result = _calculate(parameters)
        _check_deadline()
        return result
    except EntryCalculationTimeout:
        return _timeout_result(parameters)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        return {"status": "invalid_input", "message": str(error), "algorithm_version": ALGORITHM_VERSION}
    finally:
        _ENTRY_DEADLINE.reset(token)


def _calculate(parameters):
    if not isinstance(parameters, dict):
        raise ValueError("输入须为对象")
    settings = _settings_of(parameters)
    command = _command_of(parameters)
    models = parameters.get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("models不能为空")
    states = _runtime_states(parameters)
    reverse = command["reverse"]
    direction = -1 if reverse else 1
    unit = settings["unit_ms"]
    parsed_pieces = [_pieces_of(model, unit) for model in models]
    spans = [(pieces[0][0], pieces[-1][1]) for pieces in parsed_pieces]
    first = min(span[0] for span in spans)
    last = max(span[1] for span in spans)
    run_origin = last if reverse else first

    def to_run(curve):
        return direction * (curve - run_origin)

    def to_curve(run):
        return run_origin + direction * run

    devices = [_Device(model, states, direction, run_origin, command["loop"], settings, pieces)
               for model,pieces in zip(models,parsed_pieces)]

    reference = command["stopped_time_ms"]
    clamped = False
    if reference is not None and not first <= reference <= last:
        reference, clamped = min(max(reference, first), last), True

    attempts, evaluated = [], 0
    plan, selected_window, reference_window = None, None, None
    if command["use_specified_time"]:
        mode = "specified_frame"
        specified = command["specified_time_ms"]
        if not first <= specified <= last:
            raise ValueError("指定帧超出动作首末范围")
        try:
            plan = _plan_at(devices, to_run(specified), settings, allow_two_step=True)
        except EntryInfeasible as error:
            return _infeasible(command, mode, reference, f"指定帧无法接入：{error}", attempts, error.reasons)
    elif not command["nearest_start"]:
        mode = "action_boundary"
        try:
            plan = _plan_at(devices, 0., settings, allow_two_step=True)
        except EntryInfeasible as error:
            return _infeasible(command, mode, reference, f"起点无法接入：{error}", attempts, error.reasons)
    else:
        mode = "current_segment_first" if reference is not None else "nearest_whole_action"
        max_skip = settings["entry_max_skip_ms"] if reference is not None else None
        limit_u, limited = None, False
        if max_skip is not None:
            # 截止帧往参考帧一侧取到帧网格上：截后的候选正好是原候选里不超限的那部分
            resolution = settings["frame_resolution_ms"]
            limit_curve = reference+direction*max_skip
            limit_curve = (math.floor(limit_curve/resolution+1e-9) if direction > 0
                           else math.ceil(limit_curve/resolution-1e-9))*resolution
            limit_u = to_run(limit_curve)
        for low, high, phase in _windows(devices, first, last, reverse, reference):
            _check_deadline()
            if reference_window is None:
                reference_window = [low, high]
            lower, upper = sorted((to_run(low), to_run(high)))
            attempt = {"range_ms": [low, high], "phase": phase}
            if limit_u is not None and upper > limit_u+1e-9:
                limited = True
                if lower > limit_u+1e-9:
                    attempts.append({**attempt, "status": "beyond_max_skip"})
                    continue
                upper = limit_u
                attempt["searched_range_ms"] = sorted((to_curve(lower), to_curve(upper)))
            best, count = _search_window(devices, lower, upper, to_curve, to_run, settings)
            evaluated += count
            attempts.append({**attempt, "status": "planned" if best else "infeasible"})
            if best is not None:
                plan, selected_window = best, [low, high]
                break
        if plan is None:
            reasons = [f"{device.axis_labels[index]}{device.table_limit_reasons[index]}"
                       for device in devices for index in range(3) if device.table_limit_reasons[index]]
            message = "运行方向上没有可接入的帧"
            if limited:
                message += f"（接入帧最多比参考帧靠后{_ms_text(max_skip)}ms）"
            return _infeasible(command, mode, reference, message, attempts, reasons)

    return _planned(devices, plan, command, settings, mode, reference, clamped, reference_window,
                    selected_window, attempts, evaluated, to_curve)


def _infeasible(command, mode, reference, message, attempts, reasons):
    return {"status": "infeasible", "message": message, "algorithm_version": ALGORITHM_VERSION,
            "trajectory_run": False, "reverse": command["reverse"], "frame_selection_mode": mode,
            "reference_frame_ms": reference, "selected_curve_time_ms": None,
            "segment_search_attempts": attempts, "reasons": reasons}


def _route(device):
    return {"plc_id": device.plc_id, "model_id": device.model_id, "device_id": device.device_id}


def _planned(devices, plan, command, settings, mode, reference, clamped, reference_window,
             selected_window, attempts, evaluated, to_curve):
    _check_deadline()
    decimals = settings["entry_send_time_decimals"]
    u0 = plan["u0"]
    clock_start = plan["clock_start_u"]
    for _, entry in plan["entries"]:
        for move in entry["moves"]:
            curve_time = round(to_curve(clock_start), decimals)
            move["send_u"] = u0 + (curve_time-to_curve(u0)) * (-1 if command["reverse"] else 1)
    verification = _verify(plan, settings)
    entry_moves, by_device = [], {}
    for device, entry in plan["entries"]:
        _check_deadline()
        by_device.setdefault(id(device), (device, []))[1].append(entry)
        for move in entry["moves"]:
            entry_moves.append({
                **_route(device), "axis": entry["axis"], "axisIndex": entry["index"], "role": move["role"],
                "sendTime": round(to_curve(move["send_u"]), decimals),
                "beforeJoinMs": round(u0 - move["send_u"], decimals),
                **move["move"],
            })
    entry_moves.sort(key=lambda item: (-item["sendTime"] if command["reverse"] else item["sendTime"],
                                       item["model_id"], item["axisIndex"]))
    device_rows = []
    for device, entries in by_device.values():
        join, join_velocity, axes = [None] * 3, [None] * 3, []
        for entry in entries:
            join[entry["index"]] = round(entry["join"][0], 6)
            join_velocity[entry["index"]] = round(entry["join"][1], 6)
            axes.append({key: (round(value, 6) if isinstance(value, float) else value)
                         for key, value in entry.items() if key in ("axis", "kind", "lead_ms", "distance", "run_up_distance")})
        device_rows.append({**_route(device), "current_HPY": device.current, "join_HPY": join,
                            "join_velocity_HPY": join_velocity, "axes": axes})
    selected = round(to_curve(u0), 6)
    if abs(selected - round(selected)) < 1e-6:
        selected = int(round(selected))
    result = {
        "status": "planned" if verification["passed"] else "verification_failed",
        "message": "接入方案已生成，核对通过" if verification["passed"] else "接入方案核对未通过，请检查输入",
        "algorithm_version": ALGORITHM_VERSION,
        "trajectory_run": False,
        "reverse": command["reverse"],
        "selected_curve_time_ms": selected,
        "clock_start_ms": round(to_curve(clock_start), decimals),
        "entry_lead_ms": round(plan["lead_ms"], decimals),
        "frame_selection_mode": mode,
        "reference_frame_ms": reference,
        "reference_clamped": clamped,
        "reference_segment_range_ms": reference_window,
        "selected_segment_range_ms": selected_window,
        "segment_search_attempts": attempts,
        "candidates_evaluated": evaluated,
        "max_skip_ms": settings["entry_max_skip_ms"] if mode == "current_segment_first" else None,
        "entry_moves": entry_moves,
        "devices": device_rows,
        "execution": {
            "rule": "曲线时钟从clock_start_ms开始走；时钟到entry_moves[].sendTime时给对应轴下发那条Move（每条只发一次）；"
                    "帧表中下发时刻早于selected_curve_time_ms的Move全部跳过，从selected_curve_time_ms起照帧表逐帧下发",
            "relative": "也可按相对时间执行：GO后经过entry_lead_ms到达selected_curve_time_ms；"
                        "每条接入Move在到达前beforeJoinMs下发（clock_start_ms可能早于动作首帧，甚至为负）",
            "reverse_clock": "反向时原曲线时钟从clock_start_ms往小走，sendTime都不小于selected_curve_time_ms",
            "run_up_moves": sum(1 for move in entry_moves if move["role"] == "run_up"),
            "speed_factor": "按输入执行曲线和真实最大能力计算，结果直接发送；外部再变倍率须重新校验",
            "mid_run_speed_change": "selected_curve_time_ms之前不做运行中调速",
        },
        "verification": {key: (round(value, 9) if isinstance(value, float) else value)
                         for key, value in verification.items()
                         if key in ("max_position_error", "max_velocity_error", "entry_monotonic", "passed")},
    }
    if settings["include_move_table"]:
        result["move_table"] = [
            {**_route(device), "axes": [
                [{key: command[key] for key in ("atMs", "target", "velocity", "acceleration", "deceleration", "passSpeed")}
                 for command in commands] for commands in device.commands]}
            for device in devices]
    return result


###############################################################################
# 十、命令行
###############################################################################

def main(input_path=None, output_path=None):
    source = Path(input_path) if input_path else Path(__file__).with_name("算法参数.json")
    target = Path(output_path) if output_path else source.with_name(source.stem + "-结果.json")
    try:
        parameters = json.loads(source.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        result = {"status": "invalid_input", "message": "输入读取失败 " + str(error)}
    else:
        result = calculate_nonforced_entry(parameters)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {key: result.get(key) for key in ("status", "selected_curve_time_ms", "clock_start_ms", "entry_lead_ms", "message")}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"完整结果已保存：{target}")
    return result


if __name__ == "__main__":
    outcome = main(sys.argv[1] if len(sys.argv) > 1 else None, sys.argv[2] if len(sys.argv) > 2 else None)
    if outcome.get("status") != "planned":
        raise SystemExit(1)
