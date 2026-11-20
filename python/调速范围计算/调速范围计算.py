"""五模型调速范围计算，参考YXZ_new.py及PLC的正解。
模型编号为2单点、3多级升降、4无极旋转、7普通多点摆、9XY多点摆。
HPY普通多点为[高度,倾角,方向角]，XY为[高度,X倾角,Y倾角]。
无极旋转只有H角度轴，实轴直接跟随H，周期使用真实workingStroke。
"""
import json
import hashlib
import tempfile
import math
import heapq
import sys
from pathlib import Path

##########################电机正解：仅非强制第二步限速检查使用##########################
def dandian_forward_model(height, motor_num):
    return [height] * motor_num
    ##输入 虚轴1位置 虚轴2位置 原点位置在上距离  原点位置在下距离 吊点距离 最大行程
    ##输入 虚轴1位置 虚轴2位置 虚轴3位置 原点位置在上距离 原点位置在下距离 X方向吊点距离 Y方向吊点距离 最大行程 运动方向
##########################多点正解函数#########################
    ##输入 虚轴1位置 虚轴2位置 虚轴3位置 吊点坐标 原点位置在上距离 原点位置在下距离 最大行程 初始方向角
def duodian_forward_model(height, arg_x_deg, arg_y_deg, point_init_pos,
                          Baseheight1, Baseheight2, maxheight, betainit=0):
    """普通多点按HPY=[高度,倾角,方向角]计算原轴序实轴位置。"""
    if not all(math.isfinite(value) for value in (height, arg_x_deg, arg_y_deg)):
        raise ValueError("多点摆姿态必须是有限数值")
    if abs(arg_x_deg) >= 90:
        raise ValueError("多点摆倾角须在(-90,90)内")
    geometry = _prepare_multi_point_geometry(dict(point_init_pos=point_init_pos,
        Baseheight1=Baseheight1, Baseheight2=Baseheight2, maxheight=maxheight, betainit=betainit))
    beta, angle = -math.radians(arg_y_deg+betainit), -math.radians(arg_x_deg)
    cb, sb, ca, sa = math.cos(beta), math.sin(beta), math.cos(angle), math.sin(angle)
    vertical = height+Baseheight1 if Baseheight1 > 0 else Baseheight2+maxheight-height
    offset = 0.
    if angle != 0:
        radius = _radial_distance(geometry, beta)
        power = min(100., 1.73+.52*vertical/radius)
        offset = math.copysign(min(radius, radius*(abs(angle)/1.5707963)**power), angle)
    motors = []
    for x, y, z in geometry[0]:
        x1, y1 = cb*x-sb*y, sb*x+cb*y
        rx = cb*x1+sb*ca*y1-x+sb*offset
        ry = -sb*x1+cb*ca*y1-y+cb*offset
        rz = sa*y1-vertical
        length = math.sqrt(rx*rx+ry*ry+rz*rz)
        motors.append(length-Baseheight1 if Baseheight1 > 0 else Baseheight2+maxheight-length)
    return motors




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
    """按参考文件生成凸包，保留全部原吊点及实轴顺序。"""
    points = []
    for point in model["point_init_pos"]:
        values = tuple(float(value) for value in point)
        if len(values) not in (2, 3) or not all(math.isfinite(value) for value in values):
            raise ValueError("吊点须为有限的[x,y]或[x,y,z]坐标")
        points.append(values if len(values) == 3 else values + (0.,))
    if model.get("model_type") == 9 and "motor_num" in model and model["motor_num"] != len(points):
        raise ValueError("motor_num须与吊点数量一致")
    minimum = 2 if model.get("model_type") == 9 else 3
    if len(points) < minimum:
        raise ValueError(f"至少需要{minimum}个吊点")
    xy_two_points = model.get("model_type") == 9 and len(points) == 2
    if xy_two_points:
        (x1, y1, z1), (x2, y2, z2) = points
        on_x = y1 == y2 == 0 and min(x1, x2) <= 0 <= max(x1, x2) and x1 != x2
        on_y = x1 == x2 == 0 and min(y1, y2) <= 0 <= max(y1, y2) and y1 != y2
        if z1 != 0 or z2 != 0 or not (on_x or on_y):
            raise ValueError("XY双吊点须位于同一X轴或Y轴，线段包含原点、两点不重合且Z为0")
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
    if len(hull) < 3 and not xy_two_points:
        raise ValueError("吊点不能全部共线")
    base1, base2, height = (float(model[name]) for name in ("Baseheight1", "Baseheight2", "maxheight"))
    beta = float(model.get("betainit", 0))
    if not all(math.isfinite(value) for value in (base1, base2, height, beta)):
        raise ValueError("多点几何参数必须是有限数值")
    if not ((base1 > 0 and base2 == 0) or (base1 == 0 and base2 > 0)) or height <= 0:
        raise ValueError("两项原点距离须一项大于0、另一项为0，最大高度须大于0")
    if model.get("model_type") == 9 and beta != 0:
        raise ValueError("XY多点摆betainit必须为0")
    # 最终PLC保留双点线段，并在双点正算中直接将水平偏移置0。
    if xy_two_points:
        return tuple(points), (), base1, base2, height, beta
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
    if not edges:
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
    if edges and tilt > 1e-8:
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


