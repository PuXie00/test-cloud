"""五模型强制轨迹就近准备，调用calculate_nearest_entry(parameters)。

业务编号为2单点、3多级升降、4无极旋转、7普通多点摆、9XY多点摆。
停稳后按最大虚轴V/A/D规划零速起止准备，各移动轴同步到达。
普通多点HPY为[高度,倾角,方向角]，XY为[高度,X倾角,Y倾角]。
真实电机速度采用相应正解的整路径区间上界检查。
非强制带速接入使用独立的单Move版就近包。
H/P/Y单位为mm/度/度，速度为对应单位/s，加减速度为对应单位/s²。
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
ALGORITHM_VERSION = "v9_five_models_rotation_pose_20261120"
FRAME_SELECTION_VERSION = "current_original_segment_first_20261029"
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

##########################四点正解函数#########################
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
    return _ordinary_forward_position(height, arg_x_deg, arg_y_deg, geometry)

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
    xy = model.get("model_type") == 9
    if len(points) < (2 if xy else 3):
        raise ValueError("XY多点摆至少需要2个吊点" if xy else "普通多点摆至少需要3个吊点")
    two_point_xy = xy and len(points) == 2
    if two_point_xy:
        (x0, y0, z0), (x1, y1, z1) = points
        on_x = y0 == y1 == 0 and x0 != x1 and min(x0, x1) <= 0 <= max(x0, x1)
        on_y = x0 == x1 == 0 and y0 != y1 and min(y0, y1) <= 0 <= max(y0, y1)
        if z0 != 0 or z1 != 0 or not (on_x or on_y):
            raise ValueError("XY双吊点须为XY平面内同X轴或同Y轴且包含原点的不重合线段")
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
    # PLC ConvexHull在pointNum<3时不生成凸包，XY正解的水平偏移为0。
    hull = [] if two_point_xy else lower[:-1] + upper[:-1]
    if len(hull) < 3 and not two_point_xy:
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
    if not edges and not two_point_xy:
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

def _ordinary_forward_position(height, arg_x_deg, arg_y_deg, geometry):
    Baseheight1, Baseheight2, maxheight, betainit = geometry[2:]
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


def _forced_polynomial_position_bounds(coefficients, u_start, u_end):
    """求0~5次位置多项式的保守区间，不用两端采样冒充整段范围。"""
    coefficients = list(coefficients)
    while len(coefficients) > 1 and coefficients[-1] == 0.0:
        coefficients.pop()
    degree = len(coefficients)-1
    left, right = min(u_start, u_end), max(u_start, u_end)
    try:
        def value(u):
            result = 0.0
            for coefficient in reversed(coefficients):
                result = result*u+coefficient
            return result

        if degree <= 2:
            values = [value(left), value(right)]
            if degree == 2 and coefficients[2] != 0.0:
                vertex = -coefficients[1]/(2.0*coefficients[2])
                if left < vertex < right:
                    values.append(value(vertex))
            scale = max(1.0, *(abs(v) for v in values))
        else:
            # 将u=left+(right-left)*x转换到x∈[0,1]，再转为Bernstein控制值。
            width = right-left
            power = [math.fsum(coefficients[j]*math.comb(j, k)*left**(j-k)*width**k
                               for j in range(k, degree+1)) for k in range(degree+1)]
            values = [math.fsum(power[k]*math.comb(i, k)/math.comb(degree, k)
                                for k in range(i+1)) for i in range(degree+1)]
            scale = max(1.0, math.fsum(abs(v) for v in power), *(abs(v) for v in values))
        # 平移前的巨大项也可能相消；外包必须覆盖原求值过程的舍入误差。
        radius = max(abs(left), abs(right))
        absolute_terms = math.fsum(abs(coefficient)*radius**i
                                   for i, coefficient in enumerate(coefficients))
        scale = max(scale, absolute_terms)
        if not math.isfinite(scale) or not all(math.isfinite(v) for v in values):
            return -math.inf, math.inf
        pad = max(1e-12, 128.0*math.ulp(scale))
        return (math.nextafter(min(values)-pad, -math.inf),
                math.nextafter(max(values)+pad, math.inf))
    except (OverflowError, ValueError):
        # 包络溢出时只放弃该次剪枝，不能误排除可能更近的曲线区间。
        return -math.inf, math.inf


def _entry_prioritized_windows(inputs):
    """先搜索停止参考所在的公共原动作段，再逐窗沿运行方向回退。

    这里只划分时间窗，不求位置、速度或准备方案。coefficients阶段不是原动作段。
    强制循环按模型周期懒计算边界；非强制保留首末帧保持语义。不展开循环次数。
    """
    from bisect import bisect_left, bisect_right

    models = inputs["curve_action"]["models"]
    if not models:
        raise ValueError("当前段优先搜索需要非空模型列表")
    direction = inputs["direction"]
    if type(direction) is not int or direction not in (-1, 1):
        raise ValueError("direction必须为1或-1")
    loop_count = inputs.get("loop_count", 1)
    if type(loop_count) is not int or not 0 <= loop_count <= 65535:
        raise ValueError("loop_count必须为0到65535的整数")
    forced = inputs.get("trajectory_run", False)
    if type(forced) is not bool:
        raise ValueError("trajectory_run必须为bool")

    active_by_model = inputs.get("active_axes_by_model", {})

    def strictly_stationary(model):
        """只忽略参与轴上可严格证明整条恒定的模型，任何非零系数都保留。"""
        names = active_by_model.get(model.get("index"), ("H", "P", "Y"))
        axes = tuple(("H", "P", "Y").index(name) if isinstance(name, str) else int(name)
                     for name in names)
        constants = None
        for original_segment in model["segments"]:
            pieces = original_segment.get("coefficient_segments", [original_segment])
            if not pieces:
                return False
            for piece in pieces:
                if any(not isinstance(piece.get(name), (list, tuple)) or len(piece[name]) != 3
                       for name in "abcdef"):
                    return False
                if constants is None:
                    constants = tuple(piece["a"][axis] for axis in axes)
                for i, axis in enumerate(axes):
                    if piece["a"][axis] != constants[i] or any(piece[name][axis] != 0 for name in "bcdef"):
                        return False
                    for field in ("start_HPY", "target_HPY"):
                        if field in piece and piece[field][axis] != constants[i]:
                            return False
            for i, axis in enumerate(axes):
                for field in ("start_HPY", "target_HPY"):
                    if field in original_segment and original_segment[field][axis] != constants[i]:
                        return False
        return constants is not None

    descriptors = []
    global_start, global_end = None, None
    for model in models:
        segments = model["segments"]
        if not segments:
            raise ValueError("模型原动作段不能为空")
        first = int(segments[0]["start_frame"])
        last = int(segments[-1]["end_frame"])
        if last <= first:
            raise ValueError("模型原动作时间范围无效")
        global_start = first if global_start is None else min(global_start, first)
        global_end = last if global_end is None else max(global_end, last)
        # 恒定模型只影响全动作时间范围，不用其无运动关键帧切碎其他模型的当前段。
        if strictly_stationary(model):
            continue
        raw = model.get("_entry_boundaries_ms")
        if raw is None:
            # 兼容未归一化且每个segments本身就是原动作段的低层调用。
            raw = [segment[name] for segment in segments for name in ("start_frame", "end_frame")]
        boundaries = sorted({first, last, *(int(value) for value in raw)})
        if boundaries[0] < first or boundaries[-1] > last:
            raise ValueError("原动作段边界超出模型首末范围")
        offsets = tuple(value-first for value in boundaries)
        period = last-first
        count = (10000000 if loop_count == 0 else loop_count) if forced else 1
        anchor = last-period*count if forced and direction < 0 else first
        descriptors.append((anchor, anchor+period*count, period, offsets))

    reference = inputs.get("stopped_time_ms")
    if reference is None:
        yield {"range_ms": [global_start, global_end], "phase": "directional_fallback",
               "index": 0, "reference_frame_ms": None}
        return
    if type(reference) is not int or not global_start <= reference <= global_end:
        raise ValueError("停止参考帧必须是动作首末范围内的整数毫秒")
    if not descriptors:
        yield {"range_ms": [global_start, global_end], "phase": "current_segment",
               "index": 0, "reference_frame_ms": reference}
        return

    def floor_in_model(descriptor, frame):
        anchor, end, period, offsets = descriptor
        if frame < anchor:
            return None
        if frame >= end:
            return end
        cycle, local = divmod(frame-anchor, period)
        return anchor+cycle*period+offsets[bisect_right(offsets, local)-1]

    def ceil_in_model(descriptor, frame):
        anchor, end, period, offsets = descriptor
        if frame <= anchor:
            return anchor
        if frame > end:
            return None
        if frame == end:
            return end
        cycle, local = divmod(frame-anchor, period)
        return anchor+cycle*period+offsets[bisect_left(offsets, local)]

    def previous_boundary(frame, inclusive=False):
        # 所有原始边界都是整数毫秒，因此用-1得到严格前驱，不引入浮点epsilon。
        query = frame if inclusive else frame-1
        if query < global_start:
            return None
        result = global_start
        for descriptor in descriptors:
            boundary = floor_in_model(descriptor, query)
            if boundary is not None and global_start <= boundary <= global_end:
                result = max(result, boundary)
        return result

    def next_boundary(frame, inclusive=False):
        query = frame if inclusive else frame+1
        if query > global_end:
            return None
        result = global_end
        for descriptor in descriptors:
            boundary = ceil_in_model(descriptor, query)
            if boundary is not None and global_start <= boundary <= global_end:
                result = min(result, boundary)
        return result

    if direction > 0:
        left = previous_boundary(reference, inclusive=True)
        right = next_boundary(reference)
        if right is None:  # 全动作末端没有右段，使用最后一个有效公共段。
            right = global_end
            left = previous_boundary(reference)
    else:
        left = previous_boundary(reference)
        right = next_boundary(reference, inclusive=True)
        if left is None:  # 全动作首端没有左段，使用第一个有效公共段。
            left = global_start
            right = next_boundary(reference)

    index = 0
    while left is not None and right is not None and left < right:
        yield {"range_ms": [left, right],
               "phase": "current_segment" if index == 0 else "directional_fallback",
               "index": index, "reference_frame_ms": reference}
        index += 1
        if direction > 0:
            left, right = right, next_boundary(right)
        else:
            left, right = previous_boundary(left), left


class _EntryWindowInfeasible(ValueError):
    """窗口中的所有已覆盖候选均无可执行准备计划，允许按方向继续下一原段。"""


def _rotation_delta(current, target, period):
    delta = (target - current) % period
    if delta > period / 2:
        delta -= period
    return delta


def _rotation_full_period(model):
    if model.get("model_type") != 4 or model.get("_rotation_period_H") is None:
        return False
    return model["max_position_HPY"][0]-model["min_position_HPY"][0] >= model["_rotation_period_H"]


def _rotation_position(model, value):
    """纯姿态旋转H的允许区间代表值；不改原曲线系数、帧或导数。"""
    lower = model["min_position_HPY"][0]
    return lower + ((float(value)-lower) % model["_rotation_period_H"])


def _entry_positions_equal(model, first, second, tolerance=1e-5):
    period = model["_rotation_period_H"] if _rotation_full_period(model) else None
    return all(abs(_rotation_delta(a, b, period) if axis == 0 and period is not None else b-a) <= tolerance
               for axis, (a, b) in enumerate(zip(first, second)))


def _entry_axis_delta(model, axis, current, target):
    if axis == 0 and model.get("_rotation_period_H") is not None:
        return _rotation_delta(current, target, model["_rotation_period_H"])
    return target - current


def _entry_interval_distance(model, axis, current, lower, upper):
    period = model.get("_rotation_period_H") if axis == 0 else None
    if period is None:
        return max(0.0, lower - current, current - upper)
    if upper - lower >= period:
        return 0.0
    first_image = current + math.ceil((lower - current) / period) * period
    if first_image <= upper:
        return 0.0
    return min(abs(_rotation_delta(current, lower, period)),
               abs(_rotation_delta(current, upper, period)))


def _validate_rotation_prepare(model, current, target):
    period = model["_rotation_period_H"]
    lower, upper = model["min_position_HPY"][0], model["max_position_HPY"][0]
    if _rotation_full_period(model):
        return
    delta = _rotation_delta(current, target, period)
    if abs(abs(delta) - period / 2) <= max(1e-9, period * 1e-12):
        raise _EntryWindowInfeasible("无极旋转半周期同距候选无法确定PLC方向，需改选可确定方向的帧")
    end = current + delta
    if min(current, end) < lower - 1e-9 or max(current, end) > upper + 1e-9:
        raise _EntryWindowInfeasible("无极旋转的PLC最短路会穿越软行程禁用区")


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
    stopped_time_ms=None,
    search_window_ms=None,
    frame_validator=None,
):
    """指定帧直接求值；有停止参考时先在当前原段找可执行最近点，再沿方向继续。

    所有时间输入/输出均使用毫秒；selected_time_100ms是PLC的_T值。
    active_axes_by_model必须提供各模型活动轴；loop_count为PLC真实循环配置。
    loop_count=None时保留旧loop_once选帧规则，canonical入口始终传有效循环数。
    default_velocities保留旧参数名；总入口传入各模型max_velocity_HPY。
    stopped_time_ms定位点击停止时所在原段，不是段内搜索的硬边界；None保留全域搜索。
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

    # 停止指令帧只定位原动作段；惯性停下的位置可能对应本段另一侧的原曲线帧。
    # 内部递归用search_window_ms限定一个公共原段窗口，避免再次进入分段分流。
    if (nearest_start and not use_specified_time and stopped_time_ms is not None
            and search_window_ms is None):
        window_inputs = {"trajectory_run": True, "direction": direction,
            "loop_count": loop_count if loop_count is not None else (1 if loop_once else 0),
            "stopped_time_ms": stopped_time_ms, "curve_action": {"models": models},
            "active_axes_by_model": {key: [AXIS_NAMES[a] for a in axes] for key, axes in model_axes.items()}}
        attempts, reference_window = [], None
        for window in _entry_prioritized_windows(window_inputs):
            if reference_window is None:
                reference_window = list(window["range_ms"])
            try:
                result = calculate_forced_nearest_position(
                    current_positions, default_velocities, curve_action, max_accelerations,
                    direction=direction, loop_once=loop_once, nearest_start=nearest_start,
                    use_specified_time=False, specified_time_ms=specified_time_ms,
                    active_axes_by_model=active_axes_by_model, coarse_step=coarse_step,
                    fine_step=fine_step, loop_count=loop_count, stopped_time_ms=stopped_time_ms,
                    search_window_ms=window["range_ms"], frame_validator=frame_validator)
            except _EntryWindowInfeasible as error:
                attempts.append({**window, "status": "infeasible", "reason": str(error)})
                continue
            attempts.append({**window, "status": "planned"})
            result.update(frame_selection_mode="current_segment_first",
                reference_segment_range_ms=reference_window,
                selected_segment_range_ms=list(window["range_ms"]),
                segment_search_phase=window["phase"], segment_search_attempts=attempts)
            return result
        error = _EntryWindowInfeasible("当前原段及运行方向后续原段均无可执行接入方案")
        error.segment_search_attempts = attempts
        error.reference_segment_range_ms = reference_window
        raise error

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
                delta = abs(_entry_axis_delta(model, axis, current, target))
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

    # 指定帧优先：与非强制入口一致，不会因nearest_start=false而改跑起终点。
    if use_specified_time:
        specified = float(specified_time_ms)
        if (
            not math.isfinite(specified)
            or not specified.is_integer()
            or specified < global_start
            or specified > global_end
        ):
            raise ValueError(f"specified_time_ms必须在{global_start}到{global_end}之间且为整数毫秒")
        best = evaluate_frame(specified)
        start_mode = "nearest"
        frame_mode = "specified_frame"
        search_origin = specified
        reference_frame = specified
        search_start = search_end = specified
    elif not nearest_start:
        # 保留原有非就近启动：正向首帧，反向末帧。
        search_origin = global_start if direction > 0 else global_end
        best = evaluate_frame(search_origin)
        start_mode = "action_boundary"
        frame_mode = "action_boundary"
        reference_frame = None
        search_start = search_end = search_origin
    else:
        if stopped_time_ms is None:
            search_origin = global_start if direction > 0 else global_end
        else:
            if (type(stopped_time_ms) is not int
                    or not global_start <= stopped_time_ms <= global_end):
                raise ValueError("stopped_time_ms必须是动作首末范围内的整数毫秒")
            search_origin = float(stopped_time_ms)
        search_start, search_end = ((search_origin, global_end) if direction > 0
                                    else (global_start, search_origin))
        if search_window_ms is not None:
            if (not isinstance(search_window_ms, (list, tuple)) or len(search_window_ms) != 2
                    or any(type(v) not in (int, float) or not math.isfinite(v)
                           or v != int(v) for v in search_window_ms)
                    or not global_start <= search_window_ms[0] <= search_window_ms[1] <= global_end):
                raise ValueError("内部搜索窗口必须是动作范围内的升序整数毫秒区间")
            search_start, search_end = map(float, search_window_ms)
        reference_frame = stopped_time_ms
        frame_mode = "directional_nearest"

        import heapq

        search_statistics = {"method": "position_envelope_branch_and_bound",
                             "evaluated_frames": 0, "bound_intervals": 0,
                             "pruned_grid_frames": 0, "full_fine_grid_covered": True}
        coefficients = {
            int(model["index"]): [
                {axis: tuple(float(segment[name][axis]) for name in "abcdef")
                 for axis in model_axes[int(model["index"])]}
                for segment in model["segments"]]
            for model in models}
        whole_model_bounds = {}
        polynomial_bounds_cache = {}

        def model_position_bounds(model, left, right):
            """分段、空档保持及端点都纳入外包；循环跨界时保守使用整个模型范围。"""
            key = int(model["index"])
            segments = model["segments"]
            first, last = float(segments[0]["start_frame"]), float(segments[-1]["end_frame"])
            if not loop_once and (left < first or right > last):
                return whole_model_bounds[key]
            left = max(first, min(last, left))
            right = max(first, min(last, right))
            _, _, qa, _ = evaluate_model(model, left)
            _, _, qb, _ = evaluate_model(model, right)
            result = {axis: [min(qa[axis], qb[axis]), max(qa[axis], qb[axis])]
                      for axis in model_axes[key]}
            begin = max(0, bisect_right(model_start_frames[key], left)-1)
            for index in range(begin, len(segments)):
                segment = segments[index]
                start, end = float(segment["start_frame"]), float(segment["end_frame"])
                if start > right:
                    break
                lo, hi = max(left, start), min(right, end)
                for axis in model_axes[key]:
                    if lo <= hi:
                        bound_key = (coefficients[key][index][axis],
                                     (lo-start)/CURVE_TICK_FRAME, (hi-start)/CURVE_TICK_FRAME)
                        if bound_key not in polynomial_bounds_cache:
                            polynomial_bounds_cache[bound_key] = _forced_polynomial_position_bounds(*bound_key)
                        lower, upper = polynomial_bounds_cache[bound_key]
                        result[axis][0] = min(result[axis][0], lower)
                        result[axis][1] = max(result[axis][1], upper)
                    # PLC在首末帧/空档使用明确端点值，不能只包围系数值。
                    for frame, field in ((start, "start_HPY"), (end, "target_HPY")):
                        if left <= frame <= right:
                            value = float(segment[field][axis])
                            result[axis][0] = min(result[axis][0], value)
                            result[axis][1] = max(result[axis][1], value)
            return result

        # 仅用于消除多项式求值的数值尾差，不扩大现场位置/速度的执行容差。
        score_tolerance = 0.0
        for model in models:
            key = int(model["index"])
            bounds = model_position_bounds(model, float(model["segments"][0]["start_frame"]),
                                            float(model["segments"][-1]["end_frame"]))
            whole_model_bounds[key] = bounds
            for axis, (lower, upper) in bounds.items():
                current = float(current_positions[key][axis])
                velocity = float(default_velocities[key][axis])
                finite_scale = [1.0, abs(current), *(abs(v) for v in (lower, upper) if math.isfinite(v))]
                position_epsilon = max(1e-12, 32.0*math.ulp(max(finite_scale)))
                if velocity > 0.0:
                    score_tolerance = max(score_tolerance, position_epsilon/velocity)

        # 位置差除以各轴最大速度，统一H/P/Y量纲；准备参数仍在选帧后计算。
        def score_frame(global_frame, cutoff):
            """只计算归一化位置差；同分时再按运行方向选更早遇到的帧。"""
            search_statistics["evaluated_frames"] += 1
            score = 0.0
            for model in models:
                model_id = int(model["index"])
                _, _, target, _ = evaluate_model(model, global_frame)
                for axis in model_axes[model_id]:
                    delta = abs(_entry_axis_delta(model, axis, float(current_positions[model_id][axis]), target[axis]))
                    velocity = float(default_velocities[model_id][axis])
                    cost = 0.0 if delta <= 1e-12 else delta/velocity if velocity > 0 else math.inf
                    score = max(score, cost)
                # 同分还须检查剩余轴，不能把尚未算完整的同分当成最近点。
                if score > cutoff:
                    break
            return score

        minimum_score = math.inf
        equivalent_candidates = []
        validated_frames, rejected_frames = set(), {}

        def consider_frame(frame, best):
            nonlocal minimum_score
            if frame in rejected_frames:
                return best
            # 固定数值容差窗口围绕真正最小值，不用逐次epsilon比较累积放宽。
            score = score_frame(frame, minimum_score+score_tolerance)
            if score > minimum_score+score_tolerance:
                return best
            if frame_validator is not None and frame not in validated_frames:
                try:
                    frame_validator(evaluate_frame(frame))
                    validated_frames.add(frame)
                except (ValueError, ArithmeticError) as error:
                    rejected_frames[frame] = str(error)
                    return best
            # 只有可执行候选才能收紧上界；不能让不可执行的零误差排除本段其他点。
            minimum_score = min(minimum_score, score)
            if score <= minimum_score+score_tolerance:
                heapq.heappush(equivalent_candidates, (direction*frame, frame, score))
            while equivalent_candidates and equivalent_candidates[0][2] > minimum_score+score_tolerance:
                heapq.heappop(equivalent_candidates)
            _, selected_frame, selected_score = equivalent_candidates[0]
            return {"global_frame": selected_frame, "estimated_move_time": selected_score}

        def scan(start, end, step, best):
            frame = float(start)
            epsilon = abs(float(step))*1.0e-9
            while (step > 0 and frame <= end+epsilon) or (step < 0 and frame >= end-epsilon):
                if (best is not None and minimum_score == 0.0
                        and direction*frame >= direction*best["global_frame"]):
                    break
                best = consider_frame(frame, best)
                frame += step
            # 停止帧可能不与搜索步长对齐；实际范围的两端都必须参与比较。
            best = consider_frame(float(end), best)
            return best

        if direction > 0:
            best = scan(search_start, search_end, float(coarse_step), None)
        else:
            best = scan(search_end, search_start, -float(coarse_step), None)

        # 粗搜只提供上界。整个允许方向内的细网格都要覆盖，不能只细搜一个盆地。
        grid_origin = search_start if direction > 0 else search_end
        grid_count = int(math.floor((search_end-search_start)/float(fine_step)+1e-10))+1
        search_statistics["fine_grid_frames"] = grid_count
        search_statistics["normalized_position_tolerance"] = score_tolerance

        def grid_frame(index):
            return grid_origin+direction*index*float(fine_step)

        def interval_bound(first_index, last_index):
            search_statistics["bound_intervals"] += 1
            a, b = grid_frame(first_index), grid_frame(last_index)
            left, right = min(a, b), max(a, b)
            lower_score = 0.0
            for model in models:
                key = int(model["index"])
                for axis, (lower, upper) in model_position_bounds(model, left, right).items():
                    current = float(current_positions[key][axis])
                    delta = _entry_interval_distance(model, axis, current, lower, upper)
                    velocity = float(default_velocities[key][axis])
                    cost = 0.0 if delta <= 1e-12 else delta/velocity if velocity > 0.0 else math.inf
                    lower_score = max(lower_score, cost)
            return lower_score

        def competitive(lower, first_index):
            if lower > minimum_score+score_tolerance:
                return False
            if best is None:
                return True
            # 后面的区间只有能改善真正最小代价时才需要继续看。
            if (direction*grid_frame(first_index) >= direction*best["global_frame"]
                    and (minimum_score == 0.0 or lower >= best["estimated_move_time"])):
                return False
            return True

        pending = []
        initial_lower = interval_bound(0, grid_count-1)
        heapq.heappush(pending, (initial_lower, 0, grid_count-1))
        while pending:
            lower, first_index, last_index = heapq.heappop(pending)
            if not competitive(lower, first_index):
                search_statistics["pruned_grid_frames"] += last_index-first_index+1
                continue
            if last_index-first_index <= 7:
                for index in range(first_index, last_index+1):
                    best = consider_frame(grid_frame(index), best)
                continue
            middle = (first_index+last_index)//2
            best = consider_frame(grid_frame(middle), best)
            for first_child, last_child in ((first_index, middle-1), (middle+1, last_index)):
                if first_child > last_child:
                    continue
                child_lower = interval_bound(first_child, last_child)
                if competitive(child_lower, first_child):
                    heapq.heappush(pending, (child_lower, first_child, last_child))
                else:
                    search_statistics["pruned_grid_frames"] += last_child-first_child+1
        if best is None:
            error = _EntryWindowInfeasible("本原段窗口内没有可执行的准备接入点")
            error.rejected_frames = rejected_frames
            raise error
        best_frame = best["global_frame"]
        best = evaluate_frame(best_frame)
        search_statistics["infeasible_frames"] = len(rejected_frames)
        if frame_validator is not None:
            # 不缓存所有候选的整份Move表，只在最终帧重新生成一次，避免多模型内存膨胀。
            best["_entry_validated_motion"] = frame_validator(best)
        start_mode = "nearest"

    best.update({
        "direction": direction,
        "loop_once": loop_once,
        "nearest_start": nearest_start,
        "StartMode": start_mode,
        "use_specified_time": use_specified_time,
        "frame_selection_mode": frame_mode,
        "frame_selection_version": FRAME_SELECTION_VERSION,
        "reference_frame_ms": reference_frame,
        "SearchOriginFrame_ms": search_origin,
        "search_range_ms": [search_start, search_end],
        "coarse_step_ms": float(coarse_step),
        "fine_step_ms": float(fine_step),
        "metric": "max(abs(target-current)/prepare_velocity_limit)",
    })
    if frame_mode == "directional_nearest":
        best["search_statistics"] = search_statistics
    return best


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

