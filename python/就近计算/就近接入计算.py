"""强制/非强制就近接入；调用 calculate_nearest_entry(parameters)。

强制：按最大V/A/D能力规划同步准备，按既有1006/1007停稳准备流程执行。
非强制：连续恒加速度/匀速曲线；内部帧允许非零速度，按真实Move匹配q/v。
曲线接入位置join_position与Move停车目标move_target不同，不能混用。
返回axis_plans准备队列、共同prepare_time_ms及continuation_axis_moves后续覆盖时序。
plan_valid仅为数学可行；can_dispatch=false明确当前PLC接口还需带速交接/轴时序支持。
非强制默认1ms原帧网格，最短准备时间优先；不声明一般连续全局最优。

H/P/Y单位：mm/度/度，速度为对应单位/s，加减速度为对应单位/s²。
当前普通Move协议：位置、V、A/D均0.1，实际D=A；先编码再计算时间。
原曲线和四个正解保留；参见同目录JSON字段说明及非强制带速接入说明.txt。
"""
import copy
import json
import math
import os
import tempfile
import sys
from bisect import bisect_right
from pathlib import Path

AXIS_NAMES = ("H", "P", "Y")
CURVE_TICK_FRAME = 100.0
ALGORITHM_VERSION = "v5_max_capability_common_prepare"
MAX_PREPARE_TIME_MS = 4294967295

###############################################################################
# 一、模型正解基础函数：将H/P/Y位姿换算成各电机位置，供限速检查和调速范围计算使用。
###############################################################################
##########################单点正解函数#########################
    ##输入 虚轴1位置 吊点数量
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
##########################调速辅助：曲线位姿换算电机位置#########################
# 根据模型类型把曲线上的H/P/Y位置转换成各个实际电机的位置。

def _map_prepare_frame(global_frame, first, last, direction, loop_count):
    """按PLC初始WAIT_SYNC的真实循环数映射公共帧；0在PLC对应10000000次。"""
    frame = float(global_frame)
    if loop_count == 1:
        return frame  # 单次由后续取点逻辑在首/末帧保持。
    period = float(last)-float(first)
    actual_count = 10000000 if loop_count == 0 else loop_count
    if direction > 0:
        if frame <= first:
            return float(first)
        if frame >= first+period*actual_count:
            return float(last)
    else:
        if frame >= last:
            return float(last)
        if frame < last-period*actual_count:  # PLC反向结束边界使用严格小于。
            return float(first)
    # PLC getPosAllLoop先移除完整周期，再在当前周期求值；整周期点回到首帧。
    return float(first)+(frame-float(first)) % period


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
    loop_count=None,
):
    """计算强制轨迹启动位置：非就近取动作边界，就近沿用粗细搜索并按准备速度上限评分。

    所有时间输入/输出均使用毫秒；selected_time_100ms是PLC的_T值。
    active_axes_by_model必须提供各模型活动轴；loop_count为PLC真实循环配置。
    loop_count=None时保留旧loop_once选帧规则，canonical入口始终传有效循环数。
    default_velocities保留旧参数名；总入口传入各模型max_velocity_HPY。
    """
    if direction not in (1, -1):
        raise ValueError("direction只能是1(正向)或-1(反向)")
    if (
        not isinstance(loop_once, bool)
        or not isinstance(nearest_start, bool)
        or not isinstance(use_specified_time, bool)
    ):
        raise ValueError("loop_once、nearest_start和use_specified_time必须是bool")
    if loop_count is not None and (type(loop_count) is not int or not 0 <= loop_count <= 65535):
        raise ValueError("loop_count必须是0到65535的整数，或None以保留旧选帧行为")
    if loop_count is not None:
        loop_once = loop_count == 1
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
        # 总入口已完成全部端点、跨段连续性及固定轴检查，避免再校验9600段。
        if model.get("_entry_prevalidated", False):
            return
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
                if float(previous["end_frame"])-start > tolerance:
                    raise ValueError(f"模型{model_id}的分段时间重叠")
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
        if loop_count is not None:
            return _map_prepare_frame(frame, first, last, direction, loop_count)
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
            # 原段很多时用二分定位，不在每个候选帧从第一段重新遍历。
            segment = segments[bisect_right(model_start_frames[model_id], frame)-1]
            if frame >= float(segment["end_frame"]):
                # 原动作空档保持上一段末值，不把空档当作有运动系数。
                target_hpy = [float(value) for value in segment["target_HPY"]]
                curve_velocity_hpy = [0.0, 0.0, 0.0]
            else:
                target_hpy, curve_velocity_hpy = calculate_curve_hpy(segment, frame)
        return frame, segment, target_hpy, curve_velocity_hpy

    model_axes = {}
    model_start_frames = {int(m["index"]): [float(s["start_frame"]) for s in m["segments"]] for m in models}
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
            if float(default_velocities[model_id][axis]) < 0.0:
                raise ValueError(f"模型{model_id}的{AXIS_NAMES[axis]}轴正常速度必须大于0")
            if float(max_accelerations[model_id][axis]) < 0.0:
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
            plc_pos_set = [float(value) for value in target_hpy]
            for axis in active_axes:
                current = float(current_positions[model_id][axis])
                target = float(target_hpy[axis])
                normal_velocity = float(default_velocities[model_id][axis])
                max_acceleration = float(max_accelerations[model_id][axis])
                curve_velocity = float(curve_velocity_hpy[axis])
                delta = abs(target-current)
                move_time = 0.0 if delta <= 1e-12 else delta/normal_velocity if normal_velocity > 0 else math.inf
                allowed_delta = curve_velocity*curve_velocity/(2.0*max_acceleration) if max_acceleration > 0 else 0.0
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
        def score_frame(global_frame, cutoff):
            """搜索只求距离/准备速度上限代价；总入口使用最大V，完整结果只为选中帧生成。"""
            score = 0.0
            for model in models:
                model_id = int(model["index"])
                _, _, target, _ = evaluate_model(model, global_frame)
                for axis in model_axes[model_id]:
                    delta = abs(target[axis]-float(current_positions[model_id][axis]))
                    velocity = float(default_velocities[model_id][axis])
                    cost = 0.0 if delta <= 1e-12 else delta/velocity if velocity > 0 else math.inf
                    score = max(score, cost)
                # max代价只能增大；已不可能严格小于当前最优值就结束本候选。
                if score >= cutoff:
                    break
            return score

        def scan(start, end, step, best):
            frame = float(start)
            epsilon = abs(float(step))*1.0e-9
            while (step > 0 and frame <= end+epsilon) or (step < 0 and frame >= end-epsilon):
                if best is not None and best["estimated_move_time"] == 0.0:
                    break  # 代价下界为0，同分时仍保留原方向先扫描到的帧。
                score = score_frame(frame, math.inf if best is None else best["estimated_move_time"])
                # PLC使用严格小于号；同分时保留运行方向上先扫描到的点。
                if best is None or score < best["estimated_move_time"]:
                    best = {"global_frame": frame, "estimated_move_time": score}
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
        best = evaluate_frame(best["global_frame"])
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
        "metric": "max(abs(target-current)/prepare_velocity_limit)",
    })
    return best

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
        # 原动作边界按模型加一次，不能在每个系数阶段重复加整份边界列表。
        if "_entry_boundaries_ms" in model:
            boundaries.update(model["_entry_boundaries_ms"])
        if model.get("_entry_prevalidated", False):
            model_segments[model_id] = segments
            continue
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
            if "_entry_boundaries_ms" not in model:
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
            model_frame = frame if "loop_count" not in inputs else _map_prepare_frame(
                frame, segments[0]["start_frame"], segments[-1]["end_frame"], direction, inputs["loop_count"])
            target = [float(value) for value in segments[0]["start_HPY"]]
            index = bisect_right(model_start_frames[model_id], model_frame)-1
            if index >= 0:
                segment = segments[index]
                if model_frame >= float(segment["end_frame"]):
                    target = [float(value) for value in segment["target_HPY"]]
                else:
                    target, _ = _evaluate_base_action_segment(segment, model_frame)
            if not all(math.isfinite(value) for value in target):
                raise ValueError(f"模型{model_id}在{frame}ms的位置计算非有限")
            positions[model_id] = target
        return positions

    model_start_frames = {key: [float(s["start_frame"]) for s in segments] for key,segments in model_segments.items()}

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
    def candidate_score(frame, cutoff):
        """与XML同口径：全组最大abs(位移)/默认速度，不混加mm与角度。"""
        score = 0.0
        for model_id, segments in model_segments.items():
            model_frame = frame if "loop_count" not in inputs else _map_prepare_frame(
                frame, segments[0]["start_frame"], segments[-1]["end_frame"], direction, inputs["loop_count"])
            index = bisect_right(model_start_frames[model_id], model_frame)-1
            if index < 0:
                target = segments[0]["start_HPY"]
            elif model_frame >= float(segments[index]["end_frame"]):
                target = segments[index]["target_HPY"]
            else:
                target, _ = _evaluate_base_action_segment(segments[index], model_frame)
            for name in inputs["active_axes_by_model"][model_id]:
                axis = AXIS_NAMES.index(name)
                delta = abs(float(target[axis])-inputs["current_positions"][model_id][axis])
                velocity = inputs["default_velocities"][model_id][axis]
                cost = 0.0 if delta <= 1e-12 else delta/velocity if velocity > 0 else math.inf
                score = max(score, cost)
            if score >= cutoff:
                break  # 后续模型只能增大max代价，不可能严格优于当前最优。
        return score

    def nearest_candidates():
        """只在方向允许的原关键帧中选最近；不可执行时再选剩余帧的最近。"""
        remaining = list(candidates)  # 已按正/反方向排好，同分保持先遇到的帧。
        while remaining:
            best_frame, best_score = None, math.inf
            for frame in remaining:
                score = candidate_score(frame, best_score)
                if best_frame is None or score < best_score:
                    best_frame, best_score = frame, score
                if best_score == 0.0:
                    break
            if not math.isfinite(best_score):
                raise ValueError("最近关键帧评分无有效值：需要位移的准备轴默认速度不能为0")
            # 只对选中的帧生成全组目标，避免每个候选都构造完整输出字典。
            yield {"TargetFrame_ms": best_frame, "PosSet": positions_at(best_frame)}
            remaining.remove(best_frame)

    candidate_positions = nearest_candidates()
    # 主入口第一次最近候选可执行就停止，不计算全部候选的完整参数。
    if not inputs.get("_lazy_candidates", False):
        candidate_positions = list(candidate_positions)
    return {
        "stopped_time_ms": None if stopped_time_ms is None else int(stopped_time_ms),
        "SearchOriginFrame_ms": float(search_origin),
        "StartMode": "nearest",
        "direction": direction,
        "CandidateFrames_ms": [float(frame) for frame in candidates],
        "Candidates": candidate_positions,
        "NearestMetric": "max(abs(target-current)/normal_velocity)",
        "CandidateSelection": "nearest_position_in_running_direction",
    }

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

def calculate_synchronized_entry_move(nearest_position_result, inputs):
    """规划停稳后的零速起止Move：HPY不超限、单调不越过目标、移动轴同时到达。

    电机检查使用几何导数上界，不依赖离散采样恰好采中峰值，结果可能偏保守。
    这里检查HPY加减速度和实际电机速度，不替代PLC的行程、碰撞、急停保护。
    """
    # 两类准备都使用最大能力上限；同步和实轴速度检查仍可进一步降低输出参数。
    parameter_prefix = "max"

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
        velocity_limits = inputs[parameter_prefix+"_velocities"][model_id]
        acceleration_limits = inputs[parameter_prefix+"_accelerations"][model_id]
        deceleration_limits = inputs[parameter_prefix+"_decelerations"][model_id]
        axis_profiles = {}
        for axis in axes:
            distance = abs(float(target[axis])-float(current[axis]))
            velocity_limit = float(velocity_limits[axis])
            acceleration = float(acceleration_limits[axis])
            deceleration = float(deceleration_limits[axis])
            if inputs["trajectory_run"]:
                # PLC实际D=A；最大A/D是各自上限，取较小值才能同时满足两项限制。
                acceleration = deceleration = min(acceleration, deceleration)
            if distance > 1e-12 and not math.isclose(acceleration, deceleration, rel_tol=1e-12, abs_tol=0.0):
                raise ValueError("当前PLC准备Move要求A=D，不能按独立D规划后让PLC仍用A")
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
                    inferred_direction = 1 if p_tilt else 2 if y_tilt else 0
                    move_what = model.get("moveWhat", inferred_direction)
                    if type(move_what) is not int or move_what not in (0, 1, 2):
                        raise ValueError("四点moveWhat只能为0、1、2")
                    if inferred_direction and move_what != inferred_direction:
                        raise ValueError("四点moveWhat与实际准备姿态方向不一致")
                    if move_what == 1 and "Y" in inputs["active_axes_by_model"][model_id] or move_what == 2 and "P" in inputs["active_axes_by_model"][model_id]:
                        raise ValueError("四点prepare_axes与PLC的moveWhat方向不一致")
                    tilt_axis = 2 if move_what == 2 else 1
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
                # 四个旧正解不改；提前排除可能在路径中途令旧pow溢出的极端数值。
                max_pitch_rad = max(abs(current[1]), abs(target[1]))*radians_per_degree
                if math.log(radius)+n_max*max(0.0, math.log(max(max_pitch_rad, 1e-300))) > 700.0:
                    raise ValueError("多点角度/尺寸使旧正解的中途幂运算可能溢出")
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


## 数值和HPY检查：拒绝NaN、无穷、布尔值，避免异常参数进入运动计算。
def _number(value, name, nonnegative=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name}必须是有限数值")
    value = float(value)
    if nonnegative and value < 0:
        raise ValueError(f"{name}不能小于0")
    return value


def _hpy(values, name, nonnegative=False):
    if not isinstance(values, (list, tuple)) or len(values) != 3:
        raise ValueError(f"{name}必须是H/P/Y三项数组")
    return [_number(v, name, nonnegative) for v in values]


def _axes(values, name):
    if not isinstance(values, (list, tuple)) or not values:
        raise ValueError(f"{name}必须是非空轴名列表")
    if any(not isinstance(v, str) or v.upper() not in AXIS_NAMES for v in values):
        raise ValueError(f"{name}只能填写H、P、Y")
    values = [v.upper() for v in values]
    if len(set(values)) != len(values):
        raise ValueError(f"{name}不能有重复轴")
    return values


## 读取文件：默认与本脚本同目录，读取后不覆盖原动作或已有调速参数。


def _nearest_default_parameter_path():
    """公共文件优先；仅未显式给路径时兼容旧就近文件名。"""
    common=Path(__file__).with_name("算法参数.json")
    return common if common.exists() else Path(__file__).with_name("就近接入参数.json")


def _adapt_shared_nearest_parameters(parameters):
    """把公共runtime/时间单位映射到旧入口的本地副本，不改原models/settings。"""
    if not isinstance(parameters,dict):
        raise ValueError("parameters必须是对象")
    source=parameters if "models" in parameters else _adapt_legacy_parameters(parameters)
    if "runtime" in parameters and "runtime" not in source:
        source=dict(source);source["runtime"]=parameters["runtime"]
    settings=source.get("settings",{})
    if not isinstance(settings,dict):
        raise ValueError("settings必须是对象")
    local_settings=dict(settings)
    units=[]
    for name in ("forced_coefficient_time_unit_ms","curve_time_unit_ms"):
        if name in settings:
            value=_number(settings[name],name)
            if value<=0:raise ValueError(name+"必须大于0")
            units.append(value)
    if len(units)==2 and settings["forced_coefficient_time_unit_ms"]!=settings["curve_time_unit_ms"]:
        raise ValueError("forced_coefficient_time_unit_ms与curve_time_unit_ms不一致")
    if "forced_coefficient_time_unit_ms" in settings:
        local_settings["curve_time_unit_ms"]=settings["forced_coefficient_time_unit_ms"]
    local=dict(source);local["settings"]=local_settings
    if "runtime" not in source:
        return local  # 旧inline反馈继续由原入口完整校验。
    runtime=source["runtime"]
    items=source.get("models")
    if not isinstance(items,list) or not items or any(not isinstance(m,dict) for m in items):
        raise ValueError("公共models必须为非空模型对象列表")
    if not isinstance(runtime,dict) or not isinstance(runtime.get("models"),list):
        raise ValueError("runtime必须是对象，且runtime.models必须为列表")
    models={}
    for model in items:
        key=model.get("model_id")
        if type(key)is not int or key<=0 or key in models:
            raise ValueError("公共models的model_id必须是全动作唯一正整数")
        models[key]=model
    states={}
    for state in runtime["models"]:
        if not isinstance(state,dict):raise ValueError("runtime.models每项必须是对象")
        key=state.get("model_id")
        if type(key)is not int or key<=0 or key in states or key not in models:
            raise ValueError("runtime模型编号重复、无效或不属于本动作")
        states[key]=state
    if set(states)!=set(models):raise ValueError("runtime.models必须完整覆盖本动作全部模型")
    local_models=[]
    for original in items:
        key=original["model_id"];state=states[key]
        for route in ("plc_id","device_id"):
            expected=original.get(route,original["model_id"] if route=="device_id" else None)
            if route in state and (type(state[route])is not type(expected) or state[route]!=expected):
                raise ValueError(f"runtime模型{key}的{route}与静态模型路由冲突")
        position=_hpy(state.get("position_HPY"),"runtime.position_HPY")
        velocity=_hpy(state.get("velocity_HPY"),"runtime.velocity_HPY")
        if type(state.get("standstill"))is not bool:
            raise ValueError("runtime.standstill必须明确为bool")
        if state["standstill"] and any(abs(v)>1e-7 for v in velocity):
            raise ValueError("runtime.standstill=true与非零速度矛盾")
        for old,value in (("current_HPY",position),("current_velocity_HPY",velocity)):
            if old in original and _hpy(original[old],old)!=value:
                raise ValueError(f"模型{key}的inline {old}与runtime反馈不一致")
        if "standstill" in original and (type(original["standstill"])is not bool or original["standstill"]!=state["standstill"]):
            raise ValueError(f"模型{key}的inline standstill与runtime不一致")
        item=dict(original)
        item["current_HPY"]=position;item["current_velocity_HPY"]=velocity
        item["standstill"]=state["standstill"]
        local_models.append(item)
    local["models"]=local_models
    return local


