"""启动接入算法：选择强制/非强制轨迹的目标位置，并计算到位V/A/D和时间。

直接运行：python 就近位置计算.py
输入：同目录“就近位置参数.json”，也可把字典传给load_nearest_position_inputs。
JSON的“_说明”仅供开发人员阅读，算法不使用；实际网络传输可以删除整块说明。

本文件独立运行，不导入、不修改“算法流程.py”或“YXZ.JSON”。
两种选点函数沿用旧算法；只精简输入组织和主流程输出。
强制轨迹按默认V/A/D独立到位后等待；非强制轨迹按最大V/A/D同步到位并检查电机限速。
本文件不计算在线调速倍率或非零初速度重规划。
"""
import copy
import json
import math
import re
from pathlib import Path

# 固定约定，与原算法及PLC一致，不再要求每次通过JSON重复传输。
CURVE_TICK_FRAME = 100.0  # 多项式自变量每增加1，对应100ms。
AXIS_NAMES = ("H", "P", "Y")  # 所有三项数组的固定顺序。
COARSE_STEP_MS = 100.0  # 就近时间搜索的粗搜步长。
FINE_STEP_MS = 10.0  # 就近时间搜索的细搜步长。


##########################电机正解：仅非强制第二步限速检查使用##########################
def dandian_forward_model(height, motor_num):
    return [height] * motor_num
##########################两点正解函数#########################
    ##输入 虚轴1位置 虚轴2位置 原点位置在上距离  原点位置在下距离 吊点距离 最大行程
def liangdian_forward_model(height, arg_x, BaseHight1,BaseHight2, lLenth_inside,maxheight):
    if BaseHight1 != 0 and BaseHight2 == 0:
        xOffset = ((arg_x / 90.0) ** 3) * (lLenth_inside / 2.0)
        arg_x_rad = arg_x / 180.0 * math.pi  # 转为弧度制
        # 两端初始位置
        x0 = -(lLenth_inside / 2.0)
        y0 = 0
        x1 = (lLenth_inside / 2.0)
        y1 = 0
        # 旋转后两端坐标
        xA = -math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
        xB =  math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
        yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0) + BaseHight1
        yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0) + BaseHight1
        # 点 A、B 到起点的距离（减去 BaseHight）
        Apoint = math.sqrt((xA - x0) ** 2 + (yA - y0) ** 2) - BaseHight1
        Bpoint = math.sqrt((xB - x1) ** 2 + (yB - y1) ** 2) - BaseHight1
        return Apoint,Bpoint
    elif BaseHight1 == 0 and BaseHight2 != 0:
        arg_x=-1*arg_x
        xOffset = ((arg_x / 90.0) ** 3) * (lLenth_inside / 2.0)
        arg_x_rad = arg_x / 180.0 * math.pi  # 转为弧度制
        # 两端初始位置
        x0 = -(lLenth_inside / 2.0)
        y0 = BaseHight2+maxheight
        x1 = (lLenth_inside / 2.0)
        y1 = BaseHight2+maxheight
        # 旋转后两端坐标
        xA = -math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
        xB =  math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
        yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0)
        yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0)
        # 点 A、B 到起点的距离
        Apoint = BaseHight2+maxheight - math.sqrt((xA - x0) ** 2 + (yA - y0) ** 2)
        Bpoint = BaseHight2+maxheight - math.sqrt((xB - x1) ** 2 + (yB - y1) ** 2)
        return Apoint,Bpoint
##########################四点正解函数#########################
    ##输入 虚轴1位置 虚轴2位置 虚轴3位置 原点位置在上距离 原点位置在下距离 X方向吊点距离 Y方向吊点距离 最大行程 运动方向
def sidian_forward_model(height,arg_x_deg,arg_y_deg,BaseHight1,BaseHight2,lLenth_inside,wLenth_inside,maxheight,moveWhat):
    if BaseHight1 != 0 and BaseHight2 == 0:
        # X方向运动
        if moveWhat == 1:
            xOffset = ((arg_x_deg / 90.0) ** 3) * (lLenth_inside / 2.0)
            arg_x_rad = arg_x_deg / 180.0 * math.pi
            x0 = -(lLenth_inside / 2.0)
            x1 = (lLenth_inside / 2.0)
            xA = -math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
            xB = math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
            yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0) + BaseHight1
            yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0) + BaseHight1
            Apoint = math.sqrt((xA - x0) ** 2 + yA ** 2) - BaseHight1
            Bpoint = math.sqrt((xB - x1) ** 2 + yB ** 2) - BaseHight1
            Cpoint = Bpoint
            Dpoint = Apoint
            return Apoint,Bpoint,Cpoint,Dpoint
        elif moveWhat == 2:
            yOffset = ((arg_y_deg / 90.0) ** 3) * (wLenth_inside / 2.0)
            arg_y_rad = math.radians(arg_y_deg)
            x0 = -(wLenth_inside / 2.0)
            x1 = (wLenth_inside / 2.0)
            xA = -math.cos(arg_y_rad) * (wLenth_inside / 2.0) - yOffset
            xB = math.cos(arg_y_rad) * (wLenth_inside / 2.0) - yOffset
            yA = height - math.sin(arg_y_rad) * (wLenth_inside / 2.0) + BaseHight1
            yB = height + math.sin(arg_y_rad) * (wLenth_inside / 2.0) + BaseHight1
            Apoint = math.sqrt((xB - x1) ** 2 + yB ** 2) - BaseHight1
            Cpoint = math.sqrt((xA - x0) ** 2 + yA ** 2) - BaseHight1
            Bpoint = Apoint
            Dpoint = Cpoint
            return Apoint,Bpoint,Cpoint,Dpoint
        else:
            return height,height,height,height
    elif BaseHight1 == 0 and BaseHight2 != 0:
        # X方向运动
        if moveWhat == 1:
            arg_x_deg = -1 * arg_x_deg
            xOffset = ((arg_x_deg / 90.0) ** 3) * (lLenth_inside / 2.0)
            arg_x_rad = arg_x_deg / 180.0 * math.pi
            x0 = -(lLenth_inside / 2.0)
            y0 = BaseHight2 + maxheight
            x1 = (lLenth_inside / 2.0)
            y1 = BaseHight2 + maxheight
            xA = -math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
            xB = math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
            yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0)
            yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0)
            Apoint = BaseHight2 + maxheight - math.sqrt((xA - x0) ** 2 + (yA - y0) ** 2)
            Bpoint = BaseHight2 + maxheight - math.sqrt((xB - x1) ** 2 + (yB - y1) ** 2)
            Cpoint = Bpoint
            Dpoint = Apoint
            return Apoint,Bpoint,Cpoint,Dpoint
        elif moveWhat == 2:
            arg_y_deg = -1 * arg_y_deg
            yOffset = ((arg_y_deg / 90.0) ** 3) * (wLenth_inside / 2.0)
            arg_y_rad = math.radians(arg_y_deg)
            x0 = -(wLenth_inside / 2.0)
            y0 = BaseHight2 + maxheight
            x1 = (wLenth_inside / 2.0)
            y1 = BaseHight2 + maxheight
            xA = -math.cos(arg_y_rad) * (wLenth_inside / 2.0) - yOffset
            xB = math.cos(arg_y_rad) * (wLenth_inside / 2.0) - yOffset
            yA = height - math.sin(arg_y_rad) * (wLenth_inside / 2.0)
            yB = height + math.sin(arg_y_rad) * (wLenth_inside / 2.0)
            Apoint = BaseHight2 + maxheight - math.sqrt((xB - x1) ** 2 + (yB - y1) ** 2)
            Cpoint = BaseHight2 + maxheight - math.sqrt((xA - x0) ** 2 + (yA - y0) ** 2)
            Bpoint = Apoint
            Dpoint = Cpoint
            return Apoint,Bpoint,Cpoint,Dpoint
        else:
            return height,height,height,height
##########################多点正解函数#########################
    ##输入 虚轴1位置 虚轴2位置 虚轴3位置 吊点坐标 原点位置在上距离 原点位置在下距离 最大行程 初始方向角
