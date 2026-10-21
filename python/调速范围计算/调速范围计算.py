import copy
import json
import hashlib
import tempfile
import math
import heapq
import sys
from pathlib import Path
from fractions import Fraction

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
##########################两点实轴速度：对两点位置正解解析求导#########################
def liangdian_velocity_model(height, arg_x, velocity_h, velocity_x,
                            BaseHight1, BaseHight2, lLenth_inside, maxheight):
    """返回两个电机的带符号瞬时速度 (velocity_A, velocity_B)，不是整段最大速度。

    height、arg_x：当前H位置、P角度；与两点位置正解的输入一致。
    velocity_h：当前H速度，长度单位/秒；velocity_x：当前P速度，度/秒。
    后四项是原有模型几何参数；输出单位与H速度一致，反向运动保留负号。
    按现有正解的三次偏移、角度旋转和距离公式求导，不修改位置正解。
    """
    # 位置和速度必须来自同一时刻；几何参数保持原位置正解的含义。
    values = [float(value) for value in (
        height, arg_x, velocity_h, velocity_x,
        BaseHight1, BaseHight2, lLenth_inside, maxheight
    )]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("两点位置、速度和几何参数必须是有限数值")
    height, arg_x, velocity_h, velocity_x, BaseHight1, BaseHight2, lLenth_inside, maxheight = values

    if BaseHight1 != 0 and BaseHight2 == 0:
        origin_height = 0.0
        point_height = height + BaseHight1
        distance_sign = 1.0      # 上方原点：电机位置=距离-固定偏置。
    elif BaseHight1 == 0 and BaseHight2 != 0:
        # 原位置正解将角度取反，这里的角速度也必须同时取反。
        arg_x = -arg_x
        velocity_x = -velocity_x
        origin_height = BaseHight2 + maxheight
        point_height = height
        distance_sign = -1.0     # 下方原点：电机位置=固定偏置-距离。
    else:
        raise ValueError("两点正解要求BaseHight1和BaseHight2恰好一个为0，另一个非0")

    half_length = lLenth_inside / 2.0
    angle_rad = math.radians(arg_x)
    angular_velocity_rad = math.radians(velocity_x)
    sin_angle, cos_angle = math.sin(angle_rad), math.cos(angle_rad)
    offset = (arg_x / 90.0)**3 * half_length
    offset_velocity = 3.0 * (arg_x / 90.0)**2 * (velocity_x / 90.0) * half_length

    # 两端相对于各自原点的位置差，顺序与原正解的A、B电机一致。
    dx_A = half_length * (1.0 - cos_angle) - offset
    dx_B = half_length * (cos_angle - 1.0) - offset
    dy_A = point_height - half_length * sin_angle - origin_height
    dy_B = point_height + half_length * sin_angle - origin_height
    # 上述位置差对时间求导，H与P同时参与，先叠加带符号速度。
    dx_velocity_A = half_length * sin_angle * angular_velocity_rad - offset_velocity
    dx_velocity_B = -half_length * sin_angle * angular_velocity_rad - offset_velocity
    dy_velocity_A = velocity_h - half_length * cos_angle * angular_velocity_rad
    dy_velocity_B = velocity_h + half_length * cos_angle * angular_velocity_rad

    motor_velocities = []
    for name, dx, dy, dx_velocity, dy_velocity in (
        ("A", dx_A, dy_A, dx_velocity_A, dy_velocity_A),
        ("B", dx_B, dy_B, dx_velocity_B, dy_velocity_B),
    ):
        distance = math.hypot(dx, dy)
        if distance == 0:
            # 距离为0且仍有相对速度时，距离函数在此处没有双侧导数。
            if dx_velocity != 0 or dy_velocity != 0:
                raise ValueError(f"两点电机{name}相对原点的距离为0，此时位置正解不可求导")
            motor_velocity = 0.0
        else:
            # d(sqrt(dx²+dy²))/dt=(dx*dx_velocity+dy*dy_velocity)/distance。
            motor_velocity = distance_sign * ((dx / distance) * dx_velocity + (dy / distance) * dy_velocity)
        motor_velocities.append(motor_velocity)
    return tuple(motor_velocities)


##########################四点实轴速度：按原四点正解的运动方向求导#########################
def sidian_velocity_model(height, arg_x_deg, arg_y_deg,
                          velocity_h, velocity_x, velocity_y,
                          BaseHight1, BaseHight2, lLenth_inside, wLenth_inside,
                          maxheight, moveWhat):
    """返回四个电机的带符号瞬时速度，电机顺序与sidian_forward_model一致。

    前三项是H/P/Y位置，接着三项是H/P/Y速度：长度单位/秒、度/秒、度/秒。
    后六项是原四点正解的几何参数与moveWhat，不需要传入动作时间。
    moveWhat=1只使用H/P，=2只使用H/Y；其他值按原正解只使用H。
    复用两点求导公式，保留原四点模型的电机排列及未选中虚轴的处理方式。
    """
    values = [float(value) for value in (
        height, arg_x_deg, arg_y_deg, velocity_h, velocity_x, velocity_y,
        BaseHight1, BaseHight2, lLenth_inside, wLenth_inside, maxheight
    )]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("四点位置、速度和几何参数必须是有限数值")
    (height, arg_x_deg, arg_y_deg, velocity_h, velocity_x, velocity_y,
     BaseHight1, BaseHight2, lLenth_inside, wLenth_inside, maxheight) = values
    if not ((BaseHight1 != 0 and BaseHight2 == 0) or (BaseHight1 == 0 and BaseHight2 != 0)):
        raise ValueError("四点正解要求BaseHight1和BaseHight2恰好一个为0，另一个非0")
    if moveWhat == 1:
        velocity_A, velocity_B = liangdian_velocity_model(
            height, arg_x_deg, velocity_h, velocity_x,
            BaseHight1, BaseHight2, lLenth_inside, maxheight
        )
        return velocity_A, velocity_B, velocity_B, velocity_A
    elif moveWhat == 2:
        velocity_A, velocity_B = liangdian_velocity_model(
            height, arg_y_deg, velocity_h, velocity_y,
            BaseHight1, BaseHight2, wLenth_inside, maxheight
        )
        return velocity_B, velocity_B, velocity_A, velocity_A
    else:
        return velocity_h, velocity_h, velocity_h, velocity_h


