# -*- coding: utf-8 -*-
"""单点模型(type=2)、多级升降(type=3)、多点摆(type=7)、XY多点摆(type=9)。

单点模型和多级升降共用一个反解函数，两种多点摆各自提供正解、反解、超坐标保护三个函数。
HPY中多点摆为[高度,倾角,方向角]，XY多点摆为[高度,X角,Y角]，长度mm，角度°。
"""
import os
import math
import socket
import json
import traceback
import numpy as np
from scipy.optimize import least_squares

FORWARD_TOLERANCE_MM = 150.0


def _model_type(model_type):
    if model_type not in (2, 3, 7, 9):
        raise ValueError("仅支持单点模型2、多级升降3、多点摆7和XY多点摆9")
    return model_type


def _geometry(points):
    points = np.asarray(points, dtype=float)
    if points.ndim != 2 or points.shape[1] not in (2, 3) or len(points) < 3:
        raise ValueError("至少需要3个吊点，坐标格式为[x,y]或[x,y,z]")
    if not np.all(np.isfinite(points)):
        raise ValueError("吊点坐标包含非有限数值")
    if points.shape[1] == 2:
        points = np.column_stack((points, np.zeros(len(points))))

    # 凸包仅用于求横移边距；正解、反解始终使用完整原轴序。
    ordered = sorted(set(map(tuple, points[:, :2])))

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    lower, upper = [], []
    for point in ordered:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    for point in reversed(ordered):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    hull = np.asarray(lower[:-1] + upper[:-1], dtype=float)
    if len(hull) < 3:
        raise ValueError("吊点不能全部共线")
    return points, hull


def _limits(model_type, limit_data):
    _model_type(model_type)
    limits = np.asarray(limit_data, dtype=float)
    if limits.ndim != 2 or limits.shape[0] != 3 or limits.shape[1] < 2:
        raise ValueError("limit_data须提供H、P/X、Y三组[min,max]")
    lower, upper = limits[:, 0].copy(), limits[:, 1].copy()
    if not np.all(np.isfinite(limits[:, :2])) or np.any(upper < lower) or upper[0] <= 0:
        raise ValueError("高度或角度范围无效")
    angle_slice = slice(1, 3) if model_type == 9 else slice(1, 2)
    if np.any(lower[angle_slice] <= -90) or np.any(upper[angle_slice] >= 90):
        raise ValueError("倾角范围须在(-90,90)内")
    if np.any(lower[angle_slice] > 0) or np.any(upper[angle_slice] < 0):
        raise ValueError("倾角范围必须包含0，才能执行回平保护")
    return lower, upper


def _edge_distance(hull, beta):
    # 保留旧多点摆与PLC的有效射线方向：(+sinβ,+cosβ)。
    dx, dy = math.sin(beta), math.cos(beta)
    distance = float('inf')
    for a, b in zip(hull, np.roll(hull, -1, axis=0)):
        ex, ey = b - a
        determinant = dx * ey - dy * ex
        if abs(determinant) <= 1e-12:
            continue
        t = (a[0] * ey - a[1] * ex) / determinant
        u = (a[0] * dy - a[1] * dx) / determinant
        if t > 0 and -1e-12 <= u <= 1 + 1e-12:
            distance = min(distance, t)
    if not math.isfinite(distance):
        raise ValueError("当前倾斜方向无法求得有效凸包边距，请检查吊点与原点")
    return distance


def _solve_inverse(forward, lower, upper, targets, points_array, seeds, return_diagnostics):
    """共用有界最小二乘和残差验收，各模型自行提供正解与初值。"""
    active = np.flatnonzero(upper > lower)

    def expand(values):
        result = lower.copy()
        result[active] = values
        return result

    def residual(values):
        return forward(expand(values))[0] - targets

    candidates = []
    integer_targets = bool(np.all(np.abs(targets - np.round(targets)) <= 1e-9))
    for seed in seeds:
        if len(active):
            solved = least_squares(residual, seed[active], bounds=(lower[active], upper[active]),
                method='trf', x_scale='jac', ftol=1e-11, xtol=1e-11, gtol=1e-11, max_nfev=300)
            values, nfev = expand(solved.x), solved.nfev
        else:
            values, nfev = lower.copy(), 1
        distances, positions = forward(values)
        errors = distances - targets
        rmse, max_error = float(np.sqrt(np.mean(errors ** 2))), float(np.max(np.abs(errors)))
        feasible = bool(np.all(positions[:, 2] - points_array[:, 2] <= 1e-6))
        candidates.append((not feasible, rmse, max_error, values, distances, nfev))
        # 整毫米输入允许量化残差；连续位置输入则继续寻找更精确的候选。
        if feasible and (max_error <= 1e-6 or (integer_targets and rmse <= 0.35 and max_error <= 0.75)):
            break
    candidates.sort(key=lambda item: (item[0], item[1], item[2]))
    infeasible, rmse, max_error, values, distances, nfev = candidates[0]
    success = bool(not infeasible and rmse <= 1.0 and max_error <= 2.0)
    diagnostics = {'success': success, 'rmse': rmse, 'max_error': max_error,
        'candidate_count': len(candidates), 'nfev': int(nfev), 'forward_motor_H': distances.tolist()}
    if not success:
        raise ValueError(f"反解失败：实轴位置不匹配或几何不可行，最大残差{max_error:.3f}mm")
    result = values.tolist()
    return (result, diagnostics) if return_diagnostics else result