def duodian_forward_model(height,arg_x_deg,arg_y_deg,point_init_pos,Baseheight1,Baseheight2,maxheight,betainit):
    roll = arg_y_deg
    pitch = arg_x_deg
    roll = roll + betainit
    roll = -roll
    pitch = -pitch
    def degrees_to_radians(degrees):
        return degrees * math.pi / 180.0
    def apply_quaternion_rotation(x,y,z,quaternion):
        w,qx,qy,qz = quaternion
        x_rot = (1 - 2 * qy ** 2 - 2 * qz ** 2) * x + (2 * qx * qy - 2 * w * qz) * y + (2 * qx * qz + 2 * w * qy) * z
        y_rot = (2 * qx * qy + 2 * w * qz) * x + (1 - 2 * qx ** 2 - 2 * qz ** 2) * y + (2 * qy * qz - 2 * w * qx) * z
        z_rot = (2 * qx * qz - 2 * w * qy) * x + (2 * qy * qz + 2 * w * qx) * y + (1 - 2 * qx ** 2 - 2 * qy ** 2) * z
        return {'x':x_rot,'y':y_rot,'z':z_rot}
    def ni_quat_rotate_z(angle_deg):
        angle_rad = degrees_to_radians(angle_deg)
        return [math.cos(angle_rad / 2.0),0,0,math.sin(angle_rad / 2.0)]
    def shun_quat_rotate_z(angle_deg):
        angle_rad = degrees_to_radians(angle_deg)
        return [math.cos(angle_rad / 2.0),0,0,-math.sin(angle_rad / 2.0)]
    def shun_quat_rotate_x(angle_deg):
        angle_rad = degrees_to_radians(angle_deg)
        return [math.cos(angle_rad / 2.0),math.sin(angle_rad / 2.0),0,0]
    def find_distance_fixed(points,beta):
        beta = -beta * math.pi / 180.0 + math.pi / 2.0
        ray_dir = {'x':-math.cos(beta),'y':-math.sin(beta)}
        min_distance = float('inf')
        n = len(points)
        for i in range(n):
            x1,y1,_ = points[i]
            x2,y2,_ = points[(i + 1) % n]
            ab = {'x':x2 - x1,'y':y2 - y1}
            oa = {'x':-x1,'y':-y1}
            denominator = ray_dir['x'] * ab['y'] - ray_dir['y'] * ab['x']
            if denominator == 0:
                continue
            t = (oa['x'] * ab['y'] - oa['y'] * ab['x']) / denominator
            u = (ray_dir['x'] * oa['y'] - ray_dir['y'] * oa['x']) / denominator
            if t < 0 or u < 0 or u > 1:
                continue
            intersection = {'x':ray_dir['x'] * t,'y':ray_dir['y'] * t}
            distance = math.sqrt(intersection['x'] ** 2 + intersection['y'] ** 2)
            min_distance = min(min_distance,distance)
        return None if min_distance == float('inf') else min_distance
    def calc_pos_fixed(h,r,p,init_p):
        pos = copy.deepcopy(init_p)
        beta = r
        angle = p
        n_q_z = ni_quat_rotate_z(beta)
        s_q_z = shun_quat_rotate_z(beta)
        s_q_x = shun_quat_rotate_x(angle)
        np = []
        for i in range(len(init_p)):
            pos[i][2] = 0
            a = apply_quaternion_rotation(pos[i][0],pos[i][1],pos[i][2],n_q_z)
            a = apply_quaternion_rotation(a['x'],a['y'],a['z'],s_q_x)
            a = apply_quaternion_rotation(a['x'],a['y'],a['z'],s_q_z)
            np.append([a['x'],a['y'],a['z']])
        offset = find_distance_fixed(init_p,beta)
        if Baseheight1 != 0 and Baseheight2 == 0:
            if offset != 0:
                pow_val = 1.73 + 0.52 * ((h + Baseheight1) / offset)
                if pow_val > 100:
                    pow_val = 100
                a = offset / math.pow(1.5707963,pow_val)
                offset_t = a * math.pow(abs(angle * math.pi / 180.0),pow_val)
                if offset_t > offset:
                    offset_t = offset
                offset = offset_t * (-1 if angle < 0 else 1)
            for i in range(len(init_p)):
                np[i][0] += math.sin(degrees_to_radians(beta)) * offset
                np[i][1] += math.cos(degrees_to_radians(beta)) * offset
                np[i][2] += init_p[i][2] - h - Baseheight1
        elif Baseheight1 == 0 and Baseheight2 != 0:
            if offset != 0:
                pow_val = 1.73 + 0.52 * ((Baseheight2 + maxheight - h) / offset)
                if pow_val > 100:
                    pow_val = 100
                a = offset / math.pow(1.5707963,pow_val)
                offset_t = a * math.pow(abs(angle * math.pi / 180.0),pow_val)
                if offset_t > offset:
                    offset_t = offset
                offset = offset_t * (-1 if angle < 0 else 1)
            for i in range(len(init_p)):
                np[i][0] += math.sin(degrees_to_radians(beta)) * offset
                np[i][1] += math.cos(degrees_to_radians(beta)) * offset
                np[i][2] += init_p[i][2] + h - Baseheight2 - maxheight
        return np
    pos = calc_pos_fixed(height,roll,pitch,point_init_pos)
    len_list = []
    if Baseheight1 != 0 and Baseheight2 == 0:
        for i in range(len(point_init_pos)):
            distance = math.sqrt((pos[i][0] - point_init_pos[i][0]) ** 2 + (pos[i][1] - point_init_pos[i][1]) ** 2 + (pos[i][2] - point_init_pos[i][2]) ** 2) - Baseheight1
            len_list.append(float(distance))
    elif Baseheight1 == 0 and Baseheight2 != 0:
        for i in range(len(point_init_pos)):
            distance = Baseheight2 + maxheight - math.sqrt((pos[i][0] - point_init_pos[i][0]) ** 2 + (pos[i][1] - point_init_pos[i][1]) ** 2 + (pos[i][2] - point_init_pos[i][2]) ** 2)
            len_list.append(float(distance))
    return len_list
###############################################################################