## 读取文件：将本脚本同目录的 JSON 参数读入内存。
def _resolve_parameter_path(parameter_path=None):
    """显式路径直接使用；默认优先共用文件，不存在时兼容旧文件名。"""
    if parameter_path is not None:
        return Path(parameter_path)
    parameter_path = Path(__file__).with_name("算法参数.json")
    if not parameter_path.exists():
        parameter_path = Path(__file__).with_name("调速参数.json")
    return parameter_path


def load_speed_parameters(parameter_path=None):
    """读取共用参数，保留全部原始字段；也可显式传入 JSON 文件路径。"""
    parameter_path = _resolve_parameter_path(parameter_path)
    parameters = json.loads(parameter_path.read_text(encoding="utf-8-sig"))
    if not isinstance(parameters, dict) or not isinstance(parameters.get("models"), list):
        raise ValueError("参数 JSON 顶层必须是对象，且 models 必须是模型列表")
    # 返回全部参数，保留模型几何参数、原始动作帧和 abcdef 等原始字段。
    return parameters
## 虚轴状态：根据原动作 abcdef 系数，计算指定时刻的 H/P/Y 位置和速度。
def calculate_virtual_state(segment, time_ms, time_unit_ms):
    """返回 (position_HPY, velocity_HPY)，两项均为按 H/P/Y 排列的列表。

    segment：完整动作可包含 coefficient_segments；叶子阶段包含 start_frame、end_frame 和 a..f。
    time_ms：原动作中的绝对时间，单位 ms，不是段内经过时间。
    time_unit_ms：多项式自变量每增加 1 对应的毫秒数，例如 100。
    H 位置按输入的长度单位，P/Y 按角度单位；速度统一为对应单位每秒。
    本函数只计算一个时刻，不修改参数，不判断强制轨迹，不求最大速度。
    """
    # 先将时间参数转换为数值，要求时间有限且系数时间单位为正。
    start_ms = float(segment["start_frame"])
    end_ms = float(segment["end_frame"])
    time_ms = float(time_ms)
    time_unit_ms = float(time_unit_ms)
    if not all(math.isfinite(value) for value in (start_ms, end_ms, time_ms, time_unit_ms)):
        raise ValueError("动作帧、当前时间和系数时间单位必须是有限数值")
    if time_unit_ms <= 0 or end_ms <= start_ms:
        raise ValueError("系数时间单位必须大于 0，结束帧必须大于开始帧")
    # 允许计算本段起点和终点，但不向本段时间范围之外外推。
    if not start_ms <= time_ms <= end_ms:
        raise ValueError("当前时间必须位于该动作段的开始帧和结束帧之间")

    # 完整Move可包含多组分段系数；先选中当前时刻所在的阶段，再按原公式求值。
    if "coefficient_segments" in segment:
        pieces = segment["coefficient_segments"]
        if not isinstance(pieces, list) or not pieces:
            raise ValueError("coefficient_segments 必须是非空阶段列表")
        previous_end = start_ms
        selected_piece = None
        for index, piece in enumerate(pieces):
            piece_start, piece_end = float(piece["start_frame"]), float(piece["end_frame"])
            if not all(math.isfinite(v) for v in (piece_start, piece_end)) or piece_end <= piece_start:
                raise ValueError("系数阶段起止时间必须有限且结束晚于开始")
            if piece_start != previous_end or piece_end > end_ms:
                raise ValueError("系数阶段必须连续且完整地覆盖动作段，不能有间隔、重叠或越界")
            if piece_start <= time_ms < piece_end or (index == len(pieces)-1 and time_ms == piece_end):
                selected_piece = piece
            previous_end = piece_end
        if previous_end != end_ms or selected_piece is None:
            raise ValueError("系数阶段未完整覆盖动作段或当前时刻")
        return calculate_virtual_state(selected_piece, time_ms, time_unit_ms)

    # a..f 每项都必须有三个有限数值，顺序固定为 H/P/Y。
    coefficients = []
    for name in "abcdef":
        values = segment[name]
        if not isinstance(values, (list, tuple)) or len(values) != 3:
            raise ValueError(f"系数 {name} 必须包含 H/P/Y 三个数值")
        values = [float(value) for value in values]
        if not all(math.isfinite(value) for value in values):
            raise ValueError(f"系数 {name} 必须是有限数值")
        coefficients.append(values)

    # u 是段内的多项式自变量；例如经过 2500ms、单位为 100ms，则 u=25。
    u = (time_ms - start_ms) / time_unit_ms
    # 多项式求导得到的是每个 u 单位的速度，需要换算成每秒速度。
    per_second = 1000.0 / time_unit_ms
    position_HPY = []
    velocity_HPY = []
    for axis in range(3):
        a, b, c, d, e, f = (values[axis] for values in coefficients)
        position = a + b*u + c*u**2 + d*u**3 + e*u**4 + f*u**5
        velocity = (b + 2*c*u + 3*d*u**2 + 4*e*u**3 + 5*f*u**4) * per_second
        position_HPY.append(position)
        # 保留速度正负号，反向运动返回负速度；限速比较时再取绝对值。
        velocity_HPY.append(velocity)
    return position_HPY, velocity_HPY