def _prepare_motor_positions(pose, geometry, xy):
    if not xy:
        return _ordinary_forward_position(*pose, geometry)
    motion = _xy_point_motion(pose, [0., 0., 0.], geometry)[0]
    lengths = [math.sqrt(sum(value * value for value in position)) for position, _ in motion]
    base1, base2, height = geometry[2:5]
    return ([length - base1 for length in lengths] if base1 > 0 else
            [base2 + height - length for length in lengths])


def _prepare_axis_position(start, finish, velocity, acceleration, deceleration, time_s):
    distance = abs(finish - start)
    if distance == 0:
        return start
    accelerate_s = velocity / acceleration
    decelerate_s = velocity / deceleration
    cruise_s = max(0.0, distance / velocity - (accelerate_s + decelerate_s) / 2)
    total_s = accelerate_s + cruise_s + decelerate_s
    time_s = min(total_s, max(0.0, time_s))
    if time_s < accelerate_s:
        travelled = acceleration * time_s * time_s / 2
    elif time_s < accelerate_s + cruise_s:
        travelled = velocity * (time_s - accelerate_s / 2)
    else:
        travelled = distance - deceleration * (total_s - time_s)**2 / 2
    return start + math.copysign(min(distance, max(0.0, travelled)), finish - start)


def _prepare_motor_speed_bound(current, target, parameters, total_time, geometry, xy):
    """位置盒与有符号速度盒覆盖单调准备运动，必要时分割时间盒。"""
    interval = _SpeedInterval
    velocity = parameters['velocity_HPY']
    acceleration = parameters['acceleration_HPY']
    deceleration = parameters['deceleration_HPY']
    speed = [interval(0, peak) if finish > start else interval(-peak, 0)
             for start, finish, peak in zip(current, target, velocity)]
    function = _xy_motor_speed_upper if xy else _multi_point_motor_speed_upper
    instantaneous = _xy_instantaneous_speed if xy else _multi_point_instantaneous_speed
    signed_velocity = [math.copysign(peak, finish - start) if finish != start else 0.0
                       for start, finish, peak in zip(current, target, velocity)]
    pending = [(0.0, total_time, 0)]
    maximum = 0.0
    while pending:
        left, right, depth = pending.pop()
        box = []
        for axis in range(3):
            values = [_prepare_axis_position(current[axis], target[axis], velocity[axis],
                       acceleration[axis], deceleration[axis], time_s) for time_s in (left, right)]
            box.append(interval(min(values), max(values)))
        bound = function(box, speed, geometry)
        if math.isfinite(bound) and depth < 4:
            middle_position = [_prepare_axis_position(current[axis], target[axis], velocity[axis],
                               acceleration[axis], deceleration[axis], (left + right) / 2)
                               for axis in range(3)]
            # 宽位置盒会组合实际路径不同时出现的姿态。中点只决定是否细分，
            # 最终仍采用每个时间盒的区间上界，不以抽样峰速代替上界。
            estimate = instantaneous(middle_position, signed_velocity, geometry)
            if bound > 4 * max(estimate, 1e-6):
                middle = (left + right) / 2
                pending.extend(((left, middle, depth + 1), (middle, right, depth + 1)))
                continue
        if math.isfinite(bound):
            maximum = max(maximum, bound)
        elif depth < 16:
            middle = (left + right) / 2
            pending.extend(((left, middle, depth + 1), (middle, right, depth + 1)))
        else:
            raise ValueError('准备路径无法得到有限的实轴速度上界，请检查几何与姿态')
    return maximum


