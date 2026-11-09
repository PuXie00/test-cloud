"""非强制Move控制边界在线调速：time触发邻行参数，pos为停车目标。"""


import bisect


import json


import math


import sys


import threading


import uuid


from pathlib import Path


_TOL = 1e-6
_FRAME_POSITION_TOL = .05
_FRAME_VELOCITY_TOL = .05


_ZERO = {"pos": 0, "vel": 0, "accVel": 0, "decVel": 0, "passVel": 0}


_WIRE_LIMIT_CACHE = {}


_INT_ZERO = 0








_ARRIVAL_LOCK = threading.RLock()


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + "须为有限数值")
    return float(value)


def _quant(value):
    """协议使用0.1精度，半格向远离0的方向取整。"""
    return math.copysign(math.floor(abs(value) * 10 + .5 + 1e-10) / 10, value)


_SCHEDULE_PROFILE_CACHE = {}
_SCHEDULE_AXIS_CACHE = {}


def _profile(q0, v0, command):
    key = (q0, v0, command["pos"], command["vel"], command["accVel"], command["decVel"])
    cached = _SCHEDULE_PROFILE_CACHE.get(key)
    if cached is not None:
        return cached
    result = _profile_uncached(q0, v0, command)
    if len(_SCHEDULE_PROFILE_CACHE) >= 16384:
        _SCHEDULE_PROFILE_CACHE.pop(next(iter(_SCHEDULE_PROFILE_CACHE)))
    _SCHEDULE_PROFILE_CACHE[key] = result
    return result


def _profile_uncached(q0, v0, command):
    """无Jerk的真实Move，保存加速、匀速、减速及必要的制动折返。"""
    target, cap, acc, dec = (command[key] for key in ("pos", "vel", "accVel", "decVel"))
    if min(cap, acc, dec) <= 0:
        raise ValueError("有效Move的速度和加减速度须大于0")
    direction = 1 if target > q0 else -1 if target < q0 else 0
    if not direction:
        if abs(v0) <= _TOL:
            return {"phases": [], "duration": 0., "target": target}
        direction = 1 if v0 > 0 else -1
    phases = []
    q, v, elapsed = q0, v0, 0.

    def append(seconds, acceleration):
        nonlocal q, v, elapsed
        if seconds <= 1e-14:
            return
        phases.append((seconds, q, v, acceleration))
        q += v * seconds + .5 * acceleration * seconds * seconds
        v += acceleration * seconds
        elapsed += seconds

    speed = direction * v
    if speed < -_TOL:
        append(-speed / dec, direction * dec)
        speed = 0.
    distance = direction * (target - q)
    if distance < speed * speed / (2 * dec) - _TOL:
        append(speed / dec, -direction * dec)
        following = _profile(q, 0., command)
        return {"phases": phases + following["phases"],
            "duration": elapsed + following["duration"], "target": target}
    if speed > cap + _TOL:
        append((speed - cap) / dec, -direction * dec)
        speed = cap
        distance = direction * (target - q)
    peak = min(cap, math.sqrt(max(0., (2 * acc * dec * distance + dec * speed * speed) / (acc + dec))))
    if peak < speed - _TOL:
        # 微小剩距可能落入位置容差，但速度条件仍表明刹不住；真实刹停后折返，不伪造到位。
        append(speed / dec, -direction * dec)
        following = _profile(q, 0., command)
        return {"phases": phases + following["phases"],
                "duration": elapsed + following["duration"], "target": target}
    acceleration_distance = max(0., (peak * peak - speed * speed) / (2 * acc))
    deceleration_distance = peak * peak / (2 * dec)
    cruise_distance = max(0., distance - acceleration_distance - deceleration_distance)
    append(max(0., peak - speed) / acc, direction * acc)
    append(cruise_distance / peak if peak else 0., 0.)
    append(peak / dec, -direction * dec)
    if abs(q - target) > max(_TOL, 1e-10 * abs(target)) or abs(v) > _TOL:
        raise ValueError("Move积分末态不一致")
    return {"phases": phases, "duration": elapsed, "target": target}


def _state(profile, seconds):
    if profile is None:
        raise ValueError("缺少有效Move")
    remaining = max(0., seconds)
    if remaining >= profile["duration"]:
        return profile["target"], 0.
    for duration, position, velocity, acceleration in profile["phases"]:
        if remaining <= duration + 1e-12:
            used = min(remaining, duration)
            q, v = position + velocity * used + .5 * acceleration * used * used, velocity + acceleration * used
            if profile["duration"] - max(0., seconds) <= 1e-10 and abs(v) <= _TOL and abs(q - profile["target"]) <= _TOL:
                return profile["target"], 0.
            return q, v
        remaining -= duration
    return profile["target"], 0.


def _acceleration(profile, seconds):
    if profile is None or seconds >= profile["duration"] - 1e-10:
        return 0.
    elapsed = 0.
    for duration, _, _, acceleration in profile["phases"]:
        elapsed += duration
        if seconds <= elapsed + 1e-10:
            return acceleration
    return 0.


def _wire(value):
    if not isinstance(value, dict):
        raise ValueError("virtualAxis元素须为对象")
    try:
        pos = value["pos"]
        vel = value["vel"]
        acc = value["accVel"]
        dec = value["decVel"]
        passed = value["passVel"]
    except KeyError:
        raise ValueError("Move参数须为有限数值") from None
    if pos is _INT_ZERO and vel is _INT_ZERO and acc is _INT_ZERO and dec is _INT_ZERO and passed is _INT_ZERO:
        return None
    if type(pos) not in (int, float):
        raise ValueError("Move参数须为有限数值")
    if passed is not _INT_ZERO and (type(passed) not in (int, float) or not math.isfinite(passed)):
        raise ValueError("Move参数须为有限数值")
    if type(vel) not in (int, float) or type(acc) not in (int, float) or type(dec) not in (int, float):
        raise ValueError("Move参数须为有限数值")
    if vel == acc == dec == 0:
        if pos != 0 or passed != 0:
            raise ValueError("占位轴须全部为0")
        return None
    # 有界协议位置同时排除NaN、无穷和有限但无法编码的极大数值。
    if not -214748364.8 - 1e-7 <= pos <= 214748364.7 + 1e-7:
        raise ValueError("Move位置超出协议编码范围")
    raw_pos = round(pos * 10)
    if abs(pos - raw_pos / 10) > 1e-7:
        raise ValueError("当前执行表的Move参数须为实际下发的0.1精度")
    if not -2147483648 <= raw_pos <= 2147483647:
        raise ValueError("Move位置超出协议编码范围")
    # 缓存已验证的数值三元组，位置和交接速度仍逐条校验。
    key = (vel, acc, dec)
    limits = _WIRE_LIMIT_CACHE.get(key)
    if limits is None:
        if not (0 < vel <= 6553.5 + 1e-7 and 0 < acc <= 6553.5 + 1e-7 and 0 < dec <= 6553.5 + 1e-7):
            raise ValueError("Move速度或加减速度超出协议编码范围")
        raw_vel, raw_acc, raw_dec = round(vel * 10), round(acc * 10), round(dec * 10)
        limits = (raw_vel / 10, raw_acc / 10, raw_dec / 10)
        if any(abs(old - new) > 1e-7 for old, new in zip(key, limits)):
            raise ValueError("当前执行表的Move参数须为实际下发的0.1精度")
        if min(limits) <= 0:
            raise ValueError("有效Move的V/A/D低于0.1精度")
        if len(_WIRE_LIMIT_CACHE) >= 1024:
            _WIRE_LIMIT_CACHE.clear()
        _WIRE_LIMIT_CACHE[key] = limits
    # 精确可编码时只读复用输入；生成输出表时再复制，避免逐轴重复分配。
    if pos == raw_pos / 10 and key == limits:
        return value
    return {"pos": raw_pos / 10, "vel": limits[0], "accVel": limits[1],
            "decVel": limits[2], "passVel": float(passed)}