# 单点模型和多级升降共用反解
def dandian_inverse_model(height, motor_H, limit_min, limit_max):
    """按旧逻辑对实轴位置求平均，再限制到高度上下限，保留height参数供旧调用使用。"""
    positions = np.asarray(motor_H, dtype=float)
    bounds = np.asarray([limit_min, limit_max], dtype=float)
    if positions.ndim != 1 or not len(positions) or not np.all(np.isfinite(positions)):
        raise ValueError("单点摆实轴位置须为非空的有限数值列表")
    if not np.all(np.isfinite(bounds)) or limit_min > limit_max:
        raise ValueError("单点摆高度上下限无效")
    return float(np.clip(sum(motor_H) / len(motor_H), limit_min, limit_max))


# 多点摆正解
def duodian_forward_solution(height, roll, pitch, point_init_pos,Baseheight1, Baseheight2, maxheight, betainit=0, _prepared=None):
    """传入H、方向角Y、倾角P，返回原轴序的实轴位置和吊点空间坐标。"""
    values = np.asarray([height, roll, pitch, Baseheight1, Baseheight2, maxheight, betainit], dtype=float)
    if not np.all(np.isfinite(values)):
        raise ValueError("多点摆正解参数包含非有限数值")
    upper_reference = Baseheight1 > 0 and Baseheight2 == 0
    lower_reference = Baseheight1 == 0 and Baseheight2 > 0
    if not (upper_reference or lower_reference) or maxheight <= 0:
        raise ValueError("两项原点距离须一项大于0、另一项为0，最大高度须大于0")
    if abs(pitch) >= 90:
        raise ValueError("多点摆倾角须在(-90,90)内")
    points, hull = _geometry(point_init_pos) if _prepared is None else _prepared
    x, y, z = points.T
    beta, angle = -math.radians(roll + betainit), -math.radians(pitch)
    cb, sb, ca, sa = math.cos(beta), math.sin(beta), math.cos(angle), math.sin(angle)
    # 先Rz(β)，再Rx(倾角)，最后Rz(-β)，原Z在旋转后叠加。
    x1, y1 = cb * x - sb * y, sb * x + cb * y
    positions = np.column_stack((cb * x1 + sb * ca * y1,
                                 -sb * x1 + cb * ca * y1, sa * y1 + z))
    offset = 0.0
    if angle != 0:
        distance = _edge_distance(hull, beta)
        vertical = height + Baseheight1 if upper_reference else Baseheight2 + maxheight - height
        power = min(100.0, 1.73 + 0.52 * vertical / distance)
        offset = min(distance, distance * (abs(angle) / 1.5707963) ** power)
        if angle < 0:
            offset = -offset
    positions[:, 0] += math.sin(beta) * offset
    positions[:, 1] += math.cos(beta) * offset
    positions[:, 2] += -height - Baseheight1 if upper_reference else height - Baseheight2 - maxheight
    lengths = np.linalg.norm(positions - points, axis=1)
    motor_positions = lengths - Baseheight1 if upper_reference else Baseheight2 + maxheight - lengths
    return motor_positions.tolist(), positions.tolist()