## 内部极值辅助：找出多项式在0到1之间的实根，供单点高阶曲线求最大速度。
def find_unit_interval_roots(coefficients):
    """系数按常数项、一次项、二次项等排列；返回数值求得的区间实根。

    单点速度的内部极值满足加速度为0，加速度最高是三次多项式。
    先用导数的根划分单调区间，再二分求根，不需要逐帧采样或第三方库。
    """
    coefficients = list(coefficients)
    if not all(math.isfinite(value) for value in coefficients):
        raise ValueError("求极值的系数必须是有限数值")
    while coefficients and coefficients[-1] == 0:
        coefficients.pop()
    if len(coefficients) <= 1:
        return []                   # 常数或全0，不需要增加内部候选点。
    scale = max(abs(value) for value in coefficients)
    coefficients = [value / scale for value in coefficients]
    derivative = [i * coefficients[i] for i in range(1, len(coefficients))]
    turning_points = find_unit_interval_roots(derivative)
    boundaries = sorted(set([0.0, 1.0] + turning_points))
    values = [math.fsum(c * x**i for i, c in enumerate(coefficients)) for x in boundaries]
    # 包括切触0的重根；它不一定在两侧产生符号变化。
    roots = [x for x, value in zip(boundaries, values) if abs(value) <= 1e-12]
    for index in range(len(boundaries) - 1):
        left, right = boundaries[index:index + 2]
        left_value, right_value = values[index:index + 2]
        if left_value * right_value >= 0:
            continue
        for _ in range(60):
            middle = (left + right) / 2
            middle_value = math.fsum(c * middle**i for i, c in enumerate(coefficients))
            if middle_value == 0:
                left = right = middle
                break
            if (left_value < 0) == (middle_value < 0):
                left, left_value = middle, middle_value
            else:
                right = middle
        roots.append((left + right) / 2)
    return sorted(set(roots))


## 调速倍率：统一计算各模型速度限制倍率，返回整个动作的倍率估算。
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


def _two_point_motor_speed_upper(height, angle, velocity_h, velocity_angle,
                                 base_height1, base_height2, half_length, maxheight):
    """用原两点求导公式包围两个实轴的绝对速度；四点按方向复用。"""
    interval = _SpeedInterval
    if base_height1 != 0 and base_height2 == 0:
        relative_height = height + base_height1
    else:
        angle, velocity_angle = -angle, -velocity_angle
        relative_height = height - (interval(base_height2) + maxheight)
    radians = angle * (interval(math.pi) / 180.0)
    angular_velocity = velocity_angle * (interval(math.pi) / 180.0)
    sine, cosine = radians.trig(), radians.trig(cosine=True)
    normalized_angle = angle / 90.0
    offset = normalized_angle.square() * normalized_angle * half_length
    offset_velocity = normalized_angle.square() * (velocity_angle / 90.0) * (3.0*half_length)
    span = (interval(1.0) - cosine) * half_length
    rotation_velocity = sine * angular_velocity * half_length
    vertical_velocity = cosine * angular_velocity * half_length
    upper = 0.0
    for side in (1, -1):
        dx = span * side - offset
        dy = relative_height - sine * (side*half_length)
        vx = rotation_velocity * side - offset_velocity
        vy = velocity_h - vertical_velocity * side
        projected = _motor_direction_interval(dx, dy)*vx + _motor_direction_interval(dy, dx)*vy
        # 单位方向投影也不超过相对速度向量的长度；原点奇异时此界仍有限。
        norm_upper = math.hypot(vx.max_abs(), vy.max_abs())
        for _ in range(4):
            norm_upper = math.nextafter(norm_upper, math.inf)
        if not all(math.isfinite(value) for value in (projected.lo, projected.hi, norm_upper)):
            raise ValueError("两点/四点区间计算溢出，请检查几何参数和系数的数值范围")
        upper = max(upper, min(projected.max_abs(), norm_upper))
    return math.nextafter(upper, math.inf)