def calculate_speed_adjust(data, debug=False):
    """按真实邻行下发事件计算在线调速，失败原因写入message。"""
    try:
        with _ARRIVAL_LOCK:
            return _schedule_calculate(data)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        message = "调速计算失败 " + str(error)
        if debug:
            print(message, file=sys.stderr)
        return {"success": False, "message": message}


def _format_json(value, level=0):
    if isinstance(value, dict):
        if set(value) == set(_ZERO):
            return json.dumps(value, ensure_ascii=False, allow_nan=False)
        rows = ["  " * (level + 1) + json.dumps(key, ensure_ascii=False) + ": " + _format_json(item, level + 1)
                for key, item in value.items()]
        return "{\n" + ",\n".join(rows) + "\n" + "  " * level + "}" if rows else "{}"
    if isinstance(value, list) and any(isinstance(item, (dict, list)) for item in value):
        return "[\n" + ",\n".join("  " * (level + 1) + _format_json(item, level + 1) for item in value) + "\n" + "  " * level + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def main(input_path=None, output_path=None):
    target = None
    try:
        source = Path(input_path) if input_path else Path(__file__).with_name("输入.json")
        target = Path(output_path) if output_path else source.with_name("输出.json")
        if source.resolve() == target.resolve():
            target = None
            raise ValueError("输入和输出须为两个文件")
        parameters = json.loads(source.read_text(encoding="utf-8-sig"))
        result = calculate_speed_adjust(parameters)
        if json.loads(source.read_text(encoding="utf-8-sig")) != parameters:
            raise ValueError("计算期间输入已变化")
    except (ValueError, OSError, TypeError) as error:
        result = {"success": False, "message": "输入读取失败 " + str(error)}
    if target is not None:
        temporary = None
        try:
            text = _format_json(result) + "\n"
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + "." + uuid.uuid4().hex + ".tmp")
            temporary.write_text(text, encoding="utf-8", newline="\n")
            temporary.replace(target)
            temporary = None
        except (ValueError, OSError, TypeError) as error:
            message = "输出写入失败 " + str(error)
            if not result["success"]:
                message = result["message"] + "；" + message
            result = {"success": False, "message": message}
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError as error:
                    result["message"] += "；临时文件清理失败 " + str(error)
    if not result["success"]:
        print(result["message"], file=sys.stderr)
    print(_format_json(result) + "\n", end="")
    return result



def _schedule_axis(value):
    if not isinstance(value, dict) or set(value) != set(_ZERO):
        raise ValueError("虚轴须包含pos/vel/accVel/decVel/passVel")
    raw = tuple(value[key] for key in _ZERO)
    if all(type(item) in (int, float) for item in raw):
        if all(item == 0 for item in raw):
            return _ZERO
        cached = _SCHEDULE_AXIS_CACHE.get(raw)
        if cached is not None:
            return dict(cached)
    axis = {key: _number(value[key], key) for key in _ZERO}
    if min(axis[key] for key in ("vel", "accVel", "decVel")) < 0:
        raise ValueError("速度和加减速度不能为负数")
    if axis["vel"] > 0:
        for key in ("pos", "vel", "accVel", "decVel"):
            axis[key] = _quant(axis[key])
        _wire(axis)
    # vel0不下发；缓存只有纯数据模板，每次正轴复制后才附内部关联。
    if len(_SCHEDULE_AXIS_CACHE) >= 8192:
        _SCHEDULE_AXIS_CACHE.pop(next(iter(_SCHEDULE_AXIS_CACHE)))
    _SCHEDULE_AXIS_CACHE[raw] = dict(axis)
    return axis


def _schedule_rows(model, reverse=None):
    if not isinstance(model, dict) or type(model.get("deviceId")) is not int or model["deviceId"] <= 0:
        raise ValueError("deviceId须为正整数")
    blocks = model.get("timeBlockList")
    if not isinstance(blocks, list) or len(blocks) < 2:
        raise ValueError("每模型至少需要两个控制时间节点")
    rows = []
    for block in blocks:
        if not isinstance(block, dict):
            raise ValueError("控制行须为对象")
        clock = _number(block.get("time"), "time")
        axes = block.get("virtualAxis")
        if clock < 0 or not isinstance(axes, list) or len(axes) != 3:
            raise ValueError("每行须有非负time和三个虚轴")
        rows.append({"time": clock, "virtualAxis": [_schedule_axis(axis) for axis in axes]})
    collisions = [i for i, (a, b) in enumerate(zip(rows, rows[1:])) if b["time"] <= a["time"]]
    if collisions:
        edge = 0 if reverse else len(rows) - 2
        if (reverse is None or collisions != [edge] or rows[edge]["time"] != rows[edge + 1]["time"]
                or abs(rows[edge]["time"] - round(rows[edge]["time"])) > 1e-7):
            raise ValueError("timeBlockList须按正向time严格递增保存")
        # 最后一行只是结束边界，不再下发Move；真实Done会补足碰撞后的尾巴。
        rows[0 if reverse else -1]["_rounded_terminal"] = True
    return rows


def move_absolute_parameters(start_axis, target_axis, duration_ms=None):
    """读取相邻目标行的真实0105参数；pos已经是停车目标，不额外延伸。"""
    target = _schedule_axis(target_axis)
    if target["vel"] == 0:
        return None
    return {key: target[key] for key in ("pos", "vel", "accVel", "decVel")}