# 多点摆反解
def duodian_inverse_model(limitData, points, target_distances,Baseheight1, Baseheight2, maxheight, max_recursive_calls=0,betainit=0, return_diagnostics=False, initial_guess=None):
    """用多点摆正解和方向角等价初值求解，返回[H,P,Y]。"""
    del max_recursive_calls
    lower, upper = _limits(7, limitData)
    points_array, hull = _geometry(points)
    targets = np.asarray(target_distances, dtype=float)
    if targets.shape != (len(points_array),) or not np.all(np.isfinite(targets)):
        raise ValueError("实轴位置须为有限数值，且数量与吊点相同")

    def forward(values):
        distances, positions = duodian_forward_solution(values[0], values[2], values[1], points_array,
            Baseheight1, Baseheight2, maxheight, betainit, _prepared=(points_array, hull))
        return np.asarray(distances), np.asarray(positions)

    forward([lower[0], 0.0, 0.0])  # 先验证基础几何参数。
    design = np.column_stack((np.ones(len(points_array)), points_array[:, :2]))
    plane, *_ = np.linalg.lstsq(design, targets, rcond=None)
    h_seed = float(np.clip(plane[0], lower[0], upper[0]))
    seeds = []

    def add_seed(values):
        seed = np.clip(np.asarray(values, dtype=float), lower, upper)
        if not any(np.allclose(seed, old, rtol=0, atol=1e-9) for old in seeds):
            seeds.append(seed)

    if initial_guess is not None:
        guess = np.asarray(initial_guess, dtype=float)
        if guess.shape != (3,) or not np.all(np.isfinite(guess)):
            raise ValueError("HPY须为3个有限数值")
        add_seed(guess)

    p_seed = math.degrees(math.atan(math.hypot(plane[1], plane[2])))
    y_seed = math.degrees(math.atan2(-plane[1], plane[2])) - betainit
    center_y = (lower[2] + upper[2]) / 2.0

    def equivalent_y(value):
        k = round((center_y - value) / 360.0)
        return [value + 360.0 * (k + offset) for offset in (0, -1, 1)
                if lower[2] <= value + 360.0 * (k + offset) <= upper[2]] or [value + 360.0 * k]

    for pitch, yaw in ((p_seed, y_seed), (-p_seed, y_seed + 180.0)):
        for yaw_value in equivalent_y(yaw):
            add_seed([h_seed, pitch, yaw_value])
    fallback = min(max(p_seed, max(abs(lower[1]), abs(upper[1])) * 0.35, 0.1),
                   max(abs(lower[1]), abs(upper[1])))
    for yaw in (center_y, center_y + 90, center_y + 180, center_y - 90):
        for yaw_value in equivalent_y(yaw)[:1]:
            add_seed([h_seed, fallback, yaw_value])
            add_seed([h_seed, -fallback, yaw_value])
    add_seed([h_seed, 0, center_y])
    result, diagnostics = _solve_inverse(forward, lower, upper, targets, points_array, seeds, True)
    # 水平姿态的方向角不唯一，清理数值尾差后统一返回P=0、Y=0。
    if abs(result[1]) <= 1e-7:
        horizontal_result = [result[0], 0.0, 0.0]
        distances, positions = forward(horizontal_result)
        errors = distances - targets
        rmse = float(np.sqrt(np.mean(errors ** 2)))
        max_error = float(np.max(np.abs(errors)))
        if np.all(positions[:, 2] - points_array[:, 2] <= 1e-6) and rmse <= 1.0 and max_error <= 2.0:
            result = horizontal_result
            diagnostics.update({'success': True, 'rmse': rmse, 'max_error': max_error,
                                'forward_motor_H': distances.tolist()})
    return (result, diagnostics) if return_diagnostics else result


# 多点摆超坐标保护
def duodian_coordinate_protection(pose, limit_data, limit_rim):
    """按上下行程余量与安全半径计算允许倾角，限制P并保留方向角Y。"""
    lower, upper = _limits(7, limit_data)
    pose = np.asarray(pose, dtype=float)
    radius = np.asarray(limit_rim, dtype=float)
    if pose.shape != (3,) or not np.all(np.isfinite(pose)):
        raise ValueError("HPY须为3个有限数值")
    if radius.ndim != 1 or not len(radius) or not math.isfinite(radius[0]) or radius[0] <= 0:
        raise ValueError("limit_rim[0]安全半径必须大于0")
    height, p_angle, y_angle = np.clip(pose, lower, upper).tolist()
    clearance = max(0.0, min(height - lower[0], upper[0] - height))
    # 保留原多点摆88°的上限，不使用旧超坐标分支的+0.2°放宽。
    angle_limit = min(math.radians(88.0), math.asin(min(1.0, clearance / radius[0])))
    angle = math.degrees(angle_limit)
    p_angle = max(-angle, min(p_angle, angle))
    return [height, p_angle, y_angle]