##########################精简参数读取及格式校验##########################
def load_nearest_position_inputs(source=None):
    """将精简JSON映射到原选点函数参数；source可为文件路径或已解析的字典。

    强制分支使用默认V/A（减速度按当前PLC逻辑取同一A）。
    非强制分支使用最大V/A/D、模型几何及最大电机速度。
    仅强制分支读取loop_once，强制就近读取specified_time_ms；非强制就近读取stopped_time_ms。
    不生效的分支字段不参与计算。JSON说明字段均忽略。
    """
    if source is None:
        source = Path(__file__).resolve().with_name("就近位置参数.json")
    if isinstance(source, dict):
        data = source
    else:
        with open(source, "r", encoding="utf-8") as file:
            data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError("输入JSON最外层必须为对象")
    command = data.get("command")
    items = data.get("models")
    if not isinstance(command, dict):
        raise ValueError("缺少command对象")
    if not isinstance(items, list) or not items:
        raise ValueError("models必须是非空数组")

    for key in ("trajectory_run", "reverse", "nearest_start"):
        if type(command.get(key)) is not bool:
            raise ValueError(f"command.{key}必须明确传true或false")
    trajectory_run = command["trajectory_run"]
    nearest_start = command["nearest_start"]
    direction = -1 if command["reverse"] else 1

    def optional_frame(key):
        """null/省略表示未提供；0是有效帧，不能按真假值判断。"""
        value = command.get(key)
        if value is not None and (type(value) is not int or value < 0):
            raise ValueError(f"command.{key}必须是非负整数毫秒或null")
        return value

    specified = optional_frame("specified_time_ms") if trajectory_run and nearest_start else None
    stopped = optional_frame("stopped_time_ms") if not trajectory_run and nearest_start else None
    # loop_once仍影响强制分支中不同长度模型的时间映射；非强制不循环搜索。
    loop_once = command.get("loop_once", True) if trajectory_run else True
    if type(loop_once) is not bool:
        raise ValueError("command.loop_once必须是bool")

    def number(value, label, nonnegative=False):
        """拒绝布尔值、NaN和无穷大，避免它们被当成运动数据。"""
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{label}必须是数值")
        value = float(value)
        if not math.isfinite(value) or (nonnegative and value < 0):
            raise ValueError(f"{label}必须是有限{'非负' if nonnegative else ''}数值")
        return value

    def vector(value, label, nonnegative=False):
        """所有HPY位置、参数和系数固定为三项数组。"""
        if not isinstance(value, list) or len(value) != 3:
            raise ValueError(f"{label}必须有H/P/Y三项")
        return [number(x, label, nonnegative) for x in value]

    def identifier(value, label):
        """模型编号和段编号使用整数；模型编号正数，段编号允许0。"""
        if type(value) is not int or value < 0:
            raise ValueError(f"{label}必须是非负整数")
        return value

    positions, velocities, default_accelerations = {}, {}, {}
    max_velocities, max_accelerations, max_decelerations = {}, {}, {}
    active_axes, curves = {}, []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("models中的每项必须为对象")
        model_id = identifier(item.get("model_id"), "model_id")
        if model_id == 0 or model_id in positions:
            raise ValueError("model_id必须大于0且不能重复")
        axes = item.get("active_axes")
        if not isinstance(axes, list) or not axes or not all(isinstance(x, str) for x in axes):
            raise ValueError(f"模型{model_id}.active_axes必须为非空轴名数组")
        axes = [axis.upper() for axis in axes]
        if len(set(axes)) != len(axes) or any(axis not in AXIS_NAMES for axis in axes):
            raise ValueError(f"模型{model_id}.active_axes只能包含不重复的H/P/Y")
        positions[model_id] = vector(item.get("current_HPY"), f"模型{model_id}.current_HPY")
        velocities[model_id] = vector(
            item.get("default_velocity_HPY"), f"模型{model_id}.default_velocity_HPY", True)
        max_accelerations[model_id] = vector(
            item.get("max_acceleration_HPY"), f"模型{model_id}.max_acceleration_HPY", True)
        default_accelerations[model_id] = (
            vector(item.get("default_acceleration_HPY"),
                   f"模型{model_id}.default_acceleration_HPY", True)
            if trajectory_run else [0.0, 0.0, 0.0])
        max_velocities[model_id] = (
            vector(item.get("max_velocity_HPY"), f"模型{model_id}.max_velocity_HPY", True)
            if not trajectory_run else [0.0, 0.0, 0.0])
        max_decelerations[model_id] = (
            vector(item.get("max_deceleration_HPY"),
                   f"模型{model_id}.max_deceleration_HPY", True)
            if not trajectory_run else [0.0, 0.0, 0.0])
        active_axes[model_id] = axes

        raw_segments = item.get("segments")
        if not isinstance(raw_segments, list) or not raw_segments:
            raise ValueError(f"模型{model_id}.segments必须是非空数组")
        segments, segment_ids = [], set()
        for raw in raw_segments:
            if not isinstance(raw, dict):
                raise ValueError(f"模型{model_id}每个segment必须为对象")
            segment_id = identifier(raw.get("segment_id"), "segment_id")
            if segment_id in segment_ids:
                raise ValueError(f"模型{model_id}的segment_id重复")
            segment_ids.add(segment_id)
            label = f"模型{model_id}段{segment_id}"
            segment = {
                "segment_id": segment_id,
                "start_frame": number(raw.get("start_frame"), f"{label}.start_frame", True),
                "end_frame": number(raw.get("end_frame"), f"{label}.end_frame", True),
            }
            if segment["end_frame"] <= segment["start_frame"]:
                raise ValueError(f"{label}的end_frame必须大于start_frame")
            for key in ("start_HPY", "target_HPY", "a", "b", "c", "d", "e", "f"):
                segment[key] = vector(raw.get(key), f"{label}.{key}")
            segments.append(segment)
        # 数量及最后时间由segments自动取得，删除原JSON中重复传输的计数字段。
        curve_model = {
            "index": model_id,
            "segment_count": len(segments),
            "total_frames": segments[-1]["end_frame"],
            "segments": segments,
        }
        if not trajectory_run:
            model_type = identifier(item.get("model_type"), f"模型{model_id}.model_type")
            if model_type not in (1, 2, 4, 8):
                raise ValueError(f"模型{model_id}.model_type只支持1、2、4、8")
            motor_num = identifier(item.get("motor_num"), f"模型{model_id}.motor_num")
            max_motor_velocity = number(
                item.get("max_motor_velocity"), f"模型{model_id}.max_motor_velocity", True)
            if motor_num <= 0 or max_motor_velocity <= 0:
                raise ValueError(f"模型{model_id}的motor_num和max_motor_velocity必须大于0")
            curve_model.update({
                "model_type": model_type,
                "motor_num": motor_num,
                "max_motor_velocity": max_motor_velocity,
            })
            if model_type in (2, 4):
                for key in ("BaseHight1", "BaseHight2", "lLenth_inside", "maxheight"):
                    curve_model[key] = number(item.get(key), f"模型{model_id}.{key}", True)
                if model_type == 4:
                    curve_model["wLenth_inside"] = number(
                        item.get("wLenth_inside"), f"模型{model_id}.wLenth_inside", True)
            elif model_type == 8:
                for key in ("Baseheight1", "Baseheight2", "maxheight"):
                    curve_model[key] = number(item.get(key), f"模型{model_id}.{key}", True)
                curve_model["betainit"] = number(item.get("betainit"), f"模型{model_id}.betainit")
                points = item.get("point_init_pos")
                if not isinstance(points, list) or len(points) < 3:
                    raise ValueError(f"模型{model_id}.point_init_pos至少需要三个XYZ吊点")
                curve_model["point_init_pos"] = [
                    vector(point, f"模型{model_id}.point_init_pos") for point in points
                ]
        curves.append(curve_model)

    return {
        "trajectory_run": trajectory_run,
        "nearest_start": nearest_start,
        "direction": direction,
        "loop_once": loop_once,
        "use_specified_time": specified is not None,
        "specified_time_ms": 0 if specified is None else specified,
        "stopped_time_ms": stopped,
        "current_positions": positions,
        "default_velocities": velocities,
        "default_accelerations": default_accelerations,
        "default_decelerations": default_accelerations,
        "max_velocities": max_velocities,
        "max_accelerations": max_accelerations,
        "max_decelerations": max_decelerations,
        "active_axes_by_model": active_axes,
        "curve_action": {"models": curves},
        "coarse_step": COARSE_STEP_MS,
        "fine_step": FINE_STEP_MS,
    }


##########################输出格式：HPY数组保持横向显示##########################
def json_dumps_with_inline_lists(value):
    formatted = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    scalar_list_pattern = re.compile(r"\[\s*([^\[\]{}]*?)\s*\]", re.DOTALL)

    def compact_scalar_list(match):
        try:
            values = json.loads(match.group(0))
        except json.JSONDecodeError:
            return match.group(0)
        if not isinstance(values, list) or any(isinstance(item, (dict, list)) for item in values):
            return match.group(0)
        return json.dumps(values, ensure_ascii=False, separators=(", ", ": "), allow_nan=False)

    return scalar_list_pattern.sub(compact_scalar_list, formatted)


##########################系数求值：位置和每秒曲线速度##########################
def _evaluate_base_action_segment(segment, frame_ms):
    curve_time = (float(frame_ms)-float(segment["start_frame"]))/CURVE_TICK_FRAME
    positions = []
    velocities_per_second = []
    for axis in range(3):
        a, b, c, d, e, f = (
            float(segment[name][axis]) for name in ("a", "b", "c", "d", "e", "f")
        )
        positions.append(((((f*curve_time+e)*curve_time+d)*curve_time+c)*curve_time+b)*curve_time+a)
        velocity_per_curve_tick = (
            ((5.0*f*curve_time+4.0*e)*curve_time+3.0*d)*curve_time+2.0*c
        )*curve_time+b
        # 曲线变量每增加1代表0.1秒，因此换算为每秒速度时乘10。
        velocities_per_second.append(velocity_per_curve_tick*10.0)
    return positions, velocities_per_second


