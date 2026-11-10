"""非强制就近接入（同时起步、连续点选帧）。入口calculate_nonforced_entry(parameters)。

输入保持command/settings/models/runtime；输出保持entry_moves/devices和原时钟字段。
当前已停稳；各轴在同一clock_start_ms立即起步，不靠延时或提前到位等待同步。
连续曲线候选包含加速、匀速、减速和停点，默认按1ms分辨率比较共同准备时间。
先搜索stopped_time_ms所在原动作段，全段不可执行才按运行方向搜索其他段。
各轴重新计算V/A/D，内部可途中换速；公开entry_moves仅使用原版role。
接入时匹配原Move回放的位置和有符号速度，并恢复当时生效的原Move；对应指令也按原版run_up格式输出。
非零速度接入点不是Move停车目标；必须完整执行entry_moves，再接续原表。
所有运动轴首条准备指令同时下发；原本已经在位且目标静止的轴保持不动。
使用最终0.1编码参数、最终发送时刻回放，检查位置/速度、整段后续、行程、能力。
距离不足时允许先移到行程内的助跑点，再立即助跑；不安排停等，不生成超限方案。
没有共同可执行的方案时返回infeasible，不能用延时起步冒充同步。
"""

import bisect
import json
import math
import sys
from pathlib import Path