def _schedule_fit(axis, source, applied):
    # 保护D可以高于标准；绝对倍率只从V/A和固定原控制序恢复。
    lower, upper = 0., math.inf
    for key, power in (("vel", 1), ("accVel", 2)):
        base, actual = source[key], axis[key]
        if base <= 0 or actual <= 0:
            return None
        lo, hi = max(0., actual - .050000001) / base, (actual + .050000001) / base
        if power == 2:
            lo, hi = math.sqrt(lo), math.sqrt(hi)
        lower, upper = max(lower, lo), min(upper, hi)
    if source["decVel"] <= 0 or axis["decVel"] <= 0:
        return None
    upper = min(upper, math.sqrt((axis["decVel"] + .050000001) / source["decVel"]))
    if lower > upper:
        return None
    candidates = [applied, 1.]
    for key, power in (("vel", 1), ("accVel", 2)):
        ratio = (axis[key] / source[key]) ** (1 / power)
        candidates.extend((round(ratio, 2), ratio))
    candidates.append((lower + upper) / 2)
    for rate in candidates:
        if (rate > 0 and lower - 1e-8 <= rate <= upper + 1e-8
                and all(abs(_quant(source[key] * rate ** power) - axis[key]) <= 1e-7
                        for key, power in (("vel", 1), ("accVel", 2)))
                and axis["decVel"] + 1e-7 >= _quant(source["decVel"] * rate * rate)):
            cost = 0. if rate == applied else .1 if rate == 1. else 1. + abs(math.log(rate / applied)) * .01
            return rate, cost, lower, upper
    return None