# XY多点摆正解
def xy_duodian_forward_solution(height, x_angle, y_angle, point_init_pos, Baseheight1, Baseheight2, maxheight, betainit=0,hull_points=None, _prepared=None):
    """按PLC的固定X轴、固定Y轴顺序旋转，返回原轴序实轴位置和吊点空间坐标。"""
    values = np.asarray([height, x_angle, y_angle, Baseheight1, Baseheight2, maxheight, betainit], dtype=float)
    if not np.all(np.isfinite(values)):
        raise ValueError("XY多点摆正解参数包含非有限数值")
    upper_reference = Baseheight1 > 0 and Baseheight2 == 0
    lower_reference = Baseheight1 == 0 and Baseheight2 > 0
    if not (upper_reference or lower_reference) or maxheight <= 0:
        raise ValueError("两项原点距离须一项大于0、另一项为0，最大高度须大于0")
    if abs(x_angle) >= 90 or abs(y_angle) >= 90:
        raise ValueError("XY多点摆X/Y角须在(-90,90)内")
    if betainit != 0:
        raise ValueError("XY多点摆betainit必须为0")
    points, hull = _geometry(point_init_pos) if _prepared is None else _prepared
    if hull_points is not None:
        hull = np.asarray(hull_points, dtype=float)
    x, y, z = points.T
    pitch, roll = -math.radians(x_angle), -math.radians(y_angle)
    cp, sp, cr, sr = math.cos(pitch), math.sin(pitch), math.cos(roll), math.sin(roll)
    tilt = math.acos(max(-1.0, min(1.0, cp * cr)))
    beta, offset = 0.0, 0.0
    if tilt > 1e-8:
        beta = math.acos(max(-1.0, min(1.0, sp / math.sin(tilt))))
        if -sr * cp < 0:
            beta = -beta
        distance = _edge_distance(hull, beta)
        vertical = height + Baseheight1 if upper_reference else Baseheight2 + maxheight - height
        power = min(100.0, 1.73 + 0.52 * vertical / distance)
        offset = min(distance, distance * (tilt / 1.5707963) ** power)
    # XY多点摆的原Z参与两次旋转。
    y1, z1 = cp * y - sp * z, sp * y + cp * z
    positions = np.column_stack((cr * x + sr * z1, y1, -sr * x + cr * z1))
    positions[:, 0] += math.sin(beta) * offset
    positions[:, 1] += math.cos(beta) * offset
    positions[:, 2] += -height - Baseheight1 if upper_reference else height - Baseheight2 - maxheight
    lengths = np.linalg.norm(positions - points, axis=1)
    motor_positions = lengths - Baseheight1 if upper_reference else Baseheight2 + maxheight - lengths
    return motor_positions.tolist(), positions.tolist()


# XY多点摆反解
def xy_duodian_inverse_model(limitData, points, target_distances,Baseheight1, Baseheight2, maxheight, max_recursive_calls=0,betainit=0, return_diagnostics=False, initial_guess=None):
    """用XY多点摆正解和平面初值求解，返回[H,X角,Y角]。"""
    del max_recursive_calls
    lower, upper = _limits(9, limitData)
    points_array, hull = _geometry(points)
    targets = np.asarray(target_distances, dtype=float)
    if targets.shape != (len(points_array),) or not np.all(np.isfinite(targets)):
        raise ValueError("实轴位置须为有限数值，且数量与吊点相同")

    def forward(values):
        distances, positions = xy_duodian_forward_solution(*values, points_array,
            Baseheight1, Baseheight2, maxheight, betainit, _prepared=(points_array, hull))
        return np.asarray(distances), np.asarray(positions)

    forward([lower[0], 0.0, 0.0])  # 先验证基础几何参数。
    design = np.column_stack((np.ones(len(points_array)), points_array[:, :2]))
    plane, *_ = np.linalg.lstsq(design, targets, rcond=None)
    h_seed = float(np.clip(plane[0], lower[0], upper[0]))
    seeds = []

    def add_seed(values):
        seed = np.clip(np.asarray(values, dtype=float), lower, upper)
        if not any(np.allclose(seed, old, rtol=0, atol=1e-9) for old in seeds):
            seeds.append(seed)

    if initial_guess is not None:
        guess = np.asarray(initial_guess, dtype=float)
        if guess.shape != (3,) or not np.all(np.isfinite(guess)):
            raise ValueError("HPY须为3个有限数值")
        add_seed(guess)

    direction = 1.0 if Baseheight1 > 0 else -1.0
    y_seed = math.asin(float(np.clip(-direction * plane[1], -1, 1)))
    x_seed = math.asin(float(np.clip(direction * plane[2] / max(math.cos(y_seed), 1e-8), -1, 1)))
    add_seed([h_seed, math.degrees(x_seed), math.degrees(y_seed)])
    add_seed([float(np.mean(targets)), 0, 0])
    for x in (lower[1], 0, upper[1]):
        for y in (lower[2], 0, upper[2]):
            add_seed([h_seed, x, y])

    return _solve_inverse(forward, lower, upper, targets, points_array, seeds, return_diagnostics)