##########################强制轨迹：沿用原就近位置逻辑##########################
def calculate_forced_nearest_position(
    current_positions,
    default_velocities,
    curve_action,
    max_accelerations,
    direction=1,
    loop_once=True,
    nearest_start=True,
    use_specified_time=False,
    specified_time_ms=0,
    active_axes_by_model=None,
    coarse_step=100,
    fine_step=10,
):
    """计算强制轨迹启动位置：非就近取动作边界，就近按CalStartTime规则选点。

    所有时间输入/输出均使用毫秒；selected_time_100ms是PLC的_T值。
    active_axes_by_model必须提供{模型号: ["H", "P", "Y"]}。
    """
    if direction not in (1, -1):
        raise ValueError("direction只能是1(正向)或-1(反向)")
    if (
        not isinstance(loop_once, bool)
        or not isinstance(nearest_start, bool)
        or not isinstance(use_specified_time, bool)
    ):
        raise ValueError("loop_once、nearest_start和use_specified_time必须是bool")
    if float(coarse_step) <= 0.0 or float(fine_step) <= 0.0:
        raise ValueError("搜索步长必须大于0")

    models = curve_action.get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("curve_action.models不能为空")

    # 计算一条曲线分段在指定时刻的H/P/Y位置和曲线速度。
    def calculate_curve_hpy(segment, frame):
        """等价ActionEvalSegment，同时返回位置和对PLC时间单位求导的速度。"""
        t = (float(frame)-float(segment["start_frame"]))/CURVE_TICK_FRAME
        positions = []
        velocities = []
        for axis in range(3):
            a, b, c, d, e, f = (
                float(segment[name][axis]) for name in ("a", "b", "c", "d", "e", "f")
            )
            positions.append(((((f*t+e)*t+d)*t+c)*t+b)*t+a)
            velocities.append((((5.0*f*t+4.0*e)*t+3.0*d)*t+2.0*c)*t+b)
        return positions, velocities

    # 检查模型分段数量、时间连续性、位置连续性和多项式系数。
    def validate_model(model, tolerance=1.0e-5):
        model_id = int(model["index"])
        segments = model.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError(f"模型{model_id}没有segments")
        if int(model.get("segment_count", len(segments))) != len(segments):
            raise ValueError(f"模型{model_id}的segment_count不正确")

        required = (
            "segment_id", "start_frame", "end_frame", "start_HPY", "target_HPY",
            "a", "b", "c", "d", "e", "f",
        )
        previous = None
        for segment_index, segment in enumerate(segments):
            missing = [name for name in required if name not in segment]
            if missing:
                raise ValueError(f"模型{model_id}段{segment_index}缺少字段：{missing}")
            start = float(segment["start_frame"])
            end = float(segment["end_frame"])
            if not math.isfinite(start) or not math.isfinite(end) or end <= start:
                raise ValueError(f"模型{model_id}段{segment_index}时间无效")
            for name in ("start_HPY", "target_HPY", "a", "b", "c", "d", "e", "f"):
                values = segment[name]
                if not isinstance(values, list) or len(values) != 3:
                    raise ValueError(f"模型{model_id}段{segment_index}的{name}必须有三项")
                if not all(math.isfinite(float(value)) for value in values):
                    raise ValueError(f"模型{model_id}段{segment_index}的{name}存在无效数值")

            calculated_start, _ = calculate_curve_hpy(segment, start)
            calculated_end, _ = calculate_curve_hpy(segment, end)
            for axis in range(3):
                if abs(calculated_start[axis]-float(segment["start_HPY"][axis])) > tolerance:
                    raise ValueError(f"模型{model_id}段{segment_index}系数起点不正确")
                if abs(calculated_end[axis]-float(segment["target_HPY"][axis])) > tolerance:
                    raise ValueError(f"模型{model_id}段{segment_index}系数终点不正确")
            if previous is not None:
                if abs(float(previous["end_frame"])-start) > tolerance:
                    raise ValueError(f"模型{model_id}的分段时间不连续")
                for axis in range(3):
                    if abs(float(previous["target_HPY"][axis])-float(segment["start_HPY"][axis])) > tolerance:
                        raise ValueError(f"模型{model_id}的分段位置不连续")
            previous = segment

        total_frames = float(model.get("total_frames", segments[-1]["end_frame"]))
        if abs(float(segments[-1]["end_frame"])-total_frames) > tolerance:
            raise ValueError(f"模型{model_id}最后一段与total_frames不一致")

    # 把JSON中的活动轴名称转换为H/P/Y轴索引。
    def resolve_active_axes(model):
        model_id = int(model["index"])
        if active_axes_by_model is None:
            raise ValueError("必须从JSON提供active_axes_by_model")
        if (
            model_id not in active_axes_by_model and str(model_id) not in active_axes_by_model
        ):
            raise ValueError(f"缺少模型{model_id}的活动轴配置")
        raw_axes = active_axes_by_model.get(model_id, active_axes_by_model.get(str(model_id)))
        if not isinstance(raw_axes, (list, tuple)) or not raw_axes:
            raise ValueError(f"模型{model_id}的active axes不能为空")
        if len(raw_axes) == 3 and all(isinstance(value, bool) for value in raw_axes):
            axes = tuple(index for index, enabled in enumerate(raw_axes) if enabled)
        else:
            axes = []
            for value in raw_axes:
                if isinstance(value, str):
                    name = value.upper()
                    if name not in AXIS_NAMES:
                        raise ValueError(f"模型{model_id}存在未知轴{name}")
                    axis = AXIS_NAMES.index(name)
                else:
                    axis = int(value)
                    if axis not in (0, 1, 2):
                        raise ValueError(f"模型{model_id}存在未知轴索引{axis}")
                if axis not in axes:
                    axes.append(axis)
            axes = tuple(axes)
        if not axes:
            raise ValueError(f"模型{model_id}至少要有一个活动轴")
        return axes

    # 根据正反向和循环方式，把全局时间映射到当前模型的曲线时间。
    def map_frame_to_model(model, global_frame):
        """严格复现PLC：仅循环模式下，正向只包裹右端，反向只包裹左端。"""
        segments = model["segments"]
        first = float(segments[0]["start_frame"])
        last = float(segments[-1]["end_frame"])
        frame = float(global_frame)
        if loop_once:
            return frame
        period = last-first
        if direction > 0 and frame > last:
            remainder = (frame-last) % period
            return last if abs(remainder) <= 1.0e-12 else first+remainder
        if direction < 0 and frame < first:
            remainder = (first-frame) % period
            return first if abs(remainder) <= 1.0e-12 else last-remainder
        return frame

    # 计算单个模型在指定时间的目标位置、曲线速度和所在曲线段。
    def evaluate_model(model, global_frame):
        model_id = int(model["index"])
        segments = model["segments"]
        frame = map_frame_to_model(model, global_frame)
        first = float(segments[0]["start_frame"])
        last = float(segments[-1]["end_frame"])
        if frame <= first:
            segment = segments[0]
            target_hpy = [float(value) for value in segment["start_HPY"]]
            curve_velocity_hpy = [0.0, 0.0, 0.0]
        elif frame >= last:
            segment = segments[-1]
            target_hpy = [float(value) for value in segment["target_HPY"]]
            curve_velocity_hpy = [0.0, 0.0, 0.0]
        else:
            segment = next(
                item for item in segments
                if float(item["start_frame"]) <= frame < float(item["end_frame"])
            )
            target_hpy, curve_velocity_hpy = calculate_curve_hpy(segment, frame)
        return frame, segment, target_hpy, curve_velocity_hpy

    model_axes = {}
    for model in models:
        model_id = int(model["index"])
        if model_id not in current_positions:
            raise ValueError(f"缺少模型{model_id}的当前位置")
        if model_id not in default_velocities:
            raise ValueError(f"缺少模型{model_id}的正常速度")
        if model_id not in max_accelerations:
            raise ValueError(f"缺少模型{model_id}的最大加速度")
        for field_name, values in (
            ("当前位置", current_positions[model_id]),
            ("正常速度", default_velocities[model_id]),
            ("最大加速度", max_accelerations[model_id]),
        ):
            if not isinstance(values, (list, tuple)) or len(values) != 3:
                raise ValueError(f"模型{model_id}的{field_name}必须有H/P/Y三项")
            if not all(math.isfinite(float(value)) for value in values):
                raise ValueError(f"模型{model_id}的{field_name}存在无效数值")
        validate_model(model)
        model_axes[model_id] = resolve_active_axes(model)
        for axis in model_axes[model_id]:
            if float(default_velocities[model_id][axis]) <= 0.0:
                raise ValueError(f"模型{model_id}的{AXIS_NAMES[axis]}轴正常速度必须大于0")
            if float(max_accelerations[model_id][axis]) <= 0.0:
                raise ValueError(f"模型{model_id}的{AXIS_NAMES[axis]}轴最大加速度必须大于0")

    global_start = min(float(model["segments"][0]["start_frame"]) for model in models)
    global_end = max(float(model["segments"][-1]["end_frame"]) for model in models)

    # 汇总所有模型在指定时间的位置，并计算该时间点是否适合接入。
    def evaluate_frame(global_frame):
        max_move_time = 0.0
        max_delta = 0.0
        safe = True
        model_results = []
        for model in models:
            model_id = int(model["index"])
            model_frame, segment, target_hpy, curve_velocity_hpy = evaluate_model(model, global_frame)
            active_axes = model_axes[model_id]
            axis_results = []
            plc_pos_set = [0.0, 0.0, 0.0]
            for axis in active_axes:
                current = float(current_positions[model_id][axis])
                target = float(target_hpy[axis])
                normal_velocity = float(default_velocities[model_id][axis])
                max_acceleration = float(max_accelerations[model_id][axis])
                curve_velocity = float(curve_velocity_hpy[axis])
                delta = abs(target-current)
                move_time = delta/normal_velocity
                allowed_delta = curve_velocity*curve_velocity/(2.0*max_acceleration)
                axis_safe = delta <= allowed_delta
                max_move_time = max(max_move_time, move_time)
                max_delta = max(max_delta, delta)
                safe = safe and axis_safe
                plc_pos_set[axis] = target
                axis_results.append({
                    "axis": AXIS_NAMES[axis],
                    "current": current,
                    "target": target,
                    "delta": delta,
                    "normal_velocity": normal_velocity,
                    "estimated_move_time": move_time,
                    "curve_velocity_per_100ms": curve_velocity,
                    "max_acceleration": max_acceleration,
                    "allowed_delta": allowed_delta,
                    "safe": axis_safe,
                })
            model_results.append({
                "model_id": model_id,
                "model_frame": model_frame,
                "segment_id": int(segment["segment_id"]),
                "active_axes": [AXIS_NAMES[axis] for axis in active_axes],
                "current_HPY": [float(value) for value in current_positions[model_id]],
                "target_HPY": [float(value) for value in target_hpy],
                "curve_velocity_HPY_per_100ms": [float(value) for value in curve_velocity_hpy],
                "plc_PosSet_HPY": plc_pos_set,
                "axes": axis_results,
            })
        return {
            "global_frame": float(global_frame),
            "selected_time_ms": float(global_frame),
            "TargetFrame_ms": float(global_frame),
            "selected_time_100ms": float(global_frame)/CURVE_TICK_FRAME,
            "_T": float(global_frame)/CURVE_TICK_FRAME,
            "estimated_move_time": max_move_time,
            "lrMaxDelta": max_delta,
            "xSafe": safe,
            "PosSet": {
                item["model_id"]: list(item["plc_PosSet_HPY"])
                for item in model_results
            },
            "model_auto_execute": {
                item["model_id"]: True for item in model_results
            },
            "models": model_results,
        }

    # 强制轨迹非就近启动不搜索当前位置：正向从动作第一帧开始，反向从最后一帧开始。
    if not nearest_start:
        best = evaluate_frame(global_start if direction > 0 else global_end)
        start_mode = "action_boundary"
    elif use_specified_time:
        specified = float(specified_time_ms)
        if (
            not math.isfinite(specified)
            or not specified.is_integer()
            or specified < 0.0
            or specified > global_end
        ):
            raise ValueError(f"specified_time_ms必须在0到{global_end}之间且为整数毫秒")
        best = evaluate_frame(specified)
        start_mode = "nearest"
    else:
        # 按给定步长扫描时间范围，保留移动时间最短的位置。
        def scan(start, end, step, best):
            frame = float(start)
            epsilon = abs(float(step))*1.0e-9
            while (step > 0 and frame <= end+epsilon) or (step < 0 and frame >= end-epsilon):
                candidate = evaluate_frame(frame)
                # PLC使用严格小于号；同分时保留运行方向上先扫描到的点。
                if best is None or candidate["estimated_move_time"] < best["estimated_move_time"]:
                    best = candidate
                frame += step
            return best

        if direction > 0:
            best = scan(global_start, global_end, float(coarse_step), None)
        else:
            best = scan(global_end, global_start, -float(coarse_step), None)
        fine_start = max(global_start, best["global_frame"]-float(coarse_step))
        fine_end = min(global_end, best["global_frame"]+float(coarse_step))
        if direction > 0:
            best = scan(fine_start, fine_end, float(fine_step), best)
        else:
            best = scan(fine_end, fine_start, -float(fine_step), best)
        start_mode = "nearest"

    best.update({
        "direction": direction,
        "loop_once": loop_once,
        "nearest_start": nearest_start,
        "StartMode": start_mode,
        "use_specified_time": use_specified_time,
        "search_range_ms": [global_start, global_end],
        "coarse_step_ms": float(coarse_step),
        "fine_step_ms": float(fine_step),
        "metric": "max(abs(target-current)/normal_velocity)",
    })
    return best