def _nearest_input_fingerprint(parameters):
    """只比较求解输入；别的算法写入result不使本次结果失去归属。"""
    if "models" in parameters:
        value={k:parameters[k] for k in ("models","settings","command","runtime") if k in parameters}
    else:
        value={k:v for k,v in parameters.items() if k not in ("range_result","adjust_result","nearest_result") and not k.startswith("_")}
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)


def _nearest_json_key(key):
    if isinstance(key,str):text=key
    elif key is True:text="true"
    elif key is False:text="false"
    elif key is None:text="null"
    elif isinstance(key,(int,float)):text=json.dumps(key,allow_nan=False)
    else:raise TypeError("JSON对象键必须为字符串或JSON标量")
    return json.dumps(text,ensure_ascii=False)


def _nearest_format_json(value,level=0):
    """对象分行、数值等标量数组一行，保留int/float及负零数值类型。"""
    indent="  "*level
    if isinstance(value,dict):
        if not value:return "{}"
        rows=["  "*(level+1)+_nearest_json_key(k)+": "+_nearest_format_json(v,level+1) for k,v in value.items()]
        return "{\n"+",\n".join(rows)+"\n"+indent+"}"
    if isinstance(value,list):
        if not value or all(not isinstance(v,(dict,list)) for v in value):
            return json.dumps(value,ensure_ascii=False,allow_nan=False)
        return "[\n"+",\n".join("  "*(level+1)+_nearest_format_json(v,level+1) for v in value)+"\n"+indent+"]"
    return json.dumps(value,ensure_ascii=False,allow_nan=False)


def _nearest_write_shared_result(path,original,result):
    """乐观重读后原子更新nearest_result；不承诺多进程同时写同一文件。"""
    expected=_nearest_input_fingerprint(original)
    path=Path(path)
    for attempt in range(3):
        raw=path.read_bytes()
        latest=json.loads(raw.decode("utf-8-sig"))
        if not isinstance(latest,dict) or _nearest_input_fingerprint(latest)!=expected:
            raise ValueError("算法参数的models/settings/command/runtime在计算期间改变，拒绝写回旧结果")
        latest["nearest_result"]=result
        rendered=_nearest_format_json(latest)+"\n"
        descriptor,temp_name=tempfile.mkstemp(prefix="."+path.name+".",suffix=".tmp",dir=str(path.parent))
        try:
            with os.fdopen(descriptor,"w",encoding="utf-8",newline="\n") as stream:
                stream.write(rendered)
            if path.read_bytes()!=raw:
                continue  # 重读并保留刚写入的其它result；输入变化下一轮会拒绝。
            os.replace(temp_name,path)
            return
        finally:
            if os.path.exists(temp_name):os.unlink(temp_name)
    raise ValueError("算法参数在写回期间持续改变，请重新读取后计算")

def load_nearest_parameters(parameter_path=None):
    parameter_path = Path(parameter_path) if parameter_path is not None else _nearest_default_parameter_path()
    parameters = json.loads(parameter_path.read_text(encoding="utf-8-sig"))
    if not isinstance(parameters, dict):
        raise ValueError("就近接入参数JSON顶层必须是对象")
    return parameters


## 兼容旧附件的YXZ.JSON结构：转换字段后仍进入同一个同步计算流程。
def _adapt_legacy_parameters(parameters):
    command = copy.deepcopy(parameters.get("command", {}))
    action_name = command.get("action_name", "base_action")
    action = parameters.get(action_name)
    config = parameters.get("cal_start_time_config")
    positions = parameters.get("current_model_positions")
    if not isinstance(action, dict) or not isinstance(config, dict) or not isinstance(positions, list):
        raise ValueError("输入必须含models，或提供旧YXZ的动作/配置/当前位置三部分")

    def route(item, is_curve=False):
        plc = str(item.get("plc_id", "PLC_1"))
        return plc, item.get("index" if is_curve else "model_id")

    configs, currents = {}, {}
    for items, destination in ((config.get("models", []), configs), (positions, currents)):
        for item in items:
            key = route(item)
            if key in destination:
                raise ValueError(f"旧输入重复PLC/模型编号：{key}")
            destination[key] = item
    models = []
    for model in action.get("models", []):
        key = route(model, True)
        if key not in configs or key not in currents:
            raise ValueError(f"旧输入模型{key}缺少配置或当前位置")
        cfg, current = configs[key], currents[key]
        item = copy.deepcopy(model)
        item.update(copy.deepcopy(cfg))
        item.update(copy.deepcopy(current))
        item["plc_id"], item["model_id"] = key
        item["device_id"] = model.get("device_id", cfg.get("device_id", key[1]))
        item["follow_axes"] = cfg["active_axes"]
        item["prepare_axes"] = cfg.get("prepare_axes", cfg["active_axes"])
        # 停稳信息不能凭空补0；旧文件也须新增反馈速度或明确standstill=true。
        models.append(item)
    return {
        "command": command,
        "settings": {
            "model_type_scheme": config.get("model_type_scheme", "geometry"),
            "curve_time_unit_ms": config.get("curve_time_unit_ms", 100),
            "coarse_step_ms": config.get("coarse_step_ms", 100),
            "fine_step_ms": config.get("fine_step_ms", 10),
        },
        "models": models,
    }


## 输入归一化：建立全组唯一内部编号，几何类型与业务类型在入口明确转换。
def _normalize_inputs(parameters):
    if not isinstance(parameters, dict):
        raise ValueError("parameters必须是对象")
    source = parameters if "models" in parameters else _adapt_legacy_parameters(parameters)
    command, settings = source.get("command"), source.get("settings", {})
    if not isinstance(command, dict) or not isinstance(settings, dict):
        raise ValueError("command/settings必须是对象")
    if type(command.get("trajectory_run")) is not bool:
        raise ValueError("command.trajectory_run必须明确为true或false")
    flags = {"reverse": False, "loop_once": True, "nearest_start": True, "use_specified_time": False}
    for name, default in flags.items():
        flags[name] = command.get(name, default)
        if type(flags[name]) is not bool:
            raise ValueError(f"command.{name}必须为bool")
    # 显式循环数为准；未提供时兼容原loop_once，true=1，false=0(PLC无限配置)。
    loop_count = command.get("loop_count", 1 if flags["loop_once"] else 0)
    if type(loop_count) is not int or not 0 <= loop_count <= 65535:
        raise ValueError("command.loop_count必须是0到65535的整数")
    flags["loop_once"] = loop_count == 1
    specified = command.get("specified_time_ms", 0)
    stopped = command.get("stopped_time_ms")
    for name, value in (("specified_time_ms", specified), ("stopped_time_ms", stopped)):
        if value is None and name == "stopped_time_ms":
            continue
        if type(value) is not int or not 0 <= value <= 4294967295:
            raise ValueError(f"command.{name}必须是uint32整数毫秒，停止帧可为null")
    scheme = settings.get("model_type_scheme", "business")
    if scheme not in ("business", "geometry"):
        raise ValueError("settings.model_type_scheme只能是business或geometry")
    unit = _number(settings.get("curve_time_unit_ms", 100), "curve_time_unit_ms")
    coarse = _number(settings.get("coarse_step_ms", 100), "coarse_step_ms")
    fine = _number(settings.get("fine_step_ms", 10), "fine_step_ms")
    if min(unit, coarse, fine) <= 0 or coarse != int(coarse) or fine != int(fine) or fine > coarse:
        raise ValueError("系数时间单位须>0；搜索步长须为整数ms且0<细步长<=粗步长")
    items = source.get("models")
    if not isinstance(items, list) or not items:
        raise ValueError("models必须是整个同步组的非空模型列表")
    inputs = {
        "trajectory_run": command["trajectory_run"], "direction": -1 if flags["reverse"] else 1,
        "loop_once": flags["loop_once"], "loop_count": loop_count, "nearest_start": flags["nearest_start"],
        "use_specified_time": flags["use_specified_time"], "specified_time_ms": specified,
        "stopped_time_ms": stopped, "coarse_step": coarse, "fine_step": fine,
        "current_positions": {}, "active_axes_by_model": {}, "follow_axes_by_model": {},
        "default_velocities": {}, "default_accelerations": {}, "default_decelerations": {},
        "max_velocities": {}, "max_accelerations": {}, "max_decelerations": {},
        "curve_action": {"models": []}, "routes": {},
    }
    seen, device_routes = set(), set()
    for internal_id, original in enumerate(items, 1):
        if not isinstance(original, dict):
            raise ValueError("models每项必须是对象")
        # 后续所有参与计算的数组均另建；浅复制避免把150段原数据再整套深拷贝。
        item = dict(original)
        plc_id, model_id = item.get("plc_id"), item.get("model_id")
        device_id = item.get("device_id", model_id)
        if not isinstance(plc_id, str) or not plc_id.strip():
            raise ValueError("每模型plc_id必须是非空字符串")
        if type(model_id) is not int or model_id < 0:
            raise ValueError("model_id必须是非负整数；不同PLC可以重号")
        if type(device_id) is not int or not 1 <= device_id <= 65535:
            raise ValueError("device_id必须为1到65535的整数，与PLC协议一致")
        if (plc_id, model_id) in seen or (plc_id, device_id) in device_routes:
            raise ValueError("同一PLC中的model_id/device_id不能重复")
        seen.add((plc_id, model_id)); device_routes.add((plc_id, device_id))
        kind = item.get("model_type")
        if type(kind) is not int:
            raise ValueError("model_type必须为整数")
        if scheme == "business":
            if kind not in (2, 6, 7, 8):
                raise ValueError("业务模型类型仅支持2单点、6两点、7四点、8多点")
            geometry_kind = {2: 1, 6: 2, 7: 4, 8: 8}[kind]
        else:
            geometry_kind = kind
            if kind not in (1, 2, 4, 8):
                raise ValueError("几何模型类型仅支持1、2、4、8")
        geometry = item.get("geometry", {})
        if not isinstance(geometry, dict):
            raise ValueError("geometry必须是对象")
        # geometry只允许物理参数，不能覆盖反馈、停稳信息或PLC路由字段。
        geometry_fields = {"motor_num", "BaseHight1", "BaseHight2", "Baseheight1", "Baseheight2",
            "lLenth_inside", "wLenth_inside", "maxheight", "moveWhat", "point_init_pos", "betainit"}
        if set(geometry)-geometry_fields:
            raise ValueError("geometry含非几何字段，不能覆盖运行反馈或模型路由")
        if any(name in item and item[name] != value for name, value in geometry.items()):
            raise ValueError("平铺字段与geometry中的同名配置冲突")
        # 配置放geometry或保留旧平铺字段均可；核心只使用归一化副本。
        item.update(geometry)
        for name in geometry_fields-{"motor_num", "moveWhat", "point_init_pos"}:
            if name in item:
                item[name] = _number(item[name], name)
        if "point_init_pos" in item:
            if not isinstance(item["point_init_pos"], list):
                raise ValueError("point_init_pos必须是XYZ吊点列表")
            item["point_init_pos"] = [_hpy(p, "point_init_pos XYZ") for p in item["point_init_pos"]]
        item["index"], item["model_type"] = internal_id, geometry_kind
        item.setdefault("motor_num", len(item.get("point_init_pos", [])) if geometry_kind == 8 else geometry_kind)
        if type(item["motor_num"]) is not int or item["motor_num"] <= 0:
            raise ValueError("motor_num必须为正整数")
        current = _hpy(item.get("current_HPY"), "current_HPY")
        if "standstill" in item and type(item["standstill"]) is not bool:
            raise ValueError("standstill必须为bool")
        if item.get("standstill") is False:
            raise ValueError(f"{plc_id}/{model_id}尚未停稳，不能用零速准备规划")
        if "current_velocity_HPY" in item:
            current_velocity = _hpy(item["current_velocity_HPY"], "current_velocity_HPY")
            if any(abs(v) > 1e-7 for v in current_velocity):
                raise ValueError(f"{plc_id}/{model_id}当前速度非零，请停稳后准备")
        elif item.get("standstill") is not True:
            raise ValueError("须提供current_velocity_HPY或明确standstill=true，不能默认已停稳")
        follow = _axes(item.get("follow_axes", item.get("active_axes")), "follow_axes")
        prepare = _axes(item.get("prepare_axes", follow), "prepare_axes")
        supported = {1: {"H"}, 2: {"H", "P"}, 4: {"H", "P", "Y"}, 8: {"H", "P", "Y"}}[geometry_kind]
        if not set(follow).issubset(prepare) or not set(prepare).issubset(supported):
            raise ValueError("prepare_axes须包含follow_axes，且不得加入模型不存在的轴")
        if geometry_kind == 4 and "P" in prepare and "Y" in prepare:
            raise ValueError("当前四点正解只支持单一倾斜方向，不能同时准备P/Y")
        inputs["current_positions"][internal_id] = current
        inputs["active_axes_by_model"][internal_id] = prepare
        inputs["follow_axes_by_model"][internal_id] = follow
        for field, destination in (("default_velocity_HPY", "default_velocities"),
            ("default_acceleration_HPY", "default_accelerations"), ("default_deceleration_HPY", "default_decelerations"),
            ("max_velocity_HPY", "max_velocities"), ("max_acceleration_HPY", "max_accelerations"),
            ("max_deceleration_HPY", "max_decelerations")):
            inputs[destination][internal_id] = _hpy(item.get(field), field, True)
        for axis_name in prepare:
            axis = AXIS_NAMES.index(axis_name)
            for default_name, max_name in (("default_velocities", "max_velocities"),
                ("default_accelerations", "max_accelerations"), ("default_decelerations", "max_decelerations")):
                if inputs[default_name][internal_id][axis] > inputs[max_name][internal_id][axis]:
                    raise ValueError("默认准备V/A/D不能超过对应最大值")
        item["max_motor_velocity"] = _number(item.get("max_motor_velocity"), "max_motor_velocity")
        if item["max_motor_velocity"] <= 0:
            raise ValueError("max_motor_velocity必须大于0")
        segments = item.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError("每模型segments须为非空原动作段列表")
        flat, boundaries, previous = [], set(), None
        for segment in segments:
            if not isinstance(segment, dict):
                raise ValueError("segments每一项必须是动作段对象")
            start, end = segment.get("start_frame"), segment.get("end_frame")
            if any(type(v) not in (int, float) or isinstance(v, bool) or not math.isfinite(v)
                   or v != int(v) or not 0 <= v <= 4294967295 for v in (start, end)) or end <= start:
                raise ValueError("原动作帧须为uint32整数毫秒，且end_frame>start_frame")
            if previous is not None and start < previous:
                raise ValueError("原动作段须按时间排序且不能重叠")
            previous = end
            boundaries.update((int(start), int(end)))
            pieces = segment.get("coefficient_segments", [segment])
            if not isinstance(pieces, list) or not pieces:
                raise ValueError("coefficient_segments必须为非空列表")
            cursor = start
            for piece in pieces:
                if not isinstance(piece, dict):
                    raise ValueError("coefficient_segments每一项必须是系数阶段对象")
                p = dict(piece)
                if p.get("start_frame") != cursor or p.get("end_frame", cursor) <= cursor or p["end_frame"] > end:
                    raise ValueError("系数阶段必须完整、连续覆盖原动作段")
                if any(type(p.get(n)) not in (int, float) or p[n] != int(p[n]) for n in ("start_frame", "end_frame")):
                    raise ValueError("系数阶段首末帧须为整数毫秒")
                for degree, name in enumerate("abcdef"):
                    p[name] = [v*(100.0/unit)**degree for v in _hpy(p.get(name), name)]
                    if any(not math.isfinite(v) for v in p[name]):
                        raise ValueError("系数时间单位换算后超出浮点范围")
                p.setdefault("segment_id", segment.get("segment_id", len(flat)))
                for frame, name in ((p["start_frame"], "start_HPY"), (p["end_frame"], "target_HPY")):
                    evaluated, _ = _evaluate_base_action_segment(p, frame)
                    if any(not math.isfinite(v) for v in evaluated):
                        raise ValueError("系数阶段端点计算超出浮点范围")
                    if name in p and any(abs(a-b) > 1e-5 for a,b in zip(evaluated, _hpy(p[name], name))):
                        raise ValueError("系数阶段端点与位置字段不一致")
                    p[name] = evaluated
                # 首次归一化同时校验阶段/动作段/空档的位置连续性。
                if flat and any(abs(a-b) > 1e-5 for a,b in zip(flat[-1]["target_HPY"], p["start_HPY"])):
                    raise ValueError("相邻系数阶段或原动作空档前后的位置不连续")
                flat.append(p); cursor = p["end_frame"]
            if cursor != end:
                raise ValueError("系数阶段没有覆盖到原动作末帧")
            for value, name in ((flat[-len(pieces)]["start_HPY"], "start_HPY"), (flat[-1]["target_HPY"], "target_HPY")):
                if name in segment and any(abs(a-b) > 1e-5 for a,b in zip(value, _hpy(segment[name], name))):
                    raise ValueError("原动作端点与abcdef/系数阶段不一致")
        # 固定轴必须整条曲线保持同一个值；需要接到该值可在prepare_axes中显式加入。
        for axis in range(3):
            if AXIS_NAMES[axis] not in follow:
                fixed = flat[0]["start_HPY"][axis]
                for p in flat:
                    u_end = (p["end_frame"]-p["start_frame"])/100.0
                    # 系数很小也可能在长段累积成明显位移，按全段变化上界判断。
                    variation = sum(abs(p[name][axis])*u_end**degree for degree,name in enumerate("bcdef", 1))
                    if not math.isfinite(variation) or abs(p["a"][axis]-fixed)+variation > 1e-5:
                        raise ValueError("非follow_axes轴的原曲线必须固定，不能漏填活动轴")
        item["segments"], item["segment_count"] = flat, len(flat)
        item["total_frames"] = flat[-1]["end_frame"]
        item["_entry_boundaries_ms"] = sorted(boundaries)
        # 不存在的虚轴只保留当前占位；已有可动轴的固定目标不能静默丢弃。
        item["_supported_axes"] = supported
        item["_entry_prevalidated"] = True  # 只能由本次完整归一校验完成后生成。
        inputs["curve_action"]["models"].append(item)
        inputs["routes"][internal_id] = {"plc_id": plc_id, "model_id": model_id,
            "device_id": device_id, "model_type": original["model_type"]}
    return inputs