# XY多点摆超坐标保护
def xy_duodian_coordinate_protection(pose, limit_data, limit_rim):
    """按多点摆的高度余量计算合成倾角上限，保持平台法向的水平方向共同回平。"""
    lower, upper = _limits(9, limit_data)
    pose = np.asarray(pose, dtype=float)
    radius = np.asarray(limit_rim, dtype=float)
    if pose.shape != (3,) or not np.all(np.isfinite(pose)):
        raise ValueError("HPY须为3个有限数值")
    if radius.ndim != 1 or not len(radius) or not math.isfinite(radius[0]) or radius[0] <= 0:
        raise ValueError("limit_rim[0]安全半径必须大于0")
    height, p_angle, y_angle = np.clip(pose, lower, upper).tolist()
    clearance = max(0.0, min(height - lower[0], upper[0] - height))
    # 保留原多点摆88°的上限，不使用旧超坐标分支的+0.2°放宽。
    angle_limit = min(math.radians(88.0), math.asin(min(1.0, clearance / radius[0])))
    x_rad, y_rad = math.radians(p_angle), math.radians(y_angle)
    combined = math.acos(max(-1.0, min(1.0, math.cos(x_rad) * math.cos(y_rad))))
    if angle_limit <= 0:
        p_angle, y_angle = 0.0, 0.0
    elif combined > angle_limit:
        scale = math.sin(angle_limit) / math.sin(combined)
        x_new = math.asin(float(np.clip(scale * math.sin(x_rad), -1, 1)))
        y_new = math.asin(float(np.clip(scale * math.sin(y_rad) * math.cos(x_rad) / math.cos(x_new), -1, 1)))
        p_angle, y_angle = math.degrees(x_new), math.degrees(y_new)
    return [height, p_angle, y_angle]


def test_case(args):
    model_type = _model_type(args['type'])
    if model_type in (2, 3):
        height = dandian_inverse_model(args['HPY'][0], args['motor_H'],args['limit_data'][0][0], args['limit_data'][0][1])
        return {'index': args['index'], 'HPY': [round(height, 2), 0, 0],
                'Motor_H': [round(height, 0)] * len(args['motor_H'])}

    if model_type == 7:
        forward = duodian_forward_solution
        inverse = duodian_inverse_model
        protect = duodian_coordinate_protection
    else:
        forward = xy_duodian_forward_solution
        inverse = xy_duodian_inverse_model
        protect = xy_duodian_coordinate_protection
    lower, upper = _limits(model_type, args['limit_data'])
    points, hull = _geometry(args['params'])
    targets, supplied_pose = np.asarray(args['motor_H'], dtype=float), np.asarray(args['HPY'], dtype=float)
    if targets.shape != (len(points),) or not np.all(np.isfinite(targets)):
        raise ValueError("实轴位置须为有限数值，且数量与吊点相同")
    if supplied_pose.shape != (3,) or not np.all(np.isfinite(supplied_pose)):
        raise ValueError("HPY须为3个有限数值")
    base1, base2, beta = args['origin_distance1'], args['origin_distance2'], args['betainit']

    # 先正解核对所有轴；输入姿态无效或任一轴误差>150mm时才反解。
    valid_pose = bool(np.all(supplied_pose >= lower) and np.all(supplied_pose <= upper))
    guessed = None
    if valid_pose:
        forward_pose = supplied_pose[[0, 2, 1]] if model_type == 7 else supplied_pose
        guessed, _ = forward(*forward_pose, points, base1, base2, upper[0], beta,
                                      _prepared=(points, hull))
    used_inverse = not (guessed is not None and np.all(np.abs(np.asarray(guessed) - targets) <= FORWARD_TOLERANCE_MM))
    if not used_inverse:
        pose = supplied_pose.tolist()
    else:
        pose = inverse(args['limit_data'], points, targets, base1, base2, upper[0],
                       betainit=beta, initial_guess=supplied_pose)

    # 先确定最终高度精度，再计算保护角，避免高度舍入后角度越界。
    pose[0] = float(np.clip(round(pose[0], 2), lower[0], upper[0]))
    pose = protect(pose, args['limit_data'], args['limit_rim'])

    def truncate_angle(value):
        # 仅清理求解器的1e-12级噪声；朝零截断确保保护后的角度不增大。
        return math.trunc(round(value * 100, 10)) / 100.0

    pose[1], pose[2] = truncate_angle(pose[1]), truncate_angle(pose[2])
    # 多点摆方向角不参与回平，配置范围可能不含0，截断后仍须保持在范围内。
    if model_type == 7:
        pose[2] = float(np.clip(pose[2], lower[2], upper[2]))
        # 仅在实际反解后归零，150mm以内保留原方向角。水平时Y统一表示为0。
        if used_inverse and pose[1] == 0.0:
            pose[2] = 0.0
    # 输出HPY和Motor_H必须来自同一最终安全姿态，包含全部内部吊点。
    forward_pose = [pose[0], pose[2], pose[1]] if model_type == 7 else pose
    motor_positions, _ = forward(*forward_pose, points, base1, base2, upper[0], beta,
                                          _prepared=(points, hull))
    return {'index': args['index'], 'HPY': pose, 'Motor_H': [round(value, 0) for value in motor_positions]}