def _prepare_direction_domain(geometry):
    """原点严格在凸包内时返回None，否则返回从+Y计角的有效闭圆锥。"""
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


def _prepare_direction_profile(start, finish, velocity, acceleration, deceleration):
    distance = abs(finish-start)
    if distance == 0:
        return start, finish, 0., 0., 0., 0., 0., 0., 0.
    if min(velocity, acceleration, deceleration) <= 0:
        raise ValueError('有位移的准备轴须使用正速度与正加减速度')
    peak = min(velocity, math.sqrt(2*acceleration*deceleration*distance /
                                   (acceleration+deceleration)))
    accelerate_s, decelerate_s = peak/acceleration, peak/deceleration
    cruise_s = max(0., distance/peak-(accelerate_s+decelerate_s)/2)
    return (start, finish, math.copysign(1., finish-start), peak, acceleration,
            deceleration, accelerate_s, accelerate_s+cruise_s,
            accelerate_s+cruise_s+decelerate_s)


def _prepare_direction_position(profile, time_s):
    start, finish, sign, peak, acceleration, deceleration, accelerate_s, decelerate_at, end = profile
    if time_s >= end:
        return finish
    time_s = max(0., time_s)
    if time_s < accelerate_s:
        travelled = acceleration*time_s*time_s/2
    elif time_s < decelerate_at:
        travelled = peak*(time_s-accelerate_s/2)
    else:
        travelled = abs(finish-start)-deceleration*(end-time_s)**2/2
    return start+sign*min(abs(finish-start), max(0., travelled))