## 实际准备目标：非准备轴保持原位置；可动固定轴不一致时要求显式加入准备。
def _prepare_targets(candidate, inputs):
    candidate = copy.deepcopy(candidate)
    for model in inputs["curve_action"]["models"]:
        key = model["index"]
        current, target = inputs["current_positions"][key], candidate["PosSet"][key]
        for axis, name in enumerate(AXIS_NAMES):
            if name not in inputs["active_axes_by_model"][key]:
                if name in model["_supported_axes"] and abs(target[axis]-current[axis]) > 1e-5:
                    raise ValueError("固定姿态与当前不一致：须把该可动轴加入prepare_axes")
                target[axis] = current[axis]
    return candidate


## 总入口：两种选帧方式保持独立，准备运动共用同一跨PLC同步函数。
def calculate_nearest_entry(parameters):
    """输入字典，返回选帧、按PLC分组的同步Move与1006参数；不修改输入。

    can_dispatch=true表示可按17+14字节的1006共同等待协议下发。
    所有PLC必须支持以1007共同时间戳加prepareTimeMs作为准备结束时间门。
    requires_group_wait=true提示有整台静止PLC，须保持到共同结束时刻；不再拒绝计划。
    """
    inputs = _normalize_inputs(parameters)
    # 对齐XML autoFunFB.start的canLoop：强制非闭合动作回退单次。
    # 同模型虚轴首末时间是否一致须由上位机在合并HPY前检查；本格式默认共同区间。
    loop_fallback = []
    if not inputs["loop_once"]:
        for model in inputs["curve_action"]["models"]:
            key = model["index"]
            first, last = model["segments"][0]["start_HPY"], model["segments"][-1]["target_HPY"]
            for name in inputs["follow_axes_by_model"][key]:
                axis = AXIS_NAMES.index(name)
                if abs(first[axis]-last[axis]) > 0.001:
                    route = inputs["routes"][key]
                    loop_fallback.append({"plc_id": route["plc_id"], "model_id": route["model_id"],
                        "axis": name, "reason": "首尾位置不闭合，按XML规则改为单次"})
        if loop_fallback:
            # 全组统一单次；上位机必须据effective_loop_once统一下发循环设置。
            inputs["loop_once"] = True
            inputs["loop_count"] = 1
    if inputs["trajectory_run"]:
        selected = calculate_forced_nearest_position(
            inputs["current_positions"], inputs["max_velocities"], inputs["curve_action"],
            inputs["max_accelerations"], direction=inputs["direction"], loop_once=inputs["loop_once"],
            nearest_start=inputs["nearest_start"], use_specified_time=inputs["use_specified_time"],
            specified_time_ms=inputs["specified_time_ms"], active_axes_by_model=inputs["active_axes_by_model"],
            coarse_step=inputs["coarse_step"], fine_step=inputs["fine_step"], loop_count=inputs["loop_count"])
        curve_targets = {m["model_id"]: m["target_HPY"] for m in selected["models"]}
        selected = _prepare_targets(selected, inputs)
        motion = calculate_synchronized_entry_move(selected, inputs)
        skipped = []
    else:
        # 非强制指定帧只作搜索起点；仍沿方向接入原动作关键帧，不新增中间Move目标。
        if inputs["use_specified_time"]:
            inputs["stopped_time_ms"] = inputs["specified_time_ms"]
        inputs["_lazy_candidates"] = True
        candidates = calculate_non_forced_candidate_positions(inputs)
        skipped = []
        motion = None
        for candidate in candidates["Candidates"]:
            candidate.update({"StartMode": candidates["StartMode"],
                "SearchOriginFrame_ms": candidates["SearchOriginFrame_ms"]})
            try:
                curve_targets = copy.deepcopy(candidate["PosSet"])
                motion = calculate_synchronized_entry_move(_prepare_targets(candidate, inputs), inputs)
                break
            except (ValueError, ArithmeticError) as exc:
                skipped.append({"frame_ms": candidate["TargetFrame_ms"], "reason": str(exc)})
        if motion is None:
            raise ValueError("沿当前方向没有可执行的共同关键帧：" + json.dumps(skipped, ensure_ascii=False))
    # 1006原帧先确定为整数，所有目标都按该整数帧求出，不做帧/位置分别取整。
    frame = motion["TargetFrame_ms"]
    if not float(frame).is_integer():
        raise ValueError("选中帧无法直接编码为整数ms，请使用整数搜索步长/原动作帧")
    duration_ms = motion["MaxRunTime_s"]*1000.0
    if not math.isfinite(duration_ms) or duration_ms < 0:
        raise ValueError("准备耗时换算成毫秒后超出浮点范围")
    # 共同等待只向上取整，不缩短原计算时间；全部静止时0ms合法。
    prepare_time_ms_ceil = math.ceil(duration_ms)
    if prepare_time_ms_ceil > MAX_PREPARE_TIME_MS:
        raise ValueError("共同准备时长超过uint32毫秒范围，不能编码到1006")
    grouped = {}
    for key, route in inputs["routes"].items():
        params = motion["VelSet"][key]
        current, target = inputs["current_positions"][key], motion["PosSet"][key]
        execute = [abs(target[a]-current[a]) > 1e-12 for a in range(3)]
        result = {**route, "current_HPY": list(current), "curve_target_HPY": list(curve_targets[key]),
            "target_HPY": list(target), **params, "execute_HPY": execute,
            "expected_arrival_ms": duration_ms if any(execute) else 0.0,
            "motor_velocity_upper_bound": motion["MotorSpeedCheck"][key]["upper_bound"],
            "max_motor_velocity": motion["MotorSpeedCheck"][key]["limit"]}
        grouped.setdefault(route["plc_id"], {"plc_id": route["plc_id"], "models": []})["models"].append(result)
    stationary_plcs = [plc for plc, device in grouped.items() if not any(any(m["execute_HPY"]) for m in device["models"])]
    needs_wait = duration_ms > 0 and bool(stationary_plcs)
    # 每台PLC收到相同的准备时长；目标仍由PLC按公共帧计算，设备V/A公式保持不变。
    # deceleration_HPY/execute_HPY仅为结果说明，线上每设备仍只有ID和六个V/A字段。
    payloads = [{"plc_id": plc, "selectedCurveTimeMs": int(frame), "loopCount": inputs["loop_count"],
        "prepareTimeMs": prepare_time_ms_ceil, "devices": [
        {"deviceID": m["device_id"], "model_id": m["model_id"],
         "velocity_HPY": m["velocity_HPY"], "acceleration_HPY": m["acceleration_HPY"],
         "deceleration_HPY": m["deceleration_HPY"], "execute_HPY": m["execute_HPY"]}
        for m in device["models"]]} for plc, device in grouped.items()]
    return {"status": "planned", "can_dispatch": True,
        "message": "同步准备参数计算完成；整台静止PLC按共同结束时刻等待" if needs_wait else "全组同步准备参数计算完成",
        "requires_group_wait": needs_wait,
        "trajectory_run": inputs["trajectory_run"], "reverse": inputs["direction"] < 0,
        "effective_loop_once": inputs["loop_once"], "effective_loop_count": inputs["loop_count"], "loop_fallback": loop_fallback,
        "selected_curve_time_ms": int(frame), "prepare_time_ms": duration_ms,
        "prepare_time_ms_ceil": prepare_time_ms_ceil,
        "start_mode": motion["StartMode"], "motor_limit_scale": motion["MotorLimitScale"],
        "stationary_plc_ids": stationary_plcs, "all_stationary": duration_ms == 0,
        "devices": list(grouped.values()), "1006_payloads": payloads, "skipped_candidates": skipped,
        "algorithm_version": ALGORITHM_VERSION,
        "time_basis": "1007共同时间戳T0开始准备；全部PLC等待T0+prepareTimeMs且本机准备完成停稳后进入曲线",
        "protocol": {"1006_header_bytes": 17, "1006_device_bytes": 14,
            "prepareTimeMs_offset": 13, "prepareTimeMs_bytes": 4, "endianness": "big",
            "requires_plc_common_prepare_deadline": True, "1007_changed": False},
        "scope": "零速起止、Jerk=0、A=D；几何电机速度上界；不包含PLC通信/跟随延时、碰撞或硬件保护"}


class _entry_scalar_JoinInfeasible(ValueError):
    pass


def _entry_scalar__sign(value):
    return 1.0 if value > 0 else (-1.0 if value < 0 else 0.0)


def _entry_scalar__grid_floor(value, resolution):
    return math.floor(value / resolution + 1e-10) * resolution


def _entry_scalar__grid_ceil(value, resolution):
    return math.ceil(value / resolution - 1e-10) * resolution


def _entry_scalar__on_grid(value, resolution, tolerance):
    return abs(value - round(value / resolution) * resolution) <= tolerance


def _entry_scalar_move_profile(q0, v0, target, velocity, acceleration, deceleration,
                 position_min=-math.inf, position_max=math.inf, tolerance=1e-9):
    """模拟标准无 jerk 梯形 Move：目标是最终零速停车点，允许初速反向。

    若同向初速无法在 target 前刹停，明确拒绝；不假设库会自动超调后折返。
    phases 中每项为 [持续秒数, 段初位置, 段初速度, 有符号加速度]。
    """
    values = (q0, v0, target, velocity, acceleration, deceleration)
    if not all(math.isfinite(value) for value in values):
        raise _entry_scalar_JoinInfeasible("位置、速度、加减速度必须是有限数")
    if velocity <= 0 or acceleration <= 0 or deceleration <= 0:
        raise _entry_scalar_JoinInfeasible("运动 Move 的 V/A/D 必须大于 0，不能下发 0 让 PLC 替换默认值")
    if not position_min - tolerance <= q0 <= position_max + tolerance:
        raise _entry_scalar_JoinInfeasible("当前位置超出位置范围")
    if not position_min - tolerance <= target <= position_max + tolerance:
        raise _entry_scalar_JoinInfeasible("真实停车目标超出位置范围")
    direction = 0.0 if abs(target-q0)<=tolerance else _entry_scalar__sign(target - q0)
    if not direction:
        if abs(v0) <= tolerance:
            return {"phases": [], "duration_s": 0.0, "target": target}
        raise _entry_scalar_JoinInfeasible("同位置非零初速不能假定为立即停稳")
    phases, q, v, elapsed = [], q0, v0, 0.0

    def append(duration, signed_acceleration):
        nonlocal q, v, elapsed
        # 很短的非零加速段也会改变后续整段速度；不能按位置容差直接省略时间。
        if duration <= 0.0:
            return
        phases.append([duration, q, v, signed_acceleration])
        q = q + v * duration + 0.5 * signed_acceleration * duration * duration
        v = v + signed_acceleration * duration
        elapsed += duration
        if not position_min - tolerance <= q <= position_max + tolerance:
            raise _entry_scalar_JoinInfeasible("初始制动或完整 Move 超出位置范围")

    u0 = direction * v
    if u0 < -tolerance:
        # Move 目标在另一方向：先按 D 将当前速度刹为零，再起步。
        append(-u0 / deceleration, direction * deceleration)
        u0 = 0.0
    distance = direction * (target - q)
    if distance < u0 * u0 / (2 * deceleration) - tolerance:
        raise _entry_scalar_JoinInfeasible("当前初速在真实停车目标前来不及刹停，不能假设 MC 自动超调折返")
    if u0 > velocity + tolerance:
        # 覆盖后的 V 低于当前速度：先降到新 V，之后仍使用本条 Move。
        append((u0 - velocity) / deceleration, -direction * deceleration)
        u0 = velocity
        distance = direction * (target - q)
    peak_squared = (2 * acceleration * deceleration * distance
                    + deceleration * u0 * u0) / (acceleration + deceleration)
    peak = min(velocity, math.sqrt(max(0.0, peak_squared)))
    if peak < u0 - tolerance:
        raise _entry_scalar_JoinInfeasible("Move 剩余距离不足以执行给定速度曲线")
    accelerating_distance = (peak * peak - u0 * u0) / (2 * acceleration)
    braking_distance = peak * peak / (2 * deceleration)
    cruise_distance = max(0.0, distance - accelerating_distance - braking_distance)
    append((peak - u0) / acceleration, direction * acceleration)
    append(cruise_distance / peak if peak > tolerance else 0.0, 0.0)
    append(peak / deceleration, -direction * deceleration)
    if abs(q - target) > max(1e-7, abs(target) * 1e-10) or abs(v) > 1e-7:
        raise AssertionError("内部 Move 积分末态不一致")
    return {"phases": phases, "duration_s": elapsed, "target": target}


def _entry_scalar_state_at(profile, time_s):
    """只按输出的实际 Move V/A/D 曲线积分，不使用接入点插值。"""
    remaining = max(0.0, float(time_s))
    if remaining >= profile["duration_s"]:
        return profile["target"], 0.0
    for duration, q, v, acceleration in profile["phases"]:
        if remaining <= duration + 1e-11:
            remaining = min(remaining, duration)
            return q + v * remaining + 0.5 * acceleration * remaining ** 2, v + acceleration * remaining
        remaining -= duration
    return profile["target"], 0.0


def _entry_scalar__crossings(profile, q_join, tolerance=1e-8):
    """返回实际 Move 穿过 q_join 的全部 (时间, 速度)，供反向初速核验。"""
    result, elapsed = [], 0.0
    for duration, q, v, acceleration in profile["phases"]:
        if abs(acceleration) < 1e-15:
            roots = [(q_join - q) / v] if abs(v) > 1e-15 else ([0.0] if abs(q_join - q) <= tolerance else [])
        else:
            discriminant = v * v + 2 * acceleration * (q_join - q)
            roots = [] if discriminant < -tolerance else [
                (-v + math.sqrt(max(0.0, discriminant))) / acceleration,
                (-v - math.sqrt(max(0.0, discriminant))) / acceleration]
        for local_time in roots:
            if -tolerance <= local_time <= duration + tolerance:
                local_time = min(duration, max(0.0, local_time))
                result.append((elapsed + local_time, v + acceleration * local_time))
        elapsed += duration
    if not profile["phases"] and abs(profile["target"] - q_join) <= tolerance:
        result.append((0.0, 0.0))
    return result


def _entry_scalar_plan_ideal_join(q0, v0, q_join, v_join, max_velocity, max_acceleration, max_deceleration,
                    position_min=-math.inf, position_max=math.inf, enforce_equal_ad=True,
                    tolerance=1e-8):
    """单条真实 Move 的理想最短过点方案，当前位置/目标值均不擅自改动。

    末速非零时：R=q_join+sign(v_join)*v_join²/(2D)。
    该构造在 q_join 后留下真实刹停距离，接入点不会被当作零速停车点。
    无法由单条 Move 完成的折返状态明确拒绝；不能据此断言整条曲线无解。
    """
    acceleration, deceleration = float(max_acceleration), float(max_deceleration)
    if enforce_equal_ad:
        acceleration = deceleration = min(acceleration, deceleration)
    if min(max_velocity, acceleration, deceleration) <= 0:
        raise _entry_scalar_JoinInfeasible("V/A/D 上限必须大于 0")
    if abs(v0) > max_velocity + tolerance or abs(v_join) > max_velocity + tolerance:
        raise _entry_scalar_JoinInfeasible("初速或接入速度超过虚轴最大速度")
    if not position_min - tolerance <= q_join <= position_max + tolerance:
        raise _entry_scalar_JoinInfeasible("接入点超出位置范围")
    if abs(v_join) <= tolerance and abs(q_join - q0) <= tolerance and abs(v0) <= tolerance:
        return {"status": "ok", "send_move": False, "time_s": 0.0, "q_join": q_join,
                "v_join": 0.0, "move_target": q0, "velocity": 0.0, "acceleration": 0.0,
                "deceleration": 0.0, "profile": {"phases": [], "duration_s": 0.0, "target": q0},
                "precision": "ideal", "time_optimal_within_single_move_domain": True}
    direction = _entry_scalar__sign(v_join) or _entry_scalar__sign(q_join - q0)
    if not direction:
        raise _entry_scalar_JoinInfeasible("当前位置非零初速回到同位置：需要额外停车/折返阶段")
    target = q_join + direction * v_join * v_join / (2 * deceleration)
    if direction * (target - q0) <= tolerance:
        raise _entry_scalar_JoinInfeasible("所需停车目标位于接入方向后方，不能假设单条 Move 自动超调反向")
    profile = _entry_scalar_move_profile(q0, v0, target, max_velocity, acceleration, deceleration,
                           position_min, position_max, tolerance)
    crossings = ([(profile["duration_s"], 0.0)] if abs(v_join) <= 1e-12 and abs(target-q_join) <= tolerance
                 else [(t, v) for t, v in _entry_scalar__crossings(profile, q_join, tolerance)
                       if abs(v - v_join) <= tolerance])
    if not crossings:
        raise _entry_scalar_JoinInfeasible("最大 A/D 下不能由本条 Move 在该位置达到指定接入速度")
    join_time, actual_velocity = min(crossings)
    return {"status": "ok", "send_move": True, "time_s": join_time, "q_join": q_join,
            "v_join": v_join, "move_target": target, "velocity": max_velocity,
            "acceleration": acceleration, "deceleration": deceleration, "profile": profile,
            "precision": "ideal", "actual_join_velocity": actual_velocity,
            "time_optimal_within_single_move_domain": True}