def _schedule_associate(rows, original, reverse, applied, stop_switches=None):
    """同一原控制序，新增在线行只增加当前命令副本；逐虚轴保留原行关联。"""
    ordered = list(reversed(rows)) if reverse else rows
    sources = list(reversed(original)) if reverse else original
    # 整数节点可能来自round/floor/ceil；浮点节点保持原精度，原0锚没有舍入误差。
    stamp_origin = ordered[0]["time"] if reverse else 0.
    # 反向Done下穿0时整表会平移；历史整数毫秒格点随起点一起平移。
    stamp_errors = [.001 if (abs(row["time"] - round(row["time"])) <= 1e-7 or
                             abs(row["time"] - stamp_origin - round(row["time"] - stamp_origin)) <= 1e-7) else 0. for row in ordered]
    if ordered[0]["time"] == sources[0]["time"] == 0:
        stamp_errors[0] = 0.
    stop_prefix = [0]
    for flag in stop_switches or [False] * len(ordered):
        stop_prefix.append(stop_prefix[-1] + int(any(flag) if isinstance(flag, (tuple, list)) else bool(flag)))
    for axis_index in range(3):
        commands = [(index, row["virtualAxis"][axis_index]) for index, row in enumerate(ordered[1:], 1)
                    if row["virtualAxis"][axis_index]["vel"] > 0]
        baseline = [(index, row["virtualAxis"][axis_index]) for index, row in enumerate(sources[1:], 1)
                    if row["virtualAxis"][axis_index]["vel"] > 0]
        if len(commands) < len(baseline) or commands and not baseline:
            raise ValueError("当前完整执行表缺少原控制命令或新增了未定义虚轴")
        if not commands:
            continue
        starts = [abs(ordered[index - 1]["time"] - ordered[0]["time"]) / 1000 for index, _ in commands]
        ends = starts[1:] + [abs(ordered[-1]["time"] - ordered[0]["time"]) / 1000]
        durations = [right - left for left, right in zip(starts, ends)]
        source_starts = [abs(sources[index - 1]["time"] - sources[0]["time"]) / 1000 for index, _ in baseline]
        budgets = [right - left for left, right in zip(source_starts, source_starts[1:])] + [math.inf]

        def stopped(first, last):
            start_node = commands[first][0] - 1
            end_node = commands[last + 1][0] - 1
            return stop_prefix[end_node + 1] > stop_prefix[start_node + 1]

        def rounding_allowance(group, fits, rates=None):
            # ΣrΔt中的共享节点误差只按(r前-r后)计算，不能给每个副本重复加容差。
            bounds = [(rate, rate) for rate in rates] if rates is not None else [(fit[2], fit[3]) for fit in fits]
            weights = [bounds[0][1]]
            weights.extend(max(abs(a[0] - b[1]), abs(a[1] - b[0])) for a, b in zip(bounds, bounds[1:]))
            weights.append(bounds[-1][1])
            nodes = [commands[i][0] - 1 for i in group] + [commands[group[-1] + 1][0] - 1]
            return sum(stamp_errors[node] * weight for node, weight in zip(nodes, weights))

        def assign(group, j, fits):
            # 量化后V/A可同码；非stop控制组仍须精确消耗原曲线时间预算。
            # 不采用全局applied猜旧延期段的实际时钟倍率。
            rates = [fit[0] for fit in fits]
            first, last = group[0], group[-1]
            if (math.isfinite(budgets[j]) and (not stopped(first, last) or
                    sum(durations[i] * fit[2] for i, fit in zip(group, fits)) <= budgets[j] + max(1e-6, budgets[j] * 1e-10))):
                budget = budgets[j]
                original_budget = budget
                tolerance = max(1e-6, budget * 1e-10)
                low = sum(durations[i] * fit[2] for i, fit in zip(group, fits))
                high = sum(durations[i] * fit[3] for i, fit in zip(group, fits))
                quantized = not low - tolerance <= budget <= high + tolerance
                if quantized:
                    allowance = rounding_allowance(group, fits)
                    if not low - allowance - tolerance <= budget <= high + allowance + tolerance:
                        raise ValueError("当前非stop控制组与原时间预算不一致")
                    actual = sum(durations[i] * rate for i, rate in zip(group, rates))
                    # 参数倍率仍须编码出原V/A；时钟倍率才吸收有界的时间舍入差。
                    budget = actual if abs(actual - budget) <= rounding_allowance(group, fits, rates) + tolerance else min(high, max(low, budget))
                if not low - tolerance <= budget <= high + tolerance:
                    raise ValueError("当前非stop控制组与原时间预算不一致")
                if abs(sum(durations[i] * rate for i, rate in zip(group, rates)) - budget) > tolerance:
                    if len(group) == 1:
                        rates = [budget / durations[first]]
                    else:
                        left, right = 0., max(fit[3] / rate for rate, fit in zip(rates, fits))
                        for _ in range(48):
                            scale = (left + right) / 2
                            total = sum(durations[i] * min(fit[3], max(fit[2], rate * scale))
                                        for i, rate, fit in zip(group, rates, fits))
                            if total < budget:
                                left = scale
                            else:
                                right = scale
                        rates = [min(fit[3], max(fit[2], rate * (left + right) / 2)) for rate, fit in zip(rates, fits)]
                encoding_failed = False
                for k, (i, rate) in enumerate(zip(group, rates)):
                    axis, source = commands[i][1], baseline[j][1]
                    if (any(abs(_quant(source[key] * rate ** power) - axis[key]) > 1e-7
                            for key, power in (("vel", 1), ("accVel", 2)))
                            or axis["decVel"] + 1e-7 < _quant(source["decVel"] * rate * rate)):
                        # 仅消除编码边界的浮点偏差，不改变控制组的有效时间预算。
                        candidates = (rate + 1e-8, rate - 1e-8, fits[k][0])
                        rate = next((value for value in candidates if value > 0
                                     and all(abs(_quant(source[key] * value ** power) - axis[key]) <= 1e-7
                                             for key, power in (("vel", 1), ("accVel", 2)))
                                     and axis["decVel"] + 1e-7 >= _quant(source["decVel"] * value * value)), None)
                        if rate is None:
                            encoding_failed = True
                            break
                        rates[k] = rate
                if encoding_failed or abs(sum(durations[i] * rate for i, rate in zip(group, rates)) - budget) > tolerance:
                    # 数学区间的开边界也可能无法精确编码；只在同样的毫秒界内退回已验证参数倍率。
                    preferred = [fit[0] for fit in fits]
                    actual = sum(durations[i] * rate for i, rate in zip(group, preferred))
                    if abs(actual - original_budget) > rounding_allowance(group, fits, preferred) + tolerance:
                        raise ValueError("控制组无法在V/A编码范围内恢复一致时钟")
                    rates, quantized = preferred, True
                if quantized:
                    actual = sum(durations[i] * rate for i, rate in zip(group, rates))
                    if actual <= 0 or abs(actual - original_budget) > rounding_allowance(group, fits, rates) + tolerance:
                        raise ValueError("控制组时间差超过整数毫秒舍入范围")
                    # 舍入误差只在原控制组末边界结清，不能均摊进已经运行的历史。
                    # 未来重排会消费该私有预算差；实际位置/速度仍按收到的time回放。
                    commands[last + 1][1]["_clock_delta"] = original_budget - actual
            if math.isfinite(budgets[j]):
                commands[last + 1][1]["_clock_from"] = ordered[commands[first][0] - 1]["time"]
            for i, rate in zip(group, rates):
                axis = commands[i][1]
                axis["_base"] = (baseline[j][0], axis_index, baseline[j][1])
                axis["_nominal_rate"] = rate
                axis["_rate"] = rate
                axis.setdefault("_clock_delta", 0.)
                axis.setdefault("_clock_from", None)

        if len(commands) == len(baseline):
            # 未插入在线副本时，原控制行顺序就是唯一关联，线性处理。
            for j, ((_, axis), (source_index, source)) in enumerate(zip(commands, baseline)):
                fit = _schedule_fit(axis, source, applied)
                if fit is None:
                    raise ValueError("当前V/A/D无法按原控制行顺序关联100%基准")
                assign([j], j, [fit])
            continue
        extra = len(commands) - len(baseline)
        previous, paths, fits = {}, [], {}
        for i, (_, axis) in enumerate(commands):
            current, links = {}, {}
            for j in range(max(0, i - extra), min(i, len(baseline) - 1) + 1):
                fit = _schedule_fit(axis, baseline[j][1], applied)
                if fit is None:
                    continue
                rate, penalty, lower, upper = fit
                fits[i, j] = fit
                if i == 0:
                    if j == 0:
                        current[j, 0] = ((0, 0., penalty), durations[i] * lower, durations[i] * upper)
                        links[j, 0] = None
                    continue
                for parent, (cost, minimum, maximum) in previous.items():
                    previous_j, first = parent
                    if previous_j == j:
                        if abs(axis["pos"] - commands[first][1]["pos"]) > 1e-7:
                            continue  # 在线副本只能重发同一个停车目标，不能吞掉下一条目标。
                        key = (j, first)
                        value = ((cost[0], cost[1], cost[2] + penalty), minimum + durations[i] * lower, maximum + durations[i] * upper)
                    elif previous_j == j - 1:
                        tolerance = max(1e-6, budgets[previous_j] * 1e-10)
                        ordinary = minimum - tolerance <= budgets[previous_j] <= maximum + tolerance
                        # 已批准实际stop节点可因编码后Move变长而延迟，不能把这段安全尾巴当缺命令。
                        start_node = commands[first][0] - 1
                        end_node = commands[i][0] - 1
                        delayed_stop = (stop_prefix[end_node + 1] > stop_prefix[start_node + 1]
                                        and maximum + tolerance >= budgets[previous_j])
                        quantized = False
                        if not ordinary and not delayed_stop:
                            group = list(range(first, i))
                            allowance = rounding_allowance(group, [fits[k, previous_j] for k in group])
                            quantized = minimum - allowance - tolerance <= budgets[previous_j] <= maximum + allowance + tolerance
                            if not quantized:
                                continue
                        key = (j, i)
                        # 先解释原控制时长，避免早停副轴让短阶段吞掉后面的长阶段。
                        # 真实stop留下的额外等待仍可保留，随后才比较倍率偏好。
                        excess = max(0., minimum - budgets[previous_j] - tolerance) / max(budgets[previous_j], 1e-12)
                        # 旧精度/stop路径优先，只有原路径不可行才使用整数时间例外。
                        value = ((cost[0] + int(quantized), cost[1] + excess, cost[2] + penalty), durations[i] * lower, durations[i] * upper)
                    else:
                        continue
                    if key not in current or value[0] < current[key][0]:
                        current[key], links[key] = value, parent
            if not current:
                raise ValueError("当前控制副本与原100%控制时长/命令序无法一致关联")
            previous = current
            paths.append(links)
        options = [key for key in previous if key[0] == len(baseline) - 1]
        if not options:
            raise ValueError("当前完整表未保留全部原控制命令")
        key = min(options, key=lambda item: previous[item][0])
        groups = []
        for i in range(len(commands) - 1, -1, -1):
            j, _ = key
            if not groups or groups[-1][0] != j:
                groups.append((j, []))
            groups[-1][1].append(i)
            key = paths[i][key]
        for j, group in reversed(groups):
            group.reverse()
            assign(group, j, [fits[i, j] for i in group])
    return ordered


def _schedule_payload(axes):
    return [dict(axis) for axis in axes]