##########################非强制轨迹：沿用原共同候选帧逻辑##########################
def calculate_non_forced_candidate_positions(inputs):
    """返回非强制轨迹的共同搜索起点、候选帧以及各候选帧的PosSet。

    有停止帧时直接从停止帧沿运行方向寻找公共关键帧；没有停止帧时，先根据所有
    模型当前位置搜索最近的共同曲线时间。所有模型始终使用同一个候选时间。
    """
    curve_action = inputs["curve_action"]
    direction = inputs["direction"]
    nearest_start = inputs.get("nearest_start", True)
    stopped_time_ms = inputs.get("stopped_time_ms")
    if direction not in (1, -1):
        raise ValueError("direction只能是1(正向)或-1(反向)")
    if type(nearest_start) is not bool:
        raise ValueError("nearest_start必须是bool")
    if stopped_time_ms is not None:
        if isinstance(stopped_time_ms, bool):
            raise ValueError("stopped_time_ms必须是非负整数毫秒或null")
        stopped_time_ms = float(stopped_time_ms)
        if not math.isfinite(stopped_time_ms) or not stopped_time_ms.is_integer() or stopped_time_ms < 0:
            raise ValueError("stopped_time_ms必须是非负整数毫秒或null")

    models = curve_action.get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("curve_action.models不能为空")
    boundaries = set()
    model_segments = {}
    position_tolerance = 1.0e-5

    # 先校验整个动作。允许时间空档，但空档前后的位置必须与“原地保持”一致。
    for model in models:
        model_id = int(model["index"])
        if model_id in model_segments:
            raise ValueError(f"模型{model_id}重复")
        segments = model.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError(f"模型{model_id}没有segments")
        previous = None
        for segment in segments:
            start = float(segment["start_frame"])
            end = float(segment["end_frame"])
            if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
                raise ValueError(f"模型{model_id}存在无效分段时间")
            for name in ("start_HPY", "target_HPY", "a", "b", "c", "d", "e", "f"):
                values = segment.get(name)
                if not isinstance(values, (list, tuple)) or len(values) != 3:
                    raise ValueError(f"模型{model_id}的{name}必须有H/P/Y三项")
                if not all(math.isfinite(float(value)) for value in values):
                    raise ValueError(f"模型{model_id}的{name}存在非有限值")
            for frame, field in ((start, "start_HPY"), (end, "target_HPY")):
                calculated, _ = _evaluate_base_action_segment(segment, frame)
                if any(not math.isfinite(value) or abs(value-float(expected)) > position_tolerance
                       for value, expected in zip(calculated, segment[field])):
                    raise ValueError(f"模型{model_id}在{frame}ms的段端位置与系数不一致")
            if previous is not None:
                if start < float(previous["end_frame"]):
                    raise ValueError(f"模型{model_id}的曲线段重叠或未按时间排序")
                if any(abs(float(a)-float(b)) > position_tolerance
                       for a, b in zip(previous["target_HPY"], segment["start_HPY"])):
                    raise ValueError(f"模型{model_id}相邻段或空档前后的位置不连续")
            boundaries.update((start, end))
            previous = segment
        model_segments[model_id] = segments

    global_start = min(boundaries)
    global_end = max(boundaries)
    if stopped_time_ms is not None and stopped_time_ms > global_end:
        raise ValueError(f"stopped_time_ms必须在0到{global_end}之间")

    # 公共取点规则：段前保持初始位置，段间/段后保持最近一个已结束段的终点。
    def positions_at(frame):
        positions = {}
        for model_id, segments in model_segments.items():
            target = [float(value) for value in segments[0]["start_HPY"]]
            for segment in segments:
                start, end = float(segment["start_frame"]), float(segment["end_frame"])
                if frame < start:
                    break
                if frame >= end:
                    target = [float(value) for value in segment["target_HPY"]]
                    continue
                target, _ = _evaluate_base_action_segment(segment, frame)
                break
            if not all(math.isfinite(value) for value in target):
                raise ValueError(f"模型{model_id}在{frame}ms的位置计算非有限")
            positions[model_id] = target
        return positions

    # 非就近启动只有一个边界候选：正向第一帧，反向最后一帧。
    if not nearest_start:
        target_frame = global_start if direction > 0 else global_end
        return {
            "stopped_time_ms": None if stopped_time_ms is None else int(stopped_time_ms),
            "SearchOriginFrame_ms": target_frame,
            "StartMode": "action_boundary",
            "direction": direction,
            "CandidateFrames_ms": [target_frame],
            "Candidates": [{
                "TargetFrame_ms": target_frame,
                "PosSet": positions_at(target_frame),
            }],
        }

    # 未传停止帧时，所有模型一起搜索同一个曲线时间；关键帧也加入，避免漏掉短段。
    search_origin = stopped_time_ms
    if search_origin is None:
        best_score = math.inf
        for step, radius in ((inputs["coarse_step"], None), (inputs["fine_step"], inputs["coarse_step"])):
            left = 0.0 if radius is None else max(0.0, search_origin-radius)
            right = global_end if radius is None else min(global_end, search_origin+radius)
            frames = {left, right}
            frames.update(frame for frame in boundaries if left <= frame <= right)
            frames.update(left+i*step for i in range(int((right-left)/step)+1))
            for frame in sorted(frames, reverse=direction < 0):
                positions = positions_at(frame)
                score = 0.0
                for model_id in model_segments:
                    for name in inputs["active_axes_by_model"][model_id]:
                        axis = AXIS_NAMES.index(name)
                        delta = abs(positions[model_id][axis]-inputs["current_positions"][model_id][axis])
                        normal_velocity = inputs["default_velocities"][model_id][axis]
                        # 静止轴代价为0；需要位移但正常速度为0的候选不用于定位。
                        if delta <= 1.0e-12:
                            move_time = 0.0
                        else:
                            move_time = delta/normal_velocity if normal_velocity > 0 else math.inf
                        score = max(score, move_time)
                if score < best_score:
                    best_score, search_origin = score, frame
            if search_origin is None:
                raise ValueError("无法搜索最近曲线时间：正常速度为0或定位计算超出数值范围")

    # 给定停止帧恰好位于公共关键帧时先使用当前帧；位于两帧之间才沿方向取下一帧。
    # 未给停止帧时，搜索所得时间只是定位起点，仍沿运行方向取下一个公共关键帧。
    given_frame_is_boundary = (
        stopped_time_ms is not None
        and any(abs(frame-search_origin) <= 1.0e-9 for frame in boundaries)
    )
    candidates = sorted(
        (
            frame for frame in boundaries
            if (frame-search_origin)*direction >= -1.0e-9
            if given_frame_is_boundary or abs(frame-search_origin) > 1.0e-9
        ),
        reverse=direction < 0,
    )
    if not candidates:
        terminal = max(boundaries) if direction > 0 else min(boundaries)
        if abs(search_origin-terminal) > 1.0e-9:
            raise ValueError("当前方向没有候选关键帧，不选择反方向帧")
        candidates = [terminal]
    candidate_positions = [
        {
            "TargetFrame_ms": target_frame,
            "PosSet": positions_at(target_frame),
        }
        for target_frame in candidates
    ]
    return {
        "stopped_time_ms": None if stopped_time_ms is None else int(stopped_time_ms),
        "SearchOriginFrame_ms": float(search_origin),
        "StartMode": "nearest",
        "direction": direction,
        "CandidateFrames_ms": [float(frame) for frame in candidates],
        "Candidates": candidate_positions,
        "NearestMetric": "max(abs(target-current)/normal_velocity)",
    }