def _entry_scalar_plan_encoded_join(q0, v0, q_join, v_join, max_velocity, max_acceleration, max_deceleration,
                      position_min=-math.inf, position_max=math.inf, enforce_equal_ad=True,
                      position_resolution=0.1, velocity_resolution=0.1,
                      acceleration_resolution=0.1, position_tolerance=1e-8,
                      velocity_tolerance=1e-8, exact_deceleration_scan=True):
    """生成可下发的 0105 方案，并对实际曲线穿越接入点的速度再做校验。

    默认只接受数值误差内的严格命中；若调用者允许工程误差，必须显式传入
    position_tolerance/velocity_tolerance，结果同时给出真实误差。
    此函数不把未通过的理想解标记为可下发。exact_deceleration_scan=True
    会扫描0.1格点 D；适合最终候选点，不能在全曲线每个采样点都调用。
    """
    if not enforce_equal_ad:
        raise _entry_scalar_JoinInfeasible("当前量化求解器按 PLC 实际 A=D 实现；独立 A/D 必须另行启用适配")
    velocity_cap = min(6553.5, _entry_scalar__grid_floor(max_velocity, velocity_resolution))
    common_acc = min(6553.5, _entry_scalar__grid_floor(min(max_acceleration, max_deceleration), acceleration_resolution))
    if velocity_cap <= 0 or common_acc <= 0:
        raise _entry_scalar_JoinInfeasible("协议精度下没有正数 V/A/D 可下发")
    if abs(v0) > max_velocity + 1e-8 or abs(v_join) > max_velocity + velocity_tolerance:
        raise _entry_scalar_JoinInfeasible("初速或接入速度超过虚轴最大速度")
    candidates = []

    def test(target, velocity, acceleration, branch):
        if min(velocity, acceleration) <= 0:
            return
        if not _entry_scalar__on_grid(target, position_resolution, 1e-8):
            return
        if not _entry_scalar__on_grid(velocity, velocity_resolution, 1e-8):
            return
        if not _entry_scalar__on_grid(acceleration, acceleration_resolution, 1e-8):
            return
        if velocity > velocity_cap + 1e-8 or acceleration > common_acc + 1e-8:
            return
        # 能量关系的必要条件先筛选；不能命中任一真实相位时无需构建完整Move。
        # 仍完整枚举全部0.1格点A，并不跳过可能可行的加速、匀速、减速或初始制动。
        # 位置/速度容差经dq/dv=v/A扩大，避免预筛把量化允许误差内的解误删。
        direction = _entry_scalar__sign(target - q0)
        if direction:
            initial_u = direction * v0
            desired_u = direction * v_join
            energy_tolerance = (position_tolerance
                + (abs(v_join) * velocity_tolerance + .5 * velocity_tolerance ** 2) / acceleration
                + 8 * (math.ulp(q0) + math.ulp(q_join) + math.ulp(target)) + 1e-10)
            possible = False
            base_q, base_u = q0, initial_u
            if initial_u < 0:
                if initial_u - velocity_tolerance <= desired_u <= velocity_tolerance:
                    predicted_q = q0 + direction * (desired_u ** 2 - initial_u ** 2) / (2 * acceleration)
                    possible = abs(predicted_q - q_join) <= energy_tolerance
                base_q = q0 - direction * initial_u ** 2 / (2 * acceleration)
                base_u = 0.0
            elif initial_u > velocity:
                if velocity - velocity_tolerance <= desired_u <= initial_u + velocity_tolerance:
                    predicted_q = q0 + direction * (initial_u ** 2 - desired_u ** 2) / (2 * acceleration)
                    possible = abs(predicted_q - q_join) <= energy_tolerance
                base_q = q0 + direction * (initial_u ** 2 - velocity ** 2) / (2 * acceleration)
                base_u = velocity
            if base_u - velocity_tolerance <= desired_u <= velocity + velocity_tolerance:
                predicted_q = base_q + direction * (desired_u ** 2 - base_u ** 2) / (2 * acceleration)
                possible = possible or abs(predicted_q - q_join) <= energy_tolerance
            # 匀速的q由时间决定；此分支只做速度必要条件，不提前删位置。
            possible = possible or abs(desired_u - velocity) <= velocity_tolerance
            if -velocity_tolerance <= desired_u <= velocity + velocity_tolerance:
                predicted_q = target - direction * desired_u ** 2 / (2 * acceleration)
                possible = possible or abs(predicted_q - q_join) <= energy_tolerance
            if not possible:
                return
        try:
            profile = _entry_scalar_move_profile(q0, v0, target, velocity, acceleration, acceleration,
                                   position_min, position_max)
        except _entry_scalar_JoinInfeasible:
            return
        # 精确位置交点；零速接入允许显式位置容差内的停车目标。
        # 零末速且接入点就是实际停车目标时，完整停车末态是确定的(R,0)。
        # 不选q(t)=R二次方程的近重根，避免舍入误差制造8e-8残余速度的“较早接入”。
        if abs(v_join) <= 1e-12 and abs(target - q_join) <= position_tolerance:
            crossings = [(profile["duration_s"], 0.0)]
        else:
            crossings = _entry_scalar__crossings(profile, q_join)
            if abs(v_join) <= velocity_tolerance and abs(target - q_join) <= position_tolerance:
                crossings.append((profile["duration_s"], 0.0))
        for join_time, actual_velocity in crossings:
            q_actual, v_actual = _entry_scalar_state_at(profile, join_time)
            if abs(q_actual - q_join) <= position_tolerance and abs(v_actual - v_join) <= velocity_tolerance:
                candidates.append({"status": "ok", "send_move": bool(profile["phases"]),
                    "time_s": join_time, "q_join": q_join, "v_join": v_join,
                    "move_target": target, "velocity": velocity, "acceleration": acceleration,
                    "deceleration": acceleration, "profile": profile, "precision": "encoded_0105",
                    "actual_join_position": q_actual, "actual_join_velocity": v_actual,
                    "position_error": q_actual - q_join, "velocity_error": v_actual - v_join,
                    "join_branch": branch, "time_optimal_encoded": False})

    # 反向停车目标可触发初始制动；接入点也可能位于这段制动中。
    # 此时真正停车目标在另一侧，不能要求 qj+vj²/(2D) 为通信位置格点。
    # 例如 q0=76.6,v0=1,D=62，在1.995ms处速度约.876，之后才反向。
    if abs(v0) > 1e-12 and v0 * v_join >= -1e-12 and abs(v_join) <= abs(v0) + 1e-12:
        initial_direction = _entry_scalar__sign(v0)
        initial_distance = initial_direction * (q_join - q0)
        if initial_distance > 1e-12:
            required_deceleration = (v0 * v0 - v_join * v_join) / (2 * initial_distance)
            if 0 < required_deceleration <= common_acc + 1e-7 and _entry_scalar__on_grid(required_deceleration, acceleration_resolution, 1e-6):
                acceleration = round(required_deceleration / acceleration_resolution) * acceleration_resolution
                target = (_entry_scalar__grid_floor(q0 - position_resolution, position_resolution) if v0 > 0
                          else _entry_scalar__grid_ceil(q0 + position_resolution, position_resolution))
                test(target, velocity_cap, acceleration, "initial_reverse_braking")
                # 边界可能不允许反向停车目标；还可把新 V 设得更低，
                # 从而在“当前速度降到新 V”阶段穿过接入点。
                lower_cap = _entry_scalar__grid_floor(min(abs(v_join), velocity_cap), velocity_resolution)
                if lower_cap > 0:
                    stopping_position = q0 + initial_direction * v0 * v0 / (2 * acceleration)
                    target = (_entry_scalar__grid_ceil(stopping_position, position_resolution) if v0 > 0
                              else _entry_scalar__grid_floor(stopping_position, position_resolution))
                    test(target, lower_cap, acceleration, "initial_cap_deceleration")

    if abs(v_join) <= 1e-12:
        # v=0 只能在停车点接入，目标位置必须满足允许的位置误差。
        target = round(q_join / position_resolution) * position_resolution
        test(target, velocity_cap, common_acc, "standstill")
    else:
        direction = _entry_scalar__sign(v_join)
        speed_join = abs(v_join)
        # 减速过点：查最大可下发 D；在严格精确模式，首个可行 D 已经是最快尾段方案。
        count = int(round(common_acc / acceleration_resolution))
        deceleration_indices = range(count, 0, -1) if exact_deceleration_scan else [count]
        for index in deceleration_indices:
            acceleration = index * acceleration_resolution
            ideal_target = q_join + direction * speed_join * speed_join / (2 * acceleration)
            target = round(ideal_target / position_resolution) * position_resolution
            before = len(candidates)
            test(target, velocity_cap, acceleration, "deceleration")
            if len(candidates) > before and velocity_tolerance <= 1e-7 and position_tolerance <= 1e-7:
                break
        # 若接入速度可编码，可把停车点向前取整，让 q_join 位于匀速段。
        # 这能精确经过非格点 q_join，但不一定达到理想峰值方案的最短时间。
        cruise_velocity = round(speed_join / velocity_resolution) * velocity_resolution
        if cruise_velocity > 0 and abs(cruise_velocity - speed_join) <= velocity_tolerance:
            minimal_target = q_join + direction * cruise_velocity ** 2 / (2 * common_acc)
            target = (_entry_scalar__grid_ceil(minimal_target, position_resolution) if direction > 0
                      else _entry_scalar__grid_floor(minimal_target, position_resolution))
            test(target, cruise_velocity, common_acc, "cruise")
        # 加速过点：由 vj²=v0²+2*A*(qj-q0) 求 A；如初速反向，计入先刹停距离。
        projected_initial = direction * v0
        distance = direction * (q_join - q0)
        numerator = speed_join * speed_join - projected_initial * abs(projected_initial)
        if abs(distance) > 1e-12:
            required_acceleration = numerator / (2 * distance)
            if 0 < required_acceleration <= common_acc + 1e-8 and _entry_scalar__on_grid(required_acceleration, acceleration_resolution, 1e-8):
                acceleration = round(required_acceleration / acceleration_resolution) * acceleration_resolution
                minimal_target = q_join + direction * speed_join * speed_join / (2 * acceleration)
                target = (_entry_scalar__grid_ceil(minimal_target, position_resolution) if direction > 0
                          else _entry_scalar__grid_floor(minimal_target, position_resolution))
                test(target, velocity_cap, acceleration, "acceleration")
    if not candidates:
        raise _entry_scalar_JoinInfeasible("在 0105 的位置0.1、速度0.1、A/D0.1精度及指定误差内，无本求解器可下发的单条 Move 接入解")
    result = min(candidates, key=lambda item: item["time_s"])
    result["quantization"] = {"position": position_resolution, "velocity": velocity_resolution,
                              "acceleration": acceleration_resolution}
    result["accepted_tolerance"] = {"position": position_tolerance, "velocity": velocity_tolerance}
    result["time_optimal_encoded"] = (abs(v0) <= 1e-12 and exact_deceleration_scan
                                       and position_tolerance <= 1e-7 and velocity_tolerance <= 1e-7)
    result["optimality_domain"] = ("zero_initial_velocity_single_monotone_jerk_free_move_equal_ad_decimal_grid"
                                   if result["time_optimal_encoded"] else "best_of_explicit_candidates")
    return result


def _entry_scalar_synchronize_stopped_plans(plans, initial_velocities, speed_tolerance=1e-9):
    """允许停稳轴先等待，返回共同接入时刻和各轴等待时间。

    非零初速轴不能停在原地等，不能直接用 max(Ti)-Ti 填等待时间。
    """
    if len(plans) != len(initial_velocities):
        raise ValueError("plans 与 initial_velocities 长度不同")
    common_time = max((plan["time_s"] for plan in plans), default=0.0)
    delays = []
    for plan, initial_velocity in zip(plans, initial_velocities):
        delay = common_time - plan["time_s"]
        if delay > 1e-8 and abs(initial_velocity) > speed_tolerance:
            raise _entry_scalar_JoinInfeasible("非零初速轴不能直接等待：需要共同时间重规划或先统一刹停")
        delays.append(max(0.0, delay))
    return {"common_time_s": common_time, "delay_s": delays}


def _entry_scalar_solve(q0, v0, qj, vj, Vmax, Amax, Dmax, bounds=None, precision=None,
          q_tol=1e-8, v_tol=1e-8, mode="encoded", force_initial_stop=False,
          allow_reposition=False, exact_deceleration_scan=True):
    """面向主流程的包装：返回 moves 和真实过点结果，无解返回 status=infeasible。

    bounds=[最小位置,最大位置]；precision={position:.1,velocity:.1,acceleration:.1}。
    非零初速可以 force_initial_stop=True，先执行真实停车 Move；共同时间需要
    等待时，应放到该停车命令之后，绝不能让正在运动的轴凭空等待。
    allow_reposition=True 可增加“先停车到接入点后方”的命令，属于可行备选，
    不宣称它在多段准备命令集合中达到全局最短。
    """
    position_min, position_max = bounds if bounds is not None else (-math.inf, math.inf)
    precision = precision or {}
    position_resolution = float(precision.get("position", 0.1))
    velocity_resolution = float(precision.get("velocity", 0.1))
    acceleration_resolution = float(precision.get("acceleration", 0.1))
    moves, elapsed = [], 0.0
    initial_q, initial_v = q0, v0

    def make_plan(start_q, start_v):
        if mode == "ideal":
            return _entry_scalar_plan_ideal_join(start_q, start_v, qj, vj, Vmax, Amax, Dmax,
                                   position_min, position_max, True)
        if mode != "encoded":
            raise ValueError("mode 必须是 encoded 或 ideal")
        return _entry_scalar_plan_encoded_join(start_q, start_v, qj, vj, Vmax, Amax, Dmax,
                                 position_min, position_max, True,
                                 position_resolution, velocity_resolution, acceleration_resolution,
                                 q_tol, v_tol, exact_deceleration_scan)

    def add_move(plan, consume_full_stop=False, purpose="join"):
        nonlocal elapsed
        if not plan["send_move"]:
            return
        duration = plan["profile"]["duration_s"] if consume_full_stop else plan["time_s"]
        moves.append({"start_s": elapsed, "duration_s": duration,
                      "full_stop_duration_s": plan["profile"]["duration_s"],
                      "move_target": plan["move_target"], "velocity": plan["velocity"],
                      "acceleration": plan["acceleration"], "deceleration": plan["deceleration"],
                      "purpose": purpose})
        elapsed += duration

    def make_stop(start_q, start_v):
        acceleration = min(Amax, Dmax)
        velocity = Vmax
        if mode == "encoded":
            acceleration = min(6553.5, _entry_scalar__grid_floor(acceleration, acceleration_resolution))
            velocity = min(6553.5, _entry_scalar__grid_floor(Vmax, velocity_resolution))
        if min(acceleration, velocity) <= 0:
            raise _entry_scalar_JoinInfeasible("协议精度下没有停车用正数 V/A/D")
        target = start_q + start_v * abs(start_v) / (2 * acceleration)
        if mode == "encoded":
            target = (_entry_scalar__grid_ceil(target, position_resolution) if start_v > 0
                      else _entry_scalar__grid_floor(target, position_resolution))
            # V 低于初速时库先减速；取尽量接近当前速度，避免停车前额外加速。
            velocity = min(velocity, max(velocity_resolution, _entry_scalar__grid_floor(abs(start_v), velocity_resolution)))
        profile = _entry_scalar_move_profile(start_q, start_v, target, velocity, acceleration, acceleration,
                               position_min, position_max)
        return {"send_move": bool(profile["phases"]), "time_s": profile["duration_s"],
                "profile": profile, "move_target": target, "velocity": velocity,
                "acceleration": acceleration, "deceleration": acceleration}

    try:
        if force_initial_stop and abs(v0) > 1e-12:
            stop = make_stop(q0, v0)
            add_move(stop, True, "stop_before_wait")
            q0, v0 = stop["move_target"], 0.0
        try:
            plan = make_plan(q0, v0)
        except _entry_scalar_JoinInfeasible:
            if not allow_reposition:
                raise
            if abs(v0) > 1e-12:
                stop = make_stop(q0, v0)
                add_move(stop, True, "stop_before_reposition")
                q0, v0 = stop["move_target"], 0.0
            direction = _entry_scalar__sign(vj) or _entry_scalar__sign(qj - q0)
            if not direction:
                raise _entry_scalar_JoinInfeasible("同位置初速处理后仍无接入方向")
            common_acceleration = min(Amax, Dmax)
            if mode == "encoded":
                common_acceleration = _entry_scalar__grid_floor(common_acceleration, acceleration_resolution)
            if common_acceleration <= 0:
                raise _entry_scalar_JoinInfeasible("没有可表示的正数加速度")
            launch = qj - direction * max(vj * vj / (2 * common_acceleration), position_resolution)
            if mode == "encoded":
                launch = (_entry_scalar__grid_floor(launch, position_resolution) if direction > 0
                          else _entry_scalar__grid_ceil(launch, position_resolution))
            if mode == "ideal":
                reposition = _entry_scalar_plan_ideal_join(q0, 0, launch, 0, Vmax, Amax, Dmax,
                                             position_min, position_max)
            else:
                reposition = _entry_scalar_plan_encoded_join(q0, 0, launch, 0, Vmax, Amax, Dmax,
                    position_min, position_max, True, position_resolution, velocity_resolution,
                    acceleration_resolution, q_tol, v_tol, False)
            add_move(reposition, True, "reposition_at_rest")
            q0, v0 = launch, 0.0
            plan = make_plan(q0, v0)
        prefix_time = elapsed
        add_move(plan)
        q_actual, v_actual = _entry_scalar_state_at(plan["profile"], plan["time_s"])
        return {"status": "ok", "mode": mode, "moves": moves, "join_time": elapsed,
                "join_time_s": elapsed, "q_error": q_actual - qj, "v_error": v_actual - vj,
                "q_actual": q_actual, "v_actual": v_actual, "q_join": qj, "v_join": vj,
                "wait_allowed_at_start": abs(initial_v) <= 1e-12,
                "wait_anchor_s": prefix_time if abs(v0) <= 1e-12 else None,
                "initial_position": initial_q, "initial_velocity": initial_v,
                "single_move": len(moves) <= 1,
                "time_optimality": ("ideal_single_move_domain" if mode == "ideal" and len(moves) <= 1
                    else ("encoded_zero_initial_single_monotone_equal_ad_grid_optimum"
                          if len(moves) <= 1 and abs(initial_v) <= 1e-12 and plan.get("time_optimal_encoded")
                          else "best_of_explicit_encoded_candidates; not_general_global_optimum")),
                "solver_note": "需在共同接入时刻覆盖最后一条 Move，避免继续驶向停车目标"}
    except _entry_scalar_JoinInfeasible as error:
        return {"status": "infeasible", "message": str(error), "mode": mode,
                "moves": [], "join_time": None, "q_error": None, "v_error": None}