def _schedule_events(ordered):
    return [{"time": row["time"], "payload": _schedule_payload(ordered[i + 1]["virtualAxis"])
             if i + 1 < len(ordered) else None} for i, row in enumerate(ordered)]


def _schedule_state(active, seconds, initial):
    return [_state(item["profile"], seconds - item["start"]) if item else (initial[i], 0.)
            for i, item in enumerate(active)]



def _schedule_guard_d(axis, previous, pair, seconds, floor, start_floor=None):
    """只在已有批准减速度能力内保护；不从未知机械上限借能力。"""
    busy = previous is not None and previous["start"] + previous["profile"]["duration"] > seconds + 1e-10
    if not busy:
        return axis, None
    q, v = pair
    current_d = previous["axis"]["decVel"] if start_floor is None else start_floor
    if start_floor is not None:
        floor = current_d
    standard = axis["decVel"]
    approved = max(current_d, standard)
    chosen = max(standard, floor) if floor is not None else standard
    distance = axis["pos"] - q
    if v * distance > _TOL and abs(distance) > _TOL:
        required = math.ceil(v * v / (2 * abs(distance)) * 10 - 1e-8) / 10
        if required > approved + 1e-7:
            raise ValueError("刹停所需D超过已批准实际/目标D能力，保留旧Move延期")
        if required > chosen + 1e-7:
            floor = current_d
            chosen = max(standard, current_d, required)
    if chosen > approved + 1e-7:
        raise ValueError("D保护超过已批准减速度，须延期")
    protected = {**axis, "decVel": chosen}
    _wire({key: protected[key] for key in _ZERO})
    return protected, chosen if floor is not None else None


def _schedule_replay(events, initial, direction, correct_from=None, protect_from=None):
    start = events[0]["time"]
    active, records, rate = [None] * 3, [], 1.
    floors = [None] * 3
    shift_ms = 0.
    for event in events:
        unshifted = event["time"]
        event["time"] = unshifted + direction * shift_ms
        seconds = direction * (event["time"] - start) / 1000
        if (correct_from is not None and event.get("_stop")
                and direction * (unshifted - correct_from) >= -1e-7):
            mask = event["_stop"]
            finish = max((item["start"] + item["profile"]["duration"]
                          for index, item in enumerate(active) if item and mask[index]), default=seconds)
            if finish > seconds + 1e-10:
                extra = (finish - seconds) * 1000
                shift_ms += extra
                event["time"] += direction * extra
                seconds = finish
        pairs = _schedule_state(active, seconds, initial)
        live = protect_from is not None and direction * (unshifted - protect_from) >= -1e-7
        entering = live and abs(unshifted - protect_from) <= 1e-7
        for i, item in enumerate(active):
            if item is None or item["start"] + item["profile"]["duration"] <= seconds + 1e-10:
                floors[i] = None  # 真正Done才解除；瞬间v=0或vel0行不解除。
        issued = []
        if event["payload"] is not None:
            for i, axis in enumerate(event["payload"]):
                if axis["vel"] > 0:
                    if live:
                        start_floor = None
                        if entering:
                            start_floor = (event["_liveD"][i] if "_liveD" in event else
                                           active[i]["axis"]["decVel"] if active[i] else None)
                        axis, floors[i] = _schedule_guard_d(axis, active[i], pairs[i], seconds, floors[i], start_floor)
                        event["payload"][i] = axis
                    profile = _profile(*pairs[i], axis)
                    active[i] = {"profile": profile, "start": seconds, "axis": axis}
                    issued.append(axis.get("_rate", 1.))
        if issued:
            rate = issued[0]
        records.append({"time": event["time"], "seconds": seconds, "pairs": pairs,
                        "active": list(active), "rate": rate, "payload": event["payload"]})
    done = max((item["start"] + item["profile"]["duration"] for item in active if item), default=0.)
    return {"events": events, "records": records, "initial": initial, "direction": direction,
            "start": start, "end": max(records[-1]["seconds"], done), "done": done,
            "clocks": [record["seconds"] for record in records]}



def _schedule_mark_stops(replay):
    """只对本节点要更新且旧Move已停的轴保留stop；窄1ms尾巴仅作舍入修正。"""
    flags = [(False, False, False)] * len(replay["records"])
    for index in range(1, len(replay["records"])):
        record = replay["records"][index]
        payload = record["payload"]
        if not payload:
            continue
        previous = replay["records"][index - 1]["active"]
        flags[index] = tuple(
            bool(axis["vel"] > 0 and item
                 and item["start"] + item["profile"]["duration"] - record["seconds"] <= .001 + 1e-10
                 and abs(pair[0] - item["axis"]["pos"]) <= _FRAME_POSITION_TOL + _TOL)
            for axis, item, pair in zip(payload, previous, record["pairs"]))
    for event, flag in zip(replay["events"], flags):
        event["_stop"] = flag
    return flags


def _schedule_at(replay, clock):
    seconds = replay["direction"] * (clock - replay["start"]) / 1000
    clocks = replay["clocks"]
    index = max(0, bisect.bisect_right(clocks, seconds + 1e-12) - 1)
    record = replay["records"][index]
    return _schedule_state(record["active"], seconds, replay["initial"]), record, seconds


def _schedule_extrema(profile, begin, end):
    points = [_state(profile, begin)[0], _state(profile, end)[0]]
    clock = 0.
    for duration, q, v, a in profile["phases"]:
        left, right = max(0., begin - clock), min(duration, end - clock)
        if right >= left:
            points.extend((q + v * left + .5 * a * left * left, q + v * right + .5 * a * right * right))
            if a and left < -v / a < right:
                used = -v / a
                points.append(q + v * used + .5 * a * used * used)
        clock += duration
        if clock > end:
            break
    return min(points), max(points)


def _schedule_authority(replay):
    authority = {}
    for index, record in enumerate(replay["records"]):
        end = replay["records"][index + 1]["seconds"] if index + 1 < len(replay["records"]) else replay["end"]
        for item in record["active"]:
            if item is None:
                continue
            key = item["axis"].get("_base")
            if key is None:
                continue
            key = key[:2]
            low, high = _schedule_extrema(item["profile"], max(0., record["seconds"] - item["start"]), max(0., end - item["start"]))
            goal = item["axis"]["pos"]
            bounds = authority.setdefault(key, [min(low, goal), max(high, goal)])
            bounds[0], bounds[1] = min(bounds[0], low, goal), max(bounds[1], high, goal)
    return authority