def xy_duodian_forward_model(height, angle_x, angle_y, point_init_pos,
                             Baseheight1, Baseheight2, maxheight, betainit=0):
    model = dict(model_type=9, point_init_pos=point_init_pos, Baseheight1=Baseheight1,
                 Baseheight2=Baseheight2, maxheight=maxheight, betainit=betainit)
    geometry = _prepare_multi_point_geometry(model)
    motion = _xy_point_motion([height, angle_x, angle_y], [0., 0., 0.], geometry)[0]
    lengths = [math.sqrt(sum(value * value for value in position)) for position, _ in motion]
    return ([length - Baseheight1 for length in lengths] if Baseheight1 > 0 else
            [Baseheight2 + maxheight - length for length in lengths])


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


def calculate_multi_piece_max_velocity(piece, geometry, time_unit_ms, xy=False):
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
    pure_h = all(len(curves[axis])==1 and curves[axis][0].lo==curves[axis][0].hi==0
                 for axis in ((1,2) if xy else (1,)))
    def bound(current):
        values = ranges(current)
        return values[3].max_abs() if pure_h else (
            _xy_motor_speed_upper(values[:3],values[3:],geometry) if xy else
            _multi_point_motor_speed_upper(values[:3],values[3:],geometry))
    def instantaneous(x):
        q,v = calculate_virtual_state(piece,start if x==0 else end if x==1 else start+x*(end-start),time_unit_ms)
        return abs(v[0]) if pure_h else (
            _xy_instantaneous_speed(q,v,geometry) if xy else _multi_point_instantaneous_speed(q,v,geometry))
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



SUPPORTED_MODEL_TYPES = {2: "单点", 3: "多级升降", 4: "无极旋转", 7: "多点摆", 9: "XY多点摆"}


def _validate_rotation_curve(model, time_unit_ms):
    """PLC旋转模型仅H有效；全周期由轴取模，部分范围不能越过软行程。"""
    period = model.get("workingStroke")
    if isinstance(period, bool) or not isinstance(period, (int, float)) or not math.isfinite(period) or period <= 0:
        raise ValueError("无极旋转workingStroke须为真实有限正周期")
    count = model.get("motor_num", 1)
    if type(count) is not int or not 1 <= count <= 32:
        raise ValueError("无极旋转motor_num须为1到32的整数，全部绑定轴须使用相同workingStroke")
    bounds = []
    for name in ("min_position_HPY", "max_position_HPY"):
        values = model.get(name)
        if not isinstance(values, (list, tuple)) or len(values) != 3 or any(
                isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                for value in values):
            raise ValueError(f"无极旋转{name}须提供H/P/Y三个有限数值")
        bounds.append(float(values[0]))
    lower, upper = bounds
    if not 0 <= lower < upper <= period:
        raise ValueError("无极旋转H软行程须满足0<=min<max<=workingStroke")
    if not model["segments"]:
        raise ValueError("无极旋转至少需要一段动作")
    full_period = abs(lower) <= 1e-6 and abs(upper-period) <= 1e-6
    for segment in model["segments"]:
        calculate_virtual_state(segment, segment["start_frame"], time_unit_ms)
        for piece in segment.get("coefficient_segments", [segment]):
            if any(float(piece[name][axis]) != 0 for name in "bcdef" for axis in (1, 2)):
                raise ValueError("无极旋转只支持H角度轴，P/Y不能包含运动")
            if full_period:
                continue  # 实际位置由MODULO处理，不能把360附近的连续角度误判为超行程。
            start, end = float(piece["start_frame"]), float(piece["end_frame"])
            duration = (end-start)/time_unit_ms
            velocity = [power*float(piece[name][0])*duration**(power-1)
                        for power, name in enumerate("bcdef", 1)]
            frames = [start, end] + [start+x*(end-start) for x in find_unit_interval_roots(velocity)]
            for frame in frames:
                position, _ = calculate_virtual_state(piece, frame, time_unit_ms)
                if not lower-1e-6 <= position[0] <= upper+1e-6:
                    raise ValueError("无极旋转原曲线越过H软行程；部分范围不能跨过禁用区")