def calculate_two_four_piece_max_velocity(piece, model, time_unit_ms):
    """返回这一系数阶段两点/四点的峰速数值上界，只输出一个速度。

    位置/速度多项式转成Bernstein控制值，以控制值范围包围整个区间。
    虚轴候选极值用于找到峰值下界；实轴区间上界决定哪些区间还需二分。
    搜索目标为相对1e-4或绝对1e-9 mm/s，达到预算时仍返回上界，不返回采样峰值。
    双精度四则运算向外舍入，三角函数外扩8 ulp；不是跨平台形式化数学证明。
    """
    interval = _SpeedInterval
    start_ms, end_ms = float(piece["start_frame"]), float(piece["end_frame"])
    initial_q, initial_v = calculate_virtual_state(piece, start_ms, time_unit_ms)
    base1, base2, maxheight = (float(model[name]) for name in ("BaseHight1", "BaseHight2", "maxheight"))
    if not all(math.isfinite(v) for v in (base1, base2, maxheight)):
        raise ValueError("两点/四点几何参数必须是有限数值")
    if not ((base1 != 0 and base2 == 0) or (base1 == 0 and base2 != 0)):
        raise ValueError("两点/四点正解要求上下原点恰好一个非0")
    if model["model_type"] == 6 or model["moveWhat"] == 1:
        angle_axis, length = 1, float(model["lLenth_inside"])
    elif model["moveWhat"] == 2:
        angle_axis, length = 2, float(model["wLenth_inside"])
    else:
        angle_axis, length = None, 0.0
    if not math.isfinite(length):
        raise ValueError("两点/四点吊点间距必须是有限数值")
    # 沿用原速度函数的输入验证，四点未选中方向的几何参数也要合法。
    try:
        if model["model_type"] == 6:
            liangdian_velocity_model(initial_q[0],initial_q[1],initial_v[0],initial_v[1],base1,base2,length,maxheight)
        else:
            sidian_velocity_model(*initial_q,*initial_v,base1,base2,model["lLenth_inside"],model["wLenth_inside"],maxheight,model["moveWhat"])
    except ValueError as error:
        if "相对原点的距离为0" not in str(error):
            raise
    duration_u = (interval(end_ms) - start_ms) / float(time_unit_ms)
    velocity_rate = interval(1000.0) / float(time_unit_ms)

    def bernstein(axis, velocity=False):
        coefficients = [float(piece[name][axis]) for name in "abcdef"]
        if not all(math.isfinite(v) for v in coefficients):
            raise ValueError("位置系数必须是有限数值")
        if velocity:
            coefficients = [interval(i)*coefficients[i]*velocity_rate for i in range(1, 6)]
        else:
            coefficients = [interval(v) for v in coefficients]
        while len(coefficients) > 1 and coefficients[-1].lo == coefficients[-1].hi == 0:
            coefficients.pop()
        power, scaled = interval(1), []
        for coefficient in coefficients:
            scaled.append(coefficient*power)
            power = power*duration_u
        degree = len(scaled)-1
        controls = []
        for i in range(degree+1):
            value = interval(0)
            for k in range(i+1):
                weight = interval(math.comb(i,k)) / math.comb(degree,k)
                value = value + scaled[k]*weight
            controls.append(value)
        if not all(math.isfinite(value) for control in controls for value in (control.lo,control.hi)):
            raise ValueError("两点/四点多项式区间计算溢出，请检查系数的数值范围")
        return controls

    def split(controls):
        left, right = [controls[0]], [controls[-1]]
        row = controls
        while len(row) > 1:
            row = [(a+b)*0.5 for a,b in zip(row,row[1:])]
            left.append(row[0]); right.append(row[-1])
        return left, list(reversed(right))

    def control_range(controls):
        return interval(min(v.lo for v in controls), max(v.hi for v in controls))

    curves = (bernstein(0), bernstein(angle_axis) if angle_axis is not None else [interval(0)],
              bernstein(0, True), bernstein(angle_axis, True) if angle_axis is not None else [interval(0)])
    pure_h = angle_axis is None or (curves[1][0].lo == curves[1][0].hi == 0 and len(curves[1]) == 1)
    if curves[2][0].lo == curves[2][0].hi == 0 and len(curves[2]) == 1 and curves[3][0].lo == curves[3][0].hi == 0 and len(curves[3]) == 1:
        return 0.0

    def bound(current_curves):
        if pure_h:
            return control_range(current_curves[2]).max_abs()
        h,a,vh,va = (control_range(values) for values in current_curves)
        return _two_point_motor_speed_upper(h,a,vh,va,base1,base2,length/2.0,maxheight)

    def instantaneous(x):
        time_ms = start_ms if x == 0 else end_ms if x == 1 else start_ms+x*(end_ms-start_ms)
        q,v = calculate_virtual_state(piece,time_ms,time_unit_ms)
        if pure_h:
            return abs(v[0])
        try:
            if model["model_type"] == 6:
                velocities = liangdian_velocity_model(q[0],q[1],v[0],v[1],base1,base2,length,maxheight)
            else:
                velocities = sidian_velocity_model(*q,*v,base1,base2,model["lLenth_inside"],model["wLenth_inside"],maxheight,model["moveWhat"])
            return max(abs(value) for value in velocities)
        except ValueError as error:
            if "相对原点的距离为0" not in str(error):
                raise
            # 距离在原点不可双侧求导，速度绝对值用相对速度范数的单侧极限包围。
            return _two_point_motor_speed_upper(interval(q[0]),interval(q[angle_axis]),interval(v[0]),interval(v[angle_axis]),base1,base2,length/2.0,maxheight)

    candidates = {0.0, 0.5, 1.0}
    u_end = (end_ms-start_ms)/float(time_unit_ms)
    for axis in (0, angle_axis) if angle_axis is not None else (0,):
        c,d,e,f = (float(piece[name][axis]) for name in "cdef")
        candidates.update(find_unit_interval_roots([2*c,6*d*u_end,12*e*u_end*u_end,20*f*u_end*u_end*u_end]))
    best = max(instantaneous(x) for x in candidates)
    initial_upper = bound(curves)
    if not math.isfinite(initial_upper):
        raise ValueError("两点/四点速度上界不是有限数值，请检查系数和几何参数")
    initial_upper = max(best, initial_upper)
    heap = [(-initial_upper, 0, 0.0, 1.0, curves)]
    sequence = 0
    retired_upper = best
    for _ in range(4096):
        if not heap:
            return math.nextafter(max(best, retired_upper), math.inf)
        maximum_upper = max(best, retired_upper, -heap[0][0])
        if maximum_upper-best <= max(1e-9, best*1e-4):
            return math.nextafter(maximum_upper, math.inf)
        negative_upper, _, left_x, right_x, current_curves = heapq.heappop(heap)
        if -negative_upper <= best:
            retired_upper = max(retired_upper, -negative_upper)
            continue
        middle_x = (left_x+right_x)/2.0
        if middle_x == left_x or middle_x == right_x:
            # 到浮点分辨率仍未收敛时保留上界，不把它替换成低估的采样值。
            return math.nextafter(max(maximum_upper, -negative_upper), math.inf)
        best = max(best, instantaneous(middle_x))
        halves = [split(control) for control in current_curves]
        for side, (a,b) in enumerate(((left_x,middle_x),(middle_x,right_x))):
            child = tuple(values[side] for values in halves)
            upper = bound(child)
            if not math.isfinite(upper):
                raise ValueError("两点/四点速度上界不是有限数值，请检查系数和几何参数")
            if upper <= best:
                retired_upper = max(retired_upper, upper)
            else:
                sequence += 1
                heapq.heappush(heap,(-upper,sequence,a,b,child))
    # 限定单阶段的细分预算；预算耗尽只影响保守程度，不丢弃尚未检查的上界。
    return math.nextafter(max(best, retired_upper, -heap[0][0] if heap else 0.0), math.inf)

def build_segment_velocity_key(segment, geometry_key, time_unit_ms):
    """生成峰速复用键：几何、系数时间单位、各阶段时长及全部abcdef。"""
    # 每个阶段的u从0开始，绝对开始帧和segment_id不影响该段峰速。
    # 分别保存每组系数，避免数组长度不同产生相同的键。
    pieces = segment.get("coefficient_segments", [segment])
    return (geometry_key, float(time_unit_ms), tuple(
        (float(piece["end_frame"]) - float(piece["start_frame"]),
         tuple(tuple(float(value) for value in piece[name]) for name in "abcdef"))
        for piece in pieces
    ))