##########################第二步：从当前位置到目标位置的运动参数##########################
def _minimum_motion_profile(distance, velocity, acceleration, deceleration):
    """返回点到点梯形/三角形速度曲线的峰值速度和总时间（秒）。"""
    distance = abs(float(distance))
    if not all(math.isfinite(float(value)) for value in (distance, velocity, acceleration, deceleration)):
        raise ValueError("位移和V/A/D必须是有限数值")
    if distance <= 1.0e-12:
        return 0.0, 0.0
    velocity = float(velocity)
    acceleration = float(acceleration)
    deceleration = float(deceleration)
    if min(velocity, acceleration, deceleration) <= 0.0:
        raise ValueError("有位移的活动轴速度、加速度、减速度必须都大于0")
    acceleration_distance = velocity*velocity/(2.0*acceleration)
    deceleration_distance = velocity*velocity/(2.0*deceleration)
    if acceleration_distance+deceleration_distance <= distance:
        cruise_distance = distance-acceleration_distance-deceleration_distance
        return velocity, velocity/acceleration+cruise_distance/velocity+velocity/deceleration
    peak = math.sqrt(2.0*distance*acceleration*deceleration/(acceleration+deceleration))
    return peak, peak/acceleration+peak/deceleration
##########################公共辅助：按k/k²缩放运动参数#########################
# 按时间比例k缩放整条运动曲线：速度乘k，加速度和减速度乘k的平方。
def _scale_motion_parameters(velocity, acceleration, deceleration, scale):
    """返回按时间比例缩放后的速度、加速度和减速度。"""
    scale = float(scale)
    if not math.isfinite(scale) or scale <= 0.0 or scale > 1.0+1.0e-12:
        raise ValueError("运动参数缩放比例k必须大于0且不超过1")
    scale = min(scale, 1.0)
    scale_squared = scale*scale
    return (
        float(velocity)*scale,
        float(acceleration)*scale_squared,
        float(deceleration)*scale_squared,
    )
##########################内部计算：强制轨迹到起点运动#########################
# 对应PLC的curveMotionControl + CheckPreparedPosition：各模型独立到位，先到的等待，全部到位后才启动时间主轴。
def calculate_forced_motion(nearest_position_result, inputs):
    """计算强制轨迹启动前的独立Move参数和等待时间。

    这里故意不把各轴按最慢轴做 k/k² 同步：PLC使用每轴默认V/A/D到位，
    CheckPreparedPosition等待全部模型静止且位置正确后，再统一启动轨迹时间主轴。
    强制轨迹分支不做上位机虚轴或实电机超速判定，限速和保护交给PLC模型逻辑。
    """
    if not inputs["trajectory_run"]:
        raise ValueError("calculate_forced_motion只用于trajectory_run=true的强制轨迹")
    models = {int(model["index"]): model for model in inputs["curve_action"]["models"]}
    targets = nearest_position_result.get("PosSet")
    if not isinstance(targets, dict) or set(targets) != set(models):
        raise ValueError("强制轨迹目标位置必须包含本动作的全部模型")

    velocity_set = {}
    peak_velocity_set = {}
    axis_arrival_times = {}
    model_arrival_times = {}

    for model_id in models:
        current = inputs["current_positions"][model_id]
        target = targets[model_id]
        if len(current) != 3 or len(target) != 3 or not all(
            math.isfinite(float(value)) for value in (*current, *target)
        ):
            raise ValueError(f"模型{model_id}的强制轨迹起终点必须是有限H/P/Y三项")

        active_axes = [AXIS_NAMES.index(name) for name in inputs["active_axes_by_model"][model_id]]
        default_velocity = inputs["default_velocities"][model_id]
        default_acceleration = inputs["default_accelerations"][model_id]
        # 当前PLC工程的Move使用Deceleration := vAxis_Acc，默认减速也取accNormal。
        # 因此到位时间和下发预览都必须使用默认A作为D，不能另取JSON中的默认D。
        default_deceleration = default_acceleration

        velocities = [0.0, 0.0, 0.0]
        accelerations = [0.0, 0.0, 0.0]
        decelerations = [0.0, 0.0, 0.0]
        peak_velocities = [0.0, 0.0, 0.0]
        arrival_times = [0.0, 0.0, 0.0]

        for axis in active_axes:
            distance = abs(float(target[axis])-float(current[axis]))
            velocity = float(default_velocity[axis])
            acceleration = float(default_acceleration[axis])
            deceleration = float(default_deceleration[axis])
            if distance <= 1.0e-12:
                continue
            if min(velocity, acceleration, deceleration) <= 0.0:
                raise ValueError(f"模型{model_id}的{AXIS_NAMES[axis]}轴默认V/A/D必须大于0")

            peak, arrival_time = _minimum_motion_profile(
                distance, velocity, acceleration, deceleration,
            )
            velocities[axis] = velocity
            accelerations[axis] = acceleration
            decelerations[axis] = deceleration
            peak_velocities[axis] = peak
            arrival_times[axis] = arrival_time

        velocity_set[model_id] = {
            "velocity_HPY": velocities,
            "acceleration_HPY": accelerations,
            "deceleration_HPY": decelerations,
        }
        peak_velocity_set[model_id] = peak_velocities
        axis_arrival_times[model_id] = arrival_times
        model_arrival_times[model_id] = max(arrival_times)

    # PLC不要求同时到达：先到的模型保持不动，直到最慢模型到位。
    ready_time = max(model_arrival_times.values(), default=0.0)
    wait_times = {
        model_id: max(0.0, ready_time-arrival_time)
        for model_id, arrival_time in model_arrival_times.items()
    }
    if not math.isfinite(ready_time) or any(not math.isfinite(value) for value in wait_times.values()):
        raise ValueError("强制轨迹准备时间超出数值范围")

    return {
        "PosSet": targets,
        "VelSet": velocity_set,
        "PeakVelocity_HPY": peak_velocity_set,
        "AxisArrivalTime_s": axis_arrival_times,
        "ModelArrivalTime_s": model_arrival_times,
        "ModelWaitTime_s": wait_times,
        "TargetFrame_ms": nearest_position_result["selected_time_ms"],
        "StartMode": nearest_position_result.get("StartMode", "nearest"),
        "_T": nearest_position_result["_T"],
        "xSafe": nearest_position_result["xSafe"],
        "MaxRunTime_s": ready_time,
        "ArrivalMode": "independent_then_wait",
        "StartCurveTogether": True,
    }