def _entry_fast__floor_grid(value, grid):
    return math.floor(value / grid + 1e-10) * grid


def _entry_fast__ceil_grid(value, grid):
    return math.ceil(value / grid - 1e-10) * grid


def _entry_fast__ideal_candidates(q0, v0, qj, vj, velocity, acceleration):
    """无位置约束理想最短候选；signed_peak可为负，不能擅自丢弃。"""
    result = []
    for direction in (-1.0, 1.0):
        u0, uj, distance = direction * v0, direction * vj, direction * (qj - q0)
        radicand = acceleration * distance + .5 * (u0 * u0 + uj * uj)
        if radicand >= -1e-10:
            root = math.sqrt(max(0.0, radicand))
            for peak in ({root, -root} if root else {0.0}):
                first = (peak - u0) / acceleration
                last = (peak - uj) / acceleration
                if min(first, last) >= -1e-10 and max(abs(peak), abs(u0), abs(uj)) <= velocity + 1e-10:
                    result.append({'direction': direction, 'peak': peak, 'first_s': max(0.0, first),
                                   'cruise_s': 0.0, 'last_s': max(0.0, last),
                                   'total_s': max(0.0, first) + max(0.0, last)})
        # 若达到速度上限，第一条Move还需要执行一段匀速。
        peak = velocity
        first = (peak - u0) / acceleration
        last = (peak - uj) / acceleration
        cruise_distance = distance - (2 * peak * peak - u0 * u0 - uj * uj) / (2 * acceleration)
        cruise = cruise_distance / peak
        if min(first, last, cruise) >= -1e-10:
            result.append({'direction': direction, 'peak': peak, 'first_s': max(0.0, first),
                           'cruise_s': max(0.0, cruise), 'last_s': max(0.0, last),
                           'total_s': max(0.0, first) + max(0.0, cruise) + max(0.0, last)})
    return sorted(result, key=lambda item: item['total_s'])


def _entry_fast__verify_stage(profile, duration, q0, v0, acceleration, qtol, vtol):
    """对恒A目标核验真实Move全部相位边界和q误差内部极值。"""
    probes = {0.0, duration}
    elapsed = 0.0
    for phase_duration, q, v, actual_acceleration in profile['phases']:
        left, right = max(0.0, elapsed), min(duration, elapsed + phase_duration)
        if left <= right:
            probes.update((left, right))
            actual_v = v + actual_acceleration * (left - elapsed)
            delta_acceleration = actual_acceleration - acceleration
            if abs(delta_acceleration) > 1e-15:
                root = left - (actual_v - v0 - acceleration * left) / delta_acceleration
                if left < root < right:
                    probes.add(root)
        elapsed += phase_duration
    max_qerr, max_verr = 0.0, 0.0
    for time in probes:
        actual_q, actual_v = _entry_scalar_state_at(profile, time)
        desired_q = q0 + v0 * time + .5 * acceleration * time * time
        desired_v = v0 + acceleration * time
        max_qerr = max(max_qerr, abs(actual_q - desired_q))
        max_verr = max(max_verr, abs(actual_v - desired_v))
    return max_qerr <= qtol and max_verr <= vtol, max_qerr, max_verr


def _entry_fast__near_target(q_start, q_end, v_end, control_direction, acceleration, grid):
    """尽量近的真实停车目标；仍须完整Move复核，不能只靠本公式放行。"""
    raw = q_end + control_direction * v_end ** 2 / (2 * acceleration) if v_end * control_direction > 1e-12 else q_start
    if control_direction > 0:
        return _entry_fast__ceil_grid(max(raw, q_start + grid), grid)
    return _entry_fast__floor_grid(min(raw, q_start - grid), grid)


def _entry_fast__profile_controls_match(profile, q0, v0, first, cruise, last, direction, acceleration, qtol, vtol):
    """整条Move与三段理想控制比较，用于同最短时间优先合成一条Move。"""
    total = first + cruise + last
    boundaries = {0.0, first, first + cruise, total}
    elapsed = 0.0
    for duration, _, _, _ in profile['phases']:
        elapsed += duration
        if 0 < elapsed < total: boundaries.add(elapsed)
    switch_q = q0 + v0 * first + .5 * direction * acceleration * first ** 2
    switch_v = v0 + direction * acceleration * first
    after_cruise_q = switch_q + switch_v * cruise
    def desired(t):
        if t <= first:
            return q0 + v0 * t + .5 * direction * acceleration * t ** 2, v0 + direction * acceleration * t
        if t <= first + cruise:
            return switch_q + switch_v * (t - first), switch_v
        u = t - first - cruise
        return after_cruise_q + switch_v * u - .5 * direction * acceleration * u ** 2, switch_v - direction * acceleration * u
    times = sorted(boundaries)
    for left, right in zip(times, times[1:]):
        aq0, av0 = _entry_scalar_state_at(profile, left)
        aq1, av1 = _entry_scalar_state_at(profile, right)
        dq0, dv0 = desired(left);dq1,dv1=desired(right)
        if max(abs(aq0-dq0),abs(aq1-dq1))>qtol or max(abs(av0-dv0),abs(av1-dv1))>vtol:
            return False
        interval = right-left
        if interval > 0:
            delta_a=((av1-dv1)-(av0-dv0))/interval
            if abs(delta_a)>1e-15:
                root=left-(av0-dv0)/delta_a
                if left<root<right:
                    aq,av=_entry_scalar_state_at(profile,root);dq,dv=desired(root)
                    if abs(aq-dq)>qtol or abs(av-dv)>vtol:return False
    return True


def _entry_fast_fast_solve(q0, v0, qj, vj, Vmax, Amax, Dmax, bounds=None, precision=None,
               q_tol=1e-7, v_tol=1e-7, force_initial_stop=False, stop_cache=None):
    """返回同scalar.solve主要结构；不做0.1格点A遍历，失败时明确要求回退。

    若成功时间=无位置约束理想下界，则在当前可编码最大V/A/D、所给限位内
    证明最短。若只较慢候选可执行，则标明不是已证明最短。
    共同等待只允许轴起初停稳；非零初速等待需上层另做真实制动计划。
    """
    precision = precision or {}
    position_grid = float(precision.get('position', .1))
    velocity_grid = float(precision.get('velocity', .1))
    acceleration_grid = float(precision.get('acceleration', 0.1))
    if min(position_grid, velocity_grid, acceleration_grid) <= 0:
        return {'status': 'infeasible', 'message': '协议精度须大于0', 'moves': []}
    if bounds is None or not all(math.isfinite(float(x)) for x in bounds):
        return {'status': 'infeasible', 'message': '边界Move实验求解需要有限位置上下限', 'moves': []}
    low = max(float(bounds[0]), -214748364.8)
    high = min(float(bounds[1]), 214748364.7)
    low_target, high_target = _entry_fast__ceil_grid(low, position_grid), _entry_fast__floor_grid(high, position_grid)
    velocity = min(6553.5, 65535 * velocity_grid, _entry_fast__floor_grid(float(Vmax), velocity_grid))
    acceleration = min(6553.5, 65535 * acceleration_grid, _entry_fast__floor_grid(min(float(Amax), float(Dmax)), acceleration_grid))
    if not all(math.isfinite(float(x)) for x in (q0, v0, qj, vj, velocity, acceleration)):
        return {'status': 'infeasible', 'message': '状态及上限须为有限数', 'moves': []}
    if low > high or min(velocity, acceleration) <= 0:
        return {'status': 'infeasible', 'message': '无可用位置行程或正数V/A/D', 'moves': []}
    if not all(low - q_tol <= q <= high + q_tol for q in (q0, qj)):
        return {'status': 'infeasible', 'message': '初始/接入位置超限', 'moves': []}
    if max(abs(v0), abs(vj)) > velocity + v_tol:
        return {'status': 'infeasible', 'message': '初始/接入速度超过可编码速度上限', 'moves': []}
    if force_initial_stop and abs(v0)>1e-12:
        cache_key=(q0,v0,velocity,acceleration,low,high,position_grid)
        cached=stop_cache.get(cache_key) if stop_cache is not None else None
        if cached is None:
            raw=q0+v0*abs(v0)/(2*acceleration)
            # 向外取最近可编码停车格点；当前反馈不在格点时，不能额外多推整整一格。
            stop_target=_entry_fast__ceil_grid(raw,position_grid) if v0>0 else _entry_fast__floor_grid(raw,position_grid)
            if abs(stop_target-q0)<=1e-8:
                stop_target=(_entry_fast__ceil_grid(q0+position_grid,position_grid) if v0>0
                             else _entry_fast__floor_grid(q0-position_grid,position_grid))
            try:
                stop=_entry_scalar_move_profile(q0,v0,stop_target,velocity,acceleration,acceleration,low,high)
            except (ValueError,ArithmeticError,AssertionError) as error:
                return {'status':'infeasible','message':'真实停车前缀不可行: '+str(error),'moves':[]}
            if stop_cache is not None:stop_cache[cache_key]=(stop_target,stop)
        else:
            stop_target,stop=cached
        stopped=_entry_fast_fast_solve(stop_target,0.0,qj,vj,Vmax,Amax,Dmax,bounds,precision,q_tol,v_tol,False)
        if stopped['status']!='ok':return stopped
        duration=stop['duration_s']
        stop_move={'start_s':0.0,'duration_s':duration,'full_stop_duration_s':duration,
            'move_target':stop_target,'velocity':velocity,'acceleration':acceleration,'deceleration':acceleration,
            'purpose':'stop_before_wait'}
        stopped['moves']=[stop_move]+[{**move,'start_s':move['start_s']+duration} for move in stopped['moves']]
        stopped['join_time_s']+=duration;stopped['join_time']=stopped['join_time_s']
        stopped['wait_allowed_at_start']=False;stopped['wait_anchor_s']=duration
        stopped['initial_position']=q0;stopped['initial_velocity']=v0
        stopped['time_optimality']='feasible_stop_then_bang_not_general_global_optimum'
        stopped['attains_ideal_lower_bound']=False
        stopped['stop_then_subproblem_lower_bound_s']=stopped.get('ideal_lower_bound_s')
        original_ideal=_entry_fast__ideal_candidates(q0,v0,qj,vj,velocity,acceleration)
        stopped['ideal_lower_bound_s']=original_ideal[0]['total_s'] if original_ideal else 0.0
        stopped['single_move']=len(stopped['moves'])<=1
        stopped['requires_timed_multi_move']=len(stopped['moves'])>1
        return stopped
    if abs(q0 - qj) <= q_tol and abs(v0 - vj) <= v_tol:
        return {'status': 'ok', 'mode': 'encoded_boundary_bang_candidate', 'moves': [], 'join_time': 0.0,
                'join_time_s': 0.0, 'q_error': q0 - qj, 'v_error': v0 - vj, 'q_actual': q0,
                'v_actual': v0, 'q_join': qj, 'v_join': vj,
                'wait_allowed_at_start': abs(v0) <= 1e-12,
                'wait_anchor_s': 0.0 if abs(v0) <= 1e-12 else None,
                'single_move': True, 'time_optimality': 'already_at_join_state',
                'initial_position': q0, 'initial_velocity': v0, 'ideal_lower_bound_s': 0.0,
                'requires_timed_multi_move': False}
    ideals = _entry_fast__ideal_candidates(q0, v0, qj, vj, velocity, acceleration)
    if not ideals:
        return {'status': 'infeasible', 'message': '未找到理想bang-bang候选', 'moves': []}
    lower_bound = ideals[0]['total_s']
    failures = []
    for ideal in ideals:
        direction, first, cruise, last = ideal['direction'], ideal['first_s'], ideal['cruise_s'], ideal['last_s']
        moves, elapsed, q, v = [], 0.0, q0, v0
        try:
            if first + cruise > 1e-15:
                predicted_v=v+direction*acceleration*first
                predicted_q=q+v*first+.5*direction*acceleration*first**2+predicted_v*cruise
                near=_entry_fast__near_target(q,predicted_q,predicted_v,direction,acceleration,position_grid)
                chosen=None
                first_targets=(near,high_target if direction>0 else low_target)
                if abs(vj)<=1e-12 and last<=1e-15:
                    stopped_target=round(qj/position_grid)*position_grid
                    first_targets=(stopped_target,) if abs(stopped_target-qj)<=q_tol else ()
                for target in first_targets:
                    try:
                        profile=_entry_scalar_move_profile(q,v,target,velocity,acceleration,acceleration,low,high)
                        if _entry_fast__profile_controls_match(profile,q,v,first,cruise,0.0,direction,acceleration,q_tol,v_tol):
                            chosen=(target,profile);break
                    except (ValueError,ArithmeticError,AssertionError):pass
                if chosen is None:raise _entry_scalar_JoinInfeasible('第一Move提前制动或改变理想控制相位')
                target,profile=chosen
                duration = first + cruise
                moves.append({'start_s': 0.0, 'duration_s': duration, 'full_stop_duration_s': profile['duration_s'],
                              'move_target': target, 'velocity': velocity, 'acceleration': acceleration,
                              'deceleration': acceleration, 'purpose': 'bang_first_and_cruise'})
                elapsed += duration
                q, v = _entry_scalar_state_at(profile, duration)
            if last > 1e-15:
                near=_entry_fast__near_target(q,qj,vj,-direction,acceleration,position_grid)
                chosen=None
                last_targets=(near,low_target if direction>0 else high_target)
                if abs(vj)<=1e-12:
                    stopped_target=round(qj/position_grid)*position_grid
                    last_targets=(stopped_target,) if abs(stopped_target-qj)<=q_tol else ()
                for target in last_targets:
                    try:
                        profile=_entry_scalar_move_profile(q,v,target,velocity,acceleration,acceleration,low,high)
                        valid,qe,ve=_entry_fast__verify_stage(profile,last,q,v,-direction*acceleration,q_tol,v_tol)
                        if valid:chosen=(target,profile);break
                    except (ValueError,ArithmeticError,AssertionError):pass
                if chosen is None:raise _entry_scalar_JoinInfeasible('第二Move提前制动或改变理想控制相位')
                target,profile=chosen
                moves.append({'start_s': elapsed, 'duration_s': last, 'full_stop_duration_s': profile['duration_s'],
                              'move_target': target, 'velocity': velocity, 'acceleration': acceleration,
                              'deceleration': acceleration, 'purpose': 'bang_last'})
                elapsed += last
                q, v = _entry_scalar_state_at(profile, last)
            if abs(q - qj) > q_tol or abs(v - vj) > v_tol:
                raise _entry_scalar_JoinInfeasible('完整真实Move计划未在理想时间命中接入q/v')
            # 同样最短时间优先只发一条Move；不为此扫描所有0.1格点A。
            if len(moves)>1:
                tail=qj+(1 if vj>0 else -1 if vj<0 else 0)*vj*vj/(2*acceleration)
                targets={move['move_target'] for move in moves}
                targets.update((_entry_fast__floor_grid(tail,position_grid),_entry_fast__ceil_grid(tail,position_grid)))
                caps={velocity}
                if abs(abs(vj)-round(abs(vj)/velocity_grid)*velocity_grid)<=v_tol and abs(vj)>0:
                    caps.add(round(abs(vj)/velocity_grid)*velocity_grid)
                single=[]
                for target in targets:
                    for cap in caps:
                        if not 0<cap<=velocity:continue
                        try:
                            profile=_entry_scalar_move_profile(q0,v0,target,cap,acceleration,acceleration,low,high)
                            if _entry_fast__profile_controls_match(profile,q0,v0,first,cruise,last,direction,acceleration,q_tol,v_tol):
                                aq,av=_entry_scalar_state_at(profile,elapsed)
                                if abs(aq-qj)<=q_tol and abs(av-vj)<=v_tol:
                                    single.append((abs(target-qj),target,cap,profile,aq,av))
                        except (ValueError,ArithmeticError,AssertionError):pass
                if single:
                    _,target,cap,profile,q,v=min(single,key=lambda item:item[:3])
                    moves=[{'start_s':0.0,'duration_s':elapsed,'full_stop_duration_s':profile['duration_s'],
                        'move_target':target,'velocity':cap,'acceleration':acceleration,'deceleration':acceleration,
                        'purpose':'same_optimal_time_single_move'}]
            if abs(vj)<=1e-12 and moves:
                terminal=moves[-1]
                if abs(terminal['move_target']-qj)>q_tol or terminal['full_stop_duration_s']>terminal['duration_s']+1e-8:
                    raise _entry_scalar_JoinInfeasible('零末速必须真实停在接入点，不能在反向Move转折点瞬时为零后离开')
            proved = abs(elapsed - lower_bound) <= 1e-9
            return {'status': 'ok', 'mode': 'encoded_boundary_bang_candidate', 'moves': moves,
                    'join_time': elapsed, 'join_time_s': elapsed, 'q_error': q - qj, 'v_error': v - vj,
                    'q_actual': q, 'v_actual': v, 'q_join': qj, 'v_join': vj,
                    'wait_allowed_at_start': abs(v0) <= 1e-12,
                    'wait_anchor_s': 0.0 if abs(v0) <= 1e-12 else None,
                    'initial_position': q0, 'initial_velocity': v0, 'single_move': len(moves) <= 1,
                    'time_optimality': 'attains_ideal_grid_limit_lower_bound' if proved else 'feasible_boundary_bang_candidate_not_proved_optimal',
                    'ideal_lower_bound_s': lower_bound, 'attains_ideal_lower_bound': proved,
                    'requires_timed_multi_move': len(moves) > 1,
                    'q_tolerance': q_tol, 'v_tolerance': v_tol,
                    'solver_note': '必须按准确相对时刻覆盖准备Move，并在接入时覆盖到原曲线；旧停稳准备接口不兼容'}
        except (ValueError, ArithmeticError, AssertionError) as error:
            failures.append(str(error))
    return {'status': 'infeasible', 'message': '边界Move不能完整覆盖理想bang-bang相位；须退回原求解器',
            'moves': [], 'ideal_lower_bound_s': lower_bound, 'candidate_failures': failures}