import threading
import psutil  # 用于检查和释放端口
import time
HOST = "127.0.0.1"  # 只监听局域网 IP
PORT = 5000
WATCH_FILE = "YXZ_call.json"
CHUNK_SIZE = 4096
def check_data_available(args):
    required_fields = ['index', 'type', 'origin_distance1', 'params', 'motor_H', 'limit_data', 'HPY']
    for field in required_fields:
        if field not in args or not args[field]:
            return False
    return True
def process_data(data):
    """处理数据并返回结果"""
    if isinstance(data, list):
        results = [test_case(args) for args in data]
    else:
        results = test_case(data)
    return results
# --- 释放端口 ---
def free_port(port):
    for conn in psutil.net_connections(kind='tcp'):
        if conn.laddr.port == port and conn.status == 'LISTEN':
            try:
                p = psutil.Process(conn.pid)
                print(f"杀掉占用端口 {port} 的进程 PID={conn.pid}")
                p.kill()
            except Exception as e:
                print(f"释放端口失败: {e}")

# 启动服务器前先释放端口
free_port(PORT)

# --- Socket 服务 ---
def send_json_in_chunks(conn, data, chunk_size=CHUNK_SIZE):
    try:
        json_str = json.dumps(data, ensure_ascii=False)
        bytes_data = json_str.encode('utf-8')
        for i in range(0, len(bytes_data), chunk_size):
            conn.sendall(bytes_data[i:i+chunk_size])
    except Exception as e:
        print("发送数据异常:", e)

def handle_client(conn, addr):
    print(f"客户端已连接: {addr}")
    try:
        while True:
            data = conn.recv(CHUNK_SIZE)
            if not data:
                print(f"客户端 {addr} 已关闭连接")
                break
            try:
                signal_num = int(data.decode())
            except ValueError:
                signal_num = None

            if not os.path.exists(WATCH_FILE):
                conn.sendall(b'{"error":"file not found"}')
                continue

            try:
                with open(WATCH_FILE, "r", encoding="utf-8") as f:
                    items = json.load(f)
            except Exception:
                conn.sendall(b'{"error":"json parse failed"}')
                continue

            all_results = []
            for item in items:
                try:
                    result = process_data(item)  # 你的反解函数
                    all_results.append(result)
                except Exception as e:
                    all_results.append({"error": str(e)})
            with open("YXZ.json", "w", encoding="utf-8") as f_out:
                json.dump(all_results, f_out, ensure_ascii=False, indent=4)
            conn.sendall(data)  # 回显
    except Exception:
        print("客户端处理异常:\n", traceback.format_exc())
    finally:
        conn.close()

def start_server():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(5)
        print(f"服务器已启动，监听 {HOST}:{PORT}")
        while True:
            conn, addr = s.accept()
            threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()

if __name__ == "__main__":
    threading.Thread(target=start_server, daemon=True).start()
    print("服务器已启动，按 Ctrl+C 停止")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("服务器已停止")