def _prepare_multi_point_geometry(model):
    """准备原多点正解的二维边界；吊点按边界顺序给出，原点位于其内部核。"""
    points = tuple(tuple(float(x) for x in p) for p in model["point_init_pos"])
    if len(points) < 3 or any(len(p) != 3 or not all(math.isfinite(x) for x in p) for p in points):
        raise ValueError("多点吊点必须是至少三个有限XYZ坐标")
    base1, base2, height, beta = (float(model[k]) for k in ("Baseheight1", "Baseheight2", "maxheight", "betainit"))
    if not all(math.isfinite(x) for x in (base1, base2, height, beta)):
        raise ValueError("多点几何参数必须是有限数值")
    if not ((base1 != 0 and base2 == 0) or (base1 == 0 and base2 != 0)):
        raise ValueError("多点正解要求上下原点恰好一个非0")
    edges, winding, orientation = [], 0.0, None
    I = _SpeedInterval
    for p, q in zip(points, points[1:] + points[:1]):
        x, y = p[:2]; dx, dy = q[0]-x, q[1]-y
        cross = I(x)*q[1] - I(y)*q[0]
        sign = 1 if cross.lo > 0 else -1 if cross.hi < 0 else 0
        if sign == 0 or (orientation is not None and sign != orientation):
            raise ValueError("多点吊点需按边界顺序排列，原点须严格位于边界内部核，不能有边穿过原点")
        orientation = sign
        winding += math.atan2(x*q[1]-y*q[0], x*q[0]+y*q[1])
        edge_length = ((I(q[0])-x).square() + (I(q[1])-y).square()).sqrt()
        radius_min = (cross if sign > 0 else -cross) / edge_length
        radius_max = max((I(x).square()+I(y).square()).sqrt().hi,
                         (I(q[0]).square()+I(q[1]).square()).sqrt().hi)
        edges.append((x, y, I(q[0])-x, I(q[1])-y, cross, radius_min.lo, radius_max))
    if abs(abs(winding)-2*math.pi) > 1e-8:
        raise ValueError("多点吊点边界不能重复绕行或交叉")
    # Z初始值在原正解距离中相消；保留XY和全部输入，不修改原正解。
    return points, tuple(edges), base1, base2, height, beta


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
    # 原find_distance_fixed射线为(-sin(beta),-cos(beta))。
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


def calculate_multi_piece_max_velocity(piece, geometry, time_unit_ms):
    """返回多点一个系数阶段的峰速上界；按上界细分，达到预算仍保留上界。

    目标误差为相对0.01%或绝对1e-9。最多4096次细分；复杂分支可能提前
    返回较保守的结果。双精度/libm数值包围不等于跨平台形式化认证。
    """
    I = _SpeedInterval
    start, end = float(piece["start_frame"]), float(piece["end_frame"])
    calculate_virtual_state(piece,start,time_unit_ms)
    duration = (I(end)-start)/float(time_unit_ms)
    rate = I(1000)/float(time_unit_ms)
    def bernstein(axis, velocity=False):
        coefficients = [I(float(piece[name][axis])) for name in "abcdef"]
        if velocity:
            coefficients = [coefficients[i]*i*rate for i in range(1,6)]
        while len(coefficients)>1 and coefficients[-1].lo == coefficients[-1].hi == 0:
            coefficients.pop()
        power, scaled = I(1), []
        for c in coefficients:
            scaled.append(c*power); power = power*duration
        degree = len(scaled)-1
        controls = []
        for i in range(degree+1):
            value = I(0)
            for k in range(i+1):
                value = value+scaled[k]*(I(math.comb(i,k))/math.comb(degree,k))
            controls.append(value)
        if not all(math.isfinite(x) for c in controls for x in (c.lo,c.hi)):
            raise ValueError("多点多项式区间溢出，请检查系数数值范围")
        return controls
    def split(values):
        left, right, row = [values[0]], [values[-1]], values
        while len(row)>1:
            row = [(a+b)*0.5 for a,b in zip(row,row[1:])]
            left.append(row[0]); right.append(row[-1])
        return left,list(reversed(right))
    def ranges(curves):
        return [I(min(c.lo for c in row),max(c.hi for c in row)) for row in curves]
    curves = tuple(bernstein(axis,velocity) for velocity in (False,True) for axis in range(3))
    if all(len(c)==1 and c[0].lo==c[0].hi==0 for c in curves[3:]):
        return 0.0
    # P恒为0时原正解只是H平移，Y只改变方向而不改变绳长；无需几何搜索。
    pure_h = len(curves[1])==1 and curves[1][0].lo==curves[1][0].hi==0
    def bound(current):
        values = ranges(current)
        return values[3].max_abs() if pure_h else _multi_point_motor_speed_upper(values[:3],values[3:],geometry)
    def instantaneous(x):
        q,v = calculate_virtual_state(piece,start if x==0 else end if x==1 else start+x*(end-start),time_unit_ms)
        return abs(v[0]) if pure_h else _multi_point_instantaneous_speed(q,v,geometry)
    candidates = {0.0,0.5,1.0}
    u_end = (end-start)/float(time_unit_ms)
    for axis in range(3):
        c,d,e,f = (float(piece[name][axis]) for name in "cdef")
        candidates.update(find_unit_interval_roots([2*c,6*d*u_end,12*e*u_end*u_end,20*f*u_end*u_end*u_end]))
    best = max(instantaneous(x) for x in candidates)
    heap = [(-max(best,bound(curves)),0,0.0,1.0,curves)]
    sequence, retired = 0,best
    for _ in range(4096):
        if not heap:
            return math.nextafter(max(best,retired),math.inf)
        maximum = max(best,retired,-heap[0][0])
        if maximum-best <= max(1e-9,best*1e-4):
            return math.nextafter(maximum,math.inf)
        negative,_,left,right,current = heapq.heappop(heap)
        if -negative<=best:
            retired = max(retired,-negative); continue
        middle = (left+right)*0.5
        if middle==left or middle==right:
            return math.nextafter(maximum,math.inf)
        best = max(best,instantaneous(middle))
        halves = [split(c) for c in current]
        for side,(a,b) in enumerate(((left,middle),(middle,right))):
            child = tuple(pair[side] for pair in halves)
            upper = bound(child)
            if upper<=best:
                retired = max(retired,upper)
            else:
                sequence += 1
                heapq.heappush(heap,(-upper,sequence,a,b,child))
    return math.nextafter(max(best,retired,-heap[0][0] if heap else best),math.inf)