def _entry_bound__point_minimum(q0,v0,q,v,velocity,acceleration):
    # Same arithmetic/feasibility candidates; no dictionaries, result list or sorting.
    if q==q0 and v==v0:
        return 0.0
    answer=math.inf
    limit=velocity+1e-10
    for direction in (-1.0,1.0):
        u0=direction*v0
        uj=direction*v
        distance=direction*(q-q0)
        radicand=acceleration*distance+.5*(u0*u0+uj*uj)
        if radicand>=-1e-10:
            root=math.sqrt(0.0 if radicand<0.0 else radicand)
            if root<=limit and abs(u0)<=limit and abs(uj)<=limit:
                first=(root-u0)/acceleration
                last=(root-uj)/acceleration
                if first>=-1e-10 and last>=-1e-10:
                    total=(first if first>0.0 else 0.0)+(last if last>0.0 else 0.0)
                    if total<answer:answer=total
                if root:
                    peak=-root
                    first=(peak-u0)/acceleration
                    last=(peak-uj)/acceleration
                    if first>=-1e-10 and last>=-1e-10:
                        total=(first if first>0.0 else 0.0)+(last if last>0.0 else 0.0)
                        if total<answer:answer=total
        peak=velocity
        first=(peak-u0)/acceleration
        last=(peak-uj)/acceleration
        cruise_distance=distance-(2*peak*peak-u0*u0-uj*uj)/(2*acceleration)
        cruise=cruise_distance/peak
        if first>=-1e-10 and last>=-1e-10 and cruise>=-1e-10:
            total=(first if first>0.0 else 0.0)+(cruise if cruise>0.0 else 0.0)+(last if last>0.0 else 0.0)
            if total<answer:answer=total
    return answer

def _entry_bound_tolerant_bang_lower_bound(q0,v0,qj,vj,vmax,acc,qtol,vtol,low=-math.inf,high=math.inf):
    """秒。返回容差矩形内理想最短时间（减去保守浮点裕量）。

    每个bang分支的时间对q严格单调，故极小值只能在矩形边界或分支
    可行域边界。固定q边界，dT/dv=0或相位消失给出
    v²=v0²±2A(q-q0)；固定v边界，相位消失给出
    q=q0±(v²-v0²)/(2A)。另加入零峰值分支边界、v0/0切面，避免
    在带速回转/身份状态附近遗漏退化分支。限速平台只会增加v=±V边界。
    """
    qlo,qhi=max(low,qj-qtol),min(high,qj+qtol)
    vlo,vhi=max(-vmax,vj-vtol),min(vmax,vj+vtol)
    if qlo>qhi or vlo>vhi or abs(v0)>vmax+1e-10:
        return math.inf
    if qlo<=q0<=qhi and vlo<=v0<=vhi:
        return 0.0
    if min(vmax,acc)<=0:
        return math.inf
    states=set()
    def add(q,v):
        if qlo<=q<=qhi and vlo<=v<=vhi:
            states.add((q,v))
    qcuts=[qlo,qhi]
    vcuts=[vlo,vhi]
    if qlo<=q0<=qhi:qcuts.append(q0)
    if vlo<=v0<=vhi:vcuts.append(v0)
    if vlo<=0.0<=vhi:vcuts.append(0.0)
    for q in qcuts:
        for v in vcuts:add(q,v)
        displacement=q-q0
        for sign in (-1.0,1.0):
            for square in (v0*v0+sign*2*acc*displacement,
                           -v0*v0+sign*2*acc*displacement):
                if square>=0:
                    root=math.sqrt(square)
                    add(q,root);add(q,-root)
    for v in vcuts:
        for sign in (-1.0,1.0):
            add(q0+sign*(v*v-v0*v0)/(2*acc),v)
            add(q0+sign*(v*v+v0*v0)/(2*acc),v)
    answer=min((_entry_bound__point_minimum(q0,v0,q,v,vmax,acc) for q,v in states),default=math.inf)
    if not math.isfinite(answer):return answer
    # 在退化单相位/近零峰处sqrt会放大ULP，显式向下留极小数值裕量。
    position_ulp=math.ulp(q0)+math.ulp(qlo)+math.ulp(qhi)
    guard=1e-10*(1+answer)+8*math.sqrt(position_ulp/acc)
    return max(0.0,answer-guard)


##########################非强制连续曲线：位置和速度一起接入##########################
# 强制分支仍调用原v4；本节只替换非强制分支，不把接入位置当成Move停车点。

def _nf_state(model, frame, direction=1, factor=1.0):
    """在同一原帧求位置/有符号速度；模型区间之外按停稳位置保持。"""
    pieces = model['segments']
    if frame < pieces[0]['start_frame']:
        return list(pieces[0]['start_HPY']), [0.0]*3
    if frame > pieces[-1]['end_frame']:
        return list(pieces[-1]['target_HPY']), [0.0]*3
    starts = model['_nf_piece_starts']
    index = max(0, min(len(pieces)-1, bisect_right(starts, frame)-1))
    piece = pieces[index]
    if frame > piece['end_frame']:
        return list(piece['target_HPY']), [0.0]*3
    q, v = _evaluate_base_action_segment(piece, frame)
    return q, [x*direction*factor for x in v]


def _nf_motor_weights(model, low, high):
    """保守电机速度包络=sum(weight_i*abs(v_i))，覆盖整个声明行程。"""
    kind = model['model_type']
    if kind == 1:
        return [1.0, 0.0, 0.0]
    base_names=('Baseheight1','Baseheight2') if kind==8 else ('BaseHight1','BaseHight2')
    b1,b2=(model.get(n) for n in base_names)
    if b1 is None or b2 is None or not ((b1>0 and b2==0) or (b1==0 and b2>0)) or model.get('maxheight',0)<=0:
        raise ValueError('模型须恰有一个正基准高度，且maxheight>0')
    rad = math.pi/180
    if kind in (2, 4):
        if model.get('lLenth_inside',0)<=0 or (kind==4 and model.get('wLenth_inside',0)<=0):
            raise ValueError('吊点间距必须大于0')
        if model['motor_num']!=kind:
            raise ValueError('两点/四点的motor_num必须与几何模型一致')
        if kind==4 and model.get('moveWhat') not in (1,2):
            raise ValueError('四点须明确moveWhat=1(P)或2(Y)')
        axis = 2 if kind == 4 and model.get('moveWhat', 1) == 2 else 1
        span = float(model['wLenth_inside'] if axis == 2 else model['lLenth_inside'])/2
        angle = max(abs(low[axis]), abs(high[axis]))
        weights = [1.0, 0.0, 0.0]
        weights[axis] = span*rad+3*span*angle**2/90**3
        return weights
    points = model['point_init_pos']
    if len(points)<3 or model['motor_num']!=len(points) or len({tuple(p[:2]) for p in points})!=len(points):
        raise ValueError('多点须至少3个不重复吊点，motor_num须与吊点数量一致')
    radius = max(math.hypot(p[0],p[1]) for p in points)
    if radius<=1e-12 or 'betainit' not in model:
        raise ValueError('多点几何退化或缺少betainit')
    area = sum(p[0]*q[1]-p[1]*q[0] for p,q in zip(points,points[1:]+points[:1]))
    orientation = 1 if area > 0 else -1
    rmin = math.inf
    for p,q in zip(points,points[1:]+points[:1]):
        dx,dy = q[0]-p[0],q[1]-p[1]
        edge = math.hypot(dx,dy)
        if edge <= 0:
            raise ValueError('多点吊点边退化')
        distance = orientation*(p[0]*q[1]-p[1]*q[0])/edge
        if distance <= radius*1e-10 or any(orientation*(dx*(r[1]-p[1])-dy*(r[0]-p[0])) < -radius*edge*1e-10 for r in points):
            raise ValueError('多点吊点须为包含原点的有序凸多边形')
        rmin = min(rmin,distance)
    b1,b2 = model['Baseheight1'],model['Baseheight2']
    heights = [h+b1 if b1 > 0 else b2+model['maxheight']-h for h in (low[0],high[0])]
    if min(heights) < 0:
        raise ValueError('多点允许行程内的有效高度为负')
    nmin = min(100.0,1.73+.52*min(heights)/radius)
    nmax = min(100.0,1.73+.52*max(heights)/rmin)
    if math.log(radius)+nmax*max(0,math.log(max(abs(low[1]),abs(high[1]))*rad or 1e-300))>700:
        raise ValueError('多点声明角度/尺寸可能使正解溢出')
    return [1+.52/(math.e*nmin), radius*rad+radius*nmax*rad/1.5707963,
            (3*radius+(1+(nmax-1.73)/(math.e*nmin))*radius**2/rmin)*rad]


def _nf_prepare_inputs(parameters):
    """复用原校验器的模型/系数校验；真实初速另存，绝不当作已经停稳。"""
    source = parameters if 'models' in parameters else _adapt_legacy_parameters(parameters)
    copied = copy.deepcopy(source)
    actual = {}
    for m in copied['models']:
        route = (m['plc_id'],m['model_id'])
        v = _hpy(m.get('current_velocity_HPY',[0,0,0]),'current_velocity_HPY')
        if m.get('standstill') is True and any(abs(x)>1e-7 for x in v):
            raise ValueError('standstill=true与非零当前速度矛盾')
        actual[route] = v
        # 原归一器只接受停稳；这里仅借用其位置/几何/系数校验，不使用其准备求解。
        m['current_velocity_HPY'] = [0,0,0]
        m['standstill'] = True
    inputs = _normalize_inputs(copied)
    settings = source.get('settings',{})
    qtol = _hpy(settings.get('join_position_tolerance_HPY',[1e-7]*3),'join_position_tolerance_HPY',True)
    vtol = _hpy(settings.get('join_velocity_tolerance_HPY',[1e-7]*3),'join_velocity_tolerance_HPY',True)
    factor = _number(source['command'].get('speed_factor',1),'speed_factor')
    if factor <= 0:
        raise ValueError('speed_factor须大于0')
    inputs.update(current_velocities={},nf_limits={},nf_qtol=qtol,nf_vtol=vtol,nf_factor=factor)
    originals = {(m['plc_id'],m['model_id']):m for m in source['models']}
    for model in inputs['curve_action']['models']:
        key = model['index'];route = inputs['routes'][key]
        raw = originals[(route['plc_id'],route['model_id'])]
        current = inputs['current_positions'][key]
        initial_v = actual[(route['plc_id'],route['model_id'])]
        low = _hpy(raw.get('min_position_HPY'),'min_position_HPY')
        high = _hpy(raw.get('max_position_HPY'),'max_position_HPY')
        if any(lo>hi or lo < -214748364.8 or hi>214748364.7 for lo,hi in zip(low,high)):
            raise ValueError('位置上下限无效或超出0105有符号0.1位置字段')
        for axis in range(3):
            if not low[axis]-qtol[axis] <= current[axis] <= high[axis]+qtol[axis]:
                raise ValueError('当前位置超出声明行程')
        weights = _nf_motor_weights(model,low,high)
        active=inputs['active_axes_by_model'][key]
        if model['model_type']==4:
            unused='Y' if model['moveWhat']==1 else 'P'
            if unused in active or any(abs(p['a'][AXIS_NAMES.index(unused)])>1e-10 for p in model['segments']) or abs(current[AXIS_NAMES.index(unused)])>1e-10:
                raise ValueError('四点的活动轴/当前姿态与moveWhat不一致')
        if any(abs(initial_v[a])>1e-10 for a in range(3) if AXIS_NAMES[a] not in active):
            raise ValueError('非准备轴/不存在的轴不能有非零当前速度')
        needs_motion=[abs(initial_v[a])>1e-10 or any(
            abs(p['a'][a]-current[a])>qtol[a] or any(p[n][a]!=0 for n in 'bcdef')
            for p in model['segments']) for a in range(3)]
        vmax = [v if AXIS_NAMES[a] in active and needs_motion[a] else 0.0
                for a,v in enumerate(inputs['max_velocities'][key])]
        bound = sum(weights[a]*vmax[a] for a in range(3))
        scale = min(1.0,model['max_motor_velocity']/bound) if bound else 1.0
        vmax = [min(6553.5,math.floor(v*scale*10+1e-9)/10) for v in vmax]
        acc = [min(6553.5,math.floor(min(a,d)*10+1e-9)/10) for a,d in zip(inputs['max_accelerations'][key],inputs['max_decelerations'][key])]
        for a in range(3):
            if AXIS_NAMES[a] in active and needs_motion[a] and min(vmax[a],acc[a])<=0:
                raise ValueError('协议及电机速度包络下没有正数V/A/D可用于活动轴')
            if abs(initial_v[a]) > vmax[a]+vtol[a]:
                raise ValueError('当前初速超过准备限速包络，不能宣称本次准备全程不超限')
        model['_nf_piece_starts'] = [p['start_frame'] for p in model['segments']]
        # 非强制真实Move只支持分段恒加速度/匀速；不把任意五次曲线冒充Move。
        previous = None
        for p in model['segments']:
            if any(p[n][a]!=0 for n in 'def' for a in range(3)):
                raise ValueError('非强制连续曲线须由恒加速度/匀速阶段组成；高阶曲线不能直接等同MoveAbsolute')
            q0,v0 = _evaluate_base_action_segment(p,p['start_frame'])
            q1,v1 = _evaluate_base_action_segment(p,p['end_frame'])
            aa = [200*p['c'][a]*factor*factor for a in range(3)]
            if previous:
                pq,pv,pend = previous
                if any(abs(x-y)>1e-6 for x,y in zip(pq,q0)):
                    raise ValueError('曲线阶段位置不连续')
                if p['start_frame']==pend and any(abs(x-y)>1e-6 for x,y in zip(pv,v0)):
                    raise ValueError('非强制阶段交界速度不连续')
                if p['start_frame']>pend and any(abs(x)>1e-6 for x in pv+v0):
                    raise ValueError('有时间空档的两侧必须停稳，不能遗漏带速运动')
            previous = q1,v1,p['end_frame']
            for a in range(3):
                if max(abs(v0[a]),abs(v1[a]))*factor > inputs['max_velocities'][key][a]+1e-6:
                    raise ValueError('原曲线速度超过该模型最大速度')
                if abs(aa[a])>min(inputs['max_accelerations'][key][a],inputs['max_decelerations'][key][a])+1e-6:
                    raise ValueError('原曲线加减速度超过当前PLC A=D可用上限')
                if abs(aa[a])>1e-10 and abs(aa[a]*10-round(aa[a]*10))>1e-7:
                    raise ValueError('原非强制曲线的阶段加速度不能由0105的0.1加减速度无损表达')
                t=(p['end_frame']-p['start_frame'])/1000
                probes=[q0[a],q1[a]]
                native_a=200*p['c'][a]
                if abs(native_a)>1e-12 and 0 < -v0[a]/native_a < t:
                    z=-v0[a]/native_a;probes.append(q0[a]+v0[a]*z+.5*native_a*z*z)
                if min(probes)<low[a]-qtol[a] or max(probes)>high[a]+qtol[a]:
                    raise ValueError('原曲线中途位置超出行程')
        # 有限动作之外按位置保持，因此首末必须停稳；内部帧允许非零速度和过零反向。
        for p,frame in ((model['segments'][0],model['segments'][0]['start_frame']),
                        (model['segments'][-1],model['segments'][-1]['end_frame'])):
            if any(abs(v)>1e-7 for v in _evaluate_base_action_segment(p,frame)[1]):
                raise ValueError('本版有限非强制动作的首末速度须为0；内部帧可以带速')
        inputs['current_velocities'][key] = initial_v
        inputs['nf_limits'][key] = {'low':low,'high':high,'v':vmax,'a':acc,'weights':weights,
            'motor_scale':scale,'motor_velocity_upper_bound':sum(weights[a]*vmax[a] for a in range(3))}
    return source,inputs