def _virtual_peak_velocities(model, time_unit_ms):
    peaks = [0., 0., 0.]
    for segment in model["segments"]:
        calculate_virtual_state(segment, segment["start_frame"], time_unit_ms)
        for piece in segment.get("coefficient_segments", [segment]):
            start, end = float(piece["start_frame"]), float(piece["end_frame"])
            duration = (end-start)/time_unit_ms
            _, first = calculate_virtual_state(piece, start, time_unit_ms)
            _, last = calculate_virtual_state(piece, end, time_unit_ms)
            for axis in range(3):
                b, c, d, e, f = (float(piece[name][axis]) for name in "bcdef")
                peak = max(abs(first[axis]), abs(last[axis]))
                acceleration = [2*c, 6*d*duration, 12*e*duration**2, 20*f*duration**3]
                for fraction in find_unit_interval_roots(acceleration):
                    _, velocity = calculate_virtual_state(piece, start+fraction*(end-start), time_unit_ms)
                    peak = max(peak, abs(velocity[axis]))
                if not math.isfinite(peak):
                    raise ValueError("原曲线峰速必须是有限数值")
                peaks[axis] = max(peaks[axis], peak)
                angle_axis = (model["model_type"] == 7 and axis == 1) or (model["model_type"] == 9 and axis in (1, 2))
                if angle_axis:
                    velocity_coefficients = [b, 2*c*duration, 3*d*duration**2, 4*e*duration**3, 5*f*duration**4]
                    frames = [start, end] + [start+x*(end-start) for x in find_unit_interval_roots(velocity_coefficients)]
                    for frame in frames:
                        position, _ = calculate_virtual_state(piece, frame, time_unit_ms)
                        if abs(position[axis]) >= 90:
                            raise ValueError(f"模型{model.get('model_id','?')}的{'HPY'[axis]}倾角须在(-90,90)内")
    return peaks


def _virtual_peak_accelerations(model, time_unit_ms):
    """分别计算增大、减小速度幅值时的加速度峰值，单位为每秒平方。"""
    accelerating, decelerating = [0., 0., 0.], [0., 0., 0.]
    rate = 1000. / time_unit_ms
    for segment in model["segments"]:
        for piece in segment.get("coefficient_segments", [segment]):
            duration = (float(piece["end_frame"]) - float(piece["start_frame"])) / time_unit_ms
            for axis in range(3):
                b, c, d, e, f = (float(piece[name][axis]) for name in "bcdef")
                velocity = [b, 2*c*duration, 3*d*duration**2, 4*e*duration**3, 5*f*duration**4]
                acceleration = [2*c, 6*d*duration, 12*e*duration**2, 20*f*duration**3]
                if not any(acceleration):
                    continue
                jerk = [index * acceleration[index] for index in range(1, len(acceleration))]
                boundaries = sorted(set([0., 1.] + find_unit_interval_roots(velocity)
                                        + find_unit_interval_roots(acceleration)))
                extrema = find_unit_interval_roots(jerk)
                for left, right in zip(boundaries, boundaries[1:]):
                    middle = (left + right) * .5
                    middle_v = math.fsum(value * middle**index for index, value in enumerate(velocity))
                    middle_a = math.fsum(value * middle**index for index, value in enumerate(acceleration))
                    if middle_v == 0. or middle_a == 0.:
                        continue
                    candidates = [left, right] + [value for value in extrema if left < value < right]
                    peak = max(abs(math.fsum(value * fraction**index
                                             for index, value in enumerate(acceleration)))
                               for fraction in candidates)
                    peak = peak * rate * rate
                    if not math.isfinite(peak):
                        raise ValueError("原曲线加减速度峰值必须是有限数值")
                    result = accelerating if (middle_v > 0.) == (middle_a > 0.) else decelerating
                    result[axis] = max(result[axis], peak)
    return accelerating, decelerating