def _check_prepare_direction_domain(current, target, parameters, total_time, geometry, xy):
    """检查整个实际准备路径。边界容差为1e-12弧度，与射线判定同量级。"""
    if xy and any(abs(position[axis]) >= 90 for position in (current, target) for axis in (1, 2)):
        raise ValueError('XY多点摆X/Y角须在(-90,90)内')
    if (xy and len(geometry[0]) == 2) or (not xy and current[1] == target[1] == 0):
        return
    domain = _prepare_direction_domain(geometry)
    if domain is None:
        return
    left, right = domain
    if not xy:
        values = [-math.radians(position[2]+geometry[5]) for position in (current, target)]
        start, finish = min(values), max(values)
        shift = math.floor((start-left)/math.tau)
        if any(start >= left+k*math.tau-1e-12 and finish <= right+k*math.tau+1e-12
               for k in (shift-1, shift, shift+1)):
            return
        raise ValueError('普通多点摆准备路径中存在无法求得凸包边距的倾斜方向')

    interval = _SpeedInterval
    radians = math.pi/180
    sine_left, cosine_left = interval(left).trig(), interval(left).trig(True)
    sine_right, cosine_right = interval(right).trig(), interval(right).trig(True)
    profiles = [_prepare_direction_profile(current[axis], target[axis],
                parameters['velocity_HPY'][axis], parameters['acceleration_HPY'][axis],
                parameters['deceleration_HPY'][axis]) for axis in (1, 2)]
    end = max(total_time, *(profile[-1] for profile in profiles))
    times = sorted({0., end, *(time_s for profile in profiles for time_s in profile[-3:]
                              if 0 < time_s < end)})
    pending = ([(start, finish, 0) for start, finish in zip(times, times[1:])]
               if end > 0 else [(0., 0., 0)])
    while pending:
        start, finish, depth = pending.pop()
        positions = [[_prepare_direction_position(profile, time_s)
                      for time_s in (start, finish)] for profile in profiles]
        # 与参考正解相同，极小倾斜在浮点acos下为0，整盒都不使用径向偏移。
        max_angles = [math.radians(max(abs(value) for value in row)) for row in positions]
        if math.acos(min(1., math.cos(max_angles[0])*math.cos(max_angles[1]))) <= 1e-8:
            continue
        pitch, roll = [-interval(min(row), max(row))*radians for row in positions]
        nx, ny = -roll.trig()*pitch.trig(True), pitch.trig()
        tolerance = 1e-12*math.hypot(nx.max_abs(), ny.max_abs())
        cross_left = sine_left*ny-cosine_left*nx
        cross_right = nx*cosine_right-ny*sine_right
        if cross_left.hi <= tolerance and cross_right.hi <= tolerance:
            continue
        middle = (start+finish)/2
        for time_s in (start, middle, finish):
            pitch, roll = [-math.radians(_prepare_direction_position(profile, time_s))
                           for profile in profiles]
            if math.acos(max(-1., min(1., math.cos(pitch)*math.cos(roll)))) <= 1e-8:
                continue
            nx, ny = -math.sin(roll)*math.cos(pitch), math.sin(pitch)
            tolerance = 1e-12*math.hypot(nx, ny)
            if (math.sin(left)*ny-math.cos(left)*nx > tolerance or
                    nx*math.cos(right)-ny*math.sin(right) > tolerance):
                raise ValueError('XY多点摆准备路径中存在无法求得凸包边距的倾斜方向')
        if depth >= 32 or middle in (start, finish):
            raise ValueError('XY多点摆准备方向接近凸包边界，无法可靠包围整段运动')
        pending.extend(((start, middle, depth+1), (middle, finish, depth+1)))


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
        model = models[model_id]
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
        if model["model_type"] == 4:
            _validate_rotation_prepare(model, float(current[0]), float(target[0]))
        for axis in axes:
            distance = abs(_entry_axis_delta(model, axis, float(current[axis]), float(target[axis])))
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

    # 第三步：按当前模型正解包围整条准备路径的真实电机速度。
    motor_checks = {}
    motor_scale = 1.0
    for model_id, model in models.items():
        current = [float(value) for value in inputs["current_positions"][model_id]]
        target = [float(value) for value in nearest_position_result["PosSet"][model_id]]
        parameters = velocity_set[model_id]
        model_type = int(model["model_type"])
        limit = float(model["max_motor_velocity"])
        count = int(model["motor_num"])
        if not math.isfinite(limit) or limit <= 0:
            raise ValueError(f"模型{model_id}的最大电机速度必须为有限正数")
        if model_type in (1, 4):
            bound = parameters["velocity_HPY"][0]
            endpoints = [dandian_forward_model(pose[0], count) for pose in (current, target)]
        elif model_type in (8, 9):
            geometry = model["_entry_geometry"]
            base1, base2, height, beta = geometry[2:]
            if min(pose[0] + base1 if base1 > 0 else base2 + height - pose[0]
                   for pose in (current, target)) < 0:
                raise ValueError(f"模型{model_id}准备路径的有效高度不能为负")
            tilt_axes = (1, 2) if model_type == 9 else (1,)
            if any(abs(pose[axis]) >= 90 for axis in tilt_axes for pose in (current, target)):
                raise ValueError(f"模型{model_id}准备倾角须在(-90,90)内")
            endpoints = [_prepare_motor_positions(pose, geometry, model_type == 9)
                         for pose in (current, target)]
            _check_prepare_direction_domain(current, target, parameters, synchronized_time,
                                            geometry, model_type == 9)
            if all(current[axis] == target[axis] == 0 for axis in tilt_axes):
                bound = parameters["velocity_HPY"][0]
            else:
                bound = _prepare_motor_speed_bound(current, target, parameters,
                                                   synchronized_time, geometry, model_type == 9)
        else:
            raise ValueError(f"模型{model_id}类型{model_type}不受支持")
        if count <= 0 or any(len(values) != count or not all(math.isfinite(value) for value in values)
                             for values in endpoints):
            raise ValueError(f"模型{model_id}端点正解未返回有效电机位置")
        if not math.isfinite(bound) or bound < 0:
            raise ValueError(f"模型{model_id}的电机速度上界无效")
        if bound > 0:
            motor_scale = min(motor_scale, limit / (bound * (1.0 + 1.0e-9)))
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
        item.pop("_entry_loop_endpoints_HPY", None)
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
            if kind not in (2, 3, 4, 7, 9):
                raise ValueError("业务模型类型仅支持2单点、3多级升降、4无极旋转、7多点摆、9XY多点摆")
            geometry_kind = {2: 1, 3: 1, 4: 4, 7: 8, 9: 9}[kind]
        else:
            geometry_kind = kind
            if kind not in (1, 4, 8, 9):
                raise ValueError("几何模型类型仅支持1(H)、4(无极旋转)、8(普通多点)、9(XY多点)")
        geometry = item.get("geometry", {})
        if not isinstance(geometry, dict):
            raise ValueError("geometry必须是对象")
        # geometry只允许物理参数，不能覆盖反馈、停稳信息或PLC路由字段。
        geometry_fields = {"motor_num", "BaseHight1", "BaseHight2", "Baseheight1", "Baseheight2",
            "lLenth_inside", "wLenth_inside", "maxheight", "moveWhat", "point_init_pos", "betainit", "workingStroke", "nSections", "AdjustDistance", "deceleration_ratio"}
        if set(geometry)-geometry_fields:
            raise ValueError("geometry含非几何字段，不能覆盖运行反馈或模型路由")
        if any(name in item and item[name] != value for name, value in geometry.items()):
            raise ValueError("平铺字段与geometry中的同名配置冲突")
        # 配置放geometry或保留旧平铺字段均可；核心只使用归一化副本。
        item.update(geometry)
        for name in ("AdjustDistance", "deceleration_ratio"):
            if item.get(name) is None:
                item.pop(name, None)
        for name in geometry_fields-{"motor_num", "moveWhat", "point_init_pos", "nSections", "AdjustDistance"}:
            if name in item:
                item[name] = _number(item[name], name)
        if "nSections" in item and (type(item["nSections"]) is not int or not 0 <= item["nSections"] <= 10):
            raise ValueError("nSections须为0到10的整数")
        if "AdjustDistance" in item:
            points = item["AdjustDistance"]
            if not isinstance(points, list) or len(points) > 10:
                raise ValueError("AdjustDistance须为最多10个内部段点列表")
            count = item.get("nSections", len(points))
            if count > len(points):
                raise ValueError("AdjustDistance有效段点数量不能少于nSections")
            # PLC仅复制前nSections个点，固定数组尾部占位不参与校验和计算。
            item["AdjustDistance"] = [_number(value, "AdjustDistance") for value in points[:count]]
            if any(a >= b for a, b in zip(item["AdjustDistance"], item["AdjustDistance"][1:])):
                raise ValueError("多级升降内部段点须严格递增")
            if scheme == "business" and kind == 3 and count:
                lower = _hpy(item["min_position_HPY"], "min_position_HPY")[0] if "min_position_HPY" in item else -math.inf
                upper = _hpy(item["max_position_HPY"], "max_position_HPY")[0] if "max_position_HPY" in item else math.inf
                if any(not lower < value < upper for value in item["AdjustDistance"]):
                    raise ValueError("多级升降有效内部段点须位于H软行程内部")
        if "deceleration_ratio" in item and not 0 <= item["deceleration_ratio"] <= 100:
            raise ValueError("deceleration_ratio须为0到100的百分数")
        if "point_init_pos" in item:
            if not isinstance(item["point_init_pos"], list):
                raise ValueError("point_init_pos必须是XYZ吊点列表")
            points = []
            for point in item["point_init_pos"]:
                if not isinstance(point, (list, tuple)) or len(point) not in (2, 3):
                    raise ValueError("吊点须为[x,y]或[x,y,z]")
                points.append(_hpy(list(point) + ([0] if len(point) == 2 else []), "point_init_pos XYZ"))
            item["point_init_pos"] = points
        item["index"], item["model_type"] = internal_id, geometry_kind
        item.setdefault("motor_num", len(item.get("point_init_pos", [])) if geometry_kind in (8, 9) else 1)
        if type(item["motor_num"]) is not int or item["motor_num"] <= 0:
            raise ValueError("motor_num必须为正整数")
        if geometry_kind in (8, 9):
            item.setdefault("betainit", 0.0)
            item["_entry_geometry"] = _prepare_multi_point_geometry(item)
            if item["motor_num"] != len(item["_entry_geometry"][0]):
                raise ValueError("motor_num须与原吊点数量一致")
        if geometry_kind == 4:
            period = _number(item.get("workingStroke"), "workingStroke")
            lower = _hpy(item.get("min_position_HPY"), "min_position_HPY")
            upper = _hpy(item.get("max_position_HPY"), "max_position_HPY")
            if period <= 0 or not 0 <= lower[0] < upper[0]:
                raise ValueError("无极旋转workingStroke须为真实正周期，H软行程须满足0<=下限<上限")
            item["_rotation_period_H"] = period
            item["min_position_HPY"], item["max_position_HPY"] = lower, upper
        current = _hpy(item.get("current_HPY"), "current_HPY")
        if geometry_kind == 4:
            current[0] = _rotation_position(item, current[0])
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
        supported = {1: {"H"}, 4: {"H"}, 8: {"H", "P", "Y"}, 9: {"H", "P", "Y"}}[geometry_kind]
        if not set(follow).issubset(prepare) or not set(prepare).issubset(supported):
            raise ValueError("prepare_axes须包含follow_axes，且不得加入模型不存在的轴")
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
                    if name in p and not _entry_positions_equal(item, evaluated, _hpy(p[name], name)):
                        raise ValueError("系数阶段端点与位置字段不一致")
                    p[name] = evaluated
                # 首次归一化同时校验阶段/动作段/空档的位置连续性。
                if flat and not _entry_positions_equal(item, flat[-1]["target_HPY"], p["start_HPY"]):
                    raise ValueError("相邻系数阶段或原动作空档前后的位置不连续")
                flat.append(p); cursor = p["end_frame"]
            if cursor != end:
                raise ValueError("系数阶段没有覆盖到原动作末帧")
            for value, name in ((flat[-len(pieces)]["start_HPY"], "start_HPY"), (flat[-1]["target_HPY"], "target_HPY")):
                if name in segment and not _entry_positions_equal(item, value, _hpy(segment[name], name)):
                    raise ValueError("原动作端点与abcdef/系数阶段不一致")
        if _rotation_full_period(item):
            # PLC循环按保存的首尾位置原值判断，保留用户显式端点，不用取模值替代。
            first_segment, last_segment = segments[0], segments[-1]
            first_piece = first_segment.get("coefficient_segments", [first_segment])[0]
            last_piece = last_segment.get("coefficient_segments", [last_segment])[-1]
            first = first_segment.get("start_HPY", first_piece.get("start_HPY", flat[0]["start_HPY"]))
            last = last_segment.get("target_HPY", last_piece.get("target_HPY", flat[-1]["target_HPY"]))
            item["_entry_loop_endpoints_HPY"] = (_hpy(first, "start_HPY"), _hpy(last, "target_HPY"))
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
        if model.get("_rotation_period_H") is not None:
            target[0] = _rotation_position(model, target[0])
        for axis, name in enumerate(AXIS_NAMES):
            if name not in inputs["active_axes_by_model"][key]:
                if name in model["_supported_axes"] and abs(target[axis]-current[axis]) > 1e-5:
                    raise ValueError("固定姿态与当前不一致：须把该可动轴加入prepare_axes")
                target[axis] = current[axis]
    return candidate