def calculate_non_forced_motion(nearest_position_result, inputs):
    """规划停稳后的零速起止Move：HPY不超限、单调不越过目标、移动轴同时到达。

    电机检查使用几何导数上界，不依赖离散采样恰好采中峰值，结果可能偏保守。
    这里检查HPY加减速度和实际电机速度，不替代PLC的行程、碰撞、急停保护。
    """
    if inputs["trajectory_run"]:
        raise ValueError("calculate_non_forced_motion只用于trajectory_run=false的非强制轨迹")

    profiles = {}
    minimum_times = []
    models = {int(model["index"]): model for model in inputs["curve_action"]["models"]}
    if set(nearest_position_result["PosSet"]) != set(models):
        raise ValueError("目标位置必须包含本动作的全部模型")

    # 第一步：根据当前实际位置和最大参数，为每个活动轴求最短零速起止运动。
    for model_id, target in nearest_position_result["PosSet"].items():
        current = inputs["current_positions"][model_id]
        if len(current) != 3 or len(target) != 3 or not all(math.isfinite(float(value)) for value in (*current, *target)):
            raise ValueError(f"模型{model_id}的起终点必须是有限H/P/Y三项")
        axes = [AXIS_NAMES.index(name) for name in inputs["active_axes_by_model"][model_id]]
        if any(abs(float(target[axis])-float(current[axis])) > 1.0e-5
               for axis in range(3) if axis not in axes):
            raise ValueError(f"模型{model_id}的非活动轴无法到达此目标")
        velocity_limits = inputs["max_velocities"][model_id]
        acceleration_limits = inputs["max_accelerations"][model_id]
        deceleration_limits = inputs["max_decelerations"][model_id]
        axis_profiles = {}
        for axis in axes:
            distance = abs(float(target[axis])-float(current[axis]))
            velocity_limit = float(velocity_limits[axis])
            acceleration = float(acceleration_limits[axis])
            deceleration = float(deceleration_limits[axis])
            peak, total_time = _minimum_motion_profile(
                distance,
                velocity_limit,
                acceleration,
                deceleration,
            )
            if not math.isfinite(peak) or not math.isfinite(total_time):
                raise ValueError(f"模型{model_id}的运动计算超出数值范围")
            if distance > 1.0e-12 and (peak <= 0 or total_time <= 0):
                raise ValueError(f"模型{model_id}的非零位移运动参数过小，超出数值范围")

            axis_profiles[axis] = {
                "distance": distance,
                "peak": peak,
                "time": total_time,
                "acceleration": acceleration,
                "deceleration": deceleration,
            }
            minimum_times.append(total_time)
        profiles[model_id] = axis_profiles

    # 第二步：按最慢轴的耗时同步。停留轴输出零参数，不对0/0做时间缩放。
    synchronized_time = max(minimum_times, default=0.0)
    velocity_set = {}
    for model_id, axis_profiles in profiles.items():
        velocities = [0.0, 0.0, 0.0]
        accelerations = [0.0, 0.0, 0.0]
        decelerations = [0.0, 0.0, 0.0]
        for axis, profile in axis_profiles.items():
            if profile["distance"] <= 1.0e-12:
                continue
            velocity = profile["peak"]
            acceleration = profile["acceleration"]
            deceleration = profile["deceleration"]

            if synchronized_time > profile["time"]:
                # 例如原来需要2秒、同步时间为5秒：k=2/5，速度乘k，加减速度乘k²。
                synchronization_scale = profile["time"]/synchronized_time
                velocity, acceleration, deceleration = _scale_motion_parameters(
                    velocity,
                    acceleration,
                    deceleration,
                    synchronization_scale,
                )
            if not all(math.isfinite(value) and value > 0 for value in (velocity, acceleration, deceleration)):
                raise ValueError(f"模型{model_id}同步后的移动轴V/A/D超出数值范围")
            velocities[axis] = velocity
            accelerations[axis] = acceleration
            decelerations[axis] = deceleration
        velocity_set[model_id] = {
            "velocity_HPY": velocities,
            "acceleration_HPY": accelerations,
            "deceleration_HPY": decelerations,
        }

    # 第三步：为新过渡路径求实际电机速度上界。绳长变化率不超过吊点空间速度。
    # 两点/四点：高度平移 + 旋转 + 原正解中的三次偏移；四点整段只允许一个倾斜方向。
    # 多点：凸吊点多边形半径r的角度导数 <= R²/rmin，覆盖所有边切换和偏移饱和位置。
    motor_checks = {}
    motor_scale = 1.0
    radians_per_degree = math.pi/180.0
    for model_id, model in models.items():
        current = [float(value) for value in inputs["current_positions"][model_id]]
        target = [float(value) for value in nearest_position_result["PosSet"][model_id]]
        vh, vp, vy = velocity_set[model_id]["velocity_HPY"]
        model_type = int(model["model_type"])
        limit = float(model["max_motor_velocity"])
        if not math.isfinite(limit) or limit <= 0:
            raise ValueError(f"模型{model_id}的最大电机速度必须为有限正数")
        if model_type not in (1, 2, 4, 8):
            raise ValueError(f"模型{model_id}类型{model_type}不受支持")

        if model_type == 1:
            if vp > 0 or vy > 0:
                raise ValueError(f"单点模型{model_id}只支持H轴位移")
            count = int(model["motor_num"])
            bound = vh
            endpoints = [dandian_forward_model(pose[0], count) for pose in (current, target)]
        else:
            base_names = ("Baseheight1", "Baseheight2") if model_type == 8 else ("BaseHight1", "BaseHight2")
            fields = (*base_names, "maxheight")
            if model_type in (2, 4):
                fields += ("lLenth_inside",)
                if model_type == 4:
                    fields += ("wLenth_inside",)
            else:
                fields += ("betainit",)
            if any(name not in model or not math.isfinite(float(model[name])) for name in fields):
                raise ValueError(f"模型{model_id}的几何参数缺失或非有限")
            base1, base2 = (float(model[name]) for name in base_names)
            max_height = float(model["maxheight"])
            if not ((base1 > 0 and base2 == 0) or (base1 == 0 and base2 > 0)) or max_height <= 0:
                raise ValueError(f"模型{model_id}必须恰有一个正基准高度，且maxheight大于0")

            if model_type in (2, 4):
                length = float(model["lLenth_inside"])
                width = float(model["wLenth_inside"]) if model_type == 4 else length
                if min(length, width) <= 0:
                    raise ValueError(f"模型{model_id}吊点间距必须大于0")
                tilt_axis = 1
                if model_type == 2:
                    if vy > 0:
                        raise ValueError(f"两点模型{model_id}不支持Y轴位移")
                    endpoints = [liangdian_forward_model(pose[0], pose[1], base1, base2, length, max_height)
                                 for pose in (current, target)]
                else:
                    p_tilt = any(abs(pose[1]) > 1.0e-10 for pose in (current, target))
                    y_tilt = any(abs(pose[2]) > 1.0e-10 for pose in (current, target))
                    if p_tilt and y_tilt:
                        raise ValueError(f"四点模型{model_id}当前正解不支持P/Y混合倾斜过渡")
                    move_what = 1 if p_tilt else 2 if y_tilt else 0
                    tilt_axis = 2 if y_tilt else 1
                    endpoints = [sidian_forward_model(*pose, base1, base2, length, width, max_height, move_what)
                                 for pose in (current, target)]
                count = model_type
                if int(model.get("motor_num", count)) != count:
                    raise ValueError(f"模型{model_id}的motor_num与模型类型不一致")
                half_span = (length if tilt_axis == 1 else width)/2.0
                angle = max(abs(current[tilt_axis]), abs(target[tilt_axis]))
                angular_speed = vp if tilt_axis == 1 else vy
                bound = vh+(half_span*radians_per_degree+3.0*half_span*angle**2/90.0**3)*angular_speed
            else:
                points = model.get("point_init_pos")
                if not isinstance(points, list) or len(points) < 3 or any(
                    not isinstance(point, (list, tuple)) or len(point) != 3
                    or not all(math.isfinite(float(value)) for value in point) for point in points
                ):
                    raise ValueError(f"多点模型{model_id}需要至少三个有限XYZ吊点")
                points = [[float(value) for value in point] for point in points]
                count = len(points)
                if int(model.get("motor_num", count)) != count:
                    raise ValueError(f"模型{model_id}的motor_num与吊点数不一致")
                radius = max(math.hypot(point[0], point[1]) for point in points)
                if radius <= 1.0e-12 or len({tuple(point[:2]) for point in points}) != count:
                    raise ValueError(f"多点模型{model_id}吊点平面退化或重复")
                area = sum(p[0]*q[1]-p[1]*q[0] for p, q in zip(points, points[1:]+points[:1]))
                orientation = 1.0 if area > 0 else -1.0
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
                effective_heights = [pose[0]+base1 if base1 > 0 else base2+max_height-pose[0]
                                     for pose in (current, target)]
                if min(effective_heights) < 0:
                    raise ValueError(f"多点模型{model_id}过渡的有效高度不能为负")
                n_min = min(100.0, 1.73+0.52*min(effective_heights)/radius)
                n_max = min(100.0, 1.73+0.52*max(effective_heights)/min_radius)
                c_h = 0.52/(math.e*n_min)
                c_p = radius*n_max*radians_per_degree/1.5707963
                c_r = 1.0+(n_max-1.73)/(math.e*n_min)
                bound = ((1.0+c_h)*vh+(radius*radians_per_degree+c_p)*vp
                         +(3.0*radius+c_r*radius**2/min_radius)*radians_per_degree*vy)
                try:
                    endpoints = [duodian_forward_model(*pose, points, base1, base2, max_height, float(model["betainit"]))
                                 for pose in (current, target)]
                except (TypeError, ValueError, ArithmeticError) as exc:
                    raise ValueError(f"多点模型{model_id}端点正解失败：{exc}") from exc

        if count <= 0 or any(not isinstance(values, (list, tuple)) or len(values) != count
                             or not all(math.isfinite(float(value)) for value in values) for values in endpoints):
            raise ValueError(f"模型{model_id}端点正解未返回有效电机位置")
        if not math.isfinite(bound) or bound < 0:
            raise ValueError(f"模型{model_id}的电机速度上界无效")
        if bound > 0:
            motor_scale = min(motor_scale, limit/(bound*(1.0+1.0e-9)))
        motor_checks[model_id] = {"limit": limit, "upper_bound": bound}

    # 第四步：若实轴上界超限，所有模型共同乘同一个k，不能各自降速破坏同步。
    if motor_scale < 1.0:
        for parameters in velocity_set.values():
            for axis in range(3):
                velocity, acceleration, deceleration = _scale_motion_parameters(
                    parameters["velocity_HPY"][axis], parameters["acceleration_HPY"][axis],
                    parameters["deceleration_HPY"][axis], motor_scale,
                )
                if parameters["velocity_HPY"][axis] > 0 and min(velocity, acceleration, deceleration) <= 0:
                    raise ValueError("电机限速要求的参数过小，超出浮点可计算范围")
                parameters["velocity_HPY"][axis] = velocity
                parameters["acceleration_HPY"][axis] = acceleration
                parameters["deceleration_HPY"][axis] = deceleration
        synchronized_time /= motor_scale
        if not math.isfinite(synchronized_time):
            raise ValueError("限速后的运行时间超出数值范围")
    for check in motor_checks.values():
        check["upper_bound"] *= motor_scale

    return {
        "PosSet": nearest_position_result["PosSet"],
        "VelSet": velocity_set,
        "stopped_time_ms": nearest_position_result.get("stopped_time_ms"),
        "SearchOriginFrame_ms": nearest_position_result.get("SearchOriginFrame_ms", nearest_position_result.get("stopped_time_ms")),
        "TargetFrame_ms": nearest_position_result["TargetFrame_ms"],
        "StartMode": nearest_position_result.get("StartMode", "nearest"),
        # 实际Move到位速度为0，不能把原曲线导数冒充本次接入末速。
        "TargetVelocity_HPY_per_s": {model_id: [0.0, 0.0, 0.0] for model_id in profiles},
        # 从当前位置运行到目标位置所需的最大时间，单位为秒。
        "MaxRunTime_s": synchronized_time,
        "MotorLimitScale": motor_scale,
        "MotorSpeedCheck": motor_checks,
    }


