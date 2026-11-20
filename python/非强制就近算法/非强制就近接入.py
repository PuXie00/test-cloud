"""非强制单Move接入。入口calculate_nonforced_entry(parameters)，输入输出保持原版格式。
每模型完整H/P/Y三行entry_moves共用同一发送时刻，组装为一条三轴准备Move。
无中间换速、无退回助跑、无额外交接指令；后面只有原表本来存在的Move。
搜索连续曲线候选，验证共同时间的位置/有符号速度以及其后整段自然续跑。
使用真实最大V/A/D，不用默认值覆盖；最终位置、速度、加减速度均为0.1精度，未参与轴保留实际位置。
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

ALGORITHM_VERSION = "nonforced_single_move_five_models_decimal_ad_modulo_20261120"
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

def _rotation_period_of(model):
    if model.get('model_type') != 4:
        return None
    geometry = model.get('geometry', {})
    if not isinstance(geometry, dict):
        raise ValueError('geometry须为对象')
    if 'workingStroke' in model and 'workingStroke' in geometry and model['workingStroke'] != geometry['workingStroke']:
        raise ValueError('workingStroke平铺字段与geometry配置冲突')
    period = _number(model.get('workingStroke', geometry.get('workingStroke')), '模型4 workingStroke')
    if period <= 0:
        raise ValueError('模型4 workingStroke须为真实PLC配置的正周期')
    return period


def _rotation_coordinate(value, period):
    result = value % period
    tolerance = max(1e-10, 16 * math.ulp(max(1., abs(value), period)))
    return 0. if result <= tolerance or period - result <= tolerance else result


def _rotation_lift(target, current, period):
    delta = (target - current) % period
    tolerance = max(1e-10, 32 * math.ulp(max(1., abs(target), abs(current), period)))
    if abs(delta - period / 2) <= tolerance:
        raise EntryInfeasible(['旋转目标恰好半周期，缺少PLC等距选向信息，无法唯一核验shortest路径'])
    if delta > period / 2:
        delta -= period
    if abs(delta) <= tolerance or abs(abs(delta) - period) <= tolerance:
        delta = 0.
    return current + delta


def _rotation_wire_goal(value, period, quantized):
    position = _rotation_coordinate(value, period)
    if quantized:
        position = quantize(position)
    if position >= period:
        position = 0.
    return position


def _axis_period(device, index):
    return device.position_period_H if index == 0 else None


def _position_interval_allowed(device, index, lower, upper, tolerance=1e-8):
    minimum, maximum = device.lower[index], device.upper[index]
    period = _axis_period(device, index)
    if period is None:
        return lower >= minimum - tolerance and upper <= maximum + tolerance
    if maximum - minimum >= period - tolerance:
        return True
    if not math.isfinite(minimum) or not math.isfinite(maximum) or maximum < minimum:
        return False
    cycle = math.floor((lower - minimum + tolerance) / period)
    return lower >= minimum + cycle * period - tolerance and upper <= maximum + cycle * period + tolerance


def _stage_move_profile(q0, v0, target, cap, acc, dec, points, ratio, lower, upper):
    """理想连续事件模型，返回PLC多级普通Move的实际恒加速度阶段。

    points为内部段点，ratio为0至1的过点速度比例。外部指令只有一条，
    本函数还原runningDof在越过段点时发出的内部覆盖Move。
    全局move_profile负责标准MC_MoveAbsolute的积分，_check_deadline负责预算。
    """
    values = (q0, v0, target, cap, acc, dec, ratio, lower, upper, *points)
    if not all(math.isfinite(value) for value in values):
        raise ValueError('多级升降参数须为有限数值')
    if min(cap, acc, dec) <= 0 or not 0 <= ratio <= 1:
        raise ValueError('多级升降须使用正V/A/D及0至1的过点比例')
    if lower >= upper or len(points) > 10 or any(
            not lower < point < upper for point in points) or any(
            left >= right for left, right in zip(points, points[1:])):
        raise ValueError('多级内部段点须严格递增并位于软行程内，数量不超过10')
    tolerance = max(1e-8, 64 * math.ulp(max(1., abs(q0), abs(target), abs(lower), abs(upper))))
    if not lower - tolerance <= q0 <= upper + tolerance:
        raise ValueError('多级升降初始位置超出软行程')
    target = min(upper, max(lower, target))
    direction = 1 if target > q0 else -1 if target < q0 else 0
    if not direction:
        if abs(v0) <= 1e-9:
            return []
        raise ValueError('多级升降同位目标仍有初速，会越过目标后折返')

    boundaries = [lower, *points, upper]
    crossed = [point for point in points
               if direction * (point - q0) > 1e-6 and direction * (target - point) > 1e-6]
    if direction < 0:
        crossed.reverse()
    goals = []
    for point in crossed:
        speed = min(cap * ratio, math.sqrt(2 * acc * abs(point - q0)),
                    math.sqrt(2 * dec * abs(target - point)))
        # Calcute_time末段延长到零速后的停车位置，化简后消去局部峰速。
        goal = point + direction * speed * speed / (2 * dec)
        goals.append(min(goal, target) if direction > 0 else max(goal, target))
    goals.append(target)

    def choose_goal(position, velocity):
        # 越过边界后的右极限，用于理想事件时刻。零速过点按指令方向续接。
        side = velocity if abs(velocity) > 1e-9 else direction
        position_side = math.nextafter(position, math.inf if side > 0 else -math.inf)
        if abs(target - position_side) < 1.:
            return target
        index = (bisect.bisect_right(boundaries, position_side) - 1 if direction > 0 else
                 bisect.bisect_left(boundaries, position_side) - 1)
        if not 0 <= index < len(boundaries) - 1:
            raise ValueError('多级升降运动离开有效分段行程')
        next_boundary = boundaries[index + 1] if direction > 0 else boundaries[index]
        eligible = [goal for goal in goals if direction * (goal - next_boundary) >= -1e-6
                    or abs(goal - target) <= 1e-6]
        return min(eligible, key=lambda goal: abs(goal - next_boundary))

    def validate_phase(duration, position, velocity, acceleration):
        positions = [position, position + velocity * duration + acceleration * duration * duration / 2]
        if acceleration:
            zero = -velocity / acceleration
            if 0 < zero < duration:
                positions.append(position + velocity * zero + acceleration * zero * zero / 2)
        if min(positions) < lower - tolerance or max(positions) > upper + tolerance:
            raise ValueError('多级升降实际Move超出软行程')
        if any(direction * (position - target) > tolerance for position in positions):
            raise ValueError('多级升降实际Move会越过最终目标后折返')

    def first_event(duration, position, velocity, acceleration):
        first = None
        for boundary in events:
            if abs(acceleration) <= 1e-14:
                roots = [(boundary - position) / velocity] if velocity else []
            else:
                discriminant = velocity * velocity + 2 * acceleration * (boundary - position)
                if discriminant < 0:
                    continue
                root = math.sqrt(discriminant)
                term = -velocity - math.copysign(root, velocity)
                roots = ([term / acceleration, 2 * (position - boundary) / term]
                         if term else [0.])
            for seconds in roots:
                if 1e-11 < seconds <= duration + 1e-12 and (first is None or seconds < first[0]):
                    first = min(duration, seconds), boundary
        return first

    # 1单位门槛只在阶段计划已存在时改回最终目标。起步就在该范围内时，
    # 原始外部Move直接生效；若初速令其离开该范围，会产生新的规划状态。
    if abs(target - q0) < 1.:
        phases = move_profile(q0, v0, target, cap, acc, dec)
        for phase in phases:
            validate_phase(*phase)
        if any(abs(phase[1] - target) >= 1. for phase in phases):
            raise ValueError('近目标带初速的多级Move会重新进入分段规划，当前候选不采用')
        return phases

    events = list(points)
    final_threshold = target - direction
    if lower < final_threshold < upper:
        events.append(final_threshold)
    position, velocity = q0, v0
    active_goal = choose_goal(position, velocity)
    pending = list(move_profile(position, velocity, active_goal, cap, acc, dec))
    result = []
    for _ in range(256):
        _check_deadline()
        if not pending:
            if abs(position - active_goal) <= tolerance and abs(velocity) <= 1e-7:
                position, velocity = active_goal, 0.
            if abs(position - target) <= tolerance and abs(velocity) <= 1e-7:
                return result
            new_goal = choose_goal(position, velocity)
            if abs(new_goal - active_goal) <= 1e-6:
                raise ValueError('多级升降内部停车后未能进入下一段')
            active_goal = new_goal
            pending = list(move_profile(position, velocity, active_goal, cap, acc, dec))
            continue
        duration, position, velocity, acceleration = pending.pop(0)
        event = first_event(duration, position, velocity, acceleration)
        used = duration if event is None else event[0]
        validate_phase(used, position, velocity, acceleration)
        if used > 1e-14:
            result.append((used, position, velocity, acceleration))
        position = position + velocity * used + acceleration * used * used / 2
        velocity += acceleration * used
        if event is not None:
            position = event[1]
            if duration - used > 1e-12:
                pending.insert(0, (duration - used, position, velocity, acceleration))
            elif not pending and abs(position - active_goal) <= tolerance and abs(velocity) <= 1e-7:
                position, velocity = active_goal, 0.
            new_goal = choose_goal(position, velocity)
            if abs(new_goal - active_goal) > 1e-6:
                active_goal = new_goal
                pending = list(move_profile(position, velocity, active_goal, cap, acc, dec))
    raise ValueError('多级升降内部事件规划未收敛')


def _device_track(device, index, anchor, sends):
    if _stage_axis(device, index):
        return StageAxisTrack(anchor, sends, device.stage_parameters)
    return AxisTrack(anchor, sends, period=_axis_period(device, index))


def _reference_shift(device, index, u):
    period = _axis_period(device, index)
    if period is None:
        return 0.
    position = device.tracks[index].state(u)[0]
    shift = _rotation_lift(position, device.current[index], period) - position
    return round(shift / period) * period


def _reference_track(device, index, u, shift=None):
    base = device.tracks[index]
    shift = _reference_shift(device, index, u) if shift is None else shift
    if shift == 0:
        return base
    views = getattr(device, '_rotation_reference_views', None)
    if views is None:
        views = device._rotation_reference_views = {}
    key = (index, shift)
    if key not in views:
        view = object.__new__(AxisTrack)
        view.anchor = base.anchor + shift
        view.period = base.period
        view.sends, view.send_times, view.starts = base.sends, base.send_times, base.starts
        view.segments = [Segment(segment.u0, segment.u1, segment.q0 + shift, segment.v0,
                                 segment.a, segment.command, segment.target + shift)
                         for segment in base.segments]
        views[key] = view
    return views[key]


def _planning_profile(device, index, current, velocity, command):
    target = command['pos']
    if _stage_axis(device, index):
        points, ratio, lower, upper = device.stage_parameters
        try:
            phases = _stage_move_profile(current, velocity, target, command['vel'], command['accVel'],
                                         command['decVel'], points, ratio, lower, upper)
        except ValueError as error:
            raise EntryInfeasible([f'多级准备Move无法执行，{error}']) from error
        return phases, target
    period = _axis_period(device, index)
    if period is not None:
        target = _rotation_lift(target, current, period)
    return move_profile(current, velocity, target, command['vel'], command['accVel'], command['decVel']), target


def _rotation_branch_boundaries(device, lower, upper):
    period = device.position_period_H
    if period is None:
        return []
    result = []
    current = device.current[0]
    for segment in device.tracks[0].segments:
        _check_deadline()
        left, right = max(lower, segment.u0), min(upper, segment.u1)
        if right <= left or not math.isfinite(left) or not math.isfinite(right):
            continue
        positions = [segment.state(left)[0], segment.state(right)[0]]
        if segment.a:
            zero = segment.u0 - segment.v0 / segment.a * 1000
            if left < zero < right:
                positions.append(segment.state(zero)[0])
        first = math.ceil((min(positions) - current) / period - .5 - 1e-12)
        last = math.floor((max(positions) - current) / period - .5 + 1e-12)
        for cycle in range(first, last + 1):
            _check_deadline()
            target = current + (cycle + .5) * period
            q, v = segment.state(left)
            if abs(segment.a) <= 1e-14:
                roots = [(target - q) / v] if abs(v) > 1e-14 else []
            else:
                discriminant = v * v + 2 * segment.a * (target - q)
                roots = [] if discriminant < 0 else [(-v + sign * math.sqrt(discriminant)) / segment.a for sign in (-1, 1)]
            result.extend(left + root * 1000 for root in roots if left < left + root * 1000 < right)
    return result


class Segment:
    """一段恒加速度运动；u0/u1 为运行方向上的毫秒，command 为当时生效的 Move（起步前为 None）。"""

    __slots__ = ("u0", "u1", "q0", "v0", "a", "command", "target")

    def __init__(self, u0, u1, q0, v0, a, command, target=None):
        self.u0, self.u1, self.q0, self.v0, self.a, self.command = u0, u1, q0, v0, a, command
        self.target = q0 if target is None else target

    def state(self, u):
        if not self.v0 and not self.a:
            return self.q0, 0.
        dt = (u - self.u0) / 1000
        return self.q0 + self.v0 * dt + .5 * self.a * dt * dt, self.v0 + self.a * dt


class AxisTrack:
    """一个轴从 anchor 静止开始、依次执行 sends 得到的轨迹。sends = [(u_ms, Move)] 按 u 递增。"""

    def __init__(self, anchor, sends, period=None):
        self.anchor = anchor
        self.period = period
        self.sends = list(sends)
        self.send_times = [u for u, _ in self.sends]
        self.segments = []
        active_u, active_phases, active_target, active_command = -math.inf, [], anchor, None
        for u, command in self.sends:
            _check_deadline()
            q, v = self._active_state(active_u, active_phases, active_target, u)
            self._emit(active_u, active_phases, active_target, active_command, u)
            target = _rotation_lift(command["pos"], q, period) if period is not None else command["pos"]
            active_u, active_target, active_command = u, target, command
            active_phases = move_profile(q, v, target, command["vel"], command["accVel"], command["decVel"])
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
            self.segments.append(Segment(-math.inf, until, self.anchor, 0., 0., None, self.anchor))
            return
        u = active_u
        for duration, q, v, a in phases:
            end = u + duration * 1000
            if u >= until:
                return
            if end > u:
                self.segments.append(Segment(u, min(end, until), q, v, a, command, target))
            u = end
        if u < until:
            self.segments.append(Segment(u, until, target, 0., 0., command, target))

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


def _stage_parameters_of(model, lower, upper):
    if model.get('model_type') != 3:
        return None
    nested = model.get('geometry', {})
    if not isinstance(nested, dict):
        raise ValueError('多级升降geometry须为对象')
    values = {}
    for name in ('AdjustDistance', 'deceleration_ratio', 'nSections'):
        if name in model and name in nested and model[name] != nested[name]:
            raise ValueError(f'多级升降{name}平铺字段与geometry配置冲突')
        if name in model or name in nested:
            values[name] = model.get(name, nested.get(name))
    points = values.get('AdjustDistance', ())
    if points is None:
        points = ()
    if not isinstance(points, (list, tuple)) or len(points) > 10:
        raise ValueError('多级升降AdjustDistance须为最多10槽的内部段点位置列表')
    count = values.get('nSections', len(points))
    if type(count) is not int or not 0 <= count <= 10:
        raise ValueError('多级升降nSections须为0至10的整数')
    if len(points) < count:
        raise ValueError(f'多级升降nSections启用{count}个段点，须提供至少{count}项AdjustDistance')
    if values.get('deceleration_ratio') is not None:
        ratio = _number(values['deceleration_ratio'], 'deceleration_ratio')
        if not 0 <= ratio <= 100:
            raise ValueError('多级升降deceleration_ratio须为0至100百分数')
    elif count:
        raise ValueError('多级升降启用内部段点时须提供PLC实际deceleration_ratio')
    else:
        ratio = 0.
    if not count:
        return None
    points = tuple(_number(value, 'AdjustDistance') for value in points[:count])
    if not math.isfinite(lower) or not math.isfinite(upper) or lower >= upper:
        raise ValueError('多级升降须提供有限且有序的H软行程')
    if any(not lower < point < upper for point in points) or any(
            left >= right for left, right in zip(points, points[1:])):
        raise ValueError('多级升降内部段点须严格递增且位于H软行程内')
    return points, ratio / 100., lower, upper


def _stage_axis(device, index):
    parameters = getattr(device, 'stage_parameters', None)
    return index == 0 and parameters is not None and bool(parameters[0])


class StageAxisTrack(AxisTrack):
    def __init__(self, anchor, sends, parameters):
        self.anchor, self.period, self.stage_parameters = anchor, None, parameters
        self.sends = list(sends)
        self.send_times = [u for u, _ in self.sends]
        self.segments = []
        active_u, phases, target, active_command = -math.inf, [], anchor, None
        points, ratio, lower, upper = parameters
        for u, command in self.sends:
            _check_deadline()
            q, v = self._active_state(active_u, phases, target, u)
            self._emit(active_u, phases, target, active_command, u)
            target, active_u, active_command = command['pos'], u, command
            try:
                phases = _stage_move_profile(q, v, target, command['vel'], command['accVel'],
                                             command['decVel'], points, ratio, lower, upper)
            except ValueError as error:
                raise EntryInfeasible([f'多级升降实际Move无法执行，{error}']) from error
        self._emit(active_u, phases, target, active_command, math.inf)
        self.starts = [segment.u0 for segment in self.segments]


def _acceleration_rates_near(value, limit, settings, radius=1):
    return _rates_near(value, limit, settings, radius, .1)


def _stage_state_times(phases, target, q, v, settings):
    result, elapsed = [], 0.
    for duration, position, velocity, acceleration in phases:
        if abs(acceleration) <= 1e-14:
            roots = [(q - position) / velocity] if abs(velocity) > 1e-14 else []
        else:
            discriminant = velocity * velocity + 2 * acceleration * (q - position)
            roots = [] if discriminant < 0 else [(-velocity + sign * math.sqrt(discriminant)) / acceleration
                                               for sign in (-1, 1)]
        for seconds in roots:
            if -1e-10 <= seconds <= duration + 1e-10:
                seconds = min(duration, max(0., seconds))
                if abs(velocity + acceleration * seconds - v) <= _ENTRY_MATCH_VELOCITY_TOLERANCE:
                    result.append(elapsed + seconds)
        elapsed += duration
    if abs(q - target) <= settings['entry_position_tolerance'] and abs(v) <= settings['entry_velocity_tolerance']:
        result.append(elapsed)
    return result


def _stage_axis_request(device, index, u0, segment, request, settings):
    current, q, w = request['current'], request['q'], request['w']
    V, A, D = request['V'], request['A'], request['D']
    command = request['command']
    if not w and abs(q-current) <= settings['entry_position_tolerance']:
        request.update(family='hold', minimum=0., maximum=math.inf)
        return request
    target = _target_on_wire(q, device, index, settings) if not w else command['pos'] if command else q
    direction = (1 if request['v'] > 0 else -1) if w else (1 if target > current else -1)
    distance = direction * (q - current)
    if w > V + 1e-8 or distance < w*w/(2*A) - 1e-9:
        raise EntryInfeasible([f'{device.axis_labels[index]}多级准备距离或速度能力不足'])
    minimum_acc = min(_acceleration_rates_near(.1, A, settings, 2) or [A])
    minimum_dec = min(_acceleration_rates_near(.1, D, settings, 2) or [D])
    minimum_vel = min(_rates_near(max(w, .1), V, settings, 2) or [V])
    slow = dict(pos=target, vel=max(w, minimum_vel), accVel=minimum_acc, decVel=minimum_dec)
    phases, lifted = _planning_profile(device, index, current, 0., slow)
    maximum = profile_duration(phases)
    time_seeds = []
    seed_commands = [dict(pos=target, vel=V, accVel=A, decVel=D)]
    if command is not None:
        seed_commands.insert(0, {**command, 'pos': target})
    for seed in seed_commands:
        try:
            phases, lifted = _planning_profile(device, index, current, 0., seed)
        except EntryInfeasible:
            continue
        time_seeds.extend(_stage_state_times(phases, lifted, q, request['v'], settings))
    if not w:
        fastest = seed_commands[-1]
        phases, lifted = _planning_profile(device, index, current, 0., fastest)
        minimum = profile_duration(phases)
        family = 'stage_rest'
    else:
        peak = min(V, math.sqrt((2*A*D*distance + A*w*w)/(A+D)))
        minimum = (distance + peak*peak/(2*A) + (peak-w)*(peak-w)/(2*D))/peak
        family = 'stage'
    request.update(family=family, s=direction, L=abs(q-current), target=target,
                   minimum=minimum, maximum=max(minimum, maximum),
                   time_seeds=time_seeds, stage_seed_commands=seed_commands)
    return request


def _stage_candidate_moves(request, seconds, settings):
    device, index = request['device'], request['index']
    V, A, D = request['V'], request['A'], request['D']
    current, target, q, v = request['current'], request['target'], request['q'], request['v']
    if seconds <= 0:
        return
    q_tolerance = settings['entry_position_tolerance'] + 1e-9
    v_tolerance = _ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9
    minimum_acc = min(_acceleration_rates_near(.1, A, settings, 2) or [A])
    minimum_dec = min(_acceleration_rates_near(.1, D, settings, 2) or [D])
    minimum_vel = min(_rates_near(.1, V, settings, 2) or [V])
    seeds = list(request['stage_seed_commands'])
    if request['family'] == 'stage_rest':
        scale = min(1., request['minimum'] / seconds)
        seeds.append(dict(pos=target, vel=V*scale, accVel=A*scale*scale, decVel=D*scale*scale))
    else:
        seeds.append(dict(pos=target, vel=min(V, max(abs(v), minimum_vel)),
                          accVel=min(A, max(minimum_acc, abs(v)/seconds)), decVel=D))
    discoveries = []
    seen = set()

    def evaluate(cap, acc, dec):
        _check_deadline()
        command = dict(pos=target, vel=cap, accVel=acc, decVel=dec)
        try:
            phases, lifted = _planning_profile(device, index, current, 0., command)
        except EntryInfeasible:
            return None
        state = _profile_at(phases, lifted, seconds)
        return state, phases, lifted, command

    def encoded(cap, acc, dec, radius=1):
        for actual_cap in _rates_near(cap, V, settings, radius):
            for actual_acc in _acceleration_rates_near(acc, A, settings, radius):
                for actual_dec in _acceleration_rates_near(dec, D, settings, radius):
                    key = actual_cap, actual_acc, actual_dec
                    if key in seen:
                        continue
                    seen.add(key)
                    answer = evaluate(*key)
                    if answer is None:
                        continue
                    (actual_q, actual_v), phases, lifted, command = answer
                    discoveries.extend(_stage_state_times(phases, lifted, q, v, settings))
                    if abs(actual_q-q) <= q_tolerance and abs(actual_v-v) <= v_tolerance:
                        if request['family'] != 'stage_rest' or seconds-profile_duration(phases) <= _ARRIVAL_TOLERANCE_MS/1000+1e-9:
                            yield command

    for seed in seeds:
        yield from encoded(seed['vel'], seed['accVel'], seed['decVel'])

    decelerations = {D, *(seed['decVel'] for seed in seeds)}
    for dec_seed in decelerations:
        for dec in _acceleration_rates_near(dec_seed, D, settings, 1):
            if request['family'] == 'stage_rest':
                scale = min(1., request['minimum']/seconds)
                for acc in _acceleration_rates_near(A*scale*scale, A, settings, 2):
                    left, right = minimum_vel, V
                    for _ in range(24):
                        cap = (left+right)/2
                        answer = evaluate(cap, acc, dec)
                        if answer is None:
                            break
                        duration = profile_duration(answer[1])
                        if duration > seconds:
                            left = cap
                        else:
                            right = cap
                    yield from encoded((left+right)/2, acc, dec, 1)
                continue
            velocities = {V, min(V, max(abs(v), minimum_vel)), *(seed['vel'] for seed in seeds)}
            for cap_seed in velocities:
                cap = min(V, max(minimum_vel, cap_seed))
                left, right = minimum_acc, A
                low, high = evaluate(cap, left, dec), evaluate(cap, right, dec)
                if low is None or high is None:
                    continue
                if (low[0][0]-q)*(high[0][0]-q) <= 0:
                    for _ in range(24):
                        acc = (left+right)/2
                        answer = evaluate(cap, acc, dec)
                        if answer is None:
                            break
                        if request['s']*(answer[0][0]-q) < 0:
                            left = acc
                        else:
                            right = acc
                    yield from encoded(cap, (left+right)/2, dec, 1)

    # 时间提示来自同一编码参数的真实stage状态，下一次仍要重新完整求解和验证。
    existing = request.get('_stage_time_hints', [])
    request['_stage_time_hints'] = sorted(set(existing + discoveries), key=lambda value: abs(value-seconds))[:16]


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


def _compiled_curve(pieces, unit, direction, run_origin, loop, settings, period_h=None, stage_parameters=None):
    global _COMPILED_CURVE_PIECES
    _check_deadline()
    signature = (unit,direction,run_origin,loop,period_h,stage_parameters,settings["entry_quantize_protocol"],
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
        if axis == 0 and period_h is not None:
            commands = [{**command, "target": _rotation_wire_goal(command["target"], period_h, settings["entry_quantize_protocol"])} for command in commands]
        ordered = list(reversed(commands)) if direction<0 else commands
        sends = [(direction*(command["atMs"]-run_origin),_wire_move(command,settings)) for command in ordered]
        anchor = end_positions[axis] if direction<0 else start_positions[axis]
        all_commands.append(commands)
        all_tracks.append(AxisTrack(anchor,sends,period=period_h if axis == 0 else None))
    weight = len(pieces)
    if weight <= _COMPILED_CURVE_MAX_PIECES:
        _COMPILED_CURVES[signature] = (weight,all_commands,all_tracks)
        _COMPILED_CURVE_PIECES += weight
        while (len(_COMPILED_CURVES)>_COMPILED_CURVE_MAX_ENTRIES
               or _COMPILED_CURVE_PIECES>_COMPILED_CURVE_MAX_PIECES):
            _,removed = _COMPILED_CURVES.popitem(last=False)
            _COMPILED_CURVE_PIECES -= removed[0]
    return all_commands,all_tracks


class _SpeedInterval:
    """内部双精度区间：每次运算向外扩一格，避免把计算范围向内舍入。"""
    __slots__ = ("lo", "hi")

    def __init__(self, lo, hi=None):
        self.lo = float(lo)
        self.hi = self.lo if hi is None else float(hi)

    @staticmethod
    def outward(lo, hi):
        return _SpeedInterval(math.nextafter(lo, -math.inf), math.nextafter(hi, math.inf))

    def __add__(self, other):
        if not isinstance(other, _SpeedInterval):
            other = _SpeedInterval(other)
        if self.lo == self.hi == 0:
            return other
        if other.lo == other.hi == 0:
            return self
        return self.outward(self.lo + other.lo, self.hi + other.hi)

    __radd__ = __add__

    def __neg__(self):
        return _SpeedInterval(-self.hi, -self.lo)

    def __sub__(self, other):
        return self + (-other if isinstance(other, _SpeedInterval) else -float(other))

    def __mul__(self, other):
        if not isinstance(other, _SpeedInterval):
            other = _SpeedInterval(other)
        if self.lo == self.hi == 0 or other.lo == other.hi == 0:
            return _SpeedInterval(0)
        values = (self.lo*other.lo, self.lo*other.hi, self.hi*other.lo, self.hi*other.hi)
        return self.outward(min(values), max(values))

    __rmul__ = __mul__

    def __truediv__(self, other):
        if not isinstance(other, _SpeedInterval):
            other = _SpeedInterval(other)
        if other.lo <= 0 <= other.hi:
            raise ValueError("速度上界的区间除数包含0")
        if self.lo == self.hi == 0:
            return _SpeedInterval(0)
        # 直接相除，避免先取倒数时小尺寸溢出；也减少中间区间对象。
        values = (self.lo/other.lo, self.lo/other.hi, self.hi/other.lo, self.hi/other.hi)
        return self.outward(min(values), max(values))

    def square(self):
        lower = 0.0 if self.lo <= 0 <= self.hi else min(self.lo*self.lo, self.hi*self.hi)
        upper = max(self.lo*self.lo, self.hi*self.hi)
        result = self.outward(lower, upper)
        result.lo = max(0.0, result.lo)
        return result

    def sqrt(self):
        result = self.outward(math.sqrt(max(0.0, self.lo)), math.sqrt(max(0.0, self.hi)))
        result.lo = max(0.0, result.lo)
        return result

    def max_abs(self):
        return max(abs(self.lo), abs(self.hi))

    def trig(self, cosine=False):
        # 扫描端点和区间内的三角函数极值；大角度直接用[-1,1]保守包围。
        if self.hi-self.lo >= 2*math.pi or max(abs(self.lo), abs(self.hi)) > 1e6:
            return _SpeedInterval(-1, 1)
        function = math.cos if cosine else math.sin
        values = [function(self.lo), function(self.hi)]
        first = math.floor(self.lo/(math.pi/2))-1
        last = math.ceil(self.hi/(math.pi/2))+1
        pi_range = _SpeedInterval(math.pi)
        # 对libm三角函数端点和pi常量外扩8 ulp；这是本平台数值包围策略。
        for _ in range(8):
            pi_range = pi_range.outward(pi_range.lo, pi_range.hi)
        for k in range(first, last+1):
            critical = pi_range * (k/2)
            if critical.lo <= self.hi and critical.hi >= self.lo:
                values.append((1, 0, -1, 0)[k % 4] if cosine else (0, 1, 0, -1)[k % 4])
        lo, hi = min(values), max(values)
        for _ in range(8):
            lo, hi = math.nextafter(lo, -math.inf), math.nextafter(hi, math.inf)
        return _SpeedInterval(max(-1.0, lo), min(1.0, hi))

def _motor_direction_interval(component, other):
    """包围component/hypot(component,other)，保留分子分母的几何关联。"""
    minimum_other = 0.0 if other.lo <= 0 <= other.hi else min(abs(other.lo), abs(other.hi))
    maximum_other = max(abs(other.lo), abs(other.hi))

    def corner(value, perpendicular, lower):
        if value == perpendicular == 0:
            return -1.0 if lower else 1.0
        # 先归一化再平方，防止很大/很小的有效几何尺寸溢出或下溢。
        scale = max(abs(value), abs(perpendicular))
        numerator = _SpeedInterval(value) / scale
        denominator_component = _SpeedInterval(perpendicular) / scale
        distance = (numerator.square() + denominator_component.square()).sqrt()
        if distance.lo == 0:
            return -1.0 if lower else 1.0
        ratio = numerator / distance
        return max(-1.0, ratio.lo) if lower else min(1.0, ratio.hi)

    low_other = maximum_other if component.lo >= 0 else minimum_other
    high_other = maximum_other if component.hi <= 0 else minimum_other
    return _SpeedInterval(corner(component.lo, low_other, True), corner(component.hi, high_other, False))

def _prepare_multi_point_geometry(model):
    """按参考文件生成凸包，保留全部原吊点及实轴顺序。"""
    points = []
    for point in model["point_init_pos"]:
        values = tuple(float(value) for value in point)
        if len(values) not in (2, 3) or not all(math.isfinite(value) for value in values):
            raise ValueError("吊点须为有限的[x,y]或[x,y,z]坐标")
        points.append(values if len(values) == 3 else values + (0.,))
    xy_two_points = model.get("model_type") == 9 and len(points) == 2
    if len(points) < (2 if model.get("model_type") == 9 else 3):
        raise ValueError("XY多点摆至少需要2个吊点" if model.get("model_type") == 9 else "至少需要3个吊点")
    if xy_two_points:
        (x0, y0, z0), (x1, y1, z1) = points
        same_x_axis = y0 == y1 == z0 == z1 == 0
        same_y_axis = x0 == x1 == z0 == z1 == 0
        contains_origin = min(x0, x1) <= 0 <= max(x0, x1) and min(y0, y1) <= 0 <= max(y0, y1)
        if points[0] == points[1] or not (same_x_axis or same_y_axis) or not contains_origin:
            raise ValueError("XY双吊点须位于同一X轴或Y轴、线段包含原点、两点不重合且Z=0")
    ordered = sorted(set((point[0], point[1]) for point in points))
    def turn(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    lower, upper = [], []
    for point in ordered:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    for point in reversed(ordered):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    hull = lower[:-1] + upper[:-1]
    if xy_two_points:
        # PLC ConvexHull在pointNum<3时直接返回，paramInit预置hullNum=0。
        hull = []
    elif len(hull) < 3:
        raise ValueError("吊点不能全部共线")
    base1, base2, height = (float(model[name]) for name in ("Baseheight1", "Baseheight2", "maxheight"))
    beta = float(model.get("betainit", 0))
    if not all(math.isfinite(value) for value in (base1, base2, height, beta)):
        raise ValueError("多点几何参数必须是有限数值")
    if not ((base1 > 0 and base2 == 0) or (base1 == 0 and base2 > 0)) or height <= 0:
        raise ValueError("两项原点距离须一项大于0、另一项为0，最大高度须大于0")
    if model.get("model_type") == 9 and beta != 0:
        raise ValueError("XY多点摆betainit必须为0")
    edges = []
    I = _SpeedInterval
    for p, q in zip(hull, hull[1:] + hull[:1]):
        x, y = p
        if x*q[1]-y*q[0] == 0:
            continue
        cross = I(x)*q[1]-I(y)*q[0]
        if cross.lo <= 0 <= cross.hi:
            raise ValueError("凸包边与原点过近，边距数值精度不足")
        dx, dy = I(q[0])-x, I(q[1])-y
        length = (dx.square()+dy.square()).sqrt()
        absolute_cross = cross if cross.lo > 0 else -cross
        radius_min = (absolute_cross/length).lo
        radius_max = max((I(x).square()+I(y).square()).sqrt().hi,
                         (I(q[0]).square()+I(q[1]).square()).sqrt().hi)
        edges.append((x, y, dx, dy, cross, radius_min, radius_max))
    if not edges and not xy_two_points:
        raise ValueError("当前吊点无法形成有效边距")
    return tuple(points), tuple(edges), base1, base2, height, beta

def _radial_distance(geometry, beta):
    sine, cosine = math.sin(beta), math.cos(beta)
    minimum = math.inf
    for x, y, edge_x, edge_y, _, _, _ in geometry[1]:
        dx, dy = (edge_x.lo+edge_x.hi)/2, (edge_y.lo+edge_y.hi)/2
        denominator = sine*dy-cosine*dx
        if abs(denominator) <= 1e-12:
            continue
        radius = (x*dy-y*dx)/denominator
        fraction = (x*cosine-y*sine)/denominator
        if radius > 0 and -1e-12 <= fraction <= 1+1e-12:
            minimum = min(minimum, radius)
    if not math.isfinite(minimum):
        raise ValueError("当前倾斜方向无法求得有效凸包边距，请检查吊点与原点")
    return minimum

def _multi_point_motor_speed_upper(q, v, geometry):
    """包围原多点正解在位置/速度区间内的实轴峰速，包含边切换及偏移限幅。"""
    I = _SpeedInterval
    points, edges, base1, base2, maxheight, beta_init = geometry
    h, pitch, yaw = q; vh, vp, vy = v
    radians = I(math.pi)/180.0
    p, dp = -pitch*radians, -vp*radians
    beta, dbeta = -(yaw+beta_init)*radians, -vy*radians
    sine, cosine = beta.trig(), beta.trig(True)
    sp, cp = p.trig(), p.trig(True)
    distance_h = h+base1 if base1 != 0 else I(base2)+maxheight-h
    distance_v = vh if base1 != 0 else -vh
    # 参考文件的有效射线为(+sin(beta),+cos(beta))。
    # 将可能命中的边分别包围；切换到相邻边时同时包含两侧导数。
    radial_candidates = []
    for x,y,dx,dy,cross,rmin,rmax in edges:
        den = sine*dy-cosine*dx
        sign = 1 if cross.lo > 0 else -1
        positive_cross = cross if sign > 0 else -cross
        positive_den = den if sign > 0 else -den
        possible_den = positive_cross / I(rmin, rmax)
        lo, hi = max(positive_den.lo, possible_den.lo), min(positive_den.hi, possible_den.hi)
        if lo > hi:
            continue
        den = I(lo, hi)*sign
        u = (cosine*x-sine*y)/den
        if u.hi < 0 or u.lo > 1:
            continue
        radius = cross/den
        radius = I(max(rmin, radius.lo), min(rmax, radius.hi))
        if radius.lo > radius.hi:
            continue
        den_velocity = (cosine*dy+sine*dx)*dbeta
        radius_velocity = -(radius.square()/cross)*den_velocity
        radial_candidates.append((radius, radius_velocity))
    if not radial_candidates:
        raise ValueError("多点射线未找到边界，请检查吊点坐标及角度数值范围")

    # pow_val=min(100,1.73+0.52*参考高度/射线长度)。物理参考面内n>=1.73。
    # 原偏移等价于 sign(p)*R*min(1,(abs(p)/1.5707963)**n)。
    # 直接在[0,1]上求幂，避免先算大幂再相除的溢出，也处理p=0。
    abs_p = I(0 if p.lo <= 0 <= p.hi else min(abs(p.lo),abs(p.hi)), p.max_abs())
    sign_p = I(-1,1) if p.lo < 0 < p.hi else I(-1 if p.hi <= 0 else 1)
    ratio = abs_p / 1.5707963
    upper = 0.0
    for radius, radius_velocity in radial_candidates:
        exponent_raw = I(1.73)+(distance_h/radius)*0.52
        if exponent_raw.lo <= 1:
            # 范围太宽时继续细分；不把无界导数当作0，最终仍保留保守上界。
            return math.inf
        exponent = I(min(100, exponent_raw.lo), min(100, exponent_raw.hi))
        exponent_velocity = (distance_v/radius-distance_h*radius_velocity/radius.square())*0.52
        if exponent_raw.lo >= 100:
            exponent_velocity = I(0)
        elif exponent_raw.hi >= 100:
            exponent_velocity = I(min(0,exponent_velocity.lo), max(0,exponent_velocity.hi))
        if ratio.lo >= 1:
            offset, offset_velocity = sign_p*radius, sign_p*radius_velocity
        else:
            rho = I(max(0,ratio.lo), min(1,ratio.hi))
            def power_range(n):
                result = I.outward(rho.lo**n.hi, rho.hi**n.lo)
                # pow的libm结果外扩8ulp；与三角函数相同的本平台数值包围策略。
                for _ in range(7):
                    result = result.outward(result.lo,result.hi)
                return I(max(0,result.lo), min(1,result.hi))
            weight = power_range(exponent)
            slope_weight = power_range(exponent-I(1))
            # |rho**n*log(rho)|的最大值：端点及rho=exp(-1/n_min)。
            n_min = exponent.lo
            def log_weight(r):
                return 0.0 if r == 0 else -(r**n_min)*math.log(r)
            log_max = max(log_weight(rho.lo), log_weight(rho.hi))
            if rho.lo <= math.exp(-1/n_min) <= rho.hi:
                log_max = max(log_max, 1/(math.e*n_min))
            for _ in range(16):
                log_max = math.nextafter(log_max, math.inf)
            log_min = min(0.0 if r==0 else -(r**exponent.hi)*math.log(r) for r in (rho.lo,rho.hi))
            for _ in range(16):
                log_min = math.nextafter(log_min,-math.inf)
            weight_log = I(-log_max,-max(0,log_min))
            offset = sign_p*radius*weight
            offset_velocity = (sign_p*(radius_velocity*weight+radius*weight_log*exponent_velocity)
                               +radius*exponent*slope_weight*(dp/1.5707963))
            if ratio.hi >= 1:
                saturated = sign_p*radius_velocity
                offset_velocity = I(min(offset_velocity.lo,saturated.lo), max(offset_velocity.hi,saturated.hi))
        for point in points:
            x,y = point[:2]
            t = sine*x+cosine*y
            dt = (cosine*x-sine*y)*dbeta
            # Rz(-beta) Rx(p) Rz(beta)的水平位移始终沿e=(sin beta,cos beta)。
            # 距离只需sqrt(horizontal**2+vertical**2)，避免三次四元数旋转。
            horizontal = (cp-I(1))*t+offset
            horizontal_v = -sp*dp*t+(cp-I(1))*dt+offset_velocity
            vertical = sp*t-distance_h
            vertical_v = cp*dp*t+sp*dt-distance_v
            if vertical.lo > 0 or vertical.hi < 0:
                # 先求水平/垂直比，消去大参考高度；比逐分量单位方向包围更省运算。
                direction_ratio = horizontal/vertical
                projected = (vertical_v+direction_ratio*horizontal_v)/(I(1)+direction_ratio.square()).sqrt()
            else:
                projected = (_motor_direction_interval(horizontal,vertical)*horizontal_v
                             +_motor_direction_interval(vertical,horizontal)*vertical_v)
            norm_upper = math.hypot(horizontal_v.max_abs(),vertical_v.max_abs())
            for _ in range(4):
                norm_upper = math.nextafter(norm_upper, math.inf)
            upper = max(upper,min(projected.max_abs(),norm_upper))
    if not math.isfinite(upper):
        raise ValueError("多点速度区间计算溢出，请检查原轨迹和几何参数")
    return math.nextafter(upper,math.inf)

def _multi_point_instantaneous_speed(q, v, geometry):
    """原多点正解的解析瞬时峰速，用作区间搜索的候选值（不是整段上界）。"""
    points, edges, base1, base2, maxheight, beta_init = geometry
    h,pitch,yaw = q; vh,vp,vy = v
    p,dp = -pitch*math.pi/180.0,-vp*math.pi/180.0
    beta,dbeta = -(yaw+beta_init)*math.pi/180.0,-vy*math.pi/180.0
    sine,cosine = math.sin(beta),math.cos(beta)
    sp,cp = math.sin(p),math.cos(p)
    height = h+base1 if base1 != 0 else base2+maxheight-h
    height_v = vh if base1 != 0 else -vh
    candidates = []
    for x,y,dx,dy,cross,rmin,rmax in edges:
        # 用原始顶点计算标量；边界处允许两个相邻边的单侧速度。
        dx,dy = (dx.lo+dx.hi)*0.5,(dy.lo+dy.hi)*0.5
        den = sine*dy-cosine*dx
        if den == 0:
            continue
        radius = (x*dy-y*dx)/den
        u = (cosine*x-sine*y)/den
        if radius > 0 and -1e-12 <= u <= 1+1e-12:
            radius_v = -radius*(cosine*dy+sine*dx)*dbeta/den
            candidates.append((radius,radius_v))
    if not candidates:
        # 极端舍入/角度数值用单点区间包围；不退回平均速度。
        return _multi_point_motor_speed_upper([_SpeedInterval(z) for z in q],[_SpeedInterval(z) for z in v],geometry)
    minimum = min(r for r,rv in candidates)
    upper = 0.0
    for radius,radius_v in candidates:
        if radius > minimum*(1+1e-10):
            continue
        n_raw = 1.73+0.52*height/radius
        if n_raw <= 1:
            raise ValueError("多点偏移幂需大于1，当前原轨迹可能在P=0处不可导，请检查参考高度")
        n = min(100,n_raw)
        n_v = 0 if n_raw>=100 else 0.52*(height_v/radius-height*radius_v/radius**2)
        rho = abs(p)/1.5707963
        sign = -1 if p<0 else 1
        if rho>=1:
            offset,offset_v = sign*radius,sign*radius_v
        elif rho==0:
            offset,offset_v = 0.0,0.0
        else:
            weight = rho**n
            offset = sign*radius*weight
            offset_v = (sign*(radius_v*weight+radius*weight*math.log(rho)*n_v)
                        +radius*n*rho**(n-1)*dp/1.5707963)
        for x,y,_ in points:
            t = sine*x+cosine*y
            dt = (cosine*x-sine*y)*dbeta
            horizontal = (cp-1)*t+offset
            horizontal_v = -sp*dp*t+(cp-1)*dt+offset_v
            vertical = sp*t-height
            vertical_v = cp*dp*t+sp*dt-height_v
            length = math.hypot(horizontal,vertical)
            speed = math.hypot(horizontal_v,vertical_v) if length==0 else abs((horizontal/length)*horizontal_v+(vertical/length)*vertical_v)
            upper = max(upper,speed)
    if not math.isfinite(upper):
        raise ValueError("多点瞬时速度计算溢出")
    return upper

def _xy_radius_candidates(direction_x, direction_y, beta_velocity, geometry):
    candidates = []
    for x, y, edge_x, edge_y, cross, radius_min, radius_max in geometry[1]:
        edge_x = (edge_x.lo + edge_x.hi) / 2
        edge_y = (edge_y.lo + edge_y.hi) / 2
        denominator = direction_x * edge_y - direction_y * edge_x
        if denominator == 0:
            continue
        radius = (x * edge_y - y * edge_x) / denominator
        edge_fraction = (direction_y * x - direction_x * y) / denominator
        if radius > 0 and -1e-12 <= edge_fraction <= 1 + 1e-12:
            denominator_velocity = (direction_y * edge_y + direction_x * edge_x) * beta_velocity
            candidates.append((radius, -radius * denominator_velocity / denominator))
    if not candidates:
        raise ValueError("XY倾斜方向无法求得有效凸包边距，请检查吊点与原点")
    minimum = min(radius for radius, _ in candidates)
    return [(radius, velocity) for radius, velocity in candidates
            if radius <= minimum * (1 + 1e-10)]

def _xy_point_motion(q, v, geometry):
    points, edges, base1, base2, maxheight, beta_init = geometry
    if beta_init != 0:
        raise ValueError("XY多点摆betainit必须为0")
    height, angle_x, angle_y = q
    velocity_h, velocity_x, velocity_y = v
    if abs(angle_x) >= 90 or abs(angle_y) >= 90:
        raise ValueError("XY多点摆X/Y角须在(-90,90)内")
    radians = math.pi / 180
    pitch, roll = -angle_x * radians, -angle_y * radians
    pitch_v, roll_v = -velocity_x * radians, -velocity_y * radians
    sp, cp = math.sin(pitch), math.cos(pitch)
    sr, cr = math.sin(roll), math.cos(roll)
    tilt = math.acos(max(-1., min(1., cp * cr)))
    vertical = height + base1 if base1 > 0 else base2 + maxheight - height
    vertical_v = velocity_h if base1 > 0 else -velocity_h
    offsets = [(0., 0., 0., 0.)]
    if tilt > 1e-8 and edges:
        # beta is measured from +Y. Its direction follows the supplied YXZ_new.py.
        beta = math.acos(max(-1., min(1., sp / math.sin(tilt))))
        if -sr * cp < 0:
            beta = -beta
        dx, dy = math.sin(beta), math.cos(beta)
        nx, ny = -sr * cp, sp
        nx_v = -cr * roll_v * cp + sr * sp * pitch_v
        ny_v = cp * pitch_v
        sine_squared = nx * nx + ny * ny
        beta_v = (ny * nx_v - nx * ny_v) / sine_squared
        tilt_v = (sp * cr * pitch_v + cp * sr * roll_v) / math.sqrt(sine_squared)
        offsets = []
        for radius, radius_v in _xy_radius_candidates(dx, dy, beta_v, geometry):
            raw_power = 1.73 + .52 * vertical / radius
            power = min(100., raw_power)
            power_v = (0. if raw_power >= 100 else
                       .52 * (vertical_v / radius - vertical * radius_v / radius**2))
            ratio = tilt / 1.5707963
            weight = ratio**power
            if weight >= 1:
                offset, offset_v = radius, radius_v
            else:
                offset = radius * weight
                offset_v = (radius_v * weight + radius * weight * math.log(ratio) * power_v
                            + radius * power * ratio**(power - 1) * tilt_v / 1.5707963)
            offsets.append((dx * offset, dy * offset,
                            dy * beta_v * offset + dx * offset_v,
                            -dx * beta_v * offset + dy * offset_v))
    motions = []
    for offset_x, offset_y, offset_x_v, offset_y_v in offsets:
        row = []
        for x, y, z in points:
            y1, z1 = cp * y - sp * z, sp * y + cp * z
            rotated_x = cr * x + sr * z1
            rotated_y = y1
            rotated_z = -sr * x + cr * z1
            rotated_x_v = (-sr * x + cr * z1) * roll_v + sr * y1 * pitch_v
            rotated_y_v = -z1 * pitch_v
            rotated_z_v = (-cr * x - sr * z1) * roll_v + cr * y1 * pitch_v
            relative = (rotated_x - x + offset_x, rotated_y - y + offset_y,
                        rotated_z - z - vertical)
            velocity = (rotated_x_v + offset_x_v, rotated_y_v + offset_y_v,
                        rotated_z_v - vertical_v)
            row.append((relative, velocity))
        motions.append(row)
    return motions

def _xy_instantaneous_speed(q, v, geometry):
    maximum = 0.
    for row in _xy_point_motion(q, v, geometry):
        for relative, velocity in row:
            length = math.sqrt(sum(value * value for value in relative))
            speed = (math.sqrt(sum(value * value for value in velocity)) if length == 0 else
                     abs(sum(a / length * b for a, b in zip(relative, velocity))))
            maximum = max(maximum, speed)
    if not math.isfinite(maximum):
        raise ValueError("XY多点摆瞬时速度计算溢出")
    return maximum

def _xy_power_interval(ratio, power):
    I = _SpeedInterval
    values = [value**exponent for value in (ratio.lo, ratio.hi)
              for exponent in (power.lo, power.hi)]
    result = I.outward(min(values), max(values))
    for _ in range(7):
        result = result.outward(result.lo, result.hi)
    return I(max(0., result.lo), min(1., result.hi))

def _xy_offset_bounds(q, v, geometry, sp, cp, sr, cr, dp, dr):
    I = _SpeedInterval
    _, edges, base1, base2, maxheight, beta_init = geometry
    if beta_init != 0:
        raise ValueError("XY多点摆betainit必须为0")
    if not edges:
        return I(0.), I(0.), I(0.), I(0.)
    h, _, _ = q
    vh, _, _ = v
    vertical = h + base1 if base1 > 0 else I(base2) + maxheight - h
    vertical_v = vh if base1 > 0 else -vh
    nx, ny = -sr * cp, sp
    nx_v, ny_v = -cr * dr * cp + sr * sp * dp, cp * dp
    sine = (nx.square() + ny.square()).sqrt()
    cosine = cp * cr
    tilt = I(math.acos(min(1., max(0., cosine.hi))),
             math.acos(min(1., max(0., cosine.lo))))
    if sine.lo <= 0:
        # The offset scales as tilt**power with power>1, so its derivative remains
        # bounded at zero tilt even though beta's derivative itself is singular.
        rmin = min(edge[5] for edge in edges)
        rmax = max(edge[6] for edge in edges)
        radius_slope = 0.
        for x, y, ex, ey, cross, _, edge_rmax in edges:
            cross_abs = min(abs(cross.lo), abs(cross.hi))
            slope = edge_rmax**2 * math.hypot(ex.max_abs(), ey.max_abs()) / cross_abs
            radius_slope = max(radius_slope, slope)
        raw_power = I(1.73) + (vertical / I(rmin, rmax)) * .52
        low_power = raw_power.lo
        if low_power <= 1 or cosine.lo <= 0:
            return None
        low_power = min(100., low_power)
        high_power = min(100., raw_power.hi)
        rho = min(1., tilt.hi / 1.5707963)
        derivative_norm = math.hypot(nx_v.max_abs(), ny_v.max_abs())
        weight = rho**low_power
        slope_weight = rho**(low_power - 1)
        direction_scale = math.pi / (2 * 1.5707963)
        weight_over_sine = direction_scale * slope_weight
        def max_log_weight(exponent):
            if rho == 0:
                return 0.
            values = [-rho**exponent * math.log(rho)]
            if math.exp(-1 / exponent) <= rho:
                values.append(1 / (math.e * exponent))
            return max(values)
        weight_log = max_log_weight(low_power)
        log_over_sine = direction_scale * max_log_weight(low_power - 1)
        offset_max = rmax * weight
        speed_max = ((radius_slope + rmax) * derivative_norm * weight_over_sine
                     + .52 * vertical_v.max_abs() * weight_log
                     + .52 * vertical.max_abs() * radius_slope / rmin * derivative_norm * log_over_sine
                     + rmax * high_power * slope_weight * derivative_norm / (cosine.lo * 1.5707963))
        for _ in range(32):
            offset_max = math.nextafter(offset_max, math.inf)
            speed_max = math.nextafter(speed_max, math.inf)
        return (I(-offset_max, offset_max), I(-offset_max, offset_max),
                I(-speed_max, speed_max), I(-speed_max, speed_max))
    dx, dy = nx / sine, ny / sine
    beta_v = (ny * nx_v - nx * ny_v) / sine.square()
    tilt_v = (sp * cr * dp + cp * sr * dr) / sine
    candidates = []
    for x, y, ex, ey, cross, radius_min, radius_max in edges:
        denominator = dx * ey - dy * ex
        sign = 1 if cross.lo > 0 else -1
        positive_cross = cross if sign > 0 else -cross
        positive_den = denominator if sign > 0 else -denominator
        possible_den = positive_cross / I(radius_min, radius_max)
        lo, hi = max(positive_den.lo, possible_den.lo), min(positive_den.hi, possible_den.hi)
        if lo > hi:
            continue
        denominator = I(lo, hi) * sign
        edge_fraction = (dy * x - dx * y) / denominator
        if edge_fraction.hi < 0 or edge_fraction.lo > 1:
            continue
        radius = cross / denominator
        radius = I(max(radius_min, radius.lo), min(radius_max, radius.hi))
        if radius.lo > radius.hi:
            continue
        radius_v = -(radius.square() / cross) * (dy * ey + dx * ex) * beta_v
        raw_power = I(1.73) + (vertical / radius) * .52
        if raw_power.lo <= 1:
            return None
        power = I(min(100., raw_power.lo), min(100., raw_power.hi))
        power_v = (vertical_v / radius - vertical * radius_v / radius.square()) * .52
        if raw_power.lo >= 100:
            power_v = I(0.)
        elif raw_power.hi >= 100:
            power_v = I(min(0., power_v.lo), max(0., power_v.hi))
        ratio = tilt / 1.5707963
        if ratio.lo >= 1:
            offset, offset_v = radius, radius_v
        else:
            rho = I(max(0., ratio.lo), min(1., ratio.hi))
            weight = _xy_power_interval(rho, power)
            slope_weight = _xy_power_interval(rho, power - I(1.))
            def log_weight(value):
                return 0. if value == 0 else -value**power.lo * math.log(value)
            log_max = max(log_weight(rho.lo), log_weight(rho.hi))
            if rho.lo <= math.exp(-1 / power.lo) <= rho.hi:
                log_max = max(log_max, 1 / (math.e * power.lo))
            for _ in range(16):
                log_max = math.nextafter(log_max, math.inf)
            weight_log = I(-log_max, 0.)
            offset = radius * weight
            offset_v = (radius_v * weight + radius * weight_log * power_v
                        + radius * power * slope_weight * tilt_v / 1.5707963)
            if ratio.hi >= 1:
                offset_v = I(min(offset_v.lo, radius_v.lo), max(offset_v.hi, radius_v.hi))
        candidates.append((dx * offset, dy * offset,
                           dy * beta_v * offset + dx * offset_v,
                           -dx * beta_v * offset + dy * offset_v))
    if not candidates:
        raise ValueError("XY倾斜方向无法求得有效凸包边距")
    # The supplied implementation disables the offset at its small-angle guard.
    if tilt.lo <= 1e-8:
        candidates.append((I(0.), I(0.), I(0.), I(0.)))
    return tuple(I(min(row[i].lo for row in candidates), max(row[i].hi for row in candidates))
                 for i in range(4))

def _xy_motor_speed_upper(q, v, geometry):
    I = _SpeedInterval
    points, edges, base1, base2, maxheight, beta_init = geometry
    radians = I(math.pi) / 180.
    p, r = -q[1] * radians, -q[2] * radians
    dp, dr = -v[1] * radians, -v[2] * radians
    if p.lo <= -math.pi / 2 or p.hi >= math.pi / 2 or r.lo <= -math.pi / 2 or r.hi >= math.pi / 2:
        return math.inf
    sp, cp, sr, cr = p.trig(), p.trig(True), r.trig(), r.trig(True)
    offset = _xy_offset_bounds(q, v, geometry, sp, cp, sr, cr, dp, dr)
    if offset is None:
        return math.inf
    ox, oy, vox, voy = offset
    vertical = q[0] + base1 if base1 > 0 else I(base2) + maxheight - q[0]
    vertical_v = v[0] if base1 > 0 else -v[0]
    upper = 0.
    for x, y, z in points:
        y1, z1 = cp * y - sp * z, sp * y + cp * z
        rx = cr * x + sr * z1 - x + ox
        ry = y1 - y + oy
        rz = -sr * x + cr * z1 - z - vertical
        vx = (-sr * x + cr * z1) * dr + sr * y1 * dp + vox
        vy = -z1 * dp + voy
        vz = (-cr * x - sr * z1) * dr + cr * y1 * dp - vertical_v
        horizontal = (rx.square() + ry.square()).sqrt()
        projected = (_motor_direction_interval(rx, (ry.square() + rz.square()).sqrt()) * vx
                     + _motor_direction_interval(ry, (rx.square() + rz.square()).sqrt()) * vy
                     + _motor_direction_interval(rz, horizontal) * vz)
        norm = math.sqrt(vx.max_abs()**2 + vy.max_abs()**2 + vz.max_abs()**2)
        for _ in range(8):
            norm = math.nextafter(norm, math.inf)
        upper = max(upper, min(projected.max_abs(), norm))
    if not math.isfinite(upper):
        raise ValueError("XY速度区间计算溢出")
    return math.nextafter(upper, math.inf)

def _prepare_direction_domain(geometry):
    """原点严格在凸包内时返回None，否则返回从+Y计角的有效闭圆锥。"""
    if not geometry[1]:
        return None
    points = sorted(set((point[0], point[1]) for point in geometry[0]))

    def turn(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])

    lower, upper = [], []
    for chain, ordered in ((lower, points), (upper, reversed(points))):
        for point in ordered:
            while len(chain) >= 2 and turn(chain[-2], chain[-1], point) <= 0:
                chain.pop()
            chain.append(point)
    hull = lower[:-1] + upper[:-1]
    if all((_SpeedInterval(x)*q[1]-_SpeedInterval(y)*q[0]).lo > 0
           for (x, y), q in zip(hull, hull[1:]+hull[:1])):
        return None
    angles = sorted(math.atan2(x, y) % math.tau for x, y in hull if x or y)
    gaps = [(angles[(i+1) % len(angles)]-angle) % math.tau
            for i, angle in enumerate(angles)]
    gap_index = max(range(len(gaps)), key=gaps.__getitem__)
    start = angles[(gap_index+1) % len(angles)]
    width = math.tau-gaps[gap_index]
    if width > math.pi:
        raise ValueError('吊点原点接近凸包边界，准备方向域数值精度不足')
    return start, start+width

def _configure_motor_geometry(device, model, settings):
    """Attach immutable four-model geometry to a virtual-axis device."""
    kind = model.get('model_type')
    device._motor_type = kind
    device._motor_geometry = None
    device._motor_domain = None
    if kind is None:
        return
    if type(kind) is not int or kind not in (2, 3, 4, 7, 9):
        raise ValueError('model_type只支持2单点、3多级升降、4旋转、7多点摆、9XY多点摆')
    device._motor_limit = _number(model.get('max_motor_velocity'), 'max_motor_velocity')
    if device._motor_limit <= 0:
        raise ValueError('max_motor_velocity须大于0')
    if kind in (2, 3, 4):
        if any(device.commands[index] for index in (1, 2)):
            raise ValueError('单点/多级升降/旋转仅支持H轴动作曲线')
        velocity, acceleration, deceleration = device.prepare_caps[0]
        limit = min(velocity, device._motor_limit)
        device.prepare_caps[0] = (_floor_rate(limit, settings['entry_quantize_protocol']),
                                 acceleration, deceleration)
        return
    nested = model.get('geometry', {})
    if not isinstance(nested, dict):
        raise ValueError('geometry须为对象')
    fields = ('Baseheight1', 'Baseheight2', 'maxheight', 'betainit', 'point_init_pos', 'motor_num')
    configuration = {'model_type': kind}
    for name in fields:
        if name in model and name in nested and model[name] != nested[name]:
            raise ValueError(f'{name}平铺字段与geometry配置冲突')
        value = nested.get(name, model.get(name, 0 if name == 'betainit' else None))
        if name not in ('point_init_pos', 'motor_num'):
            value = _number(value, name)
        configuration[name] = value
    points = configuration['point_init_pos']
    if not isinstance(points, list):
        raise ValueError('point_init_pos须为吊点列表')
    coordinates = []
    for point in points:
        if not isinstance(point, (list, tuple)) or len(point) not in (2, 3):
            raise ValueError('吊点须为[x,y]或[x,y,z]')
        coordinates.append(tuple(_number(value, '吊点坐标') for value in point))
    configuration['point_init_pos'] = coordinates
    count = configuration.get('motor_num')
    if count is not None and (type(count) is not int or count != len(coordinates)):
        raise ValueError('motor_num须等于原吊点数量')
    device._motor_geometry = _prepare_multi_point_geometry(configuration)
    device._motor_domain = _prepare_direction_domain(device._motor_geometry)
    device._motor_geometry_signature = (kind, device._motor_geometry[0], *device._motor_geometry[2:])


def _motor_direction_box_valid(device, positions):
    """Prove that all nonzero-tilt directions in a pose box meet the hull."""
    domain = device._motor_domain
    if domain is None:
        return True
    if device._motor_type == 7 and positions[1].lo == positions[1].hi == 0:
        return True
    left, right = domain
    radians = math.pi / 180
    if device._motor_type == 7:
        yaw = positions[2]
        first, last = -(yaw.hi + device._motor_geometry[5]) * radians, -(yaw.lo + device._motor_geometry[5]) * radians
        shift = math.floor((first - left) / math.tau)
        return any(first >= left + turn * math.tau - 1e-12
                   and last <= right + turn * math.tau + 1e-12
                   for turn in (shift - 1, shift, shift + 1))
    pitch, roll = -positions[1] * radians, -positions[2] * radians
    largest_pitch = max(abs(pitch.lo), abs(pitch.hi))
    largest_roll = max(abs(roll.lo), abs(roll.hi))
    if math.acos(min(1., math.cos(largest_pitch) * math.cos(largest_roll))) <= 1e-8:
        return True
    nx, ny = -roll.trig() * pitch.trig(True), pitch.trig()
    interval = _SpeedInterval
    cross_left = interval(left).trig() * ny - interval(left).trig(True) * nx
    cross_right = nx * interval(right).trig(True) - ny * interval(right).trig()
    tolerance = 1e-12 * math.hypot(nx.max_abs(), ny.max_abs())
    return cross_left.hi <= tolerance and cross_right.hi <= tolerance


def _motor_state_speed(device, position, velocity):
    if device._motor_type in (2, 3, 4):
        return abs(velocity[0])
    geometry = device._motor_geometry
    if device._motor_type == 7:
        if position[1] == 0:
            beta = -math.radians(position[2] + geometry[5])
            sine, cosine = math.sin(beta), math.cos(beta)
            height_velocity = velocity[0] if geometry[2] > 0 else -velocity[0]
            return max(abs(-math.radians(velocity[1]) * (sine * x + cosine * y) - height_velocity)
                       for x, y, _ in geometry[0])
        return _multi_point_instantaneous_speed(position, velocity, geometry)
    return _xy_instantaneous_speed(position, velocity, geometry)


def _motor_speed_box_upper(device, positions, velocities):
    if device._motor_type in (2, 3, 4):
        return velocities[0].max_abs()
    key = (device._motor_geometry_signature,
           tuple((value.lo, value.hi) for value in positions + velocities))
    cache = device._motor_box_cache
    if key not in cache:
        upper = _motor_speed_box_upper_uncached(device, positions, velocities)
        if len(cache) >= 8192:
            cache.pop(next(iter(cache)))
        cache[key] = upper
    return cache[key]


def _motor_speed_box_upper_uncached(device, positions, velocities):
    if device._motor_type in (2, 3, 4):
        return velocities[0].max_abs()
    if device._motor_type == 7:
        if positions[1].lo == positions[1].hi == 0:
            beta = -(positions[2] + device._motor_geometry[5]) * (math.pi / 180)
            pitch_velocity = -velocities[1] * (math.pi / 180)
            height_velocity = velocities[0] if device._motor_geometry[2] > 0 else -velocities[0]
            return max((pitch_velocity * (beta.trig() * x + beta.trig(True) * y) - height_velocity).max_abs()
                       for x, y, _ in device._motor_geometry[0])
        return _multi_point_motor_speed_upper(positions, velocities, device._motor_geometry)
    if (positions[1].lo == positions[1].hi == 0
            and positions[2].lo == positions[2].hi == 0
            and velocities[1].lo == velocities[1].hi == 0
            and velocities[2].lo == velocities[2].hi == 0):
        return velocities[0].max_abs()
    return _xy_motor_speed_upper(positions, velocities, device._motor_geometry)


def _motor_phase_boxes(tracks, left, right):
    positions, velocities = [], []
    for track in tracks:
        segment = track.segment_containing((left + right) / 2)
        samples = [segment.state(left), segment.state(right)]
        position_values = [value[0] for value in samples]
        if segment.a:
            zero = segment.u0 - segment.v0 / segment.a * 1000
            if left < zero < right:
                position_values.append(segment.state(zero)[0])
        positions.append(_SpeedInterval(min(position_values), max(position_values)))
        velocities.append(_SpeedInterval(min(value[1] for value in samples), max(value[1] for value in samples)))
    return positions, velocities


def _motor_box_pose_error(device, positions):
    if device._motor_type in (2, 3, 4):
        return None
    geometry = device._motor_geometry
    axes = (1, 2) if device._motor_type == 9 else (1,)
    if any(positions[axis].lo <= -90 or positions[axis].hi >= 90 for axis in axes):
        return '准备或后续曲线倾角超出(-90,90)'
    vertical = (positions[0] + geometry[2] if geometry[2] > 0 else
                _SpeedInterval(geometry[3] + geometry[4]) - positions[0])
    height_tolerance = max(1e-8, 64 * math.ulp(max(1., abs(geometry[2]), abs(geometry[3] + geometry[4]), positions[0].max_abs())))
    if vertical.lo < -height_tolerance:
        return '准备或后续曲线的有效几何高度为负'
    return None


def _verify_motor_device(device, entries, plan):
    label = f'模型{device.model_id}'
    if set(entries) != {0, 1, 2}:
        return False, f'{label}真实电机联合核对缺少虚轴计划'
    tracks = []
    for index in range(3):
        sends = [(move['send_u'], move['move']) for move in entries[index]['moves']]
        sends.extend((u, command) for u, command in device.tracks[index].sends if u >= plan['u0'] - 1e-9)
        sends.sort(key=lambda item: item[0])
        tracks.append(_device_track(device, index, device.current[index], sends))
    begin = min(plan['clock_start_u'], *(move['send_u'] for entry in entries.values() for move in entry['moves']))
    points = {begin}
    for track in tracks:
        for segment in track.segments:
            for boundary in (segment.u0, segment.u1):
                if math.isfinite(boundary) and boundary > begin:
                    points.add(boundary)
    points = sorted(points)
    pending = [(left, right, 0) for left, right in zip(points, points[1:])] or [(begin, begin, 0)]
    tolerance = max(1e-8, device._motor_limit * 1e-9)
    while pending:
        _check_deadline()
        left, right, depth = pending.pop()
        positions, velocities = _motor_phase_boxes(tracks, left, right)
        error = _motor_box_pose_error(device, positions)
        if error:
            return False, f'{label}{error}'
        direction_valid = _motor_direction_box_valid(device, positions)
        try:
            upper = _motor_speed_box_upper(device, positions, velocities) if direction_valid else math.inf
        except (ValueError, ArithmeticError):
            upper = math.inf
        if math.isfinite(upper) and upper <= device._motor_limit + tolerance:
            continue
        middle = (left + right) / 2
        for stamp in (left, middle, right):
            _check_deadline()
            states = [track.state(stamp) for track in tracks]
            q = [state[0] for state in states]
            v = [state[1] for state in states]
            exact_positions = [_SpeedInterval(value) for value in q]
            if not _motor_direction_box_valid(device, exact_positions):
                return False, f'{label}实际运动在{stamp:.6f}ms没有有效几何边距'
            try:
                speed = _motor_state_speed(device, q, v)
            except (ValueError, ArithmeticError) as error:
                return False, f'{label}实际运动几何正解失败，{error}'
            if not math.isfinite(speed) or speed > device._motor_limit + tolerance:
                if math.isfinite(speed) and stamp <= plan['u0'] + 1e-8:
                    plan['_motor_time_hint_scale'] = max(1.2, speed / device._motor_limit)
                return False, f'{label}实际电机速度{speed:.6f}超过上限{device._motor_limit:.6f}'
        if depth >= 24 or middle in (left, right):
            return False, f'{label}运动区间无法可靠包围在真实电机速度上限内'
        pending.extend(((left, middle, depth + 1), (middle, right, depth + 1)))
    return True, ''


def _verify_motor_plan(plan, settings):
    """Validate a complete three-axis-per-device plan after final send-time encoding."""
    grouped = {}
    key_parts = []
    for device, entry in plan['entries']:
        if getattr(device, '_motor_type', None) is None:
            continue
        grouped.setdefault(id(device), (device, {}))[1][entry['index']] = entry
        key_parts.append((id(device), entry['index'], id(device.tracks[entry['index']]),
                          tuple((move['send_u'], *(move['move'][name] for name in ('pos', 'vel', 'accVel', 'decVel')))
                                for move in entry['moves'])))
    key = (plan['u0'], plan['clock_start_u'], tuple((id(device), device.position_period_H, device.stage_parameters) for device, _ in plan['entries']), tuple(key_parts))
    cached = plan.get('_motor_verification_certificate')
    if cached is not None and cached[0] == key:
        return cached[1]
    result = (True, '')
    owner = plan['entries'][0][0]
    if not hasattr(owner, '_motor_motion_certificates'):
        owner._motor_motion_certificates = {}
        owner._motor_shared_box_cache = {}
    shared = owner._motor_motion_certificates
    for device, entries in grouped.values():
        _check_deadline()
        device._motor_box_cache = owner._motor_shared_box_cache
        reference = getattr(device, '_motor_reference_signature', None)
        if reference is None:
            reference = tuple(tuple((u, *(command[name] for name in ('pos', 'vel', 'accVel', 'decVel')))
                                    for u, command in track.sends) for track in device.tracks)
            device._motor_reference_signature = reference
        motion_key = (device._motor_type, device._motor_limit, device.position_period_H, device.stage_parameters,
                      getattr(device, '_motor_geometry_signature', None), tuple(device.current),
                      plan['u0'], plan['clock_start_u'], reference,
                      tuple(tuple((move['send_u'], *(move['move'][name]
                                  for name in ('pos', 'vel', 'accVel', 'decVel')))
                                  for move in entries[index]['moves']) for index in range(3)))
        if motion_key in shared:
            continue
        result = _verify_motor_device(device, entries, plan)
        if not result[0]:
            break
        if len(shared) >= 4096:
            shared.pop(next(iter(shared)))
        shared[motion_key] = True
    plan['_motor_verification_certificate'] = (key, result)
    return result


class _Device:
    """一个模型：当前状态、能力参数、原动作段，以及按帧表回放出的各轴轨迹。"""

    def __init__(self, model, states, direction, run_origin, loop, settings, pieces=None):
        if not isinstance(model, dict) or type(model.get("model_id")) is not int:
            raise ValueError("models[].model_id须为整数")
        self.model_id = model["model_id"]
        self.position_period_H = _rotation_period_of(model)
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
                step = .1
                setattr(self, name, [math.floor(value / step + 1e-8) * step for value in getattr(self, name)])
        self.lower = (_triple(model["min_position_HPY"], f"{label} min_position_HPY")
                      if "min_position_HPY" in model else [-math.inf] * 3)
        self.upper = (_triple(model["max_position_HPY"], f"{label} max_position_HPY")
                      if "max_position_HPY" in model else [math.inf] * 3)
        self.stage_parameters = _stage_parameters_of(model, self.lower[0], self.upper[0])
        self.prepare_caps = [(_floor_rate(self.reposition_velocity[i], settings["entry_quantize_protocol"]),
                              _floor_acceleration(self.reposition_acceleration[i], settings["entry_quantize_protocol"]),
                              _floor_acceleration(self.reposition_deceleration[i], settings["entry_quantize_protocol"]))
                             for i in range(3)]
        self.axis_labels = [f"模型{self.model_id} {axis}" for axis in AXIS_NAMES]
        self.current_in_range = [_position_interval_allowed(self, i, self.current[i], self.current[i], _EPS) for i in range(3)]
        self.rest_tail_failures = set()
        unit = settings["unit_ms"]
        pieces = _pieces_of(model, unit) if pieces is None else pieces
        self.first, self.last = pieces[0][0], pieces[-1][1]
        self.keyframes = sorted({_number(segment[name], name) for segment in model["segments"]
                                 for name in ("start_frame", "end_frame")})
        self.commands, compiled_tracks = _compiled_curve(pieces,unit,direction,run_origin,loop,settings,self.position_period_H,self.stage_parameters)
        self.tracks = []
        for axis,(commands,track) in enumerate(zip(self.commands,compiled_tracks)):
            if not self.active[axis] or (not commands and self.reposition_velocity[axis] == 0):
                if commands:
                    raise ValueError(f"模型{self.model_id} {AXIS_NAMES[axis]}有运动曲线却未列入准备轴")
                self.active[axis] = False
                track = AxisTrack(self.current[axis],[])
            self.tracks.append(track)
        if _stage_axis(self, 0) and self.active[0]:
            self.tracks[0] = _device_track(self, 0, compiled_tracks[0].anchor, compiled_tracks[0].sends)
        self.moves = any(self.active[axis] and self.tracks[axis].sends for axis in range(3))
        _configure_motor_geometry(self, model, settings)
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
    if not _position_interval_allowed(device, index, command["pos"], command["pos"]):
        return f"目标{_ms_text(command['pos'])}超出行程"
    if not -214748364.8 <= command["pos"] <= 214748364.7:
        return f"目标{_ms_text(command['pos'])}超出协议范围"
    for key, maximum in (("vel", device.reposition_velocity[index]),
                         ("accVel", device.reposition_acceleration[index]),
                         ("decVel", device.reposition_deceleration[index])):
        protocol_limit = _RATE_LIMIT if key == "vel" else _ACCELERATION_LIMIT
        if command[key] > protocol_limit+1e-8:
            return f"{key}={_ms_text(command[key])}超出协议上限{protocol_limit}"
        if maximum > 0 and command[key] > maximum+1e-8:
            return f"{key}={_ms_text(command[key])}超过最大能力{_ms_text(maximum)}"
    return None


def _wire_move(command, settings):
    """还原出的一条 Move → C++ 实际下发的参数（协议 0.1 量化）。"""
    move = {"pos": command["target"], "vel": command["velocity"], "accVel": command["acceleration"],
            "decVel": command["deceleration"]}
    if settings["entry_quantize_protocol"]:
        move = {key: _quantize_acceleration(value) if key in ("accVel", "decVel") else quantize(value)
                for key, value in move.items()}
    if min(move["vel"], move["accVel"], move["decVel"]) <= 0:
        raise ValueError("曲线里有Move的V/A/D编码后为0（速度和加减速度精度均为0.1）")
    return move


###############################################################################
# 六、单Move准备：只有共同起点一条指令，接入后自然沿原表运行
###############################################################################


_RATE_LIMIT = 6553.5
_ACCELERATION_LIMIT = 6553.5
_ARRIVAL_TOLERANCE_MS = 1.0


def _floor_rate(value, quantized):
    value = min(value, _RATE_LIMIT)
    return math.floor(value * 10 + 1e-8) / 10 if quantized else value


def _quantize_acceleration(value):
    return quantize(value)


def _floor_acceleration(value, quantized):
    value = min(value, _ACCELERATION_LIMIT)
    return math.floor(value * 10 + 1e-8) / 10 if quantized else value


def _rates_near(value, limit, settings, radius=1, resolution=.1):
    if not math.isfinite(value) or value <= 0 or limit <= 0:
        return []
    if not settings["entry_quantize_protocol"]:
        return [min(value, limit)]
    center = math.floor(value / resolution + .5 + 1e-10) * resolution
    values = {round(center + k * resolution, 1)
              for k in range(-radius, radius + 1)
              if resolution - 1e-9 <= center + k * resolution <= limit + 1e-8}
    return sorted(values, key=lambda item: (abs(item-value), item))


def _target_on_wire(value, device, index, settings):
    period = _axis_period(device, index)
    if period is not None:
        wire = _rotation_wire_goal(value, period, settings["entry_quantize_protocol"])
        return _rotation_lift(wire, value, period)
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
    track = _reference_track(device, index, u0)
    segment = track.segment_containing(u0)
    q, v = segment.state(u0)
    current = device.current[index]
    label = device.axis_labels[index]
    # _verify核对u0之后（含容差）的全部原表Move，这里用同一边界
    if u0 <= device.table_limit_u[index]+1e-9:
        raise EntryInfeasible([f"{label}{device.table_limit_reasons[index]}，只能在它之后接入"])
    if not device.current_in_range[index]:
        raise EntryInfeasible([f"{label}当前位置超出行程"])
    if not _position_interval_allowed(device, index, q, q, _EPS):
        raise EntryInfeasible([f"{label}接入位置超出行程"])
    quantized = settings["entry_quantize_protocol"]
    V, A, D = device.prepare_caps[index]
    command = segment.command
    if command is not None and _axis_period(device, index) is not None:
        command = {**command, "pos": segment.target}
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
                                  (("vel", device.reposition_velocity[index]),
                                   ("accVel", device.reposition_acceleration[index]),
                                   ("decVel", device.reposition_deceleration[index]))):
        raise EntryInfeasible([f"{label}原Move超过真实最大V/A/D，不能用默认值代替最大能力"])
    if _stage_axis(device, index):
        return _stage_axis_request(device, index, u0, segment, request, settings)
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
    if family in ("stage", "stage_rest"):
        yield from _stage_candidate_moves(request, seconds, settings)
        return
    if family == "hold":
        # 无运动/不存在的虚轴也填真实位置，不能用pos=0当跳过标志。
        yield {"pos": _target_on_wire(current, device, index, settings),
               "vel": V or .1, "accVel": A or .1, "decVel": D or .1}
        return
    if family == "acceleration":
        yield {**request["command"], "vel": min(request["command"]["vel"], V)}
        return
    if seconds <= 0:
        return
    if family == "cruise":
        denominator = 2*(w*seconds-request["L"])
        if denominator > 0:
            for acc in _acceleration_rates_near(w*w/denominator, A, settings, 2):
                yield {"pos": request["target"], "vel": w, "accVel": acc, "decVel": request["dec"]}
        return
    if family == "rest":
        distance, target = request["L"], request["target"]
        ratio = seconds/request["minimum"]
        fastest = min(V, math.sqrt(2*A*D*distance/(A+D)))
        for cap in _rates_near(fastest/ratio, V, settings, 1):
            for acc in _acceleration_rates_near(A/(ratio*ratio), A, settings, 1):
                for dec in _acceleration_rates_near(D/(ratio*ratio), D, settings, 1):
                    yield {"pos": target, "vel": cap, "accVel": acc, "decVel": dec}
        harmonic = seconds*seconds/(2*distance)
        triangle_acc = {A, min(A, 4*distance/(seconds*seconds)), min(A, A/(ratio*ratio))}
        low = max(.1 if settings["entry_quantize_protocol"] else 1e-9,
                  1/max(1e-15, harmonic-1/D))
        if low <= A:
            triangle_acc.update(low+(A-low)*k/32 for k in range(33))
        for ideal_acc in sorted(triangle_acc):
            for acc in _acceleration_rates_near(ideal_acc, A, settings, 1):
                remain = harmonic-1/acc
                if remain <= 0:
                    continue
                for dec in _acceleration_rates_near(1/remain, D, settings, 1):
                    yield {"pos": target, "vel": V, "accVel": acc, "decVel": dec}
        # 有匀速段的单Move：取编码A/D反求峰速。无中途发送。
        accelerations = {A, min(A, max(.1, A/(ratio*ratio))), min(A, max(.1, 8*distance/(seconds*seconds)))}
        decelerations = {D, min(D, max(.1, D/(ratio*ratio))), min(D, max(.1, 8*distance/(seconds*seconds)))}
        for a in sorted(accelerations):
            for acc in _acceleration_rates_near(a, A, settings, 1):
                for d in sorted(decelerations):
                    for dec in _acceleration_rates_near(d, D, settings, 1):
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
        for dec in _acceleration_rates_near(ideal_dec, D, settings, 0):
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
                for acc in _acceleration_rates_near(cap*cap/denominator, A, settings, 2):
                    yield {"pos": target, "vel": cap, "accVel": acc, "decVel": dec}
            # 接入时仍在加速：瞬时速度允许小于协议最小指令速度0.1。
            for cap in _rates_near(max(w, .1), V, settings, 1):
                if cap < w-1e-9:
                    continue
                for acc in _acceleration_rates_near(w/seconds, A, settings, 1):
                    yield {"pos": target, "vel": cap, "accVel": acc, "decVel": dec}


def _entry_for_time(request, seconds, u0, settings):
    device, index = request["device"], request["index"]
    family = request["family"]
    kind = "in_place" if family == "hold" else ("run_up" if request["v"] else "reposition")
    seen = set()
    for move in _candidate_moves(request, seconds, settings):
        _check_deadline()
        if _axis_period(device, index) is not None:
            move = {**move, "pos": _rotation_wire_goal(move["pos"], device.position_period_H, settings["entry_quantize_protocol"])}
        key = tuple(move[name] for name in ("pos", "vel", "accVel", "decVel"))
        if key in seen:
            continue
        seen.add(key)
        if min(key[1:]) <= 0 or key[1] > _RATE_LIMIT+1e-8 or max(key[2:]) > _ACCELERATION_LIMIT+1e-8:
            continue
        if not _position_interval_allowed(device, index, move["pos"], move["pos"], _EPS):
            continue
        if family != "hold" and any(move[name] > request[cap]+1e-8 for name, cap in
                                    (("vel", "V"), ("accVel", "A"), ("decVel", "D"))):
            continue
        try:
            phases, lifted_target = _planning_profile(device, index, request["current"], 0., move)
        except EntryInfeasible:
            continue
        q, v = _profile_at(phases, lifted_target, seconds)
        if (abs(q-request["q"]) > settings["entry_position_tolerance"]+1e-9
                or abs(v-request["v"]) > _ENTRY_MATCH_VELOCITY_TOLERANCE+1e-9):
            continue
        if family in ("rest", "stage_rest") and seconds-profile_duration(phases) > _ARRIVAL_TOLERANCE_MS/1000+1e-9:
            continue
        # 同一接入帧若已停在同一停车点，后续与准备V/A/D无关。
        # 只复用已由完整回放证实的失败；非零速度或尚未停稳一律不能用这个缓存。
        actual_seconds = (u0-round(u0-seconds*1000, settings["entry_send_time_decimals"]))/1000
        actual_q, actual_v = _profile_at(phases, lifted_target, actual_seconds)
        if actual_v == 0. and actual_q == move["pos"] and (index, u0, actual_q) in device.rest_tail_failures:
            continue
        entry = {"axis": AXIS_NAMES[index], "index": index, "kind": kind,
                 "lead_ms": 0. if kind == "in_place" else seconds*1000,
                 "join": (request["q"], request["v"]),
                 "_reference_shift": _reference_shift(device, index, u0),
                 "moves": [{"role": "run_up" if request["v"] else "reposition", "at": "clock_start", "move": move}]}
        if kind != "in_place":
            entry["distance"] = request["L"]
        if kind == "run_up":
            entry["run_up_distance"] = request["w"]*request["w"]/(2*move["accVel"])
        plan = _materialize({"u0": u0, "lead_ms": seconds*1000, "entries": [(device, entry)]}, settings)
        try:
            if _verify(plan, settings, fail_fast=True)["passed"]:
                return entry
        except EntryInfeasible:
            continue
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
        times.update(request.get("time_seeds", []))
        if request["family"] == "cruise":
            w, L = request["w"], request["L"]
            denominator = 2*(w*lower-L)
            if denominator > 0:
                for acc in _acceleration_rates_near(w*w/denominator, request["A"], settings, 3):
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
    motor_reason = None
    motor_times_expanded = False
    candidates = [t for t in times if lower-1e-9 <= t <= upper+1e-9]
    heapq.heapify(candidates)
    time_tick = 10 ** (-settings["entry_send_time_decimals"]) / 1000
    scheduled = {round(value / time_tick) for value in candidates}
    while candidates:
        seconds = heapq.heappop(candidates)
        _check_deadline()
        entries = [None]*len(requests)
        for slot in order:
            request = requests[slot]
            entry = _entry_for_time(request, seconds, u0, settings)
            if entry is None:
                for value in request.pop("_stage_time_hints", []):
                    key = round(value / time_tick)
                    if lower-1e-9 <= value <= upper+1e-9 and key not in scheduled:
                        scheduled.add(key)
                        heapq.heappush(candidates, value)
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
                motor_ok, motor_reason = _verify_motor_plan(plan, settings)
                if motor_ok:
                    return plan
                extra_times = []
                if not motor_times_expanded and math.isfinite(upper):
                    extra_times.extend(lower + (upper - lower) * k / 64 for k in range(1, 64))
                    motor_times_expanded = True
                scale = plan.get("_motor_time_hint_scale")
                if scale is not None:
                    hint = min(upper, max(lower, seconds * scale))
                    extra_times.extend((hint - time_tick, hint, hint + time_tick))
                for value in extra_times:
                    key = round(value / time_tick)
                    if lower-1e-9 <= value <= upper+1e-9 and key not in scheduled:
                        scheduled.add(key)
                        heapq.heappush(candidates, value)
    raise EntryInfeasible([motor_reason or "该帧无可编码的同时起步单Move自然接续方案"])


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
    if any(_stage_axis(device, 0) and device.moves for device in devices):
        return False
    middle = (first+last)/2
    tolerance = settings["entry_velocity_tolerance"]
    for device in devices:
        _check_deadline()
        for index, track in enumerate(device.tracks):
            try:
                first_shift = _reference_shift(device, index, first)
                last_shift = _reference_shift(device, index, last)
                if first_shift != last_shift:
                    return False
                track = _reference_track(device, index, middle)
            except EntryInfeasible:
                return False
            segment = track.segment_containing(middle)
            if first < segment.u0 or last >= segment.u1:
                return False
            q1, v1 = segment.state(first)
            q2, v2 = segment.state(last)
            if not _position_interval_allowed(device, index, min(q1,q2), max(q1,q2), _EPS):
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
        points.update(_rotation_branch_boundaries(device, lower, upper))
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
        moving = [r for r in requests if r["family"] not in ("hold","rest","stage_rest")]
        resting = [r for r in requests if r["family"] in ("hold","rest","stage_rest")]
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
                            if r["family"] not in ("hold","rest","stage_rest")),default=math.inf)
        guard_sec = max(1e-12,64*math.ulp(max(1.,abs(lower_at_end),
                          abs(moving_upper) if math.isfinite(moving_upper) else 1.)))
        # 安全phase中，运动轴的共同可行性只能由False变True；右端仍冲突则整段无解。
        if lower_at_end > moving_upper+1e-9+guard_sec:
            return None
        bound = max((r["minimum"] if r["family"] in ("hold","rest","stage_rest")
                     else r["minimum"]-(last-first)/1000 for r in requests),default=0.)*1000
        rounding_guard = max([1e-4]+[64*math.ulp(max(1.,abs(r["minimum"])*1000,abs(last-first)))
                                    for r in requests])
        bound = max(0.,bound-rounding_guard)
        rest_max = min((r["maximum"] for r in requests
                        if r["family"] in ("hold","rest","stage_rest")),default=math.inf)
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
    track = _reference_track(device, index, u0, entry.get("_reference_shift", 0.))
    item = entry["moves"][0]
    move = item["move"]
    next_send = bisect.bisect_left(track.send_times, u0-1e-9)
    key = (id(track), device.stage_parameters, device.current[index], item["send_u"],
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
           _ENTRY_MATCH_VELOCITY_TOLERANCE, id(device.tracks[index]), device.position_period_H, device.stage_parameters, entry.get("_reference_shift", 0.), device.current[index],
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
        track = _reference_track(device, index, u0, entry.get("_reference_shift", 0.))
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
        actual = _device_track(device, index, device.current[index], sends)
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
            limits_ok &= (_position_interval_allowed(device, index, min(positions), max(positions))
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
            limits_ok &= _position_interval_allowed(device, index, command["pos"], command["pos"])
            limits_ok &= -214748364.8 <= command["pos"] <= 214748364.7
            limits_ok &= (command["vel"] <= _RATE_LIMIT + 1e-8
                          and max(command["accVel"], command["decVel"]) <= _ACCELERATION_LIMIT + 1e-8)
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
    except EntryInfeasible as error:
        command = _command_of(parameters)
        mode = "specified_frame" if command["use_specified_time"] else "action_boundary" if not command["nearest_start"] else "current_segment_first" if command["stopped_time_ms"] is not None else "nearest_whole_action"
        return _infeasible(command, mode, command["stopped_time_ms"], str(error), [], error.reasons)
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

    try:
        return _planned(devices, plan, command, settings, mode, reference, clamped, reference_window,
                        selected_window, attempts, evaluated, to_curve)
    except EntryInfeasible as error:
        return _infeasible(command, mode, reference, f"最终下发时序实轴校验失败：{error}", attempts, error.reasons)


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
    motor_ok, motor_reason = _verify_motor_plan(plan, settings)
    if not motor_ok:
        raise EntryInfeasible([motor_reason])
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
            join_position = entry["join"][0]
            if _axis_period(device, entry["index"]) is not None:
                join_position = _rotation_coordinate(join_position, device.position_period_H)
            join[entry["index"]] = round(join_position, 6)
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