def _schedule_route_authority(replay, reference=None):
    """只补原完整路线已接近的同轴相邻停车点，不借其它阶段目标。"""
    authority = _schedule_authority(replay)
    reference = replay if reference is None else reference
    actual = {}
    for index, record in enumerate(reference["records"]):
        end = reference["records"][index + 1]["seconds"] if index + 1 < len(reference["records"]) else reference["end"]
        for item in record["active"]:
            if item is None:
                continue
            key = item["axis"]["_base"][:2]
            low, high = _schedule_extrema(item["profile"], max(0., record["seconds"] - item["start"]), max(0., end - item["start"]))
            previous = actual.setdefault(key, [low, high])
            previous[0], previous[1] = min(previous[0], low), max(previous[1], high)
    previous = list(replay["initial"])
    for record in replay["records"]:
        for index, axis in enumerate(record["payload"] or ()):
            if axis["vel"] <= 0:
                continue
            key = axis["_base"][:2]
            low, high = actual[key]
            if low - _FRAME_POSITION_TOL - _TOL <= previous[index] <= high + _FRAME_POSITION_TOL + _TOL:
                bounds = authority[key]
                authority[key] = [min(bounds[0], previous[index]), max(bounds[1], previous[index])]
            previous[index] = axis["pos"]
    return authority


def _schedule_safe(replay, authority, entry):
    for index, record in enumerate(replay["records"]):
        if replay["direction"] * (record["time"] - entry) < -1e-7:
            continue
        end = replay["records"][index + 1]["seconds"] if index + 1 < len(replay["records"]) else replay["end"]
        for axis_index, item in enumerate(record["active"]):
            if item is None:
                continue
            axis = item["axis"]
            q, v = record["pairs"][axis_index]
            key = axis["_base"][:2]
            approved = authority.get(key, [min(q, axis["pos"]), max(q, axis["pos"])])
            low, high = _schedule_extrema(item["profile"], max(0., record["seconds"] - item["start"]), max(0., end - item["start"]))
            lower, upper = min(q, axis["pos"], approved[0]), max(q, axis["pos"], approved[1])
            if low < lower - _TOL or high > upper + _TOL:
                raise ValueError("新Move超出原停车目标授权范围，须延期")
            if item["start"] == record["seconds"] and v * (axis["pos"] - q) > _TOL:
                if v * v / (2 * axis["decVel"]) > abs(axis["pos"] - q) + _TOL:
                    raise ValueError("新减速度不足以在原停车目标前停稳，须延期")


def _schedule_scaled(axis, factor):
    if axis["vel"] == 0:
        return dict(axis)
    source = axis["_base"][2]
    result = {**axis, "vel": _quant(source["vel"] * factor),
              "accVel": _quant(source["accVel"] * factor * factor),
              "decVel": _quant(source["decVel"] * factor * factor), "_rate": factor, "_nominal_rate": factor, "_clock_delta": 0., "_clock_from": None}
    _wire({key: result[key] for key in _ZERO})
    return result


def _schedule_after(clock, origin, direction):
    """零时长末Noop只补浮点可表达的终界，不增加毫秒等待。"""
    elapsed = direction * (clock - origin) / 1000
    following = origin + direction * math.nextafter(elapsed, math.inf) * 1000
    if math.isfinite(following) and direction * (following - clock) > 0 and direction * (following - origin) / 1000 > elapsed:
        return following
    # 不能从0附近逐个subnormal扫描；以起点/时长的ULP定步并倍增，确保两种坐标都推进。
    step = max(math.ulp(origin), math.ulp(clock), math.ulp(elapsed) * 1000)
    while math.isfinite(step):
        following = clock + direction * step
        if not math.isfinite(following):
            break
        if direction * (following - clock) > 0 and direction * (following - origin) / 1000 > elapsed:
            return following
        step *= 2
    raise ValueError("结束时间超出浮点可表示范围")


def _schedule_terminal(events, replay):
    clock = replay["start"] + replay["direction"] * replay["end"] * 1000
    if replay["direction"] * (clock - events[-1]["time"]) > 1e-7:
        pairs, _, _ = _schedule_at(replay, clock)
        if events[-1]["payload"] is None:
            events[-1] = {**events[-1], "payload": [{**_ZERO, "pos": q} for q, _ in pairs]}
        events.append({"time": clock, "payload": None})
        previous = replay["records"][-1]
        replay["records"].append({"time": clock, "seconds": replay["end"], "pairs": pairs,
                                   "active": previous["active"], "rate": previous["rate"], "payload": None})
        replay["clocks"].append(replay["end"])
    replay["events"] = events
    return events


def _schedule_encode(events, anchor, initial, reverse, online=None, replay=None):
    direction = -1 if reverse else 1
    replay = replay or _schedule_replay(events, initial, direction)
    events = _schedule_terminal(list(events), replay)
    rows = [{"time": events[0]["time"], "virtualAxis": [{key: axis[key] for key in _ZERO} for axis in anchor]}]
    for index in range(1, len(events)):
        payload = events[index - 1]["payload"]
        if payload is None:
            payload = [{**_ZERO, "pos": q} for q, _ in replay["records"][index - 1]["pairs"]]
        axes = []
        for axis, (q, v) in zip(payload, replay["records"][index - 1]["pairs"]):
            axes.append({**{key: axis[key] for key in _ZERO}, "passVel": v if axis["vel"] > 0 else axis["passVel"]})
        rows.append({"time": events[index]["time"], "virtualAxis": axes})
    # 末有效Move由上一行time触发；把最终Done/等待终点放在它的结束边界。
    # 只合并其后的全轴skip行，中间节点和纯静止模型的等待表保持原样。
    last_move = next((i for i in range(len(rows) - 1, 0, -1)
                      if any(axis["vel"] > 0 for axis in rows[i]["virtualAxis"])), None)
    if last_move is not None and last_move + 1 < len(rows):
        rows[last_move]["time"] = rows[-1]["time"]
        rows = rows[:last_move + 1]
    shift = max(0., -min(row["time"] for row in rows))
    for row in rows:
        row["time"] += shift
    if reverse:
        rows.reverse()
    if any(b["time"] <= a["time"] for a, b in zip(rows, rows[1:])):
        raise ValueError("输出时间精度不足以区分相邻控制节点")
    return rows, None if online is None else online + shift