##########################非强制轨迹最终运动参数计算#########################
# 第二步按候选顺序计算同步Move；V/A/D或模型正解不可执行时继续尝试下一个候选。
def calculate_non_forced_motion_parameters(candidate_position_result, inputs):
    """根据第一步候选结果，返回第一个可执行目标的精简PLC运动参数。"""
    candidates = candidate_position_result.get("Candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("非强制轨迹没有可用于运动计算的候选帧")

    rejected = []
    for candidate_position in candidates:
        candidate = {
            "stopped_time_ms": candidate_position_result.get("stopped_time_ms"),
            "SearchOriginFrame_ms": candidate_position_result.get("SearchOriginFrame_ms"),
            "TargetFrame_ms": candidate_position["TargetFrame_ms"],
            "StartMode": candidate_position_result.get("StartMode", "nearest"),
            "PosSet": candidate_position["PosSet"],
        }
        try:
            motion = calculate_non_forced_motion(candidate, inputs)
        except (ValueError, ArithmeticError) as exc:
            rejected.append({
                "TargetFrame_ms": candidate_position["TargetFrame_ms"],
                "reason": str(exc),
            })
            continue

        model_results = {}
        for model_id in sorted(motion["PosSet"]):
            parameters = motion["VelSet"][model_id]
            model_results[model_id] = {
                "position_HPY": motion["PosSet"][model_id],
                "velocity_HPY": parameters["velocity_HPY"],
                "acceleration_HPY": parameters["acceleration_HPY"],
                "deceleration_HPY": parameters["deceleration_HPY"],
            }
        return {
            "TargetFrame_ms": motion["TargetFrame_ms"],
            "Models": model_results,
            "MaxRunTime_s": motion["MaxRunTime_s"],
        }

    reasons = "; ".join(
        f"{item['TargetFrame_ms']}ms: {item['reason']}" for item in rejected
    )
    raise ValueError(f"非强制轨迹没有可执行的候选帧：{reasons}")


###############################################################################
# 主流程：第一步选位置，第二步计算到目标位置的V/A/D和时间。
###############################################################################
if __name__ == "__main__":
    inputs = load_nearest_position_inputs()

    if inputs["trajectory_run"]:
        # 第一步：选择公共曲线时间和目标位置。
        position_result = calculate_forced_nearest_position(
            current_positions=inputs["current_positions"],
            default_velocities=inputs["default_velocities"],
            curve_action=inputs["curve_action"],
            max_accelerations=inputs["max_accelerations"],
            direction=inputs["direction"],
            loop_once=inputs["loop_once"],
            nearest_start=inputs["nearest_start"],
            use_specified_time=inputs["use_specified_time"],
            specified_time_ms=inputs["specified_time_ms"],
            active_axes_by_model=inputs["active_axes_by_model"],
            coarse_step=inputs["coarse_step"],
            fine_step=inputs["fine_step"],
        )
        print("一、强制轨迹目标位置：")
        print(json_dumps_with_inline_lists({
            "TargetFrame_ms": position_result["TargetFrame_ms"],
            "PosSet": position_result["PosSet"],
            "StartMode": position_result["StartMode"],
            "xSafe": position_result["xSafe"],
        }))

        # 第二步：各模型按默认V/A/D独立到位，先到的等待。
        motion_result = calculate_forced_motion(position_result, inputs)
        print("二、强制轨迹到位速度、加减速度和时间：")
        print(json_dumps_with_inline_lists(motion_result))
    else:
        # 第一步：按方向生成公共候选帧及各模型目标位置。
        position_result = calculate_non_forced_candidate_positions(inputs)
        print("一、非强制轨迹候选帧和位置：")
        print(json_dumps_with_inline_lists(position_result))

        # 第二步：依次验证候选帧，计算同步V/A/D、电机限速和运行时间。
        motion_result = calculate_non_forced_motion_parameters(position_result, inputs)
        print("二、非强制轨迹同步速度、加减速度和时间：")
        print(json_dumps_with_inline_lists(motion_result))


######################################第一、第二步流程#######################################
"""
读取command及models
        ↓
trajectory_run=true：强制轨迹
    nearest_start=false → 正向取第一帧，反向取最后一帧
    nearest_start=true：
        specified_time_ms不是null → 直接取该公共时间
        specified_time_ms为null   → 按当前位置共同粗搜100ms、细搜10ms
    输出TargetFrame_ms、PosSet、StartMode、xSafe
    xSafe为false也正常返回，本文件不下发运动；是否允许运行由上位机判断

trajectory_run=false：非强制轨迹
    nearest_start=false → 正向取第一关键帧，反向取最后关键帧
    nearest_start=true：
        提供stopped_time_ms → 作为共同搜索起点；正好在关键帧则保留该帧
        未提供停止帧       → 按当前位置共同搜索时间，再按方向取下一关键帧
    共同关键帧=所有模型段起止时间的并集；正向取后帧，反向取前帧
    各模型取同一候选时间对应的位置；段前、空档和段后按原规则保持端点
    输出Candidates，按运行方向排列；终端不自动回绕，不做运动可达性筛选

第二步：
    强制轨迹 → 各活动轴使用默认V/A，减速度按当前PLC接线也取A。
                 各轴、各模型独立到位，先到的等待最慢模型，不做k/k²同步缩放。
                 输出VelSet、各轴/模型到达时间、等待时间和MaxRunTime_s。
    非强制轨迹 → 按候选顺序，用最大V/A/D计算零速起止梯形/三角形Move。
                   取全部移动轴最长时间T；其余轴按k=Ti/T缩放：V×k，A/D×k²。
                   再用模型几何检查实际电机速度上界；超限时全部模型统一降速，保持同时到达。
                   当前候选不可执行就尝试下一候选，最终输出目标帧、位置、V/A/D和MaxRunTime_s。

注意：两种“最近”均沿用旧指标max(|目标位置-当前位置|/默认速度)，不是欧氏距离。
该估计只用于选点，实际Move时间由第二步梯形/三角形运动计算。
本算法用于停稳后重新接入，当前起始速度按0计算，不处理运动中的非零初速度重规划。
强制xSafe沿用旧PLC算法和单位约定，由上位机决定是否允许启动。
"""