def _nf_axis_lower_bound(q0,v0,qj,vj,vmax,acc,low,high):
    """不计协议取整的可证明时间下界，用于搜索剪枝；不是实际下发参数。"""
    if qj<low-1e-8 or qj>high+1e-8 or abs(vj)>vmax+1e-8:
        return math.inf
    if max(abs(qj-q0),abs(vj-v0))<1e-10:
        return 0.0
    if min(vmax,acc)<=0:
        return math.inf
    if abs(v0)>1e-10:
        return max(abs(qj-q0)/vmax,abs(vj-v0)/acc)
    end=abs(vj);direction=1 if vj>0 else -1 if vj<0 else 1 if qj>=q0 else -1
    distance=direction*(qj-q0)
    if distance < end*end/(2*acc)-1e-10:
        # 允许理想的先反向再加速，忽略行程限制只会放宽，才是真正下界。
        # 不能把“先停到某个发射点”的耗时当作下界，否则可能错误剪枝。
        reverse_peak=math.sqrt(max(0,end*end/2-acc*distance))
        if reverse_peak<=vmax:
            return (end+2*reverse_peak)/acc
        turn_distance=(end*end-2*vmax*vmax)/(2*acc)
        return (end+2*vmax)/acc+(turn_distance-distance)/vmax
    peak=min(vmax,math.sqrt(max(0,acc*distance+.5*end*end)))
    if peak<=0:
        return 0.0
    cruise=max(0,distance-(2*peak*peak-end*end)/(2*acc))/peak
    return peak/acc+(peak-end)/acc+cruise


def _nf_tolerant_lower_bound(q0,v0,qj,vj,vmax,acc,qtol,vtol,low=-math.inf,high=math.inf):
    """容差集合也适用的时间下界：最快到达位置区间，与必要速度变化取max。"""
    distance=max(0.0,abs(qj-q0)-qtol)
    if min(vmax,acc)<=0:
        return 0.0 if distance==0 and abs(vj-v0)<=vtol else math.inf
    if abs(v0)<1e-12:
        # 零初速时，在目标q/v容差矩形内求理想最短时间；4个边界候选足够。
        # 既保留有效剪枝，也不会因使用精确目标的下界漏掉容差内更快的解。
        qlo,qhi=max(low,qj-qtol)-q0,min(high,qj+qtol)-q0
        vlo,vhi=max(-vmax,vj-vtol),min(vmax,vj+vtol)
        if qlo>qhi or vlo>vhi:return math.inf
        if qlo<=0<=qhi and vlo<=0<=vhi:return 0.0
        points=[]
        for v in (vlo,vhi):
            sign=1 if v>=0 else -1
            points.append((max(qlo,min(qhi,sign*v*v/(2*acc))),v))
        for q in (qlo,qhi):
            free_v=(1 if q>=0 else -1)*min(vmax,math.sqrt(2*acc*abs(q)))
            points.append((q,max(vlo,min(vhi,free_v))))
        return max(0.0,min(_nf_axis_lower_bound(q0,0,q0+q,v,vmax,acc,low,high) for q,v in points)-1e-9)
    # 非零初速也在整个终态容差矩形上求松弛最短时间，避免极弱下界导致海量候选重算。
    return _entry_bound_tolerant_bang_lower_bound(q0,v0,qj,vj,vmax,acc,qtol,vtol,low,high)


def _nf_axis_plan(q0,v0,qj,vj,limits,axis,inputs,force_stop=False):
    """求实际编码Move；当前位置/速度已经匹配可在T=0交接，运动轴不能等。"""
    qt,vt=inputs['nf_qtol'][axis],inputs['nf_vtol'][axis]
    if abs(q0-qj)<=qt and abs(v0-vj)<=vt and (not force_stop or abs(v0)<=1e-12):
        stopped=abs(v0)<=1e-12
        return {'status':'ok','moves':[],'join_time_s':0.0,'q_actual':q0,'v_actual':v0,
                'q_error':q0-qj,'v_error':v0-vj,'wait_anchor_s':0.0 if stopped else None,
                'initial_velocity':v0,
                'time_optimality':'encoded_zero_initial_single_monotone_equal_ad_grid_optimum' if stopped else 'already_at_join_state'}
    # 先用解析峰/谷控制求理想时间，再验证1～2条真实Move能否完整复现。
    # 成功时无需扫描0.1格点加速度；限位/编码不允许该构造时才回到原精确搜索。
    fast=_entry_fast_fast_solve(q0,v0,qj,vj,limits['v'][axis],limits['a'][axis],limits['a'][axis],
        [limits['low'][axis],limits['high'][axis]],q_tol=qt,v_tol=vt,force_initial_stop=force_stop,
        stop_cache=inputs.setdefault('nf_stop_profile_cache',{}))
    counts=inputs.setdefault('nf_solver_statistics',{'analytic_solved':0,'integer_search_fallback':0})
    if fast['status']=='ok' and (force_stop or fast.get('attains_ideal_lower_bound') or fast.get('join_time_s')==0):
        counts['analytic_solved']+=1
        return fast
    counts['integer_search_fallback']+=1
    fallback=_entry_scalar_solve(q0,v0,qj,vj,limits['v'][axis],limits['a'][axis],limits['a'][axis],
        [limits['low'][axis],limits['high'][axis]],q_tol=qt,v_tol=vt,
        force_initial_stop=force_stop,allow_reposition=True,exact_deceleration_scan=True)
    if fast['status']=='ok' and (fallback['status']!='ok' or fast['join_time_s']<fallback['join_time_s']):
        return fast
    return fallback

def _nf_continuation(model,frame,inputs,initial_states=None):
    """逐轴复现原恒A阶段；V是Move上限，不能误当任意阶段的末速。

    按实际准备末态继续积分，核验每个真实Move拐点及误差极值，避免每段
    重置理想q/v掩盖误差。停车目标与原阶段终点始终分开。
    """
    key=model['index'];limits=inputs['nf_limits'][key]
    direction,factor=inputs['direction'],inputs['nf_factor']
    result=[]
    initial_q,initial_v=_nf_state(model,frame,direction,factor)
    states=list(initial_states) if initial_states is not None else list(zip(initial_q,initial_v))
    sequence=model['segments'] if direction>0 else list(reversed(model['segments']))
    first_piece=True
    for p in sequence:
        begin=max(frame,p['start_frame']) if direction>0 else min(frame,p['end_frame'])
        end=p['end_frame'] if direction>0 else p['start_frame']
        if (end-begin)*direction<=0:
            continue
        expected_q0,expected_v0=_nf_state(model,begin,direction,factor)
        q1,native_v1=_evaluate_base_action_segment(p,end)
        v1=[v*direction*factor for v in native_v1]
        dt=abs(end-begin)/(1000*factor)
        for a in range(3):
            if AXIS_NAMES[a] not in inputs['active_axes_by_model'][key]:
                continue
            q0,v0=states[a]
            qt=max(1e-9,inputs['nf_qtol'][a]);vt=max(1e-9,inputs['nf_vtol'][a])
            signed_a=200*p['c'][a]*factor*factor
            if abs(q0-expected_q0[a])>qt or abs(v0-expected_v0[a])>vt:
                raise ValueError('真实接入末态不能连续连接原阶段起点')
            if max(abs(v0),abs(v1[a]),abs(signed_a),abs(q0-q1[a]))<=1e-12:
                # 真正停稳的平台不需要下发新Move，也不需要虚构正数速度上限。
                states[a]=(q0,0.0)
                continue
            acc=abs(signed_a) if abs(signed_a)>1e-10 else limits['a'][a]
            if min(acc,limits['v'][a])<=0 or abs(acc*10-round(acc*10))>1e-7:
                raise ValueError('接入后的阶段A不能按当前协议执行')
            acc=round(acc,1);cap=math.floor(limits['v'][a]*10+1e-9)/10
            if cap<=0 or acc>limits['a'][a]+1e-7:
                raise ValueError('后续阶段超过准备所用的保守电机限速包络')
            velocities={cap}
            for value in (abs(v1[a]),abs(v0),max(abs(v1[a]),abs(v0))):
                velocities.add(math.floor(value*10+1e-9)/10)
                velocities.add(math.ceil(value*10-1e-9)/10)
            end_sign=1 if v1[a]>0 else -1 if v1[a]<0 else 0
            targets=set()
            if not end_sign:
                target=round(q1[a]*10)/10
                if abs(target-q1[a])>qt:
                    raise ValueError('零速阶段终点不能按0.1位置精度停车保持')
                targets.add(target)
            else:
                tail=q1[a]+end_sign*v1[a]*v1[a]/(2*acc)
                targets.update((math.floor(tail*10+1e-8)/10,math.ceil(tail*10-1e-8)/10,
                                round(tail*10)/10))
                # 初始制动阶段也可由反向停车目标触发；覆盖v过零和低末速。
                brake_sign=-1 if v0>0 else 1 if v0<0 else end_sign
                raw=q0+brake_sign*.1
                targets.add((math.floor(raw*10+1e-8) if brake_sign<0 else math.ceil(raw*10-1e-8))/10)
                # 速度跨零时，停车点必须同时落在当前点的反向和终点制动距离之外。
                # 只取上述两个边界中的一个，可能使目标方向错误或反向后提前减速。
                if v0>0 and end_sign<0:
                    targets.add(math.floor(min(q0-.1,tail)*10+1e-8)/10)
                elif v0<0 and end_sign>0:
                    targets.add(math.ceil(max(q0+.1,tail)*10-1e-8)/10)
            matches=[]
            for target in targets:
                # 不能用1e-13位置舍入差给“同位置非零速度”的Move虚构方向。
                # 实际编码/反馈可能恰好相等，必须换到至少下一个停车位置格点。
                if abs(target-q0)<=1e-8 and abs(v0)>vt:
                    continue
                for vel in velocities:
                    if vel<=0 or vel>cap+1e-8:
                        continue
                    try:
                        profile=_entry_scalar_move_profile(q0,v0,target,vel,acc,acc,limits['low'][a],limits['high'][a])
                    except (ValueError,ArithmeticError):
                        continue
                    # 单个真实阶段的q误差为二次式、v误差为一次式，核验全部极值。
                    probes={0.0,dt};elapsed=0.0
                    for duration,pq,pv,pa in profile['phases']:
                        left=max(0.0,elapsed);right=min(dt,elapsed+duration)
                        if left<=right:
                            probes.update((left,right))
                            wanted_v=expected_v0[a]+signed_a*left
                            actual_v=pv+pa*(left-elapsed)
                            delta_a=pa-signed_a
                            if abs(delta_a)>1e-15:
                                root=left-(actual_v-wanted_v)/delta_a
                                if left<root<right:probes.add(root)
                        elapsed+=duration
                    good=True
                    for t in probes:
                        actual_q,actual_v=_entry_scalar_state_at(profile,t)
                        wanted_q=expected_q0[a]+expected_v0[a]*t+.5*signed_a*t*t
                        wanted_v=expected_v0[a]+signed_a*t
                        if abs(actual_q-wanted_q)>qt or abs(actual_v-wanted_v)>vt:
                            good=False;break
                    if not good:
                        continue
                    actual_q,actual_v=_entry_scalar_state_at(profile,dt)
                    if abs(actual_q-q1[a])>qt or abs(actual_v-v1[a])>vt:
                        continue
                    # 零速阶段不能在接点后又反向离开；要真正停在这里。
                    if not end_sign and (abs(target-q1[a])>qt or profile['duration_s']>dt+1e-8):
                        continue
                    matches.append((profile['duration_s'],abs(target-q1[a]),target,vel,profile,actual_q,actual_v))
            if not matches:
                raise ValueError('原恒A阶段不能由可编码的真实Move连续复现；不能只匹配阶段端点')
            _,_,target,vel,profile,actual_q,actual_v=min(matches,key=lambda item:item[:4])
            states[a]=(actual_q,actual_v)
            result.append({'axis':AXIS_NAMES[a],'axis_index':a,'start_offset_after_join_ms':abs(begin-frame)/factor,
                'duration_ms':dt*1000,'move_target':target,'velocity':vel,'acceleration':acc,'deceleration':acc,
                'expected_start_position':expected_q0[a],'expected_start_velocity':expected_v0[a],
                'actual_start_position':q0,'actual_start_velocity':v0,
                'expected_end_position':q1[a],'expected_end_velocity':v1[a],
                'actual_end_position':actual_q,'actual_end_velocity':actual_v,
                'full_stop_duration_ms':profile['duration_s']*1000,'entire_phase_verified':True,
                'original_start_frame_ms':begin,'original_end_frame_ms':end})
        first_piece=False
    return result

def _nf_candidate_plan(inputs,frame,verified_best_order=None,candidate_score=None,selection_metric='minimum_prepare_time'):
    targets={};plans={}
    for model in inputs['curve_action']['models']:
        key=model['index'];q,v=_nf_state(model,frame,inputs['direction'],inputs['nf_factor'])
        targets[key]=(q,v);model_plans=[]
        for a in range(3):
            if AXIS_NAMES[a] not in inputs['active_axes_by_model'][key]:
                if abs(q[a]-inputs['current_positions'][key][a])>inputs['nf_qtol'][a] or abs(v[a])>inputs['nf_vtol'][a]:
                    raise ValueError('非准备轴无法达到接入状态')
            plan=_nf_axis_plan(inputs['current_positions'][key][a],inputs['current_velocities'][key][a],q[a],v[a],inputs['nf_limits'][key],a,inputs)
            if plan['status']!='ok':raise ValueError(plan['message'])
            model_plans.append(plan)
        plans[key]=model_plans
    # 先求共同时间；非零初速不能直接等，必要时增加一条真实停车命令后再等待。
    for _ in range(1+sum(len(ps) for ps in plans.values())):
        common=math.ceil(max(p['join_time_s'] for ps in plans.values() for p in ps)*1000-1e-8)/1000
        changed=False
        for model in inputs['curve_action']['models']:
            key=model['index'];q,v=targets[key]
            for a,plan in enumerate(plans[key]):
                if common-plan['join_time_s']>1e-8 and abs(inputs['current_velocities'][key][a])>1e-10 and plan.get('wait_anchor_s') is None:
                    plan=_nf_axis_plan(inputs['current_positions'][key][a],inputs['current_velocities'][key][a],q[a],v[a],inputs['nf_limits'][key],a,inputs,True)
                    if plan['status']!='ok':raise ValueError(plan['message'])
                    plans[key][a]=plan;changed=True
        if not changed:break
    common=math.ceil(max(p['join_time_s'] for ps in plans.values() for p in ps)*1000-1e-8)/1000
    if verified_best_order is not None:
        frame_order=frame if inputs['direction']>0 else -frame
        order=(common,candidate_score,frame_order) if selection_metric=='minimum_prepare_time' else (candidate_score,common,frame_order)
        if order>=verified_best_order:
            # 用完整验证过的上界比较全排序键；同耗时但位置/帧次序也不改善时同样跳过。
            return None
    grouped={};all_optimal=True;stationary=[]
    for model in inputs['curve_action']['models']:
        key=model['index'];route=inputs['routes'][key];q,v=targets[key];axis_results=[]
        for a,plan in enumerate(plans[key]):
            delay=max(0,common-plan['join_time_s'])
            anchor=0.0 if abs(inputs['current_velocities'][key][a])<1e-10 else plan.get('wait_anchor_s')
            if delay>1e-8 and anchor is None:raise ValueError('非零初速没有合法等待位置')
            moves=[]
            for move in plan['moves']:
                shift=delay if anchor is not None and move['start_s']>=anchor-1e-10 else 0
                moves.append({'start_offset_ms':(move['start_s']+shift)*1000,'move_target':move['move_target'],
                    'velocity':move['velocity'],'acceleration':move['acceleration'],'deceleration':move['deceleration'],
                    'expected_duration_ms':move['duration_s']*1000,'full_stop_duration_ms':move['full_stop_duration_s']*1000,
                    'purpose':move['purpose']})
            optimal=plan.get('time_optimality') in ('encoded_zero_initial_single_monotone_equal_ad_grid_optimum',
                'attains_ideal_grid_limit_lower_bound','already_at_join_state')
            all_optimal=all_optimal and optimal
            axis_results.append({'axis':AXIS_NAMES[a],'axis_index':a,'start_delay_ms':moves[0]['start_offset_ms'] if moves else 0.0,'wait_duration_ms':delay*1000,
                'wait_anchor_ms':None if anchor is None else anchor*1000,'move_steps':moves,'join_time_ms':common*1000,
                'expected_join_position':q[a],'expected_join_velocity':v[a],
                'actual_join_position':plan['q_actual'],'actual_join_velocity':plan['v_actual'],
                'position_error':plan['q_error'],'velocity_error':plan['v_error'],
                'scalar_optimality':plan.get('time_optimality'),'handoff_required':abs(v[a])>inputs['nf_vtol'][a]})
        continuation=_nf_continuation(model,frame,inputs,[(p['q_actual'],p['v_actual']) for p in plans[key]])
        first=[ar['move_steps'][0] if ar['move_steps'] else None for ar in axis_results]
        result={**route,'current_HPY':list(inputs['current_positions'][key]),'current_velocity_HPY':list(inputs['current_velocities'][key]),
            'curve_target_HPY':q,'join_position_HPY':q,'join_velocity_HPY':v,
            'target_HPY':[s['move_target'] if s else inputs['current_positions'][key][a] for a,s in enumerate(first)],
            'move_target_HPY':[s['move_target'] if s else inputs['current_positions'][key][a] for a,s in enumerate(first)],
            'velocity_HPY':[s['velocity'] if s else 0 for s in first],
            'acceleration_HPY':[s['acceleration'] if s else 0 for s in first],
            'deceleration_HPY':[s['deceleration'] if s else 0 for s in first],
            'execute_HPY':[s is not None for s in first],'expected_arrival_ms':common*1000,
            'start_delay_ms_HPY':[a['start_delay_ms'] for a in axis_results],
            'axis_plans':axis_results,'continuation_axis_moves':continuation,
            'motor_velocity_upper_bound':inputs['nf_limits'][key]['motor_velocity_upper_bound'],
            'max_motor_velocity':model['max_motor_velocity']}
        grouped.setdefault(route['plc_id'],{'plc_id':route['plc_id'],'models':[]})['models'].append(result)
    for plc,group in grouped.items():
        if not any(any(m['execute_HPY']) or any(abs(v)>1e-10 for v in m['current_velocity_HPY']) for m in group['models']):stationary.append(plc)
    return common,grouped,all_optimal,stationary