ALGORITHM_VERSION = "nonforced_simultaneous_join_20261109_original_format"
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
    # 助跑加速度取 max_acceleration_HPY（max）或 default_acceleration_HPY（default）
    "entry_acceleration_source": "max",
    # 结果里附上从曲线还原出的 Move 帧表（便于与上位机下发的对照）
    "include_move_table": False,
}


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
        if not isinstance(segment, dict):
            raise ValueError("segments元素须为对象")
        items = segment.get("coefficient_segments") or [segment]
        for item in items:
            start = _number(item.get("start_frame"), "start_frame")
            end = _number(item.get("end_frame"), "end_frame")
            if end <= start:
                raise ValueError(f"模型{model.get('model_id')}的系数阶段时间无效")
            if "a" not in item:
                raise ValueError(f"模型{model.get('model_id')}的系数阶段缺少a")
            coefficients = {name: _triple(item.get(name, [0, 0, 0]), name) for name in COEFFICIENT_NAMES}
            if any(abs(value) > 1e-12 for name in ("d", "e", "f") for value in coefficients[name]):
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
        self.segments = []
        active_u, active_phases, active_target, active_command = -math.inf, [], anchor, None
        for u, command in self.sends:
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
        return [value for segment in self.segments for value in (segment.u0, segment.u1)
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
        if not isinstance(state, dict) or type(state.get("model_id")) is not int:
            raise ValueError("runtime.models[].model_id须为整数")
        states[(str(state.get("plc_id", "")), state["model_id"])] = state
        states.setdefault(("*", state["model_id"]), state)
    return states


class _Device:
    """一个模型：当前状态、能力参数、原动作段，以及按帧表回放出的各轴轨迹。"""

    def __init__(self, model, states, direction, run_origin, loop, settings):
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
        source = "max_acceleration_HPY" if settings["entry_acceleration_source"] == "max" else "default_acceleration_HPY"
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
        unit = settings["unit_ms"]
        pieces = _pieces_of(model, unit)
        self.first, self.last = pieces[0][0], pieces[-1][1]
        self.keyframes = sorted({_number(segment[name], name) for segment in model["segments"]
                                 for name in ("start_frame", "end_frame")})
        start_positions = [_piece_state(pieces[0], axis, pieces[0][0], unit)[0] for axis in range(3)]
        end_positions = [_piece_state(pieces[-1], axis, pieces[-1][1], unit)[0] for axis in range(3)]
        # 按上位机规则还原 Move 帧表，再按 C++ 的下发时刻回放（反向从末尾往前）
        self.commands, self.tracks = [], []
        for axis in range(3):
            commands = axis_move_commands(_axis_runs(pieces, axis, unit), reverse=direction < 0, loop=loop)
            self.commands.append(commands)
            ordered = list(reversed(commands)) if direction < 0 else commands
            sends = [(direction * (command["atMs"] - run_origin), _wire_move(command, settings)) for command in ordered]
            anchor = end_positions[axis] if direction < 0 else start_positions[axis]
            self.tracks.append(AxisTrack(anchor, sends))
        self.moves = any(self.active[axis] and self.tracks[axis].sends for axis in range(3))


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
# 六、连续点接入：共同起步，按共同时间重新求各轴的 Move
###############################################################################


def _floor_rate(value, quantized):
    # 能力上限不能四舍五入向上突破。
    return math.floor(value * 10 + 1e-8) / 10 if quantized else value


def _axis_request(device, index, u0, settings, _current=None, _target=None, _allow_retreat=True, _strict=False):
    track = device.tracks[index]
    q, v = track.state(u0) if _target is None else _target
    current = device.current[index] if _current is None else _current
    label = f"模型{device.model_id} {AXIS_NAMES[index]}"
    tol = settings["entry_position_tolerance"]
    if not device.lower[index] - _EPS <= current <= device.upper[index] + _EPS:
        raise EntryInfeasible([f"{label}当前位置超出行程"])
    if not device.lower[index] - _EPS <= q <= device.upper[index] + _EPS:
        raise EntryInfeasible([f"{label}接入点超出行程"])
    command = track.segment_containing(u0).command
    quantized = settings["entry_quantize_protocol"]
    cap = _floor_rate(device.reposition_velocity[index], quantized)
    acc = _floor_rate(min(device.entry_acceleration[index], device.reposition_acceleration[index]), quantized)
    dec = _floor_rate(device.reposition_deceleration[index], quantized)
    if abs(v) <= settings["entry_velocity_tolerance"]:
        v = 0.
    if v == 0 and abs(current - q) <= (1e-9 if _strict else tol):
        return {"device": device, "index": index, "q": q, "v": v, "command": command,
                "current": current, "idle": True, "minimum": 0., "coded_minimum": 0., "u0": u0}
    if min(cap, acc, dec) <= 0:
        raise EntryInfeasible([f"{label}需要运动，但可编码最大速度/加减速度为0"])
    direction = (1 if v > 0 else -1) if v else (1 if q > current else -1)
    distance = direction * (q - current)
    speed = abs(v)
    if speed > cap + 1e-8:
        raise EntryInfeasible([f"{label}接入速度超过最大速度"])
    if distance < speed * speed / (2 * acc) - 1e-9:
        if not _allow_retreat:
            raise EntryInfeasible([f"{label}助跑距离不足"])
        return _retreat_request(device, index, u0, settings, current, q, v)
    if command is not None:
        if any(command[key] > limit + 1e-8 for key, limit in
               (("vel", cap), ("accVel", device.reposition_acceleration[index]), ("decVel", dec))):
            raise EntryInfeasible([f"{label}原Move参数超过能力上限"])
        if not device.lower[index] - _EPS <= command["pos"] <= device.upper[index] + _EPS:
            raise EntryInfeasible([f"{label}原Move停车目标超出行程"])
    peak = min(cap, math.sqrt(max(0., (2 * acc * dec * distance + acc * speed * speed) / (acc + dec))))
    if peak < speed - 1e-8 or peak <= 0:
        raise EntryInfeasible([f"{label}目标状态不可单向接入"])
    minimum = (distance + peak * peak / (2 * acc) + (peak - speed) ** 2 / (2 * dec)) / peak
    coded_peak = _floor_rate(peak, quantized)
    coded_minimum = minimum
    if coded_peak >= max(speed, .1 if quantized else 1e-9) - 1e-9:
        coded_minimum = (distance + coded_peak * coded_peak / (2 * acc)
                         + (coded_peak - speed) ** 2 / (2 * dec)) / coded_peak
    return {"device": device, "index": index, "current": current, "q": q, "v": v,
            "command": command, "idle": False, "s": direction, "L": distance, "w": speed,
            "V": cap, "A": acc, "D": dec, "minimum": minimum, "coded_minimum": coded_minimum,
            "u0": u0, "can_retreat": _allow_retreat}


def _retreat_request(device, index, u0, settings, current, q, v, extra=0.):
    direction = 1 if v > 0 else -1
    acc = min(device.entry_acceleration[index], device.reposition_acceleration[index])
    rear = q - direction * (v * v / (2 * acc) + extra)
    if settings["entry_quantize_protocol"]:
        rear = _quantize_behind(rear, direction)
    if abs(rear - current) < 1e-8:
        rear -= direction * (.1 if settings["entry_quantize_protocol"] else .001)
    first = _axis_request(device, index, u0, settings, current, (rear, 0.), False, True)
    second = _axis_request(device, index, u0, settings, rear, (q, v), False, True)
    return {**second, "current": current, "L": abs(rear - current) + abs(q - rear),
            "retreat": (first, second), "minimum": first["minimum"] + second["minimum"],
            "coded_minimum": first["coded_minimum"] + second["coded_minimum"], "can_retreat": False}


def _move_at(offset, move, role="run_up"):
    return {"role": role, "start_ms": offset * 1000, "move": move}


def _fits(request, moves, seconds, settings):
    """用最终编码参数回放；候选公式不能替代真实 Move 校验。"""
    if not moves or abs(moves[0]["start_ms"]) > 1e-7:
        return False
    device, index = request["device"], request["index"]
    for item in moves:
        move = item["move"]
        if (min(move["vel"], move["accVel"], move["decVel"]) <= 0
                or move["vel"] > request["V"] + 1e-8
                or move["accVel"] > device.reposition_acceleration[index] + 1e-8
                or move["decVel"] > request["D"] + 1e-8
                or not device.lower[index] - _EPS <= move["pos"] <= device.upper[index] + _EPS):
            return False
    actual = AxisTrack(request["current"], [(item["start_ms"], item["move"]) for item in moves])
    q, v = actual.state(seconds * 1000)
    return (abs(q - request["q"]) <= settings["entry_position_tolerance"] + 1e-9
            and abs(v - request["v"]) <= _ENTRY_MATCH_VELOCITY_TOLERANCE + 1e-9)


def _single_move(request, seconds, settings):
    """优先一条 Move：计算降低后的 A 或峰值 V，让轴立即起步、在 T 接入。"""
    L, w, A, D, V = (request[key] for key in ("L", "w", "A", "D", "V"))
    if seconds <= 0:
        return None
    if w == 0:
        ratio = seconds / request["minimum"]
        peak = min(V, math.sqrt(2 * A * D * L / (A + D)))
        cap, acc, dec = peak / ratio, A / (ratio * ratio), D / (ratio * ratio)
    elif seconds <= 2 * L / w + 1e-9:
        if L <= w * seconds - w * w / (2 * A) + 1e-9:
            denominator = 2 * (w * seconds - L)
            if denominator <= 0:
                return None
            cap, acc, dec = w, w * w / denominator, D
        else:
            B, C, K = seconds + w / D, (1 / A + 1 / D) / 2, L + w * w / (2 * D)
            discriminant = B * B - 4 * C * K
            if discriminant < -1e-8:
                return None
            cap = 2 * K / (B + math.sqrt(max(0., discriminant)))
            acc, dec = A, D
    else:
        return None
    target = request["q"] + request["s"] * w * w / (2 * dec)
    move = {"pos": target, "vel": min(cap, V), "accVel": min(acc, A), "decVel": min(dec, D)}
    if settings["entry_quantize_protocol"]:
        move = {key: quantize(value) for key, value in move.items()}
    targets = [move["pos"]]
    if request["command"] is not None and w:
        targets.append(request["command"]["pos"])
    for target in targets:
        candidate = {**move, "pos": target}
        moves = [_move_at(0., candidate)]
        if _fits(request, moves, seconds, settings):
            return moves
    return None


def _tuned_single_move(request, seconds, settings):
    """停车位置、V/A/D都以编码值反求，尽量用一条Move完成同步。

    对非零末速，选择合法编码停车点P及D，再由固定T解峰速和A。
    这是参数求解，不通过改变接入点或延迟起步弥补量化。
    """
    if not settings["entry_quantize_protocol"] or not request["w"]:
        return None
    q, w, s, A, D, V = (request[key] for key in ("q", "w", "s", "A", "D", "V"))
    seed = q + s * w * w / (2 * D)
    first = (math.ceil(seed * 10 - 1e-8) if s > 0 else math.floor(seed * 10 + 1e-8)) / 10
    targets = [first + s * step / 10 for step in (0, 1, 2, 3, 5, 10, 20)]
    if request["command"] is not None:
        targets.append(request["command"]["pos"])
    best, error = None, math.inf
    for target in targets:
        remaining = s * (target - q)
        if remaining <= 0:
            continue
        ideal_dec = w * w / (2 * remaining)
        for dec in {quantize(ideal_dec), _floor_rate(ideal_dec, True)}:
            if dec <= 0 or dec > D + 1e-9:
                continue
            effective = s * (target - request["current"]) - w * w / (2 * dec)
            B, C, K = seconds + w / dec, (1 / A + 1 / dec) / 2, effective + w * w / (2 * dec)
            discriminant = B * B - 4 * C * K
            if discriminant < -1e-9:
                continue
            needed = max(w, 2 * K / (B + math.sqrt(max(0., discriminant))))
            base = math.ceil(needed * 10 - 1e-8) / 10
            for step in (0, 1, 2, 4, 10):
                peak = base + step / 10
                denominator = 2 * (peak * seconds - (peak - w) ** 2 / (2 * dec) - effective)
                if peak > V + 1e-9 or denominator <= 0:
                    continue
                acc = quantize(peak * peak / denominator)
                if acc <= 0 or acc > A + 1e-9 or peak / acc + (peak - w) / dec > seconds + 1e-7:
                    continue
                move = {"pos": quantize(target), "vel": quantize(peak), "accVel": acc, "decVel": dec}
                moves = [_move_at(0., move)]
                if not _fits(request, moves, seconds, settings):
                    continue
                actual = AxisTrack(request["current"], [(0., move)])
                aq, av = actual.state(seconds * 1000)
                score = abs(aq - q) + abs(av - request["v"])
                if score < error:
                    best, error = moves, score
                if score < 1e-6:
                    return best
    return best


def _steering_moves(request, seconds, settings):
    """编码精度下的同步：立即低速起步，途中换速，末段达到目标有符号速度。

    c→p→w，A/D固定为能力上限，换速时刻解位移方程。所有准备指令仍使用原entry_moves。
    非零速度时保留安全的原停车目标，必要时在T前主动减速；T时由handoff恢复原Move。
    """
    L, w, A, D, V = (request[key] for key in ("L", "w", "A", "D", "V"))
    quantized = settings["entry_quantize_protocol"]
    c = .1 if quantized else min(.001, max(1e-10, L / max(1., seconds) / 100))
    if w and w < c - 1e-9:
        return None
    B, C, K = seconds + w / D, (1 / A + 1 / D) / 2, L + w * w / (2 * D)
    discriminant = B * B - 4 * C * K
    if discriminant < -1e-8:
        return None
    required = max(c, w, 2 * K / (B + math.sqrt(max(0., discriminant))))
    peak = math.ceil(required * 10 - 1e-8) / 10 if quantized else required
    if peak > V + 1e-8 or peak / A + (peak - w) / D > seconds + 1e-8:
        return None
    if w == 0:
        target = quantize(request["q"]) if quantized else request["q"]
        # 停点按最终可编码pos求解，不能发送时才取整。
        L = request["s"] * (target - request["current"])
    else:
        command = request["command"]
        if command is None:
            return None
        target = command["pos"]
        if request["s"] * (target - request["q"]) < w * w / (2 * D) - 1e-7:
            return None
    maximum_distance = peak * seconds - peak * peak / (2 * A) - (peak - w) ** 2 / (2 * D)
    if abs(peak - c) < 1e-10:
        moves = [_move_at(0., {"pos": target, "vel": peak, "accVel": A, "decVel": D})]
        return moves if _fits(request, moves, seconds, settings) else None
    switch = c / A + (maximum_distance - L) / (peak - c)
    slow = seconds - (peak - w) / D
    if switch < c / A - 1e-8 or switch + (peak - c) / A > slow + 1e-8:
        return None
    def move(cap):
        return {"pos": target, "vel": cap, "accVel": A, "decVel": D}
    # 无低速匀速阶段时直接用峰速起步，避免生成无意义的切换。
    if switch <= c / A + 1e-8:
        moves = [_move_at(0., move(peak))]
    else:
        moves = [_move_at(0., move(c)), _move_at(switch, move(peak), "prepare_switch")]
    if w and peak > w + 1e-8:
        moves.append(_move_at(slow, move(c), "prepare_switch"))
    return moves if _fits(request, moves, seconds, settings) else None


def _preparation_moves(request, seconds, settings, prefer_steering):
    if request["idle"]:
        return [] if seconds <= 1e-9 else None
    if "retreat" in request:
        first, second = request["retreat"]
        # 共同时间的余量用于计算第一步的V/A/D，而非在助跑点等待。
        runup_seconds = second["coded_minimum"]
        first_seconds = seconds - runup_seconds
        if first_seconds < first["minimum"] - 1e-8:
            return None
        before = _preparation_moves(first, first_seconds, settings, prefer_steering)
        after = _preparation_moves(second, runup_seconds, settings, prefer_steering)
        if before is None or after is None:
            return None
        before[0]["role"] = "reposition"
        return before + [{**item, "role": "prepare_switch", "start_ms": item["start_ms"] + first_seconds * 1000}
                         for item in after]
    moves = None if prefer_steering else _single_move(request, seconds, settings)
    if moves is None and not prefer_steering:
        moves = _tuned_single_move(request, seconds, settings)
    moves = moves or _steering_moves(request, seconds, settings)
    if moves is None and prefer_steering:
        moves = _single_move(request, seconds, settings)
    if moves is None and request.get("can_retreat") and request["v"]:
        for extra in (0., .1, 1., 10.):
            try:
                alternative = _retreat_request(request["device"], request["index"], request["u0"], settings,
                                               request["current"], request["q"], request["v"], extra)
            except EntryInfeasible:
                continue
            if alternative["minimum"] <= seconds + 1e-8:
                moves = _preparation_moves(alternative, seconds, settings, prefer_steering)
                if moves is not None:
                    break
    return moves


def _entry_for_time(request, seconds, u0, settings, prefer_steering=False):
    device, index = request["device"], request["index"]
    entry = {"axis": AXIS_NAMES[index], "index": index,
             "kind": "in_place" if request["idle"] else ("reposition_then_run_up" if "retreat" in request else "synchronized"),
             "lead_ms": seconds * 1000, "join": (request["q"], request["v"]), "moves": []}
    if not request["idle"]:
        moves = _preparation_moves(request, seconds, settings, prefer_steering)
        if moves is None:
            return None
        if any(item["role"] == "reposition" for item in moves):
            entry["kind"] = "reposition_then_run_up"
        for item in moves:
            item["at"] = "clock_start" if item["start_ms"] == 0 else "before_join"
            item["offset_ms"] = seconds * 1000 - item["start_ms"]
        entry["moves"] = moves
        entry["distance"] = request["L"]
    # 原表恰在t0下发时直接沿用；其它情况补发生效Move，恢复原轨迹的加/减速过程。
    track = device.tracks[index]
    if request["v"] and request["command"] is not None and not any(abs(u - u0) <= 1e-8 for u, _ in track.sends):
        entry["moves"].append({"role": "handoff", "at": "before_join", "offset_ms": 0.,
                               "move": dict(request["command"])})
    return entry


def _materialize(plan, settings):
    decimals = settings["entry_send_time_decimals"]
    plan["clock_start_u"] = round(plan["u0"] - plan["lead_ms"], decimals)
    for _, entry in plan["entries"]:
        for move in entry["moves"]:
            value = plan["clock_start_u"] if move["at"] == "clock_start" else plan["u0"] - move["offset_ms"]
            move["send_u"] = round(value, decimals)
    return plan


def _plan_at(devices, u0, settings, allow_two_step=False, requests=None):
    # allow_two_step参数保留调用兼容；各轴共用T，助跑不足可先回到合法助跑点，但不允许停等。
    requests = requests if requests is not None else [
        _axis_request(device, index, u0, settings) for device in devices
        for index in range(3) if device.active[index]]
    initial = max((request["minimum"] for request in requests), default=0.)
    coded = max((request["coded_minimum"] for request in requests), default=0.)
    # 先尝试理论最短值；最终协议峰速无法编码时再使用可编码的最短峰速方案。
    trials = sorted({initial, max(initial, coded), max(initial, coded) + .000001,
                     max(initial, coded) + .00001, max(initial, coded) + .0001})
    alternatives = []
    for request in requests:
        if request.get("can_retreat") and request["v"]:
            try:
                alternative = _retreat_request(request["device"], request["index"], u0, settings,
                                               request["current"], request["q"], request["v"])
                alternatives.append(max(initial, coded, alternative["coded_minimum"]))
            except EntryInfeasible:
                pass
    trials = sorted(set(trials + alternatives))
    for seconds in trials:
        for prefer_steering in (False, True):
            entries = []
            for request in requests:
                entry = _entry_for_time(request, seconds, u0, settings, prefer_steering)
                if entry is None:
                    break
                entries.append((request["device"], entry))
            else:
                plan = _materialize({"u0": u0, "lead_ms": seconds * 1000, "entries": entries}, settings)
                verification = _verify(plan, settings)
                if verification["passed"]:
                    return plan
    raise EntryInfeasible(["各轴无法在同一准备时间按最终编码参数同时起步、接上位置和速度"])


###############################################################################
# 七、连续选点：每个候选原曲线时刻均可参与，不要求已有公共关键帧
###############################################################################


def _search_window(devices, lower, upper, to_curve, to_run, settings):
    if not any(device.moves for device in devices):
        try:
            return _plan_at(devices, lower, settings), 1
        except EntryInfeasible:
            return None, 1
    resolution = settings["frame_resolution_ms"]
    low_curve, high_curve = sorted((to_curve(lower), to_curve(upper)))
    frames = {low_curve, high_curve}
    frames.update(range(math.ceil(low_curve / resolution) * resolution,
                        math.floor(high_curve / resolution) * resolution + 1, resolution))
    for device in devices:
        for index in range(3):
            if device.active[index]:
                frames.update(to_curve(u) for u in device.tracks[index].boundaries(lower, upper))
    # 先算所有连续候选的解析下界，再用编码回放核对可能胜出的点。
    # 下界大于已知最佳的候选无需反复构造Move，不牺牲帧网格内的比较范围。
    candidates = []
    for frame in frames:
        u = to_run(frame)
        try:
            requests = [_axis_request(device, index, u, settings) for device in devices
                        for index in range(3) if device.active[index]]
        except EntryInfeasible:
            continue
        bound = max((request["minimum"] for request in requests), default=0.) * 1000
        candidates.append((bound, u))
    candidates.sort()
    evaluated, best, shortest = 0, None, math.inf
    plans = []
    tie = settings["entry_lead_tie_ms"]
    for bound, u in candidates:
        if bound > shortest + tie + 1e-8:
            break
        evaluated += 1
        try:
            plan = _plan_at(devices, u, settings)
        except EntryInfeasible:
            continue
        plans.append(plan)
        shortest = min(shortest, plan["lead_ms"])
    if plans:
        best = min((plan for plan in plans if plan["lead_ms"] <= shortest + tie + 1e-8), key=lambda plan: plan["u0"])
    return best, evaluated


def _windows(devices, first, last, reverse, reference):
    """保留当前原动作段优先，整段不可执行才沿方向查后续段，不跨首末回绕。"""
    boundaries = {first, last}
    for device in devices:
        if device.moves:
            boundaries.update(frame for frame in device.keyframes if first <= frame <= last)
    boundaries = sorted(boundaries)
    windows = list(zip(boundaries, boundaries[1:])) or [(first, last)]
    if reference is None:
        return [(first, last, "whole_action")]
    if not reverse:
        index = next((i for i, (low, high) in enumerate(windows) if low <= reference < high), len(windows) - 1)
        ordered = windows[index:]
    else:
        index = next((i for i, (low, high) in enumerate(windows) if low < reference <= high), 0)
        ordered = list(reversed(windows[:index + 1]))
    return [(low, high, "current_segment" if position == 0 else "directional_fallback")
            for position, (low, high) in enumerate(ordered)]


###############################################################################
# 八、最终编码回放：位置、速度、后续整段、行程、能力和同时起步均纳入通过条件
###############################################################################


def _verify(plan, settings):
    u0 = plan["u0"]
    worst_position, worst_velocity = 0., 0.
    monotonic, limits_ok, simultaneous = True, True, True
    for device, entry in plan["entries"]:
        index = entry["index"]
        track = device.tracks[index]
        sends = [(move["send_u"], move["move"]) for move in entry["moves"]]
        sends += [(u, command) for u, command in track.sends if u >= u0 - 1e-9]
        sends.sort(key=lambda item: item[0])
        actual = AxisTrack(device.current[index], sends)
        preparation = [move for move in entry["moves"] if move["role"] != "handoff"]
        if entry["kind"] != "in_place":
            simultaneous &= bool(preparation) and abs(preparation[0]["send_u"] - plan["clock_start_u"]) <= 1e-8
        checkpoints = {u0}
        for trajectory in (actual, track):
            checkpoints.update(value for segment in trajectory.segments for value in (segment.u0, segment.u1)
                               if math.isfinite(value) and value >= u0)
        checkpoints.add(max(checkpoints) + 1000)
        ordered = sorted(checkpoints)
        for left, right in zip(ordered, ordered[1:]):
            aq, av = actual.state(left)
            rq, rv = track.state(left)
            acceleration = actual.segment_containing(left).a - track.segment_containing(left).a
            if abs(acceleration) > 1e-12:
                extremum = left - (av - rv) / acceleration * 1000
                if left < extremum < right:
                    checkpoints.add(extremum)
        for u in checkpoints:
            aq, av = actual.state(u)
            rq, rv = track.state(u)
            worst_position = max(worst_position, abs(aq - rq))
            worst_velocity = max(worst_velocity, abs(av - rv))
        direction = (1 if entry["join"][1] > 0 else -1) if entry["join"][1] else (
            1 if entry["join"][0] >= device.current[index] else -1)
        for segment in actual.segments:
            left, right = max(segment.u0, plan["clock_start_u"]), segment.u1
            if right <= left or not math.isfinite(left):
                continue
            if not math.isfinite(right):
                right = left
            positions = [segment.state(left)[0], segment.state(right)[0]]
            velocities = [segment.state(left)[1], segment.state(right)[1]]
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
                # 运动轴不能提前停稳并等待，或以延后发送伪装同时起步。
                rounding_ms = 10 ** (-settings["entry_send_time_decimals"])
                simultaneous &= not (end > left + rounding_ms + 1e-7 and abs(segment.a) < 1e-10 and abs(segment.state(left)[1]) < 1e-10)
        for _, command in sends:
            limits_ok &= (device.lower[index] - 1e-8 <= command["pos"] <= device.upper[index] + 1e-8
                          and command["vel"] <= device.reposition_velocity[index] + 1e-8
                          and command["accVel"] <= device.reposition_acceleration[index] + 1e-8
                          and command["decVel"] <= device.reposition_deceleration[index] + 1e-8)
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
    try:
        return _calculate(parameters)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        return {"status": "invalid_input", "message": str(error), "algorithm_version": ALGORITHM_VERSION}


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
    spans = [(piece[0][0], piece[-1][1]) for piece in (_pieces_of(model, unit) for model in models)]
    first = min(span[0] for span in spans)
    last = max(span[1] for span in spans)
    run_origin = last if reverse else first

    def to_run(curve):
        return direction * (curve - run_origin)

    def to_curve(run):
        return run_origin + direction * run

    devices = [_Device(model, states, direction, run_origin, command["loop"], settings) for model in models]

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
        for low, high, phase in _windows(devices, first, last, reverse, reference):
            if reference_window is None:
                reference_window = [low, high]
            lower, upper = sorted((to_run(low), to_run(high)))
            best, count = _search_window(devices, lower, upper, to_curve, to_run, settings)
            evaluated += count
            attempts.append({"range_ms": [low, high], "phase": phase, "status": "planned" if best else "infeasible"})
            if best is not None:
                plan, selected_window = best, [low, high]
                break
        if plan is None:
            return _infeasible(command, mode, reference, "运行方向上没有可接入的帧", attempts, [])

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
    decimals = settings["entry_send_time_decimals"]
    u0 = plan["u0"]
    clock_start = plan["clock_start_u"]
    for _, entry in plan["entries"]:
        for move in entry["moves"]:
            run_time = clock_start if move["at"] == "clock_start" else u0 - move["offset_ms"]
            # 核对的必须是最终输出sendTime所代表的时刻，而非舍入前的内部值。
            curve_time = round(to_curve(run_time), decimals)
            move["send_u"] = u0 + (curve_time - to_curve(u0)) * (-1 if command["reverse"] else 1)
    verification = _verify(plan, settings)
    entry_moves, by_device = [], {}
    for device, entry in plan["entries"]:
        by_device.setdefault(id(device), (device, []))[1].append(entry)
        for move in entry["moves"]:
            # 沿用原版角色含义：静止摆位/退回助跑点用reposition，带速接入用run_up。
            role = "run_up"
            if not entry["join"][1] or move["role"] == "reposition":
                role = "reposition"
            elif entry["kind"] == "reposition_then_run_up" and abs(
                    move["move"]["pos"] - entry["moves"][0]["move"]["pos"]) <= _EPS:
                role = "reposition"
            entry_moves.append({
                **_route(device), "axis": entry["axis"], "axisIndex": entry["index"], "role": role,
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
            # 按原版kind恢复原有可选字段组合，内部类别不进入JSON。
            kind = entry["kind"]
            q, v = entry["join"]
            if kind == "synchronized":
                kind = "run_up" if v else "reposition"
            axis = {"axis": entry["axis"], "kind": kind,
                    "lead_ms": 0. if kind == "in_place" else entry["lead_ms"]}
            if kind != "in_place":
                axis["distance"] = ((1 if v > 0 else -1) * (q - device.current[entry["index"]])
                                    if v else abs(q - device.current[entry["index"]]))
            if kind in ("run_up", "reposition_then_run_up"):
                if kind == "reposition_then_run_up":
                    axis["run_up_distance"] = abs(q - entry["moves"][0]["move"]["pos"])
                else:
                    axis["run_up_distance"] = v * v / (2 * min(device.entry_acceleration[entry["index"]],
                                                              device.reposition_acceleration[entry["index"]]))
            axes.append({key: round(value, 6) if isinstance(value, float) else value
                         for key, value in axis.items()})
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
        "entry_moves": entry_moves,
        "devices": device_rows,
        "execution": {
            "rule": "曲线时钟从clock_start_ms开始走；时钟到entry_moves[].sendTime时给对应轴下发那条Move（每条只发一次）；"
                    "帧表中下发时刻早于selected_curve_time_ms的Move全部跳过，从selected_curve_time_ms起照帧表逐帧下发",
            "relative": "也可按相对时间执行：GO后经过entry_lead_ms到达selected_curve_time_ms；"
                        "每条接入Move在到达前beforeJoinMs下发（clock_start_ms可能早于动作首帧，甚至为负）",
            "reverse_clock": "反向时原曲线时钟从clock_start_ms往小走，sendTime都不小于selected_curve_time_ms",
            "run_up_moves": sum(1 for move in entry_moves if move["role"] == "run_up"),
            "speed_factor": "结果已按输入曲线和能力核对，直接下发；若外部再次改变倍率或取整，必须重新核对能力和整段运动，不能沿用verification",
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
