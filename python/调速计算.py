"""调速计算：非强制轨迹重规划Move；强制轨迹复用已保存曲线，只计算倍率和时间。

直接运行：python 调速计算.py [调速参数.json]
统一JSON同时保存两种输入；command.trajectory_run选择分支，未选分支的数据不参与计算。
非强制读取models/runtime；强制读取forced_action/forced_runtime。切换时校验各自倍率范围。
只读取输入并输出JSON，不下发PLC、不覆盖输入、不导入旧算法文件。
约定：实际Move使用零末速、jerk=0、不混合跨段；输入速度带物理方向。
强制轨迹沿用租赁2.0的100ms曲线自变量和时间主轴加减速；倍率不受旧协议100%封顶。
返回的是实际倍率r，PLC接口须支持该倍率；本文件不会修改PLC协议或下发指令。
"""
import copy
import hashlib
import json
import math
import re
import sys
from pathlib import Path

AXIS_NAMES = ("H", "P", "Y")
_PREPARED_CACHE = {}  # 同进程按动作内容缓存；动作/几何/上限改变后自动失效。
_FORCED_CACHE = {}  # 强制曲线独立缓存；运行帧、请求倍率和方向不影响保存倍率。


##########################公共辅助：读取、输出和严格参数校验##########################
def load_speed_inputs(source=None):
    """source可为同目录JSON路径或已解析字典；_说明只供阅读。"""
    if source is None:
        source = Path(__file__).resolve().with_name("调速参数.json")
    if isinstance(source, dict):
        return copy.deepcopy(source)
    with open(source, encoding="utf-8-sig") as stream:
        data = json.load(stream)
    if not isinstance(data, dict):
        raise ValueError("JSON最外层必须是对象")
    return data


def json_dumps_with_inline_lists(value):
    """对象保持缩进，HPY等简单数组横向显示；禁止输出NaN/Infinity。"""
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    return re.sub(r"\[\s*([^\[\]{}]*?)\s*\]",
                  lambda match: "[" + re.sub(r"\s+", " ", match.group(1)).strip() + "]", text)