def _schedule_trial(old, entry, factor):
    direction = old["direction"]
    pairs, active_record, _ = _schedule_at(old, entry)
    original_events = old["events"]
    exact = next((event for event in original_events if abs(event["time"] - entry) <= 1e-7), None)
    payload = _schedule_payload(exact["payload"]) if exact and exact["payload"] else None
    if payload is None:
        payload = [dict(item["axis"]) if item else {**_ZERO, "pos": q}
                   for item, (q, _) in zip(active_record["active"], pairs)]
    else:
        payload = [axis if axis["vel"] > 0 else dict(item["axis"]) if item else axis
                   for axis, item in zip(payload, active_record["active"])]
    events = [{"time": event["time"], "payload": _schedule_payload(event["payload"]) if event["payload"] else None, "_stop": event.get("_stop", False)}
              for event in original_events if direction * (event["time"] - entry) < -1e-7]
    events.append({"time": entry, "payload": [_schedule_scaled(axis, factor) for axis in payload],
                   "_stop": exact.get("_stop", False) if exact else False})
    # 延期到旧表原触发点时，该点已采纳的旧指令能力也可在该时刻接管。
    events[-1]["_liveD"] = tuple(item["axis"]["decVel"] if item else None for item in active_record["active"])
    old_clock, new_clock = entry, entry
    old_rate = active_record["rate"]
    corrections = []
    for event_index, event in enumerate(original_events):
        progress = direction * (event["time"] - entry)
        if progress <= 1e-7 and not (event["payload"] is None and progress > 0):
            continue
        # 多轴控制组可交叠；同一段共享时间误差只能结清一次。
        correction = next((axis.get("_clock_delta", 0.) - sum(delta for clock, delta in corrections
                           if direction * (clock - axis["_clock_from"]) > 1e-7)
                           for axis in event["payload"] if axis["vel"] > 0 and axis.get("_clock_from") is not None), 0.) if event["payload"] else 0.
        seconds = (abs(event["time"] - old_clock) / 1000 * old_rate + correction) / factor
        if seconds <= 0 and event["payload"] is not None:
            raise ValueError("舍入前控制边界已过，保留原Move延期到原触发点")
        if correction:
            corrections.append((event["time"], correction))
        following = new_clock + direction * max(0., seconds) * 1000
        new_clock = _schedule_after(new_clock, old["start"], direction) if event["payload"] is None and direction * (following - new_clock) <= 0 else following
        payload = [_schedule_scaled(axis, factor) for axis in event["payload"]] if event["payload"] else None
        events.append({"time": new_clock, "payload": payload, "_stop": event.get("_stop", False)})
        old_clock = event["time"]
        old_rate = old["records"][event_index]["rate"]
    return events


def _schedule_verify(events, replay, anchor, initial, reverse, original, factor):
    """剥离内部关联后仍可按同一原控制序复用；不重复物理积分。"""
    replay = {**replay, "events": [dict(event) for event in events],
              "records": list(replay["records"]), "clocks": list(replay["clocks"])}
    encoded, _ = _schedule_encode(replay["events"], anchor, initial, reverse, replay=replay)
    rows = _schedule_rows({"deviceId": 1, "timeBlockList": encoded})
    flags = _schedule_mark_stops(replay)
    recovered = _schedule_associate(rows, original, reverse, factor, flags)
    expected = [[axis["_base"][:2] for event in replay["events"] if event["payload"]
                 for axis in [event["payload"][i]] if axis["vel"] > 0] for i in range(3)]
    actual = [[row["virtualAxis"][i]["_base"][:2] for row in recovered[1:]
               if row["virtualAxis"][i]["vel"] > 0] for i in range(3)]
    if expected != actual:
        raise ValueError("编码后的完整表改变了原控制命令关联，保留旧Move延期")


def _schedule_is_closed(rows, reverse):
    ordered = list(reversed(rows)) if reverse else rows
    initial = [axis["pos"] for axis in ordered[0]["virtualAxis"]]
    final = list(initial)
    for row in ordered[1:]:
        for index, axis in enumerate(row["virtualAxis"]):
            if axis["vel"] > 0:
                final[index] = axis["pos"]
    return all(abs(end - start) <= _TOL for start, end in zip(initial, final))