##########################非强制候选帧：区间分支定界##########################
def _nf_search_intervals(inputs, candidates, metric):
    """保留全部候选网格；只有整个时间区间都不能改善已验证方案时才剪枝。

    candidates须为已校验、升序且不重复的原帧列表。节点覆盖其中一个连续索引区间；
    q/v包络覆盖该时间区间的全部恒A阶段、位置极值、阶段空档和首末保持。
    包络中的位置和速度可以不在同一时刻出现，因此只用于放宽后的时间下界，
    绝不把这个矩形下界当作已经可下发的运动计划。
    """
    import heapq

    if metric not in ('minimum_prepare_time', 'nearest_position'):
        raise ValueError('未知的非强制选帧指标')
    stats = {'bound_blocks': 0, 'pruned_frame_count': 0, 'evaluated': 0,
             'rejected_candidates': 0, 'not_improving_candidates': 0,
             'search_method': 'interval_branch_and_bound',
             'full_candidate_grid_covered': True}
    if not candidates:
        return None, [], 0, stats, 0.0
    direction, factor = inputs['direction'], inputs['nf_factor']
    models = inputs['curve_action']['models']
    best, skipped, queue = None, [], []

    def distance_to_interval(value, low, high):
        return max(0.0, low-value, value-high)

    def point_score(frame):
        # 与原全遍历保持相同的同耗时排序依据。
        score = 0.0
        for model in models:
            key = model['index']
            position, _ = _nf_state(model, frame)
            for axis, name in enumerate(AXIS_NAMES):
                if name in inputs['active_axes_by_model'][key]:
                    score = max(score, abs(position[axis]-inputs['current_positions'][key][axis])
                                / max(inputs['max_velocities'][key][axis], 1e-12))
        return score

    def model_ranges(model, first_frame, last_frame):
        # 两端用公共状态函数求值，包含曲线外保持以及端点落在空档内的情况。
        q_first, v_first = _nf_state(model, first_frame, direction, factor)
        q_last, v_last = _nf_state(model, last_frame, direction, factor)
        qlow = [min(a, b) for a, b in zip(q_first, q_last)]
        qhigh = [max(a, b) for a, b in zip(q_first, q_last)]
        vlow = [min(a, b) for a, b in zip(v_first, v_last)]
        vhigh = [max(a, b) for a, b in zip(v_first, v_last)]
        pieces = model['segments']
        # 用已有首帧索引跳过此前阶段；可能有一个阶段跨越区间左端。
        begin_index = max(0, bisect_right(model['_nf_piece_starts'], first_frame)-1)
        for piece in pieces[begin_index:]:
            if piece['start_frame'] > last_frame:
                break
            left = max(first_frame, piece['start_frame'])
            right = min(last_frame, piece['end_frame'])
            if left > right:
                continue
            qa, va = _evaluate_base_action_segment(piece, left)
            qb, vb = _evaluate_base_action_segment(piece, right)
            for axis in range(3):
                qlow[axis] = min(qlow[axis], qa[axis], qb[axis])
                qhigh[axis] = max(qhigh[axis], qa[axis], qb[axis])
                va_axis, vb_axis = va[axis]*direction*factor, vb[axis]*direction*factor
                vlow[axis] = min(vlow[axis], va_axis, vb_axis)
                vhigh[axis] = max(vhigh[axis], va_axis, vb_axis)
                # 恒A段的位置是二次式，速度过零处可能是段内最高/最低位置。
                c = piece['c'][axis]
                if c != 0.0:
                    extremum_frame = piece['start_frame']-50.0*piece['b'][axis]/c
                    if left < extremum_frame < right:
                        qe, _ = _evaluate_base_action_segment(piece, extremum_frame)
                        qlow[axis] = min(qlow[axis], qe[axis])
                        qhigh[axis] = max(qhigh[axis], qe[axis])
        return qlow, qhigh, vlow, vhigh

    def node_bound(first_index, last_index):
        stats['bound_blocks'] += 1
        first_frame, last_frame = candidates[first_index], candidates[last_index]
        common_lower, score_lower = 0.0, 0.0
        for model in models:
            key = model['index']
            limits = inputs['nf_limits'][key]
            qlow, qhigh, vlow, vhigh = model_ranges(model, first_frame, last_frame)
            for axis, name in enumerate(AXIS_NAMES):
                # 向外扩张消除求值/中心转换的末位舍入；只能使下界更宽松。
                qpad = 1e-12*(1.0+max(abs(qlow[axis]), abs(qhigh[axis])))
                vpad = 1e-12*(1.0+max(abs(vlow[axis]), abs(vhigh[axis])))
                qmin, qmax = qlow[axis]-qpad, qhigh[axis]+qpad
                vmin, vmax = vlow[axis]-vpad, vhigh[axis]+vpad
                qmid, vmid = (qmin+qmax)*0.5, (vmin+vmax)*0.5
                qradius = (qmax-qmin)*0.5+inputs['nf_qtol'][axis]+qpad
                vradius = (vmax-vmin)*0.5+inputs['nf_vtol'][axis]+vpad
                lower = _nf_tolerant_lower_bound(
                    inputs['current_positions'][key][axis], inputs['current_velocities'][key][axis],
                    qmid, vmid, limits['v'][axis], limits['a'][axis], qradius, vradius,
                    limits['low'][axis], limits['high'][axis])
                common_lower = max(common_lower, lower)
                if name in inputs['active_axes_by_model'][key]:
                    # 评分原本只比较曲线位置；再放宽到容差区间仍是合法的下界。
                    expanded_min, expanded_max = qmid-qradius, qmid+qradius
                    score_lower = max(score_lower,
                        distance_to_interval(inputs['current_positions'][key][axis], expanded_min, expanded_max)
                        / max(inputs['max_velocities'][key][axis], 1e-12))
        # 实际公共时间也向上取整到毫秒。先减小数值保护量，不能抬高下界误剪。
        if math.isfinite(common_lower):
            rounded_lower = max(0.0, math.ceil(max(0.0, common_lower-1e-9)*1000.0-1e-8)/1000.0)
        else:
            rounded_lower = math.inf
        frame_order = first_frame if direction > 0 else -last_frame
        order = ((rounded_lower, score_lower, frame_order) if metric == 'minimum_prepare_time'
                 else (score_lower, rounded_lower, frame_order))
        return order, common_lower

    root_order, global_lower = node_bound(0, len(candidates)-1)
    heapq.heappush(queue, (root_order, 0, len(candidates)-1))
    while queue:
        lower_order, first_index, last_index = heapq.heappop(queue)
        count = last_index-first_index+1
        if (not math.isfinite(lower_order[0]) or not math.isfinite(lower_order[1])
                or (best is not None and lower_order >= best[1])):
            stats['pruned_frame_count'] += count
            continue
        middle_index = (first_index+last_index)//2
        frame = candidates[middle_index]
        score = point_score(frame)
        stats['evaluated'] += 1
        try:
            result = _nf_candidate_plan(inputs, frame, best[1] if best else None, score, metric)
        except (ValueError, ArithmeticError) as error:
            stats['rejected_candidates'] += 1
            if len(skipped) < 40:
                skipped.append({'frame_ms': frame, 'reason': str(error)})
        else:
            if result is None:
                stats['not_improving_candidates'] += 1
            else:
                common, grouped, optimal, stationary = result
                frame_order = frame if direction > 0 else -frame
                order = ((common, score, frame_order) if metric == 'minimum_prepare_time'
                         else (score, common, frame_order))
                if best is None or order < best[1]:
                    # 只有完整准备/后续Move都验证成功，才可作为剪枝上界。
                    best = (common, order, frame, score, grouped, optimal, stationary)
        for left, right in ((first_index, middle_index-1), (middle_index+1, last_index)):
            if left > right:
                continue
            child_order, _ = node_bound(left, right)
            if (not math.isfinite(child_order[0]) or not math.isfinite(child_order[1])
                    or (best is not None and child_order >= best[1])):
                stats['pruned_frame_count'] += right-left+1
            else:
                heapq.heappush(queue, (child_order, left, right))
    return best, skipped, stats['evaluated'], stats, global_lower


def _calculate_nonforced_continuous_entry(parameters):
    """连续非强制就近：全时间网格搜索，实际Move过点校验，返回准备和接续时序。"""
    source,inputs=_nf_prepare_inputs(parameters)
    command,settings=source['command'],source.get('settings',{})
    step=settings.get('nonforced_frame_step_ms',1)
    budget=settings.get('nonforced_max_search_frames',200001)
    if type(step)is not int or step<=0 or type(budget)is not int or budget<1:
        raise ValueError('非强制搜索步长/帧预算须为正整数')
    metric=command.get('selection_metric','minimum_prepare_time')
    if metric not in ('minimum_prepare_time','nearest_position'):
        raise ValueError('selection_metric仅支持minimum_prepare_time或nearest_position')
    models=inputs['curve_action']['models']
    first=min(m['segments'][0]['start_frame'] for m in models)
    last=max(m['segments'][-1]['end_frame'] for m in models)
    boundary_frames={int(p[n]) for m in models for p in m['segments'] for n in ('start_frame','end_frame')}
    direction,factor=inputs['direction'],inputs['nf_factor']
    origin=command.get('specified_time_ms') if command.get('use_specified_time') else command.get('stopped_time_ms')
    origin_basis='provided_original_progress'
    if inputs['use_specified_time']:
        # 指定帧是硬约束；真实历史进度应使用stopped_time_ms。
        origin=command['specified_time_ms']
        if not first<=origin<=last:raise ValueError('指定帧超出当前动作首末范围')
        candidates=[origin];origin_basis='exact_specified_frame'
    elif not inputs['nearest_start']:
        candidates=[first if direction>0 else last];origin=candidates[0];origin_basis='action_boundary'
    else:
        if origin is None:
            # 位置相同可能对应多个不同速度的帧，不能把位置投影冒充真实历史进度。
            # 没有提供停止进度时，从方向起点搜索整个动作，以共同准备时间选帧。
            origin=int(first) if direction>0 else int(last)
            origin_basis='action_boundary_without_original_progress'
        if type(origin)is not int or not 0<=origin<=4294967295:raise ValueError('原动作进度须为uint32毫秒')
        if not first<=origin<=last:raise ValueError('停止进度超出当前动作首末范围')
        lo,hi=(origin,int(last)) if direction>0 else (int(first),origin)
        candidates=sorted(set(range(lo,hi+1,step))|{lo,hi}|{f for f in boundary_frames if lo<=f<=hi})
    if len(candidates)>budget:raise ValueError('非强制候选帧数超过预算')
    # 所有1ms候选仍保留。按整段q/v包络的合法下界排除不可能改善的区间，
    # 不先给每个毫秒都重做位置、速度和真实Move计算。
    best,skipped,evaluated,search_stats,lower=_nf_search_intervals(inputs,candidates,metric)
    if best is None:
        return {'status':'infeasible','plan_valid':False,'can_dispatch':False,'message':'方向允许的候选帧没有可编码的真实Move接入计划',
            'trajectory_run':False,'reverse':direction<0,'selected_curve_time_ms':None,'prepare_time_ms':None,'prepare_time_ms_ceil':None,
            'stationary_plc_ids':[],'devices':[],'skipped_candidates':skipped,'algorithm_version':'v8_decimal_interval_nonforced_velocity_join'}
    common,_,frame,score,grouped,scalar_optimal,stationary=best
    if common*1000>4294967295:raise ValueError('准备时长超出uint32毫秒')
    loops=inputs['loop_count'];fallback=[]
    if loops!=1:
        for m in models:
            qa,va=_nf_state(m,m['segments'][0]['start_frame']);qb,vb=_nf_state(m,m['segments'][-1]['end_frame'])
            if any(abs(x-y)>1e-6 for x,y in zip(qa+va,qb+vb)):
                fallback.append({**inputs['routes'][m['index']],'reason':'循环首尾位置或速度不闭合，统一改为单次'})
        if fallback:loops=1
    return {'status':'planned','plan_valid':True,'can_dispatch':False,
        'message':'接入计划已按真实Move求解；当前PLC准备接口仍须扩展带速交接及轴时序后才能直接下发',
        'trajectory_run':False,'reverse':direction<0,'selected_curve_time_ms':int(frame),
        'prepare_time_ms':common*1000,'prepare_time_ms_ceil':round(common*1000),
        'handoff_time_from_T0_ms':common*1000,'start_mode':'nearest_continuous' if inputs['nearest_start'] else 'original_boundary',
        'selection_metric':metric,'search_origin_frame_ms':origin,'search_origin_basis':origin_basis,
        'effective_loop_count':loops,'effective_loop_once':loops==1,'loop_fallback':fallback,
        'stationary_plc_ids':stationary,'requires_group_wait':common>0,
        'all_stationary':common==0 and all(abs(v)<1e-10 for vs in inputs['current_velocities'].values() for v in vs),
        'devices':list(grouped.values()),'1006_payloads':[],
        'algorithm_version':'v8_decimal_interval_nonforced_velocity_join','original_curve_unchanged':True,
        'move_targets_may_differ_from_join':True,
        'timing_basis':'T0开始准备；T0+prepare_time_ms在曲线位置和有符号速度处交接，非零接入速度时不等待停稳',
        'matching_tolerance_HPY':{'position':inputs['nf_qtol'],'velocity':inputs['nf_vtol']},
        'optimality':{'frame_step_ms':step,'candidate_frames':len(candidates),'encoded_candidates_evaluated':evaluated,
            'full_grid_searched':True,'continuous_global_optimum_certified':False,
            'all_selected_axes_time_optimal_in_certified_domain':scalar_optimal,'ideal_lower_bound_ms':lower*1000,
            'upper_minus_lower_ms':max(0,(common-lower)*1000),
            'meaning':'解析解达到理想时间下界时才标记最短；在所声明时间网格和保守电机包络内比较，停车等待/回退方案不宣称一般连续全局最优'},
        'solver_statistics':inputs.get('nf_solver_statistics',{}),
        'search_statistics':search_stats,
        'execution_contract':{'current_plc_protocol_compatible':False,'requires_plc_changes':True,
            'move_target_is_stop_position':True,'join_position_is_handoff_point':True,'A_equals_D':True,
            'position_resolution':0.1,'velocity_resolution':0.1,'acceleration_resolution':0.1,
            'deceleration_resolution':0.1,'protocol_version':'0105_decimal_v1',
            'unsigned_raw_max':65535,'actual_unsigned_max':6553.5,
            'axis_timed_queue_required':True,'fractional_ms_delays_may_be_required':True,
            'must_cover_move_at_handoff':True,'must_not_wait_for_standstill_at_nonzero_join':True,
            'note':'现有1006无独立停车目标且要求停稳；0106每模型只有一个预约槽，不能预装本计划的完整轴级队列'},
        'skipped_candidates':skipped,'scope':'虚轴V/A/D与行程；保守实轴速度包络；不含实轴加速度证明、碰撞或驱动跟随误差'}


_calculate_nearest_entry_v4 = calculate_nearest_entry


def calculate_nearest_entry(parameters):
    """公共静态models＋runtime入口；强制/非强制求解数学保持v8 Decimal。"""
    source=_adapt_shared_nearest_parameters(parameters)
    if source.get('command',{}).get('trajectory_run') is True:
        return _calculate_nearest_entry_v4(source)
    return _calculate_nonforced_continuous_entry(source)


## F5自测入口：读取示例，输出独立结果文件，原参数不被改写。
def main():
    path=Path(sys.argv[1]) if len(sys.argv)>1 else _nearest_default_parameter_path()
    try:
        parameters=load_nearest_parameters(path)
        result=calculate_nearest_entry(parameters)
        if path.name=="就近接入参数.json":
            # 旧默认/显式旧文件名兼容：仍生成独立结果，不覆盖旧输入。
            output=path.with_name(path.stem+"-结果.json")
            output.write_text(_nearest_format_json(result)+"\n",encoding="utf-8")
        else:
            # 新公共文件只更新nearest_result，其它算法结果与全部输入保留。
            _nearest_write_shared_result(path,parameters,result)
            output=path
    except (ValueError,TypeError,KeyError,ArithmeticError,OSError) as exc:
        print(json.dumps({"status":"invalid_input","message":str(exc)},ensure_ascii=False,indent=2))
        return 1
    print(json.dumps({k:result[k] for k in ("status","can_dispatch","selected_curve_time_ms","prepare_time_ms","prepare_time_ms_ceil","stationary_plc_ids")},ensure_ascii=False,indent=2))
    print(result["message"])
    print(f"完整目标/V/A/D及执行时序已保存：{output}")
    return 0 if result.get("plan_valid",result["can_dispatch"]) else 2


if __name__=="__main__":
    raise SystemExit(main())