def calculate_velocity_adjust(models, time_unit_ms, classification_max_factor):
    """返回velocity_adjust，不修改模型参数，不输出中间结果。

    models：模型列表，每个模型包含动作段、系数、几何参数和自身电机限速。
    time_unit_ms：abcdef自变量每增加1对应的毫秒数，不是100ms采样间隔。
    classification_max_factor：分类上限，可升速时为math.inf，只能降速时为1.0。
    返回值是原动作100%对应的倍率，例如2.0表示200%；全静止时可能为math.inf。
    两点/四点使用段内峰速数值上界；多点仍采用位置差分，整个动作尚非安全认证范围。
    """
    # 第二步：计算各模型在原动作100%下的最大实轴速度，随后与各自限速比较。
    # 分类允许升速时为inf，只能降速时为1.0。
    velocity_adjust = classification_max_factor
    # 只在本次计算中复用相同动作段的峰速，不跨请求保留旧结果。
    segment_velocity_cache = {}
    geometry_fields = {
        2: (),
        6: ("BaseHight1", "BaseHight2", "lLenth_inside", "maxheight"),
        7: ("BaseHight1", "BaseHight2", "lLenth_inside", "wLenth_inside", "maxheight", "moveWhat"),
        8: ("point_init_pos", "Baseheight1", "Baseheight2", "maxheight", "betainit"),
    }
    for model in models:
        model_type = model["model_type"]   # 当前模型的类型：2、6、7或8。
        segments = model["segments"]     # 当前模型的全部动作段。
        segment_count = len(segments)    # 列表有几项，当前模型就有几段动作。
        # 编号和电机限速不影响峰速；几何参数不同则不能共用计算结果。
        geometry_key = (model_type, json.dumps(
            [model[name] for name in geometry_fields.get(model_type, ())],
            ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ))
        # 按模型类型分类；各类型的速度计算后续写在对应 case 中。
        match model_type:
            case 2:  # 单点模型：实轴速度直接由 H 轴速度得到。
                model_max_velocity = 0.0  # 当前模型全部动作段的最大速度。
                segment_max_velocities = []  # 按segments原顺序保存每段最大速度。
                for segment in segments:
                    segment_max_velocity = 0.0  # 当前这一段的最大速度。
                    # 检查时间、系数和分段覆盖情况；兼容只有一组abcdef的动作段。
                    calculate_virtual_state(segment, segment["start_frame"], time_unit_ms)
                    segment_key = build_segment_velocity_key(segment, geometry_key, time_unit_ms)
                    if segment_key in segment_velocity_cache:
                        segment_max_velocity = segment_velocity_cache[segment_key]
                        segment_max_velocities.append(segment_max_velocity)
                        model_max_velocity = max(model_max_velocity, segment_max_velocity)
                        continue  # 同一动作已算过，直接复用；本模型限速仍单独比较。
                    pieces = segment.get("coefficient_segments", [segment])
                    for piece in pieces:
                        start_ms = float(piece["start_frame"])
                        end_ms = float(piece["end_frame"])
                        candidate_times = [start_ms, end_ms]
                        # 梯形只看各阶段两端；高阶系数还需要看阶段内部的速度极值。
                        u_end = (end_ms - start_ms) / time_unit_ms
                        c, d, e, f = (float(piece[name][0]) for name in "cdef")
                        acceleration_coefficients = [2*c, 6*d*u_end, 12*e*u_end**2, 20*f*u_end**3]
                        for x in find_unit_interval_roots(acceleration_coefficients):
                            candidate_times.append(start_ms + x * (end_ms - start_ms))
                        for time_ms in candidate_times:
                            _, velocity_HPY = calculate_virtual_state(piece, time_ms, time_unit_ms)
                            # 单点实轴速度等于H轴速度；取绝对值，正向和反向都能比较。
                            segment_max_velocity = max(segment_max_velocity, abs(velocity_HPY[0]))
                    segment_max_velocities.append(segment_max_velocity)
                    segment_velocity_cache[segment_key] = segment_max_velocity
                    model_max_velocity = max(model_max_velocity, segment_max_velocity)
                if model_max_velocity > 0:
                    model_allowed_factor = model["max_motor_velocity"] / model_max_velocity
                    velocity_adjust = min(velocity_adjust, model_allowed_factor)
            case 6:  # 两点模型：结合 H/P 位置、速度和两点正解计算实轴速度。
                model_max_velocity = 0.0  # 当前模型全部动作段的峰速数值上界。
                motor_limit = float(model["max_motor_velocity"])
                if not math.isfinite(motor_limit) or motor_limit <= 0:
                    raise ValueError("两点模型max_motor_velocity必须是有限的正数")
                for segment in segments:
                    segment_max_velocity = 0.0  # 当前这一段两个电机的峰速数值上界。
                    calculate_virtual_state(segment, segment["start_frame"], time_unit_ms)
                    segment_key = build_segment_velocity_key(segment, geometry_key, time_unit_ms)
                    if segment_key in segment_velocity_cache:
                        segment_max_velocity = segment_velocity_cache[segment_key]
                        model_max_velocity = max(model_max_velocity, segment_max_velocity)
                        continue  # 同一动作已算过，直接复用；本模型限速仍单独比较。
                    pieces = segment.get("coefficient_segments", [segment])
                    for piece in pieces:
                        # 候选极值加区间上界，只细分可能出现更高峰速的区间。
                        piece_max_velocity = calculate_two_four_piece_max_velocity(piece, model, time_unit_ms)
                        segment_max_velocity = max(segment_max_velocity, piece_max_velocity)
                    segment_velocity_cache[segment_key] = segment_max_velocity
                    model_max_velocity = max(model_max_velocity, segment_max_velocity)
                # 采用峰速数值上界计算倍率；不包含加减速度限制和PLC在线执行验证。
                if model_max_velocity > 0:
                    model_allowed_factor = motor_limit / model_max_velocity
                    velocity_adjust = min(velocity_adjust, model_allowed_factor)
            case 7:  # 四点模型：按 moveWhat 选择运动方向，结合四点正解计算。
                model_max_velocity = 0.0  # 当前模型全部动作段的峰速数值上界。
                motor_limit = float(model["max_motor_velocity"])
                if not math.isfinite(motor_limit) or motor_limit <= 0:
                    raise ValueError("四点模型max_motor_velocity必须是有限的正数")
                for segment in segments:
                    segment_max_velocity = 0.0  # 当前这一段四个电机的峰速数值上界。
                    calculate_virtual_state(segment, segment["start_frame"], time_unit_ms)
                    segment_key = build_segment_velocity_key(segment, geometry_key, time_unit_ms)
                    if segment_key in segment_velocity_cache:
                        segment_max_velocity = segment_velocity_cache[segment_key]
                        model_max_velocity = max(model_max_velocity, segment_max_velocity)
                        continue  # 同一动作已算过，直接复用；本模型限速仍单独比较。
                    pieces = segment.get("coefficient_segments", [segment])
                    for piece in pieces:
                        # 候选极值加区间上界，只细分可能出现更高峰速的区间。
                        piece_max_velocity = calculate_two_four_piece_max_velocity(piece, model, time_unit_ms)
                        segment_max_velocity = max(segment_max_velocity, piece_max_velocity)
                    segment_velocity_cache[segment_key] = segment_max_velocity
                    model_max_velocity = max(model_max_velocity, segment_max_velocity)
                # 采用峰速数值上界计算倍率；不包含加减速度限制和PLC在线执行验证。
                if model_max_velocity > 0:
                    model_allowed_factor = motor_limit / model_max_velocity
                    velocity_adjust = min(velocity_adjust, model_allowed_factor)
            case 8:  # 多点模型：按原正解求瞬时速度，包围阶段内的实轴峰值。
                model_max_velocity = 0.0
                motor_limit = float(model["max_motor_velocity"])
                if not math.isfinite(motor_limit) or motor_limit <= 0:
                    raise ValueError("多点模型max_motor_velocity必须是有限的正数")
                geometry = _prepare_multi_point_geometry(model)
                for segment in segments:
                    calculate_virtual_state(segment, segment["start_frame"], time_unit_ms)
                    segment_key = build_segment_velocity_key(segment, geometry_key, time_unit_ms)
                    if segment_key in segment_velocity_cache:
                        segment_max_velocity = segment_velocity_cache[segment_key]
                    else:
                        segment_max_velocity = 0.0
                        for piece in segment.get("coefficient_segments", [segment]):
                            piece_max_velocity = calculate_multi_piece_max_velocity(piece, geometry, time_unit_ms)
                            segment_max_velocity = max(segment_max_velocity, piece_max_velocity)
                        segment_velocity_cache[segment_key] = segment_max_velocity
                    model_max_velocity = max(model_max_velocity, segment_max_velocity)
                if model_max_velocity > 0:
                    model_allowed_factor = motor_limit / model_max_velocity
                    velocity_adjust = min(velocity_adjust, model_allowed_factor)
            case _:  # 未接入的模型类型。
                raise ValueError(f"不支持的模型类型：{model_type}，目前只支持 2、6、7、8")
    return velocity_adjust