## 总入口：两种选帧方式保持独立，准备运动共用同一跨PLC同步函数。
def _calculate_forced_entry(parameters):
    """输入字典，返回选帧、按PLC分组的同步Move与1006参数；不修改输入。

    can_dispatch=true表示可按17+14字节的1006共同等待协议下发。
    所有PLC必须支持以1007共同时间戳加prepareTimeMs作为准备结束时间门。
    requires_group_wait=true提示有整台静止PLC，须保持到共同结束时刻；不再拒绝计划。
    """
    inputs = _normalize_inputs(parameters)
    if not inputs["trajectory_run"]:
        raise ValueError("强制入口接受trajectory_run=true；非强制请使用单Move版就近包")
    # 对齐XML autoFunFB.start的canLoop：强制非闭合动作回退单次。
    # 同模型虚轴首末时间是否一致须由上位机在合并HPY前检查；本格式默认共同区间。
    loop_fallback = []
    if not inputs["loop_once"]:
        for model in inputs["curve_action"]["models"]:
            key = model["index"]
            first, last = model.get("_entry_loop_endpoints_HPY", (
                model["segments"][0]["start_HPY"], model["segments"][-1]["target_HPY"]))
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
    selection_summary = {}
    position_limits = {}
    for model in inputs["curve_action"]["models"]:
        key = model["index"]
        lower = (_hpy(model["min_position_HPY"], "min_position_HPY")
                 if "min_position_HPY" in model else [-math.inf]*3)
        upper = (_hpy(model["max_position_HPY"], "max_position_HPY")
                 if "max_position_HPY" in model else [math.inf]*3)
        if any(a > b for a, b in zip(lower, upper)):
            raise ValueError("虚轴行程下限不能大于上限")
        axes = [AXIS_NAMES.index(name) for name in model["_supported_axes"]]
        for axis in axes:
            current = inputs["current_positions"][key][axis]
            if current < lower[axis]-1e-9 or current > upper[axis]+1e-9:
                raise ValueError(f"模型{key}当前位置已超出{AXIS_NAMES[axis]}行程")
        position_limits[key] = lower, upper, axes

    def validate_selected_frame(candidate):
        # 1006只传原帧，不传算法规范化后的准备位置；PLC会重新求值后夹到软限。
        # 因此须先检查原帧位置，不能把365先取模为5后假定PLC也会准备到5。
        for key, target in candidate["PosSet"].items():
            lower, upper, axes = position_limits[key]
            if any(target[axis] < lower[axis]-1e-9 or target[axis] > upper[axis]+1e-9
                   for axis in axes):
                raise ValueError(f"模型{key}的原曲线候选目标超出PLC准备软行程")
        prepared = _prepare_targets(candidate, inputs)
        for key, target in prepared["PosSet"].items():
            lower, upper, axes = position_limits[key]
            if any(target[axis] < lower[axis]-1e-9 or target[axis] > upper[axis]+1e-9
                   for axis in axes):
                raise ValueError(f"模型{key}的候选准备目标超出虚轴行程")
        return calculate_synchronized_entry_move(prepared, inputs)

    search_nearest = inputs["nearest_start"] and not inputs["use_specified_time"]
    selected = calculate_forced_nearest_position(
        inputs["current_positions"], inputs["max_velocities"], inputs["curve_action"],
        inputs["max_accelerations"], direction=inputs["direction"], loop_once=inputs["loop_once"],
        nearest_start=inputs["nearest_start"], use_specified_time=inputs["use_specified_time"],
        specified_time_ms=inputs["specified_time_ms"], active_axes_by_model=inputs["active_axes_by_model"],
        coarse_step=inputs["coarse_step"], fine_step=inputs["fine_step"], loop_count=inputs["loop_count"],
        stopped_time_ms=inputs["stopped_time_ms"],
        frame_validator=validate_selected_frame if search_nearest else None)
    selection_summary = selected
    curve_targets = {m["model_id"]: m["target_HPY"] for m in selected["models"]}
    validated_motion = selected.pop("_entry_validated_motion", None)
    motion = validated_motion if validated_motion is not None else validate_selected_frame(selected)
    skipped = []
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
        model = inputs["curve_action"]["models"][key - 1]
        execute = [abs(_entry_axis_delta(model, a, current[a], target[a])) > 1e-12 for a in range(3)]
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
        "frame_selection_mode": selection_summary.get("frame_selection_mode", "action_boundary"),
        "frame_selection_version": FRAME_SELECTION_VERSION,
        "reference_frame_ms": selection_summary.get("reference_frame_ms"),
        "search_origin_frame_ms": selection_summary.get("SearchOriginFrame_ms"),
        "search_range_ms": selection_summary.get("search_range_ms", [frame, frame]),
        "selection_metric": "nearest_position",
        "position_metric": "max(distance(target,current)/max_velocity_HPY); type4 uses modulo distance",
        "search_statistics": selection_summary.get("search_statistics", {}),
        "reference_segment_range_ms": selection_summary.get("reference_segment_range_ms"),
        "selected_segment_range_ms": selection_summary.get("selected_segment_range_ms"),
        "segment_search_phase": selection_summary.get("segment_search_phase"),
        "segment_search_attempts": selection_summary.get("segment_search_attempts", []),
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


def calculate_nearest_entry(parameters):
    """五模型强制准备入口，输入静态models与停稳runtime。"""
    source=_adapt_shared_nearest_parameters(parameters)
    if source.get('command',{}).get('trajectory_run') is True:
        try:
            return _calculate_forced_entry(source)
        except _EntryWindowInfeasible as error:
            return {'status':'infeasible','plan_valid':False,'can_dispatch':False,
                'trajectory_run':True,'reverse':source['command'].get('reverse',False),
                'message':str(error),'selected_curve_time_ms':None,'prepare_time_ms':None,
                'prepare_time_ms_ceil':None,'devices':[],'1006_payloads':[],
                'stationary_plc_ids':[],'frame_selection_mode':'current_segment_first',
                'frame_selection_version':FRAME_SELECTION_VERSION,
                'reference_frame_ms':source['command'].get('stopped_time_ms'),
                'reference_segment_range_ms':getattr(error,'reference_segment_range_ms',None),
                'segment_search_attempts':getattr(error,'segment_search_attempts',[])}
    raise ValueError("非强制就近请调用非强制就近接入-单Move版-20261110包中的入口")


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