def _schedule_model(model, original_rows, factor, reverse, applied, rows=None, build_next=True, original_model=None):
    rows = _schedule_rows(model, reverse) if rows is None else rows
    ordered = list(reversed(rows)) if reverse else rows
    initial = [axis["pos"] for axis in ordered[0]["virtualAxis"]]
    events = _schedule_events(ordered)
    direction = -1 if reverse else 1
    old = _schedule_replay(events, initial, direction)
    if ordered[-1].get("_rounded_terminal"):
        tail = old["done"] - old["records"][-1]["seconds"]
        if tail > 0:
            ordered[-1]["time"] += direction * tail * 1000
        elif events[-2]["payload"] and any(axis["vel"] > 0 for axis in events[-2]["payload"]):
            ordered[-1]["time"] = _schedule_after(ordered[-1]["time"], old["start"], direction)
        else:
            raise ValueError("纯等待末边界重复，无法恢复原等待时长")
        events = _schedule_events(ordered)
        old = _schedule_replay(events, initial, direction)
    flags = _schedule_mark_stops(old)
    _schedule_associate(rows, original_rows, reverse, applied, flags)
    # 纯等待模型没有Move参数可恢复倍率；此前调速已立即生效，时钟采用applied。
    rate = applied if not any(axis["vel"] > 0 for row in ordered[1:] for axis in row["virtualAxis"]) else 1.
    for index, record in enumerate(old["records"]):
        if record["payload"] is not None:
            issued = []
            for axis, source in zip(record["payload"], ordered[index + 1]["virtualAxis"]):
                if axis["vel"] > 0:
                    axis["_base"], axis["_rate"] = source["_base"], source["_rate"]
                    axis["_nominal_rate"] = source["_nominal_rate"]
                    axis["_clock_delta"] = source["_clock_delta"]
                    axis["_clock_from"] = source["_clock_from"]
                    issued.append(source["_rate"])
            if issued:
                rate = issued[0]
        record["rate"] = rate
    events = _schedule_terminal(events, old)
    online = _number(model.get("onlineTime"), "onlineTime")
    if not 0 <= direction * (online - old["start"]) / 1000 <= old["end"] + 1e-9:
        raise ValueError("onlineTime须位于本模型当前完整运行时间内")
    authority = _schedule_authority(old)
    entries = [] if factor == applied else [online] + [event["time"] for event in events if direction * (event["time"] - online) > 1e-7]
    chosen, chosen_replay = events, old
    for entry in entries:
        try:
            trial = _schedule_trial(old, entry, factor)
            replay = _schedule_replay(trial, initial, direction, correct_from=entry, protect_from=entry)
            _schedule_safe(replay, authority, entry)
            _schedule_verify(trial, replay, ordered[0]["virtualAxis"], initial, reverse, original_rows, factor)
            chosen, chosen_replay = trial, replay
            break
        except ValueError:
            continue
    result_rows, mapped = _schedule_encode(chosen, ordered[0]["virtualAxis"], initial, reverse, online, chosen_replay)
    result = {"deviceId": model["deviceId"], "onlineTime": mapped, "timeBlockList": result_rows}
    if not build_next:
        return result, None, False
    # 只有整个动作实际闭合才构造下一轮；不会采用的next不应影响本轮调速。
    # 下一轮从同一静止锚开始，原正向行基准/同row反向读取保持不变。
    baseline = list(reversed(original_rows)) if reverse else original_rows
    goals = {}
    for row in ordered[1:]:
        for axis in row["virtualAxis"]:
            if axis["vel"] > 0:
                key = axis["_base"][:2]
                if key in goals and abs(goals[key] - axis["pos"]) > 1e-7:
                    raise ValueError("同一原控制命令的在线副本改变了停车目标")
                goals[key] = axis["pos"]
    fresh, unit = [], []
    clock = unit_clock = events[0]["time"]
    for index, source_row in enumerate(baseline):
        if index:
            difference = abs(source_row["time"] - baseline[index - 1]["time"])
            clock += direction * difference / factor
            unit_clock += direction * difference
        payload = unit_payload = None
        if index + 1 < len(baseline):
            payload, unit_payload = [], []
            for ai, source in enumerate(baseline[index + 1]["virtualAxis"]):
                axis = dict(source)
                if axis["vel"] > 0:
                    axis.update({"pos": goals[index + 1, ai], "_base": (index + 1, ai, source), "_rate": 1.})
                    unit_payload.append(dict(axis))
                    axis = _schedule_scaled(axis, factor)
                else:
                    unit_payload.append(dict(axis))
                payload.append(axis)
        fresh.append({"time": clock, "payload": payload})
        unit.append({"time": unit_clock, "payload": unit_payload})
    unit_replay = _schedule_replay(unit, initial, direction)
    flags = _schedule_mark_stops(unit_replay)
    for event, flag in zip(fresh, flags):
        event["_stop"] = flag
    next_replay = _schedule_replay(fresh, initial, direction, correct_from=fresh[0]["time"])
    end_pairs, _, _ = _schedule_at(next_replay, next_replay["start"] + direction * next_replay["end"] * 1000)
    closed = all(abs(q - start) <= _TOL for (q, _), start in zip(end_pairs, initial))
    following = None
    if closed:
        try:
            _schedule_safe(next_replay, _schedule_route_authority(unit_replay), fresh[0]["time"])
        except ValueError:
            if original_model is None:
                raise
            # 原始小数V/A/D只证明停车点属于完整原意，实际next始终按编码参数积分。
            raw_rows = original_model["timeBlockList"][::-1] if reverse else original_model["timeBlockList"]
            raw = [{**event, "payload": [dict(axis) for axis in event["payload"]] if event["payload"] else None} for event in unit]
            changed = False
            for index, event in enumerate(raw[:-1]):
                for axis, source in zip(event["payload"], raw_rows[index + 1]["virtualAxis"]):
                    if axis["vel"] > 0:
                        for key in ("vel", "accVel", "decVel"):
                            value = _number(source[key], key)
                            changed |= value != axis[key]
                            axis[key] = value
            if not changed:
                raise
            intent = _schedule_replay(raw, initial, direction)
            _schedule_safe(next_replay, _schedule_route_authority(unit_replay, intent), fresh[0]["time"])
        next_rows, _ = _schedule_encode(fresh, ordered[0]["virtualAxis"], initial, reverse, replay=next_replay)
        following = {"deviceId": model["deviceId"], "timeBlockList": next_rows}
    return result, following, closed


def _schedule_actions(actions, name):
    if not isinstance(actions, list) or not actions:
        raise ValueError(name + "须为非空动作数组")
    result = {}
    for action in actions:
        if not isinstance(action, dict) or type(action.get("actionId")) is not int or action["actionId"] <= 0 or action["actionId"] in result:
            raise ValueError("actionId须为不重复的正整数")
        models = action.get("modelList")
        if not isinstance(models, list) or not models:
            raise ValueError("modelList须为非空数组")
        mapped = {}
        for model in models:
            if not isinstance(model, dict) or type(model.get("deviceId")) is not int or model["deviceId"] <= 0 or model["deviceId"] in mapped:
                raise ValueError("deviceId须为不重复的正整数")
            mapped[model["deviceId"]] = model
        result[action["actionId"]] = mapped
    return result


def _schedule_calculate(parameters):
    if not isinstance(parameters, dict) or not isinstance(parameters.get("command"), dict):
        raise ValueError("请求须有command")
    command = parameters["command"]
    factor = _number(command.get("requestedFactor"), "requestedFactor")
    applied = _number(command.get("appliedFactor"), "appliedFactor")
    reverse = command.get("reverse")
    if factor <= 0 or applied <= 0 or type(reverse) is not bool:
        raise ValueError("倍率须大于0，reverse须为布尔值")
    originals = _schedule_actions(parameters.get("originalParams"), "originalParams")
    currents = _schedule_actions(parameters.get("params"), "params")
    if originals.keys() != currents.keys():
        raise ValueError("两份表的动作须一一对应")
    output, following = [], []
    for action_id, models in currents.items():
        if models.keys() != originals[action_id].keys():
            raise ValueError("两份表的模型须一一对应")
        prepared = {}
        for device, model in models.items():
            try:
                prepared[device] = (_schedule_rows(originals[action_id][device]), _schedule_rows(model, reverse))
            except ValueError as error:
                raise ValueError(f"动作{action_id} 模型{device}：{error}") from None
        action_closed = all(_schedule_is_closed(rows, reverse) for _, rows in prepared.values())
        results, next_models, closed = [], [], []
        for device, model in models.items():
            try:
                original, rows = prepared[device]
                result, next_model, loops = _schedule_model(model, original, factor, reverse, applied,
                                                           rows=rows, build_next=action_closed, original_model=originals[action_id][device])
            except ValueError as error:
                raise ValueError(f"动作{action_id} 模型{device}：{error}") from None
            results.append(result)
            closed.append(loops)
            if next_model is not None:
                next_models.append(next_model)
        output.append({"actionId": action_id, "modelList": results})
        if all(closed):
            following.append({"actionId": action_id, "modelList": next_models})
    response = {"success": True, "message": "", "params": output}
    if following:
        response["nextParams"] = following
    return response


if __name__ == "__main__":
    result = main(sys.argv[1] if len(sys.argv) > 1 else None, sys.argv[2] if len(sys.argv) > 2 else None)
    if not result["success"]:
        raise SystemExit(1)