def calculate_velocity_adjust(models, time_unit_ms, classification_max_factor):
    """返回分类、实轴/虚轴限速及已提供虚轴加减速度共同允许的倍率。"""
    allowed = classification_max_factor
    segment_cache = {}
    for model in models:
        kind = model["model_type"]
        if kind not in SUPPORTED_MODEL_TYPES:
            raise ValueError(f"不支持的模型类型：{kind}，目前只支持2、3、4、7、9")
        label = f"模型{model.get('model_id','?')}"
        if kind == 4:
            _validate_rotation_curve(model, time_unit_ms)
        supplied = model.get("max_velocity_HPY")
        if not isinstance(supplied, (list, tuple)) or len(supplied) != 3:
            raise ValueError(f"{label}需要H/P/Y三个max_velocity_HPY最大速度")
        limits = [float(value) for value in supplied]
        if any(isinstance(value, bool) for value in supplied) or any(not math.isfinite(value) or value < 0 for value in limits):
            raise ValueError(f"{label}的max_velocity_HPY须为三个有限非负数")
        peaks = _virtual_peak_velocities(model, time_unit_ms)
        for axis, peak in enumerate(peaks):
            if peak > 0:
                if limits[axis] == 0:
                    raise ValueError(f"{label}的{'HPY'[axis]}最大速度为0，但原曲线包含运动")
                allowed = min(allowed, limits[axis]/peak)
        capability_fields = ("max_acceleration_HPY", "max_deceleration_HPY")
        if any(name in model for name in capability_fields):
            acceleration_peaks = _virtual_peak_accelerations(model, time_unit_ms)
            # 此接口没有方向字段，时间反向时A/D互换，范围须同时覆盖两种方向。
            both_directions = [max(a, d) for a, d in zip(*acceleration_peaks)]
            for name in capability_fields:
                if name not in model:
                    continue
                supplied = model[name]
                if not isinstance(supplied, (list, tuple)) or len(supplied) != 3:
                    raise ValueError(f"{label}的{name}须提供H/P/Y三个真实能力")
                limits = [float(value) for value in supplied]
                if any(isinstance(value, bool) for value in supplied) or any(
                        not math.isfinite(value) or value < 0 for value in limits):
                    raise ValueError(f"{label}的{name}须为三个有限非负数")
                for axis, peak in enumerate(both_directions):
                    if peak > 0:
                        if limits[axis] == 0:
                            raise ValueError(f"{label}的{'HPY'[axis]}轴{name}为0，但原曲线需要相应加减速")
                        allowed = min(allowed, math.sqrt(limits[axis]) / math.sqrt(peak))
        motor_limit = float(model["max_motor_velocity"])
        if not math.isfinite(motor_limit) or motor_limit <= 0:
            raise ValueError(f"{label}的max_motor_velocity须为有限正数")
        if kind in (2, 3, 4):
            motor_peak = peaks[0]
        else:
            geometry = _prepare_multi_point_geometry(model)
            geometry_key = (kind, json.dumps(geometry, ensure_ascii=False, default=lambda value:(value.lo,value.hi), separators=(",", ":")))
            motor_peak = 0.
            for segment in model["segments"]:
                key = build_segment_velocity_key(segment, geometry_key, time_unit_ms)
                if key not in segment_cache:
                    segment_cache[key] = max(calculate_multi_piece_max_velocity(piece, geometry, time_unit_ms, xy=kind == 9)
                                             for piece in segment.get("coefficient_segments", [segment]))
                motor_peak = max(motor_peak, segment_cache[key])
        if motor_peak > 0:
            allowed = min(allowed, motor_limit/motor_peak)
    return allowed


# 共用JSON接线：原动作校验只用于识别修改，不重新计算运动峰值。
RANGE_RESULT_VERSION = "shared_json_v2"


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
    model_names = SUPPORTED_MODEL_TYPES
    if not trajectory_run:  # 只有非强制轨迹按单点、同步、不同步三类限制调速。
        # 第一步：先给整个动作分类，此处还不计算最大实轴速度。
        # 只要任意非单点模型有一段不同步，整个动作就不能超过原动作的100%。
        all_single_point = True          # 是否全部为单点模型。
        all_non_single_synchronized = True  # 所有非单点模型的动作段是否都确认同步。
        for model in models:
            model_type = model["model_type"]
            if model_type not in model_names:
                raise ValueError(f"不支持的模型类型：{model_type}，目前只支持2、3、4、7、9")
            if not model["segments"]:
                raise ValueError("每个模型至少需要一段动作")
            if model_type in (2, 3, 4):
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
            action_category = ("全部单点/多级升降/无极旋转：可升速、可降速"
                               if any(model["model_type"] == 4 for model in models)
                               else "全部单点/多级升降：可升速、可降速")
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