def compact_speed_output(value):
    """控制台省略积分用phase和普通单条Move的重复commands；多阶段制动指令完整保留。

    函数返回值仍保留全部phase供预览和测试。压缩结果也可作previous_plan回传。
    """
    if isinstance(value, list):
        return [compact_speed_output(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: compact_speed_output(item) for key, item in value.items()
            if key != "axis_phases" and not (key == "axis_commands" and value.get("ExecutionMode") == "move")}


def _number(value, label, minimum=None):
    """拒绝bool、NaN、无穷大和越界数值。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label}必须是数值")
    value = float(value)
    if not math.isfinite(value) or (minimum is not None and value < minimum):
        raise ValueError(f"{label}必须是有限数值且不小于{minimum}")
    return value


def _vector(value, label, minimum=None):
    """读取固定顺序[H,P,Y]或[X,Y,Z]三项数组。"""
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{label}必须是三项数组")
    return [_number(v, label, minimum) for v in value]


def _integer(value, label, minimum=0):
    """ID和计划版本使用整数，不接受布尔值。"""
    if type(value) is not int or value < minimum:
        raise ValueError(f"{label}必须是大于等于{minimum}的整数")
    return value


##########################内部运动求解：真实初速度、零末速度的Move##########################
def _plan_move_axis(start, target, initial_velocity, velocity, acceleration,
                    deceleration, maximum_deceleration=None, duration=None):
    """计算零末速Move的真实运动阶段；duration指定时求等时解，不用等待补齐。

    位置、初速度和phase加速度使用轴的实际正负方向；V/A/D参数使用正数。
    已背离目标的轴先制动，再执行Move，commands明确分成两条指令。
    当前速度无法在目标之前刹住时直接拒绝，不能用原帧时间冒充可达。
    """
    start, target, initial_velocity, velocity, acceleration, deceleration = (
        float(value) for value in
        (start, target, initial_velocity, velocity, acceleration, deceleration)
    )
    maximum_deceleration = (
        deceleration if maximum_deceleration is None else float(maximum_deceleration)
    )
    requested_duration = None if duration is None else float(duration)
    values = [start, target, initial_velocity, velocity, acceleration,
              deceleration, maximum_deceleration]
    if requested_duration is not None:
        values.append(requested_duration)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Move位置、速度、加减速度和时间必须为有限数值")
    if min(velocity, acceleration, deceleration, maximum_deceleration) < 0.0:
        raise ValueError("Move的速度、加速度、减速度参数不能为负数")
    if requested_duration is not None and requested_duration < 0.0:
        raise ValueError("Move指定耗时不能为负数")
    distance = abs(target-start)
    if distance <= 1.0e-12:
        if abs(initial_velocity) > 1.0e-12:
            raise ValueError("轴已在目标但速度非零，不能在不越过目标的条件下停车")
        # 已在目标的静止轴可以保持；它不执行Move，不冒充一条移动轴的等时解。
        hold_duration = 0.0 if requested_duration is None else requested_duration
        return {
            "velocity": 0.0, "acceleration": 0.0, "deceleration": 0.0,
            "duration": hold_duration, "peak_velocity": 0.0,
            "position_min": start, "position_max": start,
            "phases": [], "commands": [], "mode": "already_at_target",
            "final_position": start, "final_velocity": 0.0,
        }
    if min(velocity, acceleration, deceleration, maximum_deceleration) <= 0.0:
        raise ValueError("有位移的Move必须提供大于0的V/A/D")
    if deceleration > maximum_deceleration*(1.0+1.0e-12):
        raise ValueError("Move减速度超过最大允许减速度")

    direction = 1.0 if target > start else -1.0
    initial_speed = initial_velocity*direction
    used_deceleration = deceleration
    raised_deceleration = False
    if initial_speed > 0.0:
        # 只有给定更大的允许减速度时，才允许提高D救回原本来不及停车的状态。
        required_deceleration = initial_speed*initial_speed/(2.0*distance)
        if required_deceleration > maximum_deceleration*(1.0+1.0e-12):
            raise ValueError("剩余距离小于最大减速度所需停车距离，目标不可达")
        if required_deceleration > used_deceleration*(1.0+1.0e-12):
            used_deceleration = maximum_deceleration
            raised_deceleration = True

    def build_plan(speed_cap, accel, decel):
        """积分实际阶段，返回一条连续的位置/速度轨迹与对应Move/制动指令。"""
        phases = []
        position = 0.0
        speed = initial_speed
        elapsed = 0.0
        position_min = position_max = start
        peak_speed = abs(initial_speed)

        def append_phase(phase_duration, phase_acceleration):
            nonlocal position, speed, elapsed, position_min, position_max, peak_speed
            if phase_duration <= 0.0:
                return
            phase_start = start+direction*position
            physical_speed = direction*speed
            physical_acceleration = direction*phase_acceleration
            phases.append({
                "start_offset_s": elapsed,
                "duration": phase_duration,
                "initial_position": phase_start,
                "initial_velocity": physical_speed,
                "acceleration": physical_acceleration,
            })
            endpoint = position+speed*phase_duration+0.5*phase_acceleration*phase_duration**2
            physical_endpoint = start+direction*endpoint
            position_min = min(position_min, phase_start, physical_endpoint)
            position_max = max(position_max, phase_start, physical_endpoint)
            if phase_acceleration != 0.0:
                turning_time = -speed/phase_acceleration
                if 0.0 < turning_time < phase_duration:
                    turning_position = start+direction*(
                        position+speed*turning_time+0.5*phase_acceleration*turning_time**2
                    )
                    position_min = min(position_min, turning_position)
                    position_max = max(position_max, turning_position)
            position = endpoint
            speed += phase_acceleration*phase_duration
            peak_speed = max(peak_speed, abs(speed))
            elapsed += phase_duration

        brake_duration = 0.0
        brake_position = start
        if initial_speed < 0.0:
            brake_duration = -initial_speed/decel
            append_phase(brake_duration, decel)
            speed = 0.0
            brake_position = start+direction*position

        remaining_distance = distance-position
        forward_initial_speed = max(0.0, speed)
        if forward_initial_speed > speed_cap:
            stopping_distance = forward_initial_speed**2/(2.0*decel)
            residual_distance = remaining_distance-stopping_distance
            if residual_distance < -1.0e-9*max(1.0, remaining_distance):
                raise ValueError("Move减速度不足以在目标位置前停车")
            append_phase((forward_initial_speed-speed_cap)/decel, -decel)
            speed = speed_cap
            append_phase(max(0.0, residual_distance)/speed_cap, 0.0)
            append_phase(speed_cap/decel, -decel)
            command_velocity = speed_cap
            mode = "decelerate_to_new_speed"
        else:
            peak_squared = (
                2.0*accel*decel*remaining_distance+decel*forward_initial_speed**2
            )/(accel+decel)
            reached_speed = min(speed_cap, math.sqrt(max(0.0, peak_squared)))
            reached_speed = max(forward_initial_speed, reached_speed)
            accel_distance = (reached_speed**2-forward_initial_speed**2)/(2.0*accel)
            decel_distance = reached_speed**2/(2.0*decel)
            cruise_distance = max(0.0, remaining_distance-accel_distance-decel_distance)
            append_phase((reached_speed-forward_initial_speed)/accel, accel)
            speed = reached_speed
            append_phase(cruise_distance/reached_speed, 0.0)
            append_phase(reached_speed/decel, -decel)
            command_velocity = reached_speed
            mode = ("trapezoid_from_actual_speed" if cruise_distance > 1.0e-10
                    else "triangle_from_actual_speed")

        if initial_speed < 0.0:
            mode = "brake_reverse_then_move"
        elif raised_deceleration:
            mode = "increase_deceleration_to_stop"
        final_position = start+direction*position
        if abs(final_position-target) > 1.0e-8*max(1.0, distance):
            raise ValueError("Move积分结果与目标位置不一致")
        commands = []
        if brake_duration > 0.0:
            commands.append({
                "start_offset_s": 0.0, "duration_s": brake_duration,
                "target_position": brake_position, "velocity": abs(initial_velocity),
                "acceleration": 0.0, "deceleration": decel,
                "initial_velocity": initial_velocity, "kind": "brake_to_zero",
            })
        commands.append({
            "start_offset_s": brake_duration, "duration_s": elapsed-brake_duration,
            "target_position": target, "velocity": command_velocity,
            "acceleration": accel, "deceleration": decel,
            "initial_velocity": 0.0 if brake_duration > 0.0 else initial_velocity,
            "kind": "move_to_target",
        })
        return {
            "velocity": command_velocity, "acceleration": accel, "deceleration": decel,
            "duration": elapsed, "peak_velocity": peak_speed,
            "position_min": position_min, "position_max": position_max,
            "phases": phases, "commands": commands, "mode": mode,
            "final_position": final_position, "final_velocity": direction*speed,
        }

    fastest = build_plan(velocity, acceleration, used_deceleration)
    if requested_duration is None:
        return fastest
    time_tolerance = 1.0e-9*max(1.0, requested_duration, fastest["duration"])
    if requested_duration < fastest["duration"]-time_tolerance:
        raise ValueError("指定耗时短于当前Move参数允许的最短耗时")
    if abs(requested_duration-fastest["duration"]) <= time_tolerance:
        return fastest
    if abs(initial_speed) <= 1.0e-12:
        factor = fastest["duration"]/requested_duration
        # 零速起止时对整条轨迹严格时间伸缩，V乘k，A/D乘k平方。
        return build_plan(fastest["velocity"]*factor, acceleration*factor**2,
                          used_deceleration*factor**2)

    # 保持真实初速度和A/D不变，仅降低后续速度上限，数值求固定耗时。
    # 恰在停车距离边界时只有纯制动解，降低速度上限不会创造额外位移或时间。
    stopping_slack = distance-max(0.0, initial_speed)**2/(2.0*used_deceleration)
    if initial_speed > 0.0 and stopping_slack <= 1.0e-12*max(1.0, distance):
        raise ValueError("当前轴恰好只能制动到目标，无法在固定初速度下延长Move耗时")
    fast_cap = velocity
    slow_cap = velocity
    slow_plan = fastest
    for _ in range(200):
        slow_cap *= 0.5
        slow_plan = build_plan(slow_cap, acceleration, used_deceleration)
        if slow_plan["duration"] >= requested_duration:
            break
    else:
        raise ValueError("固定初速度下找不到指定耗时的Move参数")
    for _ in range(120):
        middle_cap = (slow_cap+fast_cap)/2.0
        middle_plan = build_plan(middle_cap, acceleration, used_deceleration)
        if abs(middle_plan["duration"]-requested_duration) <= time_tolerance*0.01:
            return middle_plan
        if middle_plan["duration"] >= requested_duration:
            slow_cap, slow_plan = middle_cap, middle_plan
        else:
            fast_cap = middle_cap
    if abs(slow_plan["duration"]-requested_duration) > time_tolerance:
        raise ValueError("指定Move耗时求解未收敛")
    return slow_plan



def _move_motor_speed_bound(model, position_min, position_max, speed_bounds):
    """以位姿包围盒和每轴绝对峰速求解析上界；包围盒须包含反向制动的停车位置。

    不假设三轴按直线比例运动，也不以离散采样充当上界。绳长的变化率不会
    超过吊点空间速度，下面分别限制平移、旋转及机构补偿偏移的变化率。
    """
    model_id = model.get("index", "?")
    vectors = []
    for values in (position_min, position_max, speed_bounds):
        if not isinstance(values, (list, tuple)) or len(values) != 3:
            raise ValueError(f"模型{model_id}的位姿包围盒和速度上界必须各有H/P/Y三项")
        vector = [float(value) for value in values]
        if not all(math.isfinite(value) for value in vector):
            raise ValueError(f"模型{model_id}的位姿包围盒和速度上界必须有限")
        vectors.append(vector)
    lower, upper, speeds = vectors
    if any(lower[i] > upper[i] or speeds[i] < 0.0 for i in range(3)):
        raise ValueError(f"模型{model_id}的包围盒顺序或绝对速度上界无效")
    vh, vp, vy = speeds
    model_type = int(model["model_type"])
    if model_type not in (1, 2, 4, 8):
        raise ValueError(f"模型{model_id}类型{model_type}不受支持")
    if model_type == 1:
        if vp > 0.0 or vy > 0.0 or lower[1:] != upper[1:]:
            raise ValueError(f"单点模型{model_id}只支持H轴运动")
        if int(model.get("motor_num", 0)) <= 0:
            raise ValueError(f"模型{model_id}的motor_num必须大于0")
        return vh

    base_names = ("Baseheight1", "Baseheight2") if model_type == 8 else ("BaseHight1", "BaseHight2")
    fields = (*base_names, "maxheight")
    fields += ("betainit",) if model_type == 8 else ("lLenth_inside",)
    if model_type == 4:
        fields += ("wLenth_inside",)
    if any(name not in model or not math.isfinite(float(model[name])) for name in fields):
        raise ValueError(f"模型{model_id}的几何参数缺失或非有限")
    base1, base2 = (float(model[name]) for name in base_names)
    max_height = float(model["maxheight"])
    if not ((base1 > 0.0 and base2 == 0.0) or (base1 == 0.0 and base2 > 0.0)) or max_height <= 0.0:
        raise ValueError(f"模型{model_id}必须恰有一个正基准高度，且maxheight大于0")
    radians_per_degree = math.pi/180.0

    if model_type in (2, 4):
        if int(model.get("motor_num", model_type)) != model_type:
            raise ValueError(f"模型{model_id}的motor_num与模型类型不一致")
        length = float(model["lLenth_inside"])
        width = float(model["wLenth_inside"]) if model_type == 4 else length
        if min(length, width) <= 0.0:
            raise ValueError(f"模型{model_id}吊点间距必须大于0")
        tilt_axis = 1
        if model_type == 2:
            if vy > 0.0 or lower[2] != upper[2]:
                raise ValueError(f"两点模型{model_id}不支持Y轴运动")
        else:
            # 常量倾角也决定正解分支，不能只看曲线是否含该轴速度系数。
            p_tilt = vp > 0.0 or max(abs(lower[1]), abs(upper[1])) > 1.0e-10
            y_tilt = vy > 0.0 or max(abs(lower[2]), abs(upper[2])) > 1.0e-10
            if p_tilt and y_tilt:
                raise ValueError(f"四点模型{model_id}当前正解不支持P/Y混合倾斜过渡")
            tilt_axis = 2 if y_tilt else 1
        half_span = (length if tilt_axis == 1 else width)/2.0
        angle_bound = max(abs(lower[tilt_axis]), abs(upper[tilt_axis]))
        # 旋转导数 <= 半径；三次偏移导数为3*r*角度²/90³。
        bound = vh+(half_span*radians_per_degree+3.0*half_span*angle_bound**2/90.0**3)*speeds[tilt_axis]
    else:
        points = model.get("point_init_pos")
        if not isinstance(points, list) or len(points) < 3 or any(
            not isinstance(point, (list, tuple)) or len(point) != 3
            or not all(math.isfinite(float(value)) for value in point) for point in points
        ):
            raise ValueError(f"多点模型{model_id}需要至少三个有限XYZ吊点")
        points = [[float(value) for value in point] for point in points]
        if int(model.get("motor_num", len(points))) != len(points):
            raise ValueError(f"模型{model_id}的motor_num与吊点数不一致")
        radius = max(math.hypot(point[0], point[1]) for point in points)
        if radius <= 1.0e-12 or len({tuple(point[:2]) for point in points}) != len(points):
            raise ValueError(f"多点模型{model_id}吊点平面退化或重复")
        area = sum(p[0]*q[1]-p[1]*q[0] for p, q in zip(points, points[1:]+points[:1]))
        orientation = 1.0 if area > 0.0 else -1.0
        min_radius = math.inf
        for p, q in zip(points, points[1:]+points[:1]):
            dx, dy = q[0]-p[0], q[1]-p[1]
            edge = math.hypot(dx, dy)
            origin_distance = orientation*(p[0]*q[1]-p[1]*q[0])/edge
            if origin_distance <= radius*1.0e-10 or any(
                orientation*(dx*(r[1]-p[1])-dy*(r[0]-p[0])) < -radius*edge*1.0e-10
                for r in points
            ):
                raise ValueError(f"多点模型{model_id}吊点必须组成包含原点的有序凸多边形")
            min_radius = min(min_radius, origin_distance)
        effective_heights = (
            [lower[0]+base1, upper[0]+base1] if base1 > 0.0
            else [base2+max_height-upper[0], base2+max_height-lower[0]]
        )
        if min(effective_heights) < 0.0:
            raise ValueError(f"多点模型{model_id}整个运动包围盒的有效高度不能为负")
        # 射线至凸多边形的半径r处处满足rmin<=r<=R，|dr/d角度|<=R²/rmin。
        # 补偿偏移为r*min(1,(|P|/1.5707963)^n)，n=min(100,1.73+0.52*h/r)。
        # 对h/P/r的导数界覆盖顶点切边和偏移饱和点；利用x^n*|ln x|<=1/(e*n)。
        n_min = min(100.0, 1.73+0.52*min(effective_heights)/radius)
        n_max = min(100.0, 1.73+0.52*max(effective_heights)/min_radius)
        c_h = 0.52/(math.e*n_min)
        c_p = radius*n_max*radians_per_degree/1.5707963
        c_r = 1.0+(n_max-1.73)/(math.e*n_min)
        bound = ((1.0+c_h)*vh+(radius*radians_per_degree+c_p)*vp
                 +(3.0*radius+c_r*radius**2/min_radius)*radians_per_degree*vy)
    if not math.isfinite(bound) or bound < 0.0:
        raise ValueError(f"模型{model_id}的电机速度上界无效")
    return bound


##########################保存辅助：标准化实际Move动作并缓存安全范围##########################
def _prepare_action(document):
    """缓存只绑定models内容；运行反馈、用户倍率变化不重新认证完整Base。"""
    raw_models = document.get("models")
    if not isinstance(raw_models, list) or not raw_models:
        raise ValueError("models必须是非空数组")
    signature = hashlib.sha256(json.dumps(raw_models, sort_keys=True, allow_nan=False,
                                         ensure_ascii=False).encode("utf-8")).hexdigest()
    if signature in _PREPARED_CACHE:
        return _PREPARED_CACHE[signature]
    models, certificates, ratios, summaries = {}, {}, [], {}
    for raw in raw_models:
        if not isinstance(raw, dict):
            raise ValueError("模型必须是对象")
        mid = _integer(raw.get("model_id"), "model_id", 1)
        if mid in models:
            raise ValueError("model_id不能重复")
        model = copy.deepcopy(raw)
        model["index"] = mid  # 内部几何工具使用index，对外只需要model_id。
        axes = raw.get("active_axes")
        if isinstance(axes, list) and len(axes) == 3 and all(type(a) is bool for a in axes):
            axes = [name for name, enabled in zip(AXIS_NAMES, axes) if enabled]
        if (not isinstance(axes, list) or not axes or any(a not in AXIS_NAMES for a in axes)
                or len(set(axes)) != len(axes)):
            raise ValueError(f"模型{mid}.active_axes必须是不重复的H/P/Y数组")
        model["axes"] = [AXIS_NAMES.index(a) for a in axes]
        for key in ("max_velocity_HPY", "max_acceleration_HPY", "max_deceleration_HPY"):
            model[key] = _vector(raw.get(key), key, 0)
            if any(model[key][axis] <= 0 for axis in model["axes"]):
                raise ValueError(f"模型{mid}活动轴{key}必须大于0")
        for key in ("min_position_HPY", "max_position_HPY"):
            model[key] = _vector(raw.get(key), key)
        if any(lo > hi for lo, hi in zip(model["min_position_HPY"], model["max_position_HPY"])):
            raise ValueError(f"模型{mid}行程下限不能大于上限")
        model["model_type"] = _integer(raw.get("model_type"), "model_type", 1)
        model["motor_num"] = _integer(raw.get("motor_num"), "motor_num", 1)
        if model["model_type"] in (2, 4):
            keys = ["BaseHight1", "BaseHight2", "lLenth_inside", "maxheight"]
            if model["model_type"] == 4:
                keys.append("wLenth_inside")
            for key in keys:
                model[key] = _number(raw.get(key), key, 0)
        elif model["model_type"] == 8:
            for key in ("Baseheight1", "Baseheight2", "maxheight"):
                model[key] = _number(raw.get(key), key, 0)
            model["betainit"] = _number(raw.get("betainit"), "betainit")
            points = raw.get("point_init_pos")
            if not isinstance(points, list):
                raise ValueError("多点模型缺少point_init_pos")
            model["point_init_pos"] = [_vector(p, "point_init_pos") for p in points]
        model["max_motor_velocity"] = _number(raw.get("max_motor_velocity"), "max_motor_velocity", 0)
        if model["max_motor_velocity"] <= 0:
            raise ValueError("max_motor_velocity必须大于0")
        segments = raw.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError(f"模型{mid}.segments不能为空")
        model["segments"], ids, previous = [], set(), None
        model_ratios = []
        for raw_segment in segments:
            if not isinstance(raw_segment, dict):
                raise ValueError("segment必须是对象")
            sid = _integer(raw_segment.get("segment_id"), "segment_id")
            if sid in ids:
                raise ValueError(f"模型{mid}的segment_id重复")
            ids.add(sid)
            seg = {"segment_id": sid}
            for key in ("start_frame", "end_frame"):
                seg[key] = _number(raw_segment.get(key), key, 0)
            if seg["end_frame"] <= seg["start_frame"]:
                raise ValueError("段结束帧必须大于开始帧")
            for key in ("start_HPY", "target_HPY"):
                seg[key] = _vector(raw_segment.get(key), key)
                if any(not model["min_position_HPY"][a] <= seg[key][a] <= model["max_position_HPY"][a]
                       for a in range(3)):
                    raise ValueError(f"模型{mid}段{sid}端点超出行程")
            for key in ("velocity_HPY", "acceleration_HPY", "deceleration_HPY"):
                seg[key] = _vector(raw_segment.get(key), key, 0)
            if previous is not None:
                if seg["start_frame"] < previous["end_frame"]:
                    raise ValueError("段必须按时间排序且不能重叠")
                if any(abs(a-b) > 1e-6 for a, b in zip(seg["start_HPY"], previous["target_HPY"])):
                    raise ValueError("段间位置不连续；空档只允许保持上一终点")
            profiles = []
            for axis in range(3):
                p, q = seg["start_HPY"][axis], seg["target_HPY"][axis]
                if axis not in model["axes"] and abs(q-p) > 1e-8:
                    raise ValueError("非活动轴不能有位移")
                profile = _plan_move_axis(p, q, 0, seg["velocity_HPY"][axis],
                                         seg["acceleration_HPY"][axis], seg["deceleration_HPY"][axis])
                profiles.append(profile)
                if abs(q-p) > 1e-12:
                    model_ratios.extend((model["max_velocity_HPY"][axis]/seg["velocity_HPY"][axis],
                                         math.sqrt(model["max_acceleration_HPY"][axis]/seg["acceleration_HPY"][axis]),
                                         math.sqrt(model["max_deceleration_HPY"][axis]/seg["deceleration_HPY"][axis])))
            lower = [min(p, q) for p, q in zip(seg["start_HPY"], seg["target_HPY"])]
            upper = [max(p, q) for p, q in zip(seg["start_HPY"], seg["target_HPY"])]
            peaks = [p["peak_velocity"] for p in profiles]
            bound = _move_motor_speed_bound(model, lower, upper, peaks)
            if bound > 0:
                model_ratios.append(model["max_motor_velocity"]/(bound*(1+1e-9)))
            certificates[(mid, sid)] = {"lower": lower, "upper": upper, "peaks": peaks,
                                        "bound": bound, "duration": max(p["duration"] for p in profiles)}
            model["segments"].append(seg)
            previous = seg
        ratios.extend(model_ratios)
        summaries[str(mid)] = {"MaxScale": min(model_ratios) if model_ratios else None,
                               "SegmentCount": len(model["segments"])}
        models[mid] = model
    maximum = min(ratios) if ratios else 1.0
    if not math.isfinite(maximum) or maximum <= 0:
        raise ValueError("无法得到有限正倍率")
    start = min(m["segments"][0]["start_frame"] for m in models.values())
    end = max(m["segments"][-1]["end_frame"] for m in models.values())
    report = {"ScaleValid": True, "MaxScale": maximum, "ActionSignature": signature,
              "BaseFrameRange_ms": [start, end], "Models": summaries,
              "ScaleBasis": "certified_zero_terminal_velocity_move",
              "AllStationary": not ratios}
    result = {"models": models, "certificates": certificates, "report": report,
              "start": start, "end": end, "cycles": {}}
    if len(_PREPARED_CACHE) >= 8:
        _PREPARED_CACHE.pop(next(iter(_PREPARED_CACHE)))
    _PREPARED_CACHE[signature] = result
    return result


##########################算法一：保存动作时计算统一允许倍率##########################
def calculate_speed_range(document):
    """返回保守安全倍率。失败返回ScaleValid=false，不返回虚假的可用倍率。"""
    try:
        if document.get("command", {}).get("trajectory_run") is True:
            return calculate_forced_speed_range(document)
        if document.get("command", {}).get("trajectory_run") is not False:
            return {"ScaleValid": False, "MaxScale": None, "Status": "invalid_input",
                    "Reason": "trajectory_run必须明确传true或false"}
        return copy.deepcopy(_prepare_action(document)["report"])
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, OverflowError, ZeroDivisionError) as exc:
        return {"ScaleValid": False, "MaxScale": None, "Reason": str(exc)}


##########################运动校验：虚轴上限、行程及实际电机速度上界##########################
def _check_profiles(model, profiles, certificate=None):
    """缓存位姿范围覆盖本段时复用证明；超出范围（例如反向停车）重新计算几何界。"""
    for axis, p in enumerate(profiles):
        for value, key in ((p["peak_velocity"], "max_velocity_HPY"),
                           (p["velocity"], "max_velocity_HPY"),
                           (p["acceleration"], "max_acceleration_HPY"),
                           (p["deceleration"], "max_deceleration_HPY")):
            if value > model[key][axis]*(1+1e-9)+1e-9:
                raise ValueError(f"模型{model['model_id']}的{AXIS_NAMES[axis]}轴超过{key}")
        if (p["position_min"] < model["min_position_HPY"][axis]-1e-8
                or p["position_max"] > model["max_position_HPY"][axis]+1e-8):
            raise ValueError(f"模型{model['model_id']}的{AXIS_NAMES[axis]}轴过渡/停车位置超出行程")
    lower, upper, peaks = ([p[key] for p in profiles]
                           for key in ("position_min", "position_max", "peak_velocity"))
    covered = certificate is not None and all(
        lower[a] >= certificate["lower"][a] and upper[a] <= certificate["upper"][a]
        and (certificate["peaks"][a] > 0 or peaks[a] == 0) for a in range(3))
    if covered:
        scale = max((peaks[a]/certificate["peaks"][a]
                     for a in range(3) if certificate["peaks"][a] > 0), default=0)
        bound = certificate["bound"]*scale
    else:
        bound = _move_motor_speed_bound(model, lower, upper, peaks)
    if bound > model["max_motor_velocity"]*(1+1e-9):
        raise ValueError(f"模型{model['model_id']}电机速度上界{bound:.6g}超过{model['max_motor_velocity']:.6g}")
    return bound


def _segment_at(model, frame, direction):
    """方向相关的半开区间：边界正向选右段、反向选左段。"""
    return next((seg for seg in model["segments"] if (
        seg["start_frame"] <= frame < seg["end_frame"] if direction > 0 else
        seg["start_frame"] < frame <= seg["end_frame"])), None)


def _held_position(model, frame):
    """段前保持首点，空档及段后保持最近完成段的终点。"""
    held = model["segments"][0]["start_HPY"]
    for seg in model["segments"]:
        if seg["end_frame"] <= frame:
            held = seg["target_HPY"]
    return list(held)


def _make_specs(prepared, origin, direction, feedback=None):
    """按请求方向生成Move列表；当前段取实际反馈，后续段从Base端点出发。"""
    specs = []
    for mid, model in prepared["models"].items():
        active = _segment_at(model, origin, direction) if feedback is not None else None
        ordered = model["segments"] if direction > 0 else reversed(model["segments"])
        if feedback is not None and active is None:
            expected = _held_position(model, origin)
            if any(abs(p-q) > 1e-6 for p, q in zip(feedback[mid]["position_HPY"], expected)):
                raise ValueError(f"模型{mid}在空档/终端未位于保持点，需先完成位置接入")
            if any(abs(v) > 1e-9 for v in feedback[mid]["velocity_HPY"]):
                raise ValueError(f"模型{mid}在空档/终端仍运动，不能当作静止保持")
        for seg in ordered:
            first, last = ((seg["start_frame"], seg["end_frame"]) if direction > 0
                           else (seg["end_frame"], seg["start_frame"]))
            current = seg is active
            if not current and (first-origin)*direction < 0:
                continue
            p, q = ((seg["start_HPY"], seg["target_HPY"]) if direction > 0
                    else (seg["target_HPY"], seg["start_HPY"]))
            specs.append({"mid": mid, "segment": seg, "base_start": origin if current else first,
                          "base_end": last, "start": list(feedback[mid]["position_HPY"] if current else p),
                          "target": list(q), "initial": list(feedback[mid]["velocity_HPY"] if current else [0.0]*3),
                          "current": current})
    return specs


def _profile_spec(prepared, spec, factor, duration=None):
    """完整零速段严格时间缩放；非零初速段保留反馈速度，按指定耗时求解。"""
    model, seg = prepared["models"][spec["mid"]], spec["segment"]
    profiles = []
    for axis in range(3):
        if axis not in model["axes"]:
            if abs(spec["target"][axis]-spec["start"][axis]) > 1e-8 or abs(spec["initial"][axis]) > 1e-9:
                raise ValueError("非活动轴不能运动或改变位置")
        profiles.append(_plan_move_axis(
            spec["start"][axis], spec["target"][axis], spec["initial"][axis],
            seg["velocity_HPY"][axis]*factor, seg["acceleration_HPY"][axis]*factor**2,
            seg["deceleration_HPY"][axis]*factor**2,
            maximum_deceleration=model["max_deceleration_HPY"][axis], duration=duration))
    bound = _check_profiles(model, profiles, prepared["certificates"][(spec["mid"], seg["segment_id"])])
    return profiles, bound


def _emit_segment(spec, profiles, bound, start, end):
    """生成可核验的Move/制动参数；phase只供预览积分，真正下发需按axis_commands。"""
    base_duration = (abs(spec["base_end"]-spec["base_start"])/1000
                     if spec["base_start"] is not None else None)
    return {"segment_id": spec["segment"]["segment_id"],
            "source": "replanned_current_segment" if spec["current"] else "scaled_base_segment",
            "base_start_frame": spec["base_start"], "base_end_frame": spec["base_end"],
            "start_frame": start, "end_frame": end,
            "base_duration_s": base_duration, "allocated_time_s": (end-start)/1000,
            "duration_change_from_base_s": (end-start)/1000-base_duration if base_duration is not None else None,
            "start_HPY": spec["start"], "target_HPY": spec["target"],
            "initial_velocity_HPY": spec["initial"],
            "velocity_HPY": [p["velocity"] for p in profiles],
            "acceleration_HPY": [p["acceleration"] for p in profiles],
            "deceleration_HPY": [p["deceleration"] for p in profiles],
            "PeakVelocity_HPY": [p["peak_velocity"] for p in profiles],
            "axis_arrival_time_s": [p["duration"] for p in profiles],
            "axis_modes": [p["mode"] for p in profiles],
            "axis_commands": [p["commands"] for p in profiles],
            "axis_phases": [p["phases"] for p in profiles],
            "motion_time_s": max(p["duration"] for p in profiles),
            "MotorSpeedUpperBound": bound,
            "ExecutionMode": "brake_then_move_axis_commands" if any(len(p["commands"]) > 1 for p in profiles) else "move"}


##########################公共时间表：所有模型共用Base帧到Online帧映射##########################
def _build_schedule(prepared, origin, direction, specs, factor, online_origin, quantum):
    """保留共同事件及空档；对最终帧再次求等时解，不能用早到等待冒充同步Move。"""
    terminal = prepared["end"] if direction > 0 else prepared["start"]
    events = sorted({origin, terminal, *(s["base_start"] for s in specs), *(s["base_end"] for s in specs)},
                    reverse=direction < 0)
    incoming = {event: [] for event in events}
    for spec in specs:
        if not spec["current"]:
            # 完整段的最短时间直接复用保存结果，无需再次求运动峰值和几何界。
            duration = prepared["certificates"][(spec["mid"], spec["segment"]["segment_id"])]["duration"]/factor
        else:
            profiles, _ = _profile_spec(prepared, spec, factor)
            duration = max(p["duration"] for p in profiles)
        incoming[spec["base_end"]].append((spec["base_start"], duration))
    frames = {origin: online_origin}
    for before, event in zip(events, events[1:]):
        required = frames[before]+abs(event-before)/factor
        for start, duration in incoming[event]:
            required = max(required, frames[start]+1000*duration)
        frames[event] = math.ceil(required/quantum)*quantum
    output = {str(mid): {"segments": []} for mid in prepared["models"]}
    for spec in specs:
        start, end = frames[spec["base_start"]], frames[spec["base_end"]]
        profiles, bound = _profile_spec(prepared, spec, factor, (end-start)/1000)
        output[str(spec["mid"])]["segments"].append(_emit_segment(spec, profiles, bound, start, end))
    return {"FrameMap": [{"base_frame_ms": b, "online_frame_ms": t} for b, t in frames.items()],
            "Models": output, "Duration_s": (frames[terminal]-online_origin)/1000}


def _full_cycle(prepared, direction, factor, quantum):
    """完整单趟按方向/倍率/时间精度缓存，下一次相同倍率直接复用。"""
    key = (direction, factor, quantum)
    if key not in prepared["cycles"]:
        origin = prepared["start"] if direction > 0 else prepared["end"]
        specs = _make_specs(prepared, origin, direction)
        schedule = _build_schedule(prepared, origin, direction, specs, factor, 0.0, quantum)
        if len(prepared["cycles"]) >= 32:
            prepared["cycles"].pop(next(iter(prepared["cycles"])))
        prepared["cycles"][key] = schedule
    return copy.deepcopy(prepared["cycles"][key])


##########################反向准备：全组先制动，先停的轴等待##########################
def _brake_group(prepared, feedback, online_frame, quantum):
    """按已保存最大减速度停车，检查包含停车外移的行程和电机界。"""
    raw, longest, stopped = {}, 0.0, copy.deepcopy(feedback)
    for mid, state in feedback.items():
        model = prepared["models"][mid]
        profiles = []
        for axis, (position, velocity) in enumerate(zip(state["position_HPY"], state["velocity_HPY"])):
            decel = model["max_deceleration_HPY"][axis] if abs(velocity) > 1e-12 else 0.0
            if abs(velocity) > 1e-12 and (axis not in model["axes"] or decel <= 0):
                raise ValueError("反向制动轴没有有效减速度")
            duration = abs(velocity)/decel if decel else 0.0
            acceleration = -math.copysign(decel, velocity) if decel else 0.0
            stop = position+velocity*duration+0.5*acceleration*duration**2
            phases = [{"start_offset_s": 0.0, "duration": duration, "initial_position": position,
                       "initial_velocity": velocity, "acceleration": acceleration}] if duration else []
            commands = [{"kind": "brake_to_zero", "start_offset_s": 0.0, "duration_s": duration,
                         "target_position": stop, "velocity": abs(velocity), "acceleration": 0.0,
                         "deceleration": decel, "initial_velocity": velocity}] if duration else []
            profiles.append({"duration": duration, "velocity": abs(velocity), "acceleration": 0.0,
                             "deceleration": decel, "peak_velocity": abs(velocity), "commands": commands,
                             "phases": phases, "position_min": min(position, stop), "position_max": max(position, stop),
                             "mode": "brake_to_zero", "final_position": stop})
            stopped[mid]["position_HPY"][axis], stopped[mid]["velocity_HPY"][axis] = stop, 0.0
            longest = max(longest, duration)
        bound = _check_profiles(model, profiles)
        raw[mid] = (profiles, bound)
    resume = math.ceil((online_frame+longest*1000)/quantum)*quantum if longest else online_frame
    output = {}
    for mid, (profiles, bound) in raw.items():
        spec = {"segment": {"segment_id": feedback[mid]["current_segment_id"]}, "current": True,
                "base_start": None, "base_end": None, "start": feedback[mid]["position_HPY"],
                "target": stopped[mid]["position_HPY"], "initial": feedback[mid]["velocity_HPY"]}
        item = _emit_segment(spec, profiles, bound, online_frame, resume)
        item.update(source="group_reverse_brake", ExecutionMode="brake_then_wait",
                    wait_after_s=[max(0.0, (resume-online_frame)/1000-p["duration"]) for p in profiles])
        output[str(mid)] = {"segments": [item]}
    return stopped, output, resume


##########################反馈定位：连续调速必须依据最新已生效计划##########################
def _resolve_runtime(prepared, runtime):
    """反馈帧映射只定位逻辑段，当前位置和速度始终采用PLC实测值。"""
    if not isinstance(runtime, dict):
        raise ValueError("adjust操作需要runtime对象")
    revision = _integer(runtime.get("plan_revision"), "plan_revision")
    snapshot = runtime.get("snapshot_id")
    if not isinstance(snapshot, str) or not snapshot:
        raise ValueError("snapshot_id必须为非空反馈标识")
    direction = runtime.get("current_direction")
    if type(direction) is not int or direction not in (-1, 1):
        raise ValueError("current_direction必须为1或-1")
    current_factor = _number(runtime.get("current_factor"), "current_factor", 0)
    if current_factor <= 0:
        raise ValueError("current_factor必须大于0")
    origin = _number(runtime.get("base_frame_ms"), "base_frame_ms", 0)
    online = _number(runtime.get("online_frame_ms"), "online_frame_ms", 0)
    elapsed = _number(runtime.get("current_cycle_elapsed_s"), "current_cycle_elapsed_s", 0)
    if not prepared["start"] <= origin <= prepared["end"]:
        raise ValueError("base_frame_ms必须在动作首末帧范围内")
    previous = runtime.get("previous_plan")
    expected_segments = None
    group_brake_pending = False
    if revision > 0 and previous is None:
        raise ValueError("连续调速必须提供最新已生效previous_plan，不能只传原始Base帧")
    if previous is not None:
        if (not isinstance(previous, dict) or previous.get("Applied") is not True
                or previous.get("PlanRevision") != revision
                or previous.get("ActionSignature") != prepared["report"]["ActionSignature"]):
            raise ValueError("previous_plan未生效、版本不符或动作内容已改变")
        if abs(current_factor-previous["AppliedFactor"]) > 1e-9:
            raise ValueError("反馈current_factor与最新计划倍率不一致")
        if online < previous["ClickOnlineFrame_ms"]:
            raise ValueError("反馈早于最新计划起始时间")
        mapping, plans, local_time = previous["FrameMap"], previous["Models"], online
        expected_direction = previous["Direction"]
        # 循环使用半开区间：恰好到终端的采样已属于下一轮，ping_pong也已切方向。
        if online >= mapping[-1]["online_frame_ms"] and previous["LoopMode"] != "once":
            offset = online-mapping[-1]["online_frame_ms"]
            next_duration = previous["NextLoopTime_s"]*1000
            if previous["LoopMode"] == "ping_pong":
                following_duration = previous["FollowingLoopTime_s"]*1000
                local_time = offset % (next_duration+following_duration)
                if local_time < next_duration:
                    mapping, plans = previous["NextLoopFrameMap"], previous["NextLoopModels"]
                    expected_direction = -previous["Direction"]
                else:
                    local_time -= next_duration
                    mapping, plans = previous["FollowingLoopFrameMap"], previous["FollowingLoopModels"]
            else:
                local_time = offset % next_duration
                mapping, plans = previous["NextLoopFrameMap"], previous["NextLoopModels"]
        if direction != expected_direction:
            raise ValueError("current_direction与最新计划所在循环的方向不一致")
        resolved = mapping[-1]["base_frame_ms"]
        if local_time <= mapping[0]["online_frame_ms"]:
            resolved = mapping[0]["base_frame_ms"]
        else:
            for left, right in zip(mapping, mapping[1:]):
                if left["online_frame_ms"] <= local_time < right["online_frame_ms"]:
                    rate = (local_time-left["online_frame_ms"])/(right["online_frame_ms"]-left["online_frame_ms"])
                    resolved = left["base_frame_ms"]+rate*(right["base_frame_ms"]-left["base_frame_ms"])
                    break
        if abs(origin-resolved) > 1e-5:
            raise ValueError(f"base_frame_ms与最新FrameMap不一致，应为{resolved:.9g}")
        expected_segments = {}
        for mid in prepared["models"]:
            rows = plans[str(mid)]["segments"]
            active = next((s for s in rows if s["start_frame"] <= local_time < s["end_frame"]), None)
            expected_segments[mid] = active["segment_id"] if active else None
        # 反向制动等待期间逻辑相位保持；当前仍属于输入反馈的原始段。
        if plans is previous["Models"] and online < mapping[0]["online_frame_ms"]:
            expected_segments = {int(k): v for k, v in previous["InputSegmentIds"].items()}
            group_brake_pending = bool(previous.get("BrakeModels"))
    states, feedback = runtime.get("model_states"), {}
    if not isinstance(states, list):
        raise ValueError("model_states必须为数组")
    for state in states:
        mid = _integer(state.get("model_id"), "反馈model_id", 1)
        if mid not in prepared["models"] or mid in feedback:
            raise ValueError("反馈模型重复或不属于动作")
        segment_id = state.get("current_segment_id")
        if segment_id is not None:
            _integer(segment_id, "current_segment_id")
        model = prepared["models"][mid]
        if expected_segments is None:
            active = _segment_at(model, origin, direction)
            expected = active["segment_id"] if active else None
        else:
            expected = expected_segments[mid]
        if segment_id != expected:
            raise ValueError(f"模型{mid}反馈段{segment_id}与正在执行的段{expected}不一致")
        position = _vector(state.get("position_HPY"), "position_HPY")
        velocity = _vector(state.get("velocity_HPY"), "velocity_HPY")
        for axis in range(3):
            if not model["min_position_HPY"][axis] <= position[axis] <= model["max_position_HPY"][axis]:
                raise ValueError("实际反馈位置超出行程")
            if abs(velocity[axis]) > model["max_velocity_HPY"][axis]*(1+1e-9)+1e-9:
                raise ValueError("实际初速度已经超过虚轴限额")
            if axis not in model["axes"] and abs(velocity[axis]) > 1e-9:
                raise ValueError("非活动轴反馈速度非零")
        feedback[mid] = {"current_segment_id": segment_id, "position_HPY": position, "velocity_HPY": velocity}
    if set(feedback) != set(prepared["models"]):
        raise ValueError("反馈必须包含每个模型")
    return origin, online, elapsed, direction, current_factor, revision, snapshot, feedback, group_brake_pending


##########################结果汇总：本次调速后的峰值速度##########################
def _maximum_speeds(prepared, *groups):
    """覆盖当前制动、剩余动作、下一轮；HPY三轴不混成一个不同单位的标量。"""
    peaks = {str(mid): [0.0]*3 for mid in prepared["models"]}
    motors = {str(mid): 0.0 for mid in prepared["models"]}
    for group in groups:
        for mid, value in group.items():
            for seg in value["segments"]:
                peaks[mid] = [max(a, b) for a, b in zip(peaks[mid], seg["PeakVelocity_HPY"])]
                motors[mid] = max(motors[mid], seg["MotorSpeedUpperBound"])
    return peaks, motors


##########################算法二：点击调速/反向时计算新计划##########################
def calculate_non_forced_speed_adjustment(document, prepared=None):
    """输出规划结果，不直接操作PLC。失败时不输出任何可下发的新指令。

    降倍率是有限次可行方案搜索，不宣称找到了当前状态的理论最大倍率。
    非零初速无法瞬时改变；不能立即应用时返回deferred，需在新反馈下重试。
    prepared可传算法一结果；其签名必须与当前动作一致，不能伪造倍率绕过内部认证。
    """
    failure = {"Applied": False, "Status": "invalid_input", "AppliedFactor": None,
               "CurrentCycleRemaining_s": None, "CurrentCycleTotal_s": None,
               "NextLoopTime_s": None, "MaxVelocity_HPY_per_s": None,
               "MaxMotorVelocityUpperBound": None, "Models": {}, "BrakeModels": {}}
    try:
        command = document.get("command", {})
        if command.get("trajectory_run") is not False:
            return dict(failure, Status="invalid_input", Reason="非强制入口要求trajectory_run=false；强制请调用calculate_forced_speed_adjustment")
        cache = _prepare_action(document)
        report = cache["report"]
        if prepared is not None and (not prepared.get("ScaleValid")
                                     or prepared.get("ActionSignature") != report["ActionSignature"]):
            raise ValueError("保存倍率结果与本次动作不一致")
        requested = _number(command.get("requested_factor"), "requested_factor", 0)
        if requested <= 0:
            raise ValueError("requested_factor必须大于0；停止请使用停止指令")
        if type(command.get("reverse")) is not bool:
            raise ValueError("reverse必须是bool")
        direction = -1 if command["reverse"] else 1
        mode = command.get("loop_mode", "once")
        if mode not in ("once", "repeat", "ping_pong"):
            raise ValueError("loop_mode只能为once/repeat/ping_pong")
        quantum = _number(command.get("frame_quantum_ms", 1), "frame_quantum_ms", 0)
        if quantum <= 0:
            raise ValueError("frame_quantum_ms必须大于0")
        (origin, online, elapsed, old_direction, old_factor, revision, snapshot,
         feedback, group_brake_pending) = _resolve_runtime(cache, document.get("runtime"))
        failure.update(RequestedFactor=requested, MaxScale=report["MaxScale"],
                       ActionSignature=report["ActionSignature"], BasedOnPlanRevision=revision, SnapshotId=snapshot)
        if mode == "repeat" and any(any(abs(p-q) > 1e-6 for p, q in zip(
                m["segments"][0]["start_HPY"], m["segments"][-1]["target_HPY"])) for m in cache["models"].values()):
            raise ValueError("repeat要求首尾位置闭合；首尾不同请使用ping_pong或显式回程段")
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, OverflowError, ZeroDivisionError) as exc:
        return dict(failure, Reason=str(exc))

    # 反向先全组停车。停车轨迹与请求倍率分离，避免倍率越小、制动距离反而越长。
    brakes, resume, planning_feedback = {}, online, feedback
    try:
        # 制动阶段连续点击也要先完成全组停车，不能因为目标方向相同而各轴自行掉头。
        if (direction != old_direction or group_brake_pending) and any(
                abs(v) > 1e-12 for s in feedback.values() for v in s["velocity_HPY"]):
            planning_feedback, brakes, resume = _brake_group(cache, feedback, online, quantum)
        specs = _make_specs(cache, origin, direction, planning_feedback)
    except (ValueError, ArithmeticError) as exc:
        return dict(failure, Status="deferred", Reason=str(exc), Retry="取得新的可行/停稳反馈后重新调用；本次不替换已生效计划")

    factor = min(requested, report["MaxScale"])
    errors, schedule, full, next_cycle, following = [], None, None, None, None
    for attempt in range(12):
        try:
            schedule = _build_schedule(cache, origin, direction, specs, factor, resume, quantum)
            full = _full_cycle(cache, direction, factor, quantum)
            if mode != "once":
                next_cycle = _full_cycle(cache, -direction if mode == "ping_pong" else direction, factor, quantum)
                following = full if mode == "ping_pong" else None
            break
        except (ValueError, ArithmeticError) as exc:
            errors.append(str(exc))
            schedule = None
            factor *= 0.8
    if schedule is None:
        return dict(failure, Status="deferred", Reason=errors[-1], AttemptCount=len(errors),
                    Retry="在可行的停稳事件重新计算；不强行下发，不把未知剩余时间写成0")
    remaining = (resume-online)/1000+schedule["Duration_s"]
    next_models = next_cycle["Models"] if next_cycle else {}
    following_models = following["Models"] if following else {}
    peaks, motor_peaks = _maximum_speeds(cache, brakes, schedule["Models"], next_models, following_models)
    result = dict(
        Applied=True, Status="planned", RequestedFactor=requested, AppliedFactor=factor,
        CurrentFactor=old_factor, MaxScale=report["MaxScale"], FactorLimited=factor < requested-1e-12,
        ActionSignature=report["ActionSignature"], BasedOnPlanRevision=revision, PlanRevision=revision+1,
        SnapshotId=snapshot, Direction=direction, PreviousDirection=old_direction, LoopMode=mode,
        ClickBaseFrame_ms=origin, ClickOnlineFrame_ms=online, TransitionBrakeTime_s=(resume-online)/1000,
        CurrentCycleRemaining_s=remaining, CurrentCycleTotal_s=elapsed+remaining,
        BaseActionTime_s=(cache["end"]-cache["start"])/1000,
        CompleteActionTime_s=full["Duration_s"], NextLoopTime_s=next_cycle["Duration_s"] if next_cycle else None,
        CompleteActionTimeChangeFromBase_s=full["Duration_s"]-(cache["end"]-cache["start"])/1000,
        FollowingLoopTime_s=following["Duration_s"] if following else None,
        RoundTripTime_s=(full["Duration_s"]+next_cycle["Duration_s"]) if mode == "ping_pong" else None,
        MaxVelocity_HPY_per_s=peaks, MaxMotorVelocityUpperBound=motor_peaks,
        MaximumSpeedScope="本次制动及剩余运动；开启循环时还包括后续完整循环",
        FrameMap=schedule["FrameMap"], Models=schedule["Models"], BrakeModels=brakes,
        NextLoopFrameMap=next_cycle["FrameMap"] if next_cycle else [], NextLoopModels=next_models,
        FollowingLoopFrameMap=following["FrameMap"] if following else [], FollowingLoopModels=following_models,
        InputSegmentIds={str(mid): s["current_segment_id"] for mid, s in feedback.items()},
        TimeBasis="jerk=0、每段末速0、不混合跨段；相对于反馈快照，不含通讯/PLC扫描延迟",
        CommitRule="仅在反馈/计划版本仍匹配时统一生效；Applied仅表示规划通过，非PLC执行确认",
    )
    if errors:
        result["AdjustmentReason"] = errors[0]
    return result


##########################强制轨迹辅助：整段多项式速度上界##########################
def _forced_bernstein(power):
    """把归一化时间u∈[0,1]的幂系数换为Bernstein控制值，用凸包覆盖整段。"""
    degree = len(power)-1
    values = [math.fsum(power[j]*math.comb(k, j)/math.comb(degree, j)
                        for j in range(k+1)) for k in range(degree+1)]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("强制曲线系数换算溢出")
    return values


def _forced_split(values):
    """de Casteljau对半细分；两个凸包分别覆盖左右半段，不依赖离散采样。"""
    left, right = [values[0]], [values[-1]]
    while len(values) > 1:
        values = [(a+b)/2 for a, b in zip(values, values[1:])]
        left.append(values[0])
        right.append(values[-1])
    return left, right[::-1]


def _forced_interval(values):
    """凸包边界加浮点裕量；常量轴保持精确常量，避免虚构混合倾斜。"""
    low, high = min(values), max(values)
    margin = 0.0 if low == high else 64*math.ulp(max(abs(low), abs(high)))
    return low-margin, high+margin


def _prepare_forced_action(document):
    """只按forced_action缓存完整曲线的速度认证；调速不修改PLC保存的系数。

    XML保存时udiStartTime=输入ms/100；getPosAllLoop用段内100ms单位求a..f。
    因而只接收100ms整倍数节点，避免上位机与PLC整数截断后的曲线不一致。
    MaxScale只认证虚轴/实际电机速度；主轴加速度产生的附加轴加速度仍由PLC保护。
    """
    action = document.get("forced_action")
    if not isinstance(action, dict) or not isinstance(action.get("models"), list) or not action["models"]:
        raise ValueError("强制轨迹需要forced_action.models，不能拿非强制Move的V/A/D代替曲线")
    signature = hashlib.sha256(("forced-plc100ms-v2-physical-scale:"+json.dumps(
        action, sort_keys=True, ensure_ascii=False, allow_nan=False)).encode("utf-8")).hexdigest()
    if signature in _FORCED_CACHE:
        return _FORCED_CACHE[signature]
    ranges, ratios, can_loop = {}, [], True
    for raw in action["models"]:
        if not isinstance(raw, dict):
            raise ValueError("强制模型必须是对象")
        mid = _integer(raw.get("model_id"), "forced.model_id", 1)
        if str(mid) in ranges:
            raise ValueError("强制模型编号重复")
        model = copy.deepcopy(raw)
        model["index"] = mid
        model["model_type"] = _integer(raw.get("model_type"), "model_type", 1)
        model["motor_num"] = _integer(raw.get("motor_num"), "motor_num", 1)
        axes = raw.get("active_axes")
        if (not isinstance(axes, list) or not axes or any(a not in AXIS_NAMES for a in axes)
                or len(set(axes)) != len(axes)):
            raise ValueError("强制模型active_axes必须为不重复的H/P/Y名称数组")
        active = {AXIS_NAMES.index(a) for a in axes}
        maximum = _vector(raw.get("max_velocity_HPY"), "max_velocity_HPY", 0)
        if any(maximum[a] <= 0 for a in active):
            raise ValueError("强制活动虚轴最大速度必须大于0")
        motor_limit = _number(raw.get("max_motor_velocity"), "max_motor_velocity", 0)
        if motor_limit <= 0:
            raise ValueError("电机最大速度必须大于0")
        segments = raw.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError(f"强制模型{mid}没有曲线段")
        previous_end, previous_position, first_position = None, None, None
        ids = set()
        for seg in segments:
            sid = _integer(seg.get("segment_id"), "segment_id")
            if sid in ids:
                raise ValueError("强制曲线段编号重复")
            ids.add(sid)
            start = _number(seg.get("start_frame"), "start_frame", 0)
            end = _number(seg.get("end_frame"), "end_frame", 0)
            if end <= start or any(abs(v/100-round(v/100)) > 1e-9 for v in (start, end)):
                raise ValueError("强制曲线节点必须递增且为100ms整倍数，与PLC保存格式一致")
            if previous_end is not None and start != previous_end:
                raise ValueError("强制Timeline段间不能有空档/重叠；保持段也要显式写常数曲线")
            coefficients = [_vector(seg.get(name), f"系数{name}") for name in "abcdef"]
            ticks, duration = (end-start)/100, (end-start)/1000
            positions, velocities = [], []
            for axis in range(3):
                power = [coefficients[n][axis]*ticks**n for n in range(6)]
                positions.append(_forced_bernstein(power))
                velocities.append(_forced_bernstein([n*power[n]/duration for n in range(1, 6)]))
                if axis not in active and any(v != 0 for v in velocities[-1]):
                    raise ValueError("强制曲线未启用的轴仍在运动")
            begin, finish = [p[0] for p in positions], [p[-1] for p in positions]
            for key, actual in (("start_HPY", begin), ("target_HPY", finish)):
                declared = _vector(seg.get(key), key)
                if any(abs(a-b) > 1e-5 for a, b in zip(actual, declared)):
                    raise ValueError(f"模型{mid}段{sid}系数与{key}端点不一致")
            if previous_position is not None and any(abs(a-b) > 1e-5 for a, b in zip(begin, previous_position)):
                raise ValueError("强制曲线位置不连续，降倍率不能消除位置跳变")
            if first_position is None:
                first_position = begin
                first_frame = start
            previous_end, previous_position = end, finish
            intervals = [(positions, velocities)]
            for _ in range(4):
                halves = []
                for pp, vv in intervals:
                    ps, vs = [_forced_split(v) for v in pp], [_forced_split(v) for v in vv]
                    halves.extend(([p[side] for p in ps], [v[side] for v in vs]) for side in (0, 1))
                intervals = halves
            for pp, vv in intervals:
                boxes = [_forced_interval(p) for p in pp]
                peaks = [max(abs(v) for v in _forced_interval(values)) for values in vv]
                ratios.extend(maximum[a]/(peaks[a]*(1+1e-9)) for a in active if peaks[a] > 0)
                bound = _move_motor_speed_bound(model, [p[0] for p in boxes], [p[1] for p in boxes], peaks)
                if bound > 0:
                    ratios.append(motor_limit/(bound*(1+1e-9)))
            # 比PLC canLoop的0.001位置公差更严格；不把接缝跳变认证为安全速度。
        can_loop = can_loop and all(abs(a-b) <= 1e-5 for a, b in zip(first_position, previous_position))
        ranges[str(mid)] = (first_frame, previous_end)
    maximum = min(ratios) if ratios else None
    if maximum is not None and (not math.isfinite(maximum) or maximum <= 0):
        raise ValueError("强制曲线无法得到有效倍率")
    # 上位机输出曲线/机构本身的倍率上限，不混入旧XML的1%..100%整数接口限制。
    # 整个动作静止时不存在由速度决定的有限上限，用null+标志说明，不能虚构1倍上限。
    result = {"ranges": ranges, "can_loop": can_loop,
              "report": {"ScaleValid": True, "MaxScale": maximum, "ActionSignature": signature,
                         "ScaleBasis": "forced_curve_speed_bound",
                         "CanLoop": can_loop, "UnboundedBySpeed": maximum is None}}
    if len(_FORCED_CACHE) >= 8:
        _FORCED_CACHE.pop(next(iter(_FORCED_CACHE)))
    _FORCED_CACHE[signature] = result
    return result


##########################强制算法一：保存动作时只计算一次曲线允许倍率##########################
def calculate_forced_speed_range(document):
    """返回整个强制动作的速度倍率上限；反馈/方向/请求倍率改变不会重算曲线。"""
    try:
        if document.get("command", {}).get("trajectory_run") is not True:
            raise ValueError("强制调速要求trajectory_run=true")
        prepared = _prepare_forced_action(document)
        mode = document.get("command", {}).get("loop_mode", "once")
        if mode not in ("once", "repeat"):
            raise ValueError("当前PLC没有自动ping_pong模式；反向请单独修改reverse")
        if mode == "repeat" and not prepared["can_loop"]:
            raise ValueError("强制循环要求各Timeline首尾位置闭合，PLC不会按非闭合动作连续循环")
        return copy.deepcopy(prepared["report"])
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, ArithmeticError) as exc:
        return {"ScaleValid": False, "MaxScale": None, "Reason": str(exc)}


def _forced_master_travel_time(distance, initial_speed, target_speed, acceleration):
    """主轴到边界的首次到达时间：先制动/加减速再匀速，不在曲线边界虚构零速停车。

    距离单位ms，速度ms/s，加速度ms/s²。XML movMainAbs用同一个mainAxisAcc作A/D。
    初速按目标方向投影；负数意味着需先刹停，制动位移也计入剩余路程。
    """
    if distance <= 0:
        return 0.0
    velocity, elapsed, covered, phases = initial_speed, 0.0, 0.0, []
    if velocity < 0:
        phases.extend(((-velocity/acceleration, acceleration), (target_speed/acceleration, acceleration)))
    elif velocity > target_speed:
        phases.append(((velocity-target_speed)/acceleration, -acceleration))
    else:
        phases.append(((target_speed-velocity)/acceleration, acceleration))
    for duration, accel in phases:
        final_speed = velocity+accel*duration
        moved = (velocity+final_speed)*duration/2
        if velocity >= 0 and covered+moved >= distance:
            left = distance-covered
            root = math.sqrt(max(0.0, velocity*velocity+2*accel*left))
            return elapsed+2*left/(velocity+root)
        covered += moved
        elapsed += duration
        velocity = max(0.0, final_speed)
    return elapsed+(distance-covered)/target_speed


##########################强制算法二：只输出倍率和时间，不生成曲线或Move参数##########################
def calculate_forced_speed_adjustment(document, saved_range=None):
    """按租赁2.0时间主轴预览剩余时间和完整周期，不给PLC重新发送各模型参数。

    完整周期=周期ms/(1000*r)，与方向无关；当前剩余时间可包含主轴变速/反向制动。
    缺少主轴速度或本次有效A时只给明确标注的匀速估算。PLC换向未获允许时不猜等待时间。
    范围只限速度；主轴加减速导致的附加虚轴加速度、行程等仍由PLC保护。
    """
    failure = {"Applied": False, "Status": "invalid_input", "MaxScale": None,
               "AppliedFactor": None, "RemainingTime_s": None, "CompleteCycleTime_s": None,
               "NextLoopTime_s": None}
    try:
        command = document.get("command", {})
        report = calculate_forced_speed_range(document)
        if not report["ScaleValid"]:
            raise ValueError(report["Reason"])
        prepared = _prepare_forced_action(document)
        failure["MaxScale"] = report["MaxScale"]
        if saved_range is not None and (not saved_range.get("ScaleValid") or
                saved_range.get("ActionSignature") != report["ActionSignature"] or
                saved_range.get("MaxScale") != report["MaxScale"]):
            raise ValueError("保存倍率结果与当前强制动作不一致")
        factor = _number(command.get("requested_factor"), "requested_factor", 0)
        failure["RequestedFactor"] = factor
        if factor <= 0:
            raise ValueError("requested_factor必须为有限正倍率，例如1.5表示150%；停止请使用PLC停止指令")
        if report["MaxScale"] is not None and factor > report["MaxScale"]:
            raise ValueError("请求倍率超过保存的MaxScale；不暗改PLC实际收到的请求倍率")
        if type(command.get("reverse")) is not bool:
            raise ValueError("reverse必须为bool")
        direction = -1 if command["reverse"] else 1
        mode = command.get("loop_mode", "once")
        runtime = document.get("forced_runtime")
        if not isinstance(runtime, dict):
            raise ValueError("强制调速需要forced_runtime时间主轴反馈，不使用非强制runtime")
        frame = _number(runtime.get("current_frame_ms"), "current_frame_ms")
        # once表示原始单轮，不把“多轮运行中修改循环次数”为1误当作重回第一轮。
        if mode == "once" and not 0 <= frame <= max(v[1] for v in prepared["ranges"].values()):
            raise ValueError("once需要原始单轮的主轴帧；多轮中途修改结束轮数不属于本接口")
        not_started = runtime.get("not_started_model_ids", [])
        if (not isinstance(not_started, list) or len(set(not_started)) != len(not_started)
                or any(type(mid) is not int or str(mid) not in prepared["ranges"] for mid in not_started)):
            raise ValueError("not_started_model_ids必须为尚未进入FollowCurve的有效模型编号数组")
        old_direction = runtime.get("current_direction")
        if type(old_direction) is not int or old_direction not in (-1, 1):
            raise ValueError("forced_runtime.current_direction必须为1或-1")
        for key in ("pending_reversal", "reversal_allowed"):
            if runtime.get(key) is not None and type(runtime[key]) is not bool:
                raise ValueError(f"{key}必须为bool")
        if runtime.get("pending_reversal", False) or (
                mode == "repeat" and direction != old_direction and runtime.get("reversal_allowed") is not True):
            return dict(failure, Status="deferred", Reason="PLC循环换向尚未获准或状态未知；等待时长未知，不能报确定剩余时间")
        raw_velocity, raw_acceleration = (runtime.get("current_master_velocity_ms_per_s"),
                                           runtime.get("master_acceleration_ms_per_s2"))
        velocity = None if raw_velocity is None else _number(raw_velocity, "current_master_velocity_ms_per_s")
        acceleration = None if raw_acceleration is None else _number(raw_acceleration, "master_acceleration_ms_per_s2", 0)
        if acceleration is not None and acceleration <= 0:
            raise ValueError("有效主轴加减速度必须大于0；未知请填null，不能填0冒充可变速")
        estimate = velocity is None or acceleration is None
        speed = 1000*factor
        if not math.isfinite(speed) or speed <= 0:
            raise ValueError("倍率换算后的时间主轴速度超出有效数值范围")
        times = {}
        for mid, (start, end) in prepared["ranges"].items():
            period = end-start
            if mode == "once":
                boundary = end if direction > 0 else start
                distance = max(0.0, direction*(boundary-frame))
            elif direction > 0:
                boundary = end if int(mid) in not_started else start+(math.floor((frame-start)/period)+1)*period
                distance = boundary-frame
            else:
                boundary = start if int(mid) in not_started else start+(math.ceil((frame-start)/period)-1)*period
                distance = frame-boundary
            if distance < 0:
                raise ValueError("未开始模型的状态与主轴帧/运行方向不一致")
            remaining = distance/speed if estimate else _forced_master_travel_time(
                distance, direction*velocity, speed, acceleration)
            next_time = None
            if mode == "repeat":
                next_time = period/speed if estimate else _forced_master_travel_time(
                    distance+period, direction*velocity, speed, acceleration)-remaining
            if not math.isfinite(remaining) or remaining < 0 or (
                    next_time is not None and (not math.isfinite(next_time) or next_time <= 0)):
                raise ValueError("主轴时间计算溢出或精度不足，不能生成可靠时间")
            times[mid] = {"RemainingTime_s": remaining, "CompleteCycleTime_s": period/speed,
                          "NextLoopTime_s": next_time}
        common = len(set(prepared["ranges"].values())) == 1
        spans = list(prepared["ranges"].values())
        complete = (max(v[1] for v in spans)-min(v[0] for v in spans))/speed
        if not math.isfinite(complete):
            raise ValueError("完整周期计算超出有限数值范围")
        result = {"Applied": True, "Status": "estimated" if estimate else "predicted",
                  "MaxScale": report["MaxScale"], "RequestedFactor": factor, "AppliedFactor": factor,
                  "UnboundedBySpeed": report["UnboundedBySpeed"],
                  "Direction": direction,
                  "RemainingTime_s": max(t["RemainingTime_s"] for t in times.values()),
                  "CompleteCycleTime_s": complete,
                  "NextLoopTime_s": next(iter(times.values()))["NextLoopTime_s"] if common else None,
                  "EstimateOnly": estimate, "HasCommonCycle": common,
                  "TimeBasis": "steady_speed_estimate" if estimate else "plc_master_ramp_prediction"}
        if mode == "repeat" and not common:
            result.update(RemainingTime_s=None, CompleteCycleTime_s=None, ModelTimes=times,
                          TimeNotes="不同模型的Timeline起止帧不同，没有统一的一轮；分别查看ModelTimes")
        elif estimate:
            result["TimeNotes"] = "缺少实际主轴速度/本次有效加减速度，只按新倍率匀速估算；不包含变速/反向过渡"
        # 时间及速度认证均不包含通讯、扫描延迟和PLC保护动作；Applied不是下发成功确认。
        return result
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, ArithmeticError) as exc:
        return dict(failure, Reason=str(exc))


######################################主函数：只读取、调用和输出######################################
if __name__ == "__main__":
    document = load_speed_inputs(sys.argv[1] if len(sys.argv) > 1 else None)
    command = document.get("command", {})
    if command.get("trajectory_run") is True:
        print("一、强制轨迹保存倍率：")
        saved_range = calculate_forced_speed_range(document)
        print(json_dumps_with_inline_lists(saved_range))
        if command.get("operation") == "adjust":
            print("二、强制轨迹调速后的时间：")
            print(json_dumps_with_inline_lists(calculate_forced_speed_adjustment(document, saved_range)))
        elif command.get("operation") != "prepare":
            raise ValueError("command.operation只能为prepare或adjust")
    elif command.get("trajectory_run") is False:
        print("一、保存动作时的调速倍率：")
        saved_range = calculate_speed_range(document)
        print(json_dumps_with_inline_lists(saved_range))
        if command.get("operation") == "adjust":
            print("二、本次调速/反向的运行参数、时间帧和最大速度：")
            print(json_dumps_with_inline_lists(compact_speed_output(
                calculate_non_forced_speed_adjustment(document, saved_range))))
        elif command.get("operation") != "prepare":
            raise ValueError("command.operation只能为prepare或adjust")
    else:
        raise ValueError("command.trajectory_run必须明确传true或false")


######################################流程与全部分支说明######################################
"""
保存动作（prepare）：
读取各段真实Move基准V/A/D、起终点、时间帧和模型限额
        ↓
虚轴速度倍率、sqrt(加速度倍率)、sqrt(减速度倍率)、实际电机速度倍率取最小
        ↓
返回MaxScale，并按动作内容缓存运动时间和几何速度界

点击调速（adjust）：
最新计划版本 + 同一时刻实际位置/有符号速度 + 原始逻辑帧/实际发送帧
        ↓
正向→正向 / 反向→反向：保留实际初速度规划当前剩余Move
正向→反向 / 反向→正向：先检查并输出全组制动，停稳后统一换向
        ↓
零初速完整段：V×r、A/D×r²；非零初速当前段：固定实际初速度重新求解
        ↓
公共事件帧重排；空档保留，短段三角形，长段梯形，静止轴保持
        ↓
最终参数校验V/A/D、停车行程和实际电机速度界；必要时有限次试算较低倍率
        ↓
成功：位置/V/A/D、制动指令、帧映射、本轮剩余及总时间、实际峰速/电机上界
失败：Applied=false、Models为空、时间及峰速null，等待新反馈再试

循环：once只执行到请求方向终端；repeat首尾必须闭合，同方向重复；
ping_pong每到一个端点算一趟，下一趟换向，RoundTripTime_s是完整两趟。
连续点击：传上次真正已生效结果previous_plan、匹配的plan_revision和新反馈；
使用最新FrameMap定位，不用旧倍率连乘，不把逻辑帧当真实位置。
静止反馈也须校验当前位置到目标的路径，不能仅凭保存倍率跳过新的接入运动。
四点模型仍只认证单一倾角P或Y，P/Y混合倾斜明确拒绝，不能误报安全。
这不是在线PLC扫描任务：仅保存或点击时调用；缓存限额变化后自动失效。

##########################强制轨迹：PLC保存曲线，调速只改变时间主轴##########################
保存时：forced_action原始a..f、100ms节点、虚轴/实际电机速度上限
        ↓
整段多项式速度界 + 模型几何速度界 → 统一MaxScale（不受旧协议100%限制，不按百分比取整）
        ↓
缓存认证结果；只改请求倍率、方向或当前帧不重新计算整条曲线

点击时：请求倍率 + 正反向 + forced_runtime时间主轴反馈
        ↓
确认请求为正倍率且在保存范围；循环反向需PLC已允许（否则时间未知）
        ↓
根据各Timeline首末节点确定正向/反向剩余主轴距离
        ↓
有实际主轴速度和有效A/D：预测变速/反向制动后的边界到达时间
缺少主轴动态反馈：明确标注为匀速估算，不能冒充含过渡的准确时间
        ↓
输出倍率、剩余时间、稳态完整周期、下一实际周期时间；不输出/重发曲线和Move参数

当前提供的PLC旧协议仍有限制1%..100%的校验，现场须自行修改；本算法不修改工程。
输出AppliedFactor为倍率r，如1.5；PLC若仍使用百分比，需要接口侧乘100为150，不能混用。
主轴内部1位置单位=100ms，1倍速=10单位/s；取消倍率上限不改变这套时间单位。
本接口反馈统一使用ms、ms/s、ms/s²：PLC原始主轴位置/速度/加速度均乘100后传入。
master_acceleration_ms_per_s2是getAdjSpeedAcc后C/D组取小值的实际参数，不是虚轴最大A。
getPosAllLoop循环每个Timeline的首末节点，不支持非强制算法的自动ping_pong。
当前帧使用累计主轴帧；尚处RunToOneFrame的模型用not_started_model_ids明确标识。
once仅表示原始单轮，不表示在多轮运行中修改PLC的结束轮数。
各模型周期不一致时输出ModelTimes，不捏造统一循环时间。一次运行只预测到曲线终端，
不包含结束后的机械停车/通讯延迟。速度上限并不替代PLC加速度、行程和碰撞保护。
"""