# 共用JSON接线：原动作校验只用于识别修改，不重新计算运动峰值。
RANGE_RESULT_VERSION = "shared_json_v1"


def build_action_signature(parameters):
    """绑定原动作、限速、设置和运行方式；请求倍率及在线反馈不影响已保存范围。"""
    trajectory_run = parameters["command"]["trajectory_run"]
    if not isinstance(trajectory_run, bool):
        raise ValueError("trajectory_run必须是true或false")
    original_inputs = {
        "models": parameters["models"],
        "settings": parameters["settings"],
        "trajectory_run": trajectory_run,
    }
    original_text = json.dumps(original_inputs, ensure_ascii=False, sort_keys=True,
                               separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(original_text.encode("utf-8")).hexdigest()


def save_speed_result(result_name, result, calculation_parameters, parameter_path=None):
    """只更新共用JSON的结果部分，保留原始动作、最新请求及在线反馈。"""
    parameter_path = _resolve_parameter_path(parameter_path)
    latest_parameters = load_speed_parameters(parameter_path)
    if build_action_signature(latest_parameters) != build_action_signature(calculation_parameters):
        raise ValueError("计算期间原动作或限速已修改，请重新计算调速范围")
    if result_name == "adjust_result" and (
        latest_parameters["command"] != calculation_parameters["command"]
        or latest_parameters.get("runtime") != calculation_parameters.get("runtime")
        or latest_parameters.get("range_result") != calculation_parameters.get("range_result")
    ):
        raise ValueError("计算期间调速请求、在线反馈或已保存范围已变化，请使用最新参数重试")
    latest_parameters[result_name] = result

    # 数值数组保持一行，模型和动作段逐层缩进，方便直接查看JSON。
    def format_json(value, level=0):
        indent = "  " * level
        child_indent = "  " * (level + 1)
        if isinstance(value, dict):
            if not value:
                return "{}"
            entries = [child_indent + json.dumps(key, ensure_ascii=False) + ": "
                       + format_json(item, level + 1) for key, item in value.items()]
            return "{\n" + ",\n".join(entries) + "\n" + indent + "}"
        if isinstance(value, list) and any(isinstance(item, (dict, list)) for item in value):
            entries = [child_indent + format_json(item, level + 1) for item in value]
            return "[\n" + ",\n".join(entries) + "\n" + indent + "]"
        return json.dumps(value, ensure_ascii=False, allow_nan=False)

    contents = format_json(latest_parameters) + "\n"
    temporary_path = None
    try:
        # 写完整后再替换原JSON，避免留下写到一半的参数文件。
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=parameter_path.parent, prefix="调速参数-",
                                         suffix=".tmp", delete=False) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(contents)
        temporary_path.replace(parameter_path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


###############################################################################主函数逻辑###############################################################################
def calculate_range_result(parameters):
    """沿用原分类及峰值算法，返回可保存到共用JSON的范围结果。"""
    # parameters来自共用JSON，models中的每一项就是一个模型。
    trajectory_run = parameters["command"]["trajectory_run"]
    if not isinstance(trajectory_run, bool):
        raise ValueError("trajectory_run必须是true或false")
    models = parameters["models"]
    if not models:
        raise ValueError("models 不能为空，至少需要一个模型")
    # 两种运行方式共用系数时间单位；强制轨迹默认不设置分类上限。
    time_unit_ms = float(parameters["settings"]["forced_coefficient_time_unit_ms"])
    if not math.isfinite(time_unit_ms) or time_unit_ms <= 0:
        raise ValueError("系数时间单位必须是有限的正数")
    classification_max_factor = math.inf
    action_category = "强制轨迹：按原始曲线计算"
    print(f"读取成功，共 {len(models)} 个模型")
    # 模型类型编号与名称的对应关系；编号不代表电机数量。
    model_names = {2: "单点", 6: "两点", 7: "四点", 8: "多点"}
    if not trajectory_run:  # 只有非强制轨迹按单点、同步、不同步三类限制调速。
        # 第一步：先给整个动作分类，此处还不计算最大实轴速度。
        # 只要任意非单点模型有一段不同步，整个动作就不能超过原动作的100%。
        all_single_point = True          # 是否全部为单点模型。
        all_non_single_synchronized = True  # 所有非单点模型的动作段是否都确认同步。
        for model in models:
            model_type = model["model_type"]
            if model_type not in model_names:
                raise ValueError(f"不支持的模型类型：{model_type}，目前只支持 2、6、7、8")
            if not model["segments"]:
                raise ValueError("每个模型至少需要一段动作")
            if model_type == 2:
                continue                # 单点不需要比较多个虚轴的同步情况。
            all_single_point = False

            for segment in model["segments"]:
                # 先检查阶段是否完整覆盖动作时间，再逐轴查看实际运动阶段。
                calculate_virtual_state(segment, segment["start_frame"], time_unit_ms)
                pieces = segment.get("coefficient_segments", [segment])
                moving_axis_phases = []  # 只保存参与运动的虚轴，忽略全程静止轴。
                segment_synchronized = True

                for axis in range(3):   # 0=H，1=P，2=Y；速度正负均保留。
                    axis_phases = []
                    axis_moves = False
                    trapezoid_confirmed = True
                    for piece in pieces:
                        _, start_velocity = calculate_virtual_state(piece, piece["start_frame"], time_unit_ms)
                        _, end_velocity = calculate_virtual_state(piece, piece["end_frame"], time_unit_ms)
                        # 只在同步分类时消除零速残差，不修改原轨迹的位置和速度。
                        phase_start_velocity = start_velocity[axis]
                        phase_end_velocity = end_velocity[axis]
                        # 按本轴、本阶段的速度量级设相对容差；H/P/Y各自判断。
                        velocity_tolerance = 1e-12 * max(abs(phase_start_velocity), abs(phase_end_velocity))
                        if abs(phase_start_velocity) <= velocity_tolerance:
                            phase_start_velocity = 0.0
                        if abs(phase_end_velocity) <= velocity_tolerance:
                            phase_end_velocity = 0.0
                        start_ms = float(piece["start_frame"])
                        end_ms = float(piece["end_frame"])
                        # b..f 全为0，才表示这一阶段的位置保持不变。
                        stationary = all(float(piece[name][axis]) == 0 for name in "bcdef")
                        if stationary:
                            phase_name = "静止"
                        else:
                            axis_moves = True
                            # 当前先识别分段梯形：加减速位置是二次式，匀速是一次式。
                            # 更高阶曲线或阶段内反向不能仅凭阶段名称认定同步。
                            if any(float(piece[name][axis]) != 0 for name in "def"):
                                trapezoid_confirmed = False
                                phase_name = "未确认"
                            elif float(piece["c"][axis]) == 0:
                                phase_name = "匀速"
                            elif (phase_start_velocity < 0 < phase_end_velocity
                                  or phase_end_velocity < 0 < phase_start_velocity):
                                trapezoid_confirmed = False
                                phase_name = "未确认"
                            elif abs(phase_end_velocity) > abs(phase_start_velocity):
                                phase_name = "加速"
                            else:
                                phase_name = "减速"
                        # 同一阶段可能被拆成几组系数，合并后再比较实际起止时间。
                        if axis_phases and axis_phases[-1][0] == phase_name:
                            axis_phases[-1][2] = end_ms
                        else:
                            axis_phases.append([phase_name, start_ms, end_ms])

                    if axis_moves:
                        moving_axis_phases.append((axis_phases, trapezoid_confirmed))

                # 只有一个虚轴运动时，没有多个运动虚轴之间的不同步问题。
                if len(moving_axis_phases) > 1:
                    reference_phases = moving_axis_phases[0][0]
                    for axis_phases, trapezoid_confirmed in moving_axis_phases:
                        if not trapezoid_confirmed or len(axis_phases) != len(reference_phases):
                            segment_synchronized = False
                            break
                        for actual, reference in zip(axis_phases, reference_phases):
                            if actual[0] != reference[0] or not all(
                                math.isclose(actual[i], reference[i], rel_tol=0, abs_tol=1e-6)
                                for i in (1, 2)
                            ):
                                segment_synchronized = False
                                break
                        if not segment_synchronized:
                            break
                if not segment_synchronized:
                    all_non_single_synchronized = False

        # 得到三类之一；分类上限不是最终安全倍率，后续还要计算本模型限速。
        if all_single_point:
            action_category = "全部单点：可升速、可降速"
            classification_max_factor = math.inf
        elif all_non_single_synchronized:
            action_category = "同步非单点：可升速、可降速"
            classification_max_factor = math.inf
        else:
            action_category = "不同步或未确认同步的非单点：只能降速，最高100%"
            classification_max_factor = 1.0
        print(f"动作分类：{action_category}")
    # 第二步：两种运行方式统一计算倍率；强制轨迹直接算，非强制轨迹带分类上限。
    velocity_adjust = calculate_velocity_adjust(models, time_unit_ms, classification_max_factor)
    print(f"动作倍率估算：{velocity_adjust*100:.6f}%")
    if math.isnan(velocity_adjust) or velocity_adjust <= 0:
        raise ValueError("最大调速倍率必须大于0，请检查原动作和电机限速")
    return {
        "max_factor": None if math.isinf(velocity_adjust) else velocity_adjust,
        "unlimited": math.isinf(velocity_adjust),
        "action_category": action_category,
        "action_signature": build_action_signature(parameters),
        "range_version": RANGE_RESULT_VERSION,
    }


def main(parameter_path=None):
    """独立计算范围，仅回写 range_result；command.operation 由其他算法共用。"""
    # 先固定本次读写路径，重读与原子保存都使用同一个文件。
    parameter_path = _resolve_parameter_path(parameter_path)
    parameters = load_speed_parameters(parameter_path)
    result = calculate_range_result(parameters)
    save_speed_result("range_result", result, parameters, parameter_path)
    print(f"最大倍率已保存到{parameter_path.name}的range_result.max_factor")
    return result


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
