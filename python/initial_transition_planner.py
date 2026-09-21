#######################当前位置到目标位置的时间计算########################  时间 速度加减速度‘
import math
import copy
import json
import copy
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
##########################单点速度求解函数#########################
    ##输入 当前位置 目标位置 速度 加速度 减速度
def dandian_velocity_model(current_pos,target_pos,velocity,acceleration,deceleration):
    distance = abs(target_pos-current_pos)
    if distance == 0:
        return 0
    s_acc = velocity**2/(2.0*acceleration)
    s_dec = velocity**2/(2.0*deceleration)
    if distance >= s_acc+s_dec:
        max_velocity = velocity
    else:
        max_velocity = math.sqrt(2.0*distance*acceleration*deceleration/(acceleration+deceleration))
    return max_velocity
##########################两点速度求解函数#########################
    ##输入 当前高度 目标高度 当前角度 目标角度 高度速度加减速度 角度速度加减速度 原点位置在上距离 原点位置在下距离 吊点距离 最大行程
def liangdian_velocity_model(height_start,height_target,arg_x_start,arg_x_target,height_velocity,height_acceleration,height_deceleration,arg_x_velocity,arg_x_acceleration,arg_x_deceleration,BaseHight1,BaseHight2,lLenth_inside,maxheight):
    ##生成 H、P 各自的速度轨迹
    def build_profile(p0,pf,velocity,acceleration,deceleration):
        distance = abs(pf-p0)
        if distance == 0:
            return p0,pf,0,0,0,0,0,0
        direction = 1.0 if pf > p0 else -1.0
        s_acc = velocity**2/(2.0*acceleration)
        s_dec = velocity**2/(2.0*deceleration)
        if distance >= s_acc+s_dec:
            v_peak = velocity
            t1 = v_peak/acceleration
            t2 = (distance-s_acc-s_dec)/v_peak
            t3 = v_peak/deceleration
        else:
            v_peak = math.sqrt(2.0*distance*acceleration*deceleration/(acceleration+deceleration))
            t1 = v_peak/acceleration
            t2 = 0.0
            t3 = v_peak/deceleration
        return p0,pf,direction,v_peak,t1,t2,t3,t1+t2+t3
    ##任意给一个 t，直接算这个虚轴在哪
    def calc_pos_vel(profile,t,acceleration,deceleration):
        p0,pf,direction,v_peak,t1,t2,t3,total_time = profile
        if direction == 0:
            return p0,0.0
        if t <= 0:
            return p0,0.0
        if t >= total_time:
            return pf,0.0
        if t <= t1:
            s = 0.5*acceleration*t**2
            velocity = acceleration*t
        elif t <= t1+t2:
            dt = t-t1
            s1 = 0.5*acceleration*t1**2
            s = s1+v_peak*dt
            velocity = v_peak
        else:
            dt = t-t1-t2
            s1 = 0.5*acceleration*t1**2
            s2 = v_peak*t2
            s = s1+s2+v_peak*dt-0.5*deceleration*dt**2
            velocity = v_peak-deceleration*dt
        position = p0+direction*s
        velocity = direction*velocity
        return position,velocity
    ##H、P 的速度怎么变成 A、B 电机速度
    def calc_motor_velocity(height,arg_x,height_vel,arg_x_vel):
        half_lenth = lLenth_inside/2.0
        rad = math.pi/180.0
        if BaseHight1 != 0 and BaseHight2 == 0:
            angle = arg_x
            angle_vel = arg_x_vel
            xOffset = ((angle/90.0)**3)*half_lenth
            xOffset_vel = 3.0*((angle/90.0)**2)*(half_lenth/90.0)*angle_vel
            angle_rad = angle*rad
            x0 = -half_lenth
            y0 = 0.0
            x1 = half_lenth
            y1 = 0.0
            xA = -math.cos(angle_rad)*half_lenth-xOffset
            xB = math.cos(angle_rad)*half_lenth-xOffset
            yA = height-math.sin(angle_rad)*half_lenth+BaseHight1
            yB = height+math.sin(angle_rad)*half_lenth+BaseHight1
            xA_vel = math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
            xB_vel = -math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
            yA_vel = height_vel-math.cos(angle_rad)*half_lenth*rad*angle_vel
            yB_vel = height_vel+math.cos(angle_rad)*half_lenth*rad*angle_vel

        elif BaseHight1 == 0 and BaseHight2 != 0:
            angle = -arg_x
            angle_vel = -arg_x_vel
            xOffset = ((angle/90.0)**3)*half_lenth
            xOffset_vel = 3.0*((angle/90.0)**2)*(half_lenth/90.0)*angle_vel
            angle_rad = angle*rad
            x0 = -half_lenth
            y0 = BaseHight2+maxheight
            x1 = half_lenth
            y1 = BaseHight2+maxheight
            xA = -math.cos(angle_rad)*half_lenth-xOffset
            xB = math.cos(angle_rad)*half_lenth-xOffset
            yA = height-math.sin(angle_rad)*half_lenth
            yB = height+math.sin(angle_rad)*half_lenth
            xA_vel = math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
            xB_vel = -math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
            yA_vel = height_vel-math.cos(angle_rad)*half_lenth*rad*angle_vel
            yB_vel = height_vel+math.cos(angle_rad)*half_lenth*rad*angle_vel
        else:
            return 0.0
        distance_A = math.sqrt((xA-x0)**2+(yA-y0)**2)
        distance_B = math.sqrt((xB-x1)**2+(yB-y1)**2)
        A_velocity = abs(((xA-x0)*xA_vel+(yA-y0)*yA_vel)/distance_A)
        B_velocity = abs(((xB-x1)*xB_vel+(yB-y1)*yB_vel)/distance_B)
        return max(A_velocity,B_velocity)
    height_profile = build_profile(height_start,height_target,height_velocity,height_acceleration,height_deceleration)
    arg_x_profile = build_profile(arg_x_start,arg_x_target,arg_x_velocity,arg_x_acceleration,arg_x_deceleration)
    total_time = max(height_profile[7],arg_x_profile[7])
    if total_time == 0:
        return 0.0
    max_velocity = 0.0
    t = 0.0
    while t <= total_time:
        height,height_vel = calc_pos_vel(height_profile,t,height_acceleration,height_deceleration)
        arg_x,arg_x_vel = calc_pos_vel(arg_x_profile,t,arg_x_acceleration,arg_x_deceleration)
        motor_velocity = calc_motor_velocity(height,arg_x,height_vel,arg_x_vel)
        if motor_velocity > max_velocity:
            max_velocity = motor_velocity
        t = t+0.1
    key_times = [height_profile[4],height_profile[4]+height_profile[5],height_profile[7],arg_x_profile[4],arg_x_profile[4]+arg_x_profile[5],arg_x_profile[7],total_time]
    for t in key_times:
        if t >= 0 and t <= total_time:
            height,height_vel = calc_pos_vel(height_profile,t,height_acceleration,height_deceleration)
            arg_x,arg_x_vel = calc_pos_vel(arg_x_profile,t,arg_x_acceleration,arg_x_deceleration)
            motor_velocity = calc_motor_velocity(height,arg_x,height_vel,arg_x_vel)
            if motor_velocity > max_velocity:
                max_velocity = motor_velocity
    return max_velocity
##########################四点整段最大速度求解函数#########################
    ##输入 当前高度 目标高度 当前X角度 目标X角度 当前Y角度 目标Y角度 高度速度加减速度 X角度速度加减速度 Y角度速度加减速度 原点位置在上距离 原点位置在下距离 X方向吊点距离 Y方向吊点距离 最大行程 运动方向
def sidian_velocity_model(height_start,height_target,arg_x_start,arg_x_target,arg_y_start,arg_y_target,height_velocity,height_acceleration,height_deceleration,arg_x_velocity,arg_x_acceleration,arg_x_deceleration,arg_y_velocity,arg_y_acceleration,arg_y_deceleration,BaseHight1,BaseHight2,lLenth_inside,wLenth_inside,maxheight,moveWhat):
    def build_profile(p0,pf,velocity,acceleration,deceleration):
        distance = abs(pf-p0)
        if distance == 0:
            return p0,pf,0,0,0,0,0,0
        if velocity <= 0 or acceleration <= 0 or deceleration <= 0:
            raise ValueError("速度、加速度、减速度必须大于0")
        direction = 1.0 if pf > p0 else -1.0
        s_acc = velocity**2/(2.0*acceleration)
        s_dec = velocity**2/(2.0*deceleration)
        if distance >= s_acc+s_dec:
            v_peak = velocity
            t1 = v_peak/acceleration
            t2 = (distance-s_acc-s_dec)/v_peak
            t3 = v_peak/deceleration
        else:
            v_peak = math.sqrt(2.0*distance*acceleration*deceleration/(acceleration+deceleration))
            t1 = v_peak/acceleration
            t2 = 0.0
            t3 = v_peak/deceleration
        return p0,pf,direction,v_peak,t1,t2,t3,t1+t2+t3
    def calc_pos_vel(profile,t,acceleration,deceleration):
        p0,pf,direction,v_peak,t1,t2,t3,total_time = profile
        if direction == 0:
            return p0,0.0
        if t <= 0:
            return p0,0.0
        if t >= total_time:
            return pf,0.0
        if t <= t1:
            s = 0.5*acceleration*t**2
            velocity = acceleration*t
        elif t <= t1+t2:
            dt = t-t1
            s1 = 0.5*acceleration*t1**2
            s = s1+v_peak*dt
            velocity = v_peak
        else:
            dt = t-t1-t2
            s1 = 0.5*acceleration*t1**2
            s2 = v_peak*t2
            s = s1+s2+v_peak*dt-0.5*deceleration*dt**2
            velocity = v_peak-deceleration*dt
        position = p0+direction*s
        velocity = direction*velocity
        return position,velocity
    def calc_motor_velocity(height,arg_x,arg_y,height_vel,arg_x_vel,arg_y_vel):
        rad = math.pi/180.0
        if BaseHight1 != 0 and BaseHight2 == 0:
            if moveWhat == 1:
                half_lenth = lLenth_inside/2.0
                angle = arg_x
                angle_vel = arg_x_vel
                xOffset = ((angle/90.0)**3)*half_lenth
                xOffset_vel = 3.0*((angle/90.0)**2)*(half_lenth/90.0)*angle_vel
                angle_rad = angle*rad
                x0 = -half_lenth
                y0 = 0.0
                x1 = half_lenth
                y1 = 0.0
                xA = -math.cos(angle_rad)*half_lenth-xOffset
                xB = math.cos(angle_rad)*half_lenth-xOffset
                yA = height-math.sin(angle_rad)*half_lenth+BaseHight1
                yB = height+math.sin(angle_rad)*half_lenth+BaseHight1
                xA_vel = math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
                xB_vel = -math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
                yA_vel = height_vel-math.cos(angle_rad)*half_lenth*rad*angle_vel
                yB_vel = height_vel+math.cos(angle_rad)*half_lenth*rad*angle_vel
                distance_A = math.sqrt((xA-x0)**2+(yA-y0)**2)
                distance_B = math.sqrt((xB-x1)**2+(yB-y1)**2)
                A_velocity = abs(((xA-x0)*xA_vel+(yA-y0)*yA_vel)/distance_A)
                B_velocity = abs(((xB-x1)*xB_vel+(yB-y1)*yB_vel)/distance_B)
                C_velocity = B_velocity
                D_velocity = A_velocity
                return max(A_velocity,B_velocity,C_velocity,D_velocity)
            elif moveWhat == 2:
                half_lenth = wLenth_inside/2.0
                angle = arg_y
                angle_vel = arg_y_vel
                yOffset = ((angle/90.0)**3)*half_lenth
                yOffset_vel = 3.0*((angle/90.0)**2)*(half_lenth/90.0)*angle_vel
                angle_rad = angle*rad
                x0 = -half_lenth
                y0 = 0.0
                x1 = half_lenth
                y1 = 0.0
                xA = -math.cos(angle_rad)*half_lenth-yOffset
                xB = math.cos(angle_rad)*half_lenth-yOffset
                yA = height-math.sin(angle_rad)*half_lenth+BaseHight1
                yB = height+math.sin(angle_rad)*half_lenth+BaseHight1
                xA_vel = math.sin(angle_rad)*half_lenth*rad*angle_vel-yOffset_vel
                xB_vel = -math.sin(angle_rad)*half_lenth*rad*angle_vel-yOffset_vel
                yA_vel = height_vel-math.cos(angle_rad)*half_lenth*rad*angle_vel
                yB_vel = height_vel+math.cos(angle_rad)*half_lenth*rad*angle_vel
                distance_A = math.sqrt((xB-x1)**2+(yB-y1)**2)
                distance_C = math.sqrt((xA-x0)**2+(yA-y0)**2)
                A_velocity = abs(((xB-x1)*xB_vel+(yB-y1)*yB_vel)/distance_A)
                C_velocity = abs(((xA-x0)*xA_vel+(yA-y0)*yA_vel)/distance_C)
                B_velocity = A_velocity
                D_velocity = C_velocity
                return max(A_velocity,B_velocity,C_velocity,D_velocity)
            else:
                return abs(height_vel)
        elif BaseHight1 == 0 and BaseHight2 != 0:
            if moveWhat == 1:
                half_lenth = lLenth_inside/2.0
                angle = -arg_x
                angle_vel = -arg_x_vel
                xOffset = ((angle/90.0)**3)*half_lenth
                xOffset_vel = 3.0*((angle/90.0)**2)*(half_lenth/90.0)*angle_vel
                angle_rad = angle*rad
                x0 = -half_lenth
                y0 = BaseHight2+maxheight
                x1 = half_lenth
                y1 = BaseHight2+maxheight
                xA = -math.cos(angle_rad)*half_lenth-xOffset
                xB = math.cos(angle_rad)*half_lenth-xOffset
                yA = height-math.sin(angle_rad)*half_lenth
                yB = height+math.sin(angle_rad)*half_lenth
                xA_vel = math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
                xB_vel = -math.sin(angle_rad)*half_lenth*rad*angle_vel-xOffset_vel
                yA_vel = height_vel-math.cos(angle_rad)*half_lenth*rad*angle_vel
                yB_vel = height_vel+math.cos(angle_rad)*half_lenth*rad*angle_vel
                distance_A = math.sqrt((xA-x0)**2+(yA-y0)**2)
                distance_B = math.sqrt((xB-x1)**2+(yB-y1)**2)
                A_velocity = abs(((xA-x0)*xA_vel+(yA-y0)*yA_vel)/distance_A)
                B_velocity = abs(((xB-x1)*xB_vel+(yB-y1)*yB_vel)/distance_B)
                C_velocity = B_velocity
                D_velocity = A_velocity
                return max(A_velocity,B_velocity,C_velocity,D_velocity)
            elif moveWhat == 2:
                half_lenth = wLenth_inside/2.0
                angle = -arg_y
                angle_vel = -arg_y_vel
                yOffset = ((angle/90.0)**3)*half_lenth
                yOffset_vel = 3.0*((angle/90.0)**2)*(half_lenth/90.0)*angle_vel
                angle_rad = angle*rad
                x0 = -half_lenth
                y0 = BaseHight2+maxheight
                x1 = half_lenth
                y1 = BaseHight2+maxheight
                xA = -math.cos(angle_rad)*half_lenth-yOffset
                xB = math.cos(angle_rad)*half_lenth-yOffset
                yA = height-math.sin(angle_rad)*half_lenth
                yB = height+math.sin(angle_rad)*half_lenth
                xA_vel = math.sin(angle_rad)*half_lenth*rad*angle_vel-yOffset_vel
                xB_vel = -math.sin(angle_rad)*half_lenth*rad*angle_vel-yOffset_vel
                yA_vel = height_vel-math.cos(angle_rad)*half_lenth*rad*angle_vel
                yB_vel = height_vel+math.cos(angle_rad)*half_lenth*rad*angle_vel
                distance_A = math.sqrt((xB-x1)**2+(yB-y1)**2)
                distance_C = math.sqrt((xA-x0)**2+(yA-y0)**2)
                A_velocity = abs(((xB-x1)*xB_vel+(yB-y1)*yB_vel)/distance_A)
                C_velocity = abs(((xA-x0)*xA_vel+(yA-y0)*yA_vel)/distance_C)
                B_velocity = A_velocity
                D_velocity = C_velocity
                return max(A_velocity,B_velocity,C_velocity,D_velocity)
            else:
                return abs(height_vel)
        else:
            raise ValueError("BaseHight1和BaseHight2参数错误")
    height_profile = build_profile(height_start,height_target,height_velocity,height_acceleration,height_deceleration)
    if moveWhat == 1:
        angle_profile = build_profile(arg_x_start,arg_x_target,arg_x_velocity,arg_x_acceleration,arg_x_deceleration)
        angle_acceleration = arg_x_acceleration
        angle_deceleration = arg_x_deceleration
    elif moveWhat == 2:
        angle_profile = build_profile(arg_y_start,arg_y_target,arg_y_velocity,arg_y_acceleration,arg_y_deceleration)
        angle_acceleration = arg_y_acceleration
        angle_deceleration = arg_y_deceleration
    else:
        angle_profile = (0,0,0,0,0,0,0,0)
        angle_acceleration = 1.0
        angle_deceleration = 1.0
    total_time = max(height_profile[7],angle_profile[7])
    if total_time == 0:
        return 0.0
    max_velocity = 0.0
    t = 0.0
    while t <= total_time:
        height,height_vel = calc_pos_vel(height_profile,t,height_acceleration,height_deceleration)
        if moveWhat == 1:
            arg_x,arg_x_vel = calc_pos_vel(angle_profile,t,arg_x_acceleration,arg_x_deceleration)
            arg_y = arg_y_start
            arg_y_vel = 0.0
        elif moveWhat == 2:
            arg_y,arg_y_vel = calc_pos_vel(angle_profile,t,arg_y_acceleration,arg_y_deceleration)
            arg_x = arg_x_start
            arg_x_vel = 0.0
        else:
            arg_x = arg_x_start
            arg_y = arg_y_start
            arg_x_vel = 0.0
            arg_y_vel = 0.0
        motor_velocity = calc_motor_velocity(height,arg_x,arg_y,height_vel,arg_x_vel,arg_y_vel)
        if motor_velocity > max_velocity:
            max_velocity = motor_velocity
        t = t+0.1
    key_times = [height_profile[4],height_profile[4]+height_profile[5],height_profile[7],angle_profile[4],angle_profile[4]+angle_profile[5],angle_profile[7],total_time]
    for t in key_times:
        if t >= 0 and t <= total_time:
            height,height_vel = calc_pos_vel(height_profile,t,height_acceleration,height_deceleration)
            if moveWhat == 1:
                arg_x,arg_x_vel = calc_pos_vel(angle_profile,t,arg_x_acceleration,arg_x_deceleration)
                arg_y = arg_y_start
                arg_y_vel = 0.0
            elif moveWhat == 2:
                arg_y,arg_y_vel = calc_pos_vel(angle_profile,t,arg_y_acceleration,arg_y_deceleration)
                arg_x = arg_x_start
                arg_x_vel = 0.0
            else:
                arg_x = arg_x_start
                arg_y = arg_y_start
                arg_x_vel = 0.0
                arg_y_vel = 0.0
            motor_velocity = calc_motor_velocity(height,arg_x,arg_y,height_vel,arg_x_vel,arg_y_vel)
            if motor_velocity > max_velocity:
                max_velocity = motor_velocity
    return max_velocity
##########################多点整段最大速度求解函数#########################
    ##输入 当前高度目标高度 当前X角度目标X角度 当前Y角度目标Y角度 三虚轴速度加减速度 多点模型参数
def duodian_velocity_model(height_start,height_target,arg_x_start,arg_x_target,arg_y_start,arg_y_target,height_velocity,height_acceleration,height_deceleration,arg_x_velocity,arg_x_acceleration,arg_x_deceleration,arg_y_velocity,arg_y_acceleration,arg_y_deceleration,point_init_pos,Baseheight1,Baseheight2,maxheight,betainit):
    def build_profile(p0,pf,velocity,acceleration,deceleration):
        distance = abs(pf-p0)
        if distance == 0:
            return p0,pf,0,0,0,0,0,0
        if velocity <= 0 or acceleration <= 0 or deceleration <= 0:
            raise ValueError("速度、加速度、减速度必须大于0")
        direction = 1.0 if pf > p0 else -1.0
        s_acc = velocity**2/(2.0*acceleration)
        s_dec = velocity**2/(2.0*deceleration)
        if distance >= s_acc+s_dec:
            v_peak = velocity
            t1 = v_peak/acceleration
            t2 = (distance-s_acc-s_dec)/v_peak
            t3 = v_peak/deceleration
        else:
            v_peak = math.sqrt(2.0*distance*acceleration*deceleration/(acceleration+deceleration))
            t1 = v_peak/acceleration
            t2 = 0.0
            t3 = v_peak/deceleration
        return p0,pf,direction,v_peak,t1,t2,t3,t1+t2+t3

    def calc_pos(profile,t,acceleration,deceleration):
        p0,pf,direction,v_peak,t1,t2,t3,total_time = profile
        if direction == 0:
            return p0
        if t <= 0:
            return p0
        if t >= total_time:
            return pf
        if t <= t1:
            s = 0.5*acceleration*t**2
        elif t <= t1+t2:
            dt = t-t1
            s1 = 0.5*acceleration*t1**2
            s = s1+v_peak*dt
        else:
            dt = t-t1-t2
            s1 = 0.5*acceleration*t1**2
            s2 = v_peak*t2
            s = s1+s2+v_peak*dt-0.5*deceleration*dt**2
        return p0+direction*s

    height_profile = build_profile(height_start,height_target,height_velocity,height_acceleration,height_deceleration)
    arg_x_profile = build_profile(arg_x_start,arg_x_target,arg_x_velocity,arg_x_acceleration,arg_x_deceleration)
    arg_y_profile = build_profile(arg_y_start,arg_y_target,arg_y_velocity,arg_y_acceleration,arg_y_deceleration)

    total_time = max(height_profile[7],arg_x_profile[7],arg_y_profile[7])

    if total_time == 0:
        return 0.0

    height = height_start
    arg_x = arg_x_start
    arg_y = arg_y_start

    last_length = duodian_forward_model(height,arg_x,arg_y,point_init_pos,Baseheight1,Baseheight2,maxheight,betainit)

    max_velocity = 0.0
    last_time = 0.0
    t = 0.1

    while last_time < total_time:
        if t > total_time:
            t = total_time

        height = calc_pos(height_profile,t,height_acceleration,height_deceleration)
        arg_x = calc_pos(arg_x_profile,t,arg_x_acceleration,arg_x_deceleration)
        arg_y = calc_pos(arg_y_profile,t,arg_y_acceleration,arg_y_deceleration)

        current_length = duodian_forward_model(height,arg_x,arg_y,point_init_pos,Baseheight1,Baseheight2,maxheight,betainit)

        dt = t-last_time

        for i in range(len(current_length)):
            motor_velocity = abs(current_length[i]-last_length[i])/dt

            if motor_velocity > max_velocity:
                max_velocity = motor_velocity

        last_length = current_length
        last_time = t
        t = t+0.1

    return max_velocity
##########################虚轴运动时间计算函数#########################
    ##输入 当前位置 目标位置 速度 加速度 减速度
def calc_motion_time(current_pos,target_pos,velocity,acceleration,deceleration):
    distance = abs(target_pos-current_pos)

    if distance == 0:
        return 0.0

    if velocity <= 0 or acceleration <= 0 or deceleration <= 0:
        raise ValueError("速度、加速度、减速度必须大于0")

    s_acc = velocity**2/(2.0*acceleration)
    s_dec = velocity**2/(2.0*deceleration)

    if distance >= s_acc+s_dec:
        t1 = velocity/acceleration
        t2 = (distance-s_acc-s_dec)/velocity
        t3 = velocity/deceleration
    else:
        v_peak = math.sqrt(2.0*distance*acceleration*deceleration/(acceleration+deceleration))
        t1 = v_peak/acceleration
        t2 = 0.0
        t3 = v_peak/deceleration

    return t1+t2+t3
##########################虚轴同步参数计算函数#########################
    ##输入 原速度 原加速度 原减速度 原运动时间 目标运动时间
def scale_motion_parameter(velocity,acceleration,deceleration,old_time,target_time):
    if old_time == 0:
        return 0.0,0.0,0.0
    if target_time <= old_time:
        return velocity,acceleration,deceleration
    k = target_time/old_time
    new_velocity = velocity/k
    new_acceleration = acceleration/(k*k)
    new_deceleration = deceleration/(k*k)

    return new_velocity,new_acceleration,new_deceleration
##########################虚轴运动时间计算函数#########################
    ##输入 当前位置 目标位置 速度 加速度 减速度
def calc_motion_time(current_pos,target_pos,velocity,acceleration,deceleration):
    distance = abs(target_pos-current_pos)

    if distance == 0:
        return 0.0

    if velocity <= 0 or acceleration <= 0 or deceleration <= 0:
        raise ValueError("速度、加速度、减速度必须大于0")

    s_acc = velocity**2/(2.0*acceleration)
    s_dec = velocity**2/(2.0*deceleration)

    if distance >= s_acc+s_dec:
        t1 = velocity/acceleration
        t2 = (distance-s_acc-s_dec)/velocity
        t3 = velocity/deceleration
    else:
        v_peak = math.sqrt(2.0*distance*acceleration*deceleration/(acceleration+deceleration))
        t1 = v_peak/acceleration
        t2 = 0.0
        t3 = v_peak/deceleration

    total_time = t1+t2+t3

    return total_time
##########################虚轴运动参数缩放函数#########################
    ##输入 原速度 原加速度 原减速度 原运动时间 目标运动时间
def scale_motion_parameter(velocity,acceleration,deceleration,old_time,target_time):
    if old_time == 0:
        return velocity,acceleration,deceleration

    if target_time < old_time:
        raise ValueError("目标时间不能小于原运动时间")

    if target_time == old_time:
        return velocity,acceleration,deceleration

    k = target_time/old_time

    new_velocity = velocity/k
    new_acceleration = acceleration/(k*k)
    new_deceleration = deceleration/(k*k)

    return new_velocity,new_acceleration,new_deceleration
##########################上位机JSON参数解析函数#########################
def parse_YXZ_call():
    with open("YXZ_call.json","r",encoding="utf-8") as f:
        data = json.load(f)

    action_id = data["action_id"]
    model_count = data["model_count"]
    model_list = data["models"]

    if len(model_list) != model_count:
        raise ValueError("model_count与实际模型数量不一致")

    models = {}

    for model in model_list:
        index = model["index"]
        model_type = model["model_type"]

        if index in models:
            raise ValueError(f"模型index重复：{index}")

        # ====================公共参数====================
        models[index] = {
            "index":index,
            "model_type":model_type,

            "current_HPY":model["current_HPY"].copy(),
            "target_HPY":model["target_HPY"].copy(),

            "velocity_original":model["velocity"].copy(),
            "acceleration_original":model["acceleration"].copy(),
            "deceleration_original":model["deceleration"].copy(),

            "velocity_work":model["velocity"].copy(),
            "acceleration_work":model["acceleration"].copy(),
            "deceleration_work":model["deceleration"].copy(),

            "velocity_final":model["velocity"].copy(),
            "acceleration_final":model["acceleration"].copy(),
            "deceleration_final":model["deceleration"].copy(),

            "max_motor_velocity":model["max_motor_velocity"],

            "axis_time":[0.0,0.0,0.0],
            "model_time":0.0,
            "max_velocity":0.0,
            "safe_time":0.0,

            "model_params":{}
        }

        # ====================单点参数====================
        if model_type == 1:
            models[index]["model_params"] = {
                "motor_num":model["motor_num"]
            }

        # ====================两点参数====================
        elif model_type == 2:
            models[index]["model_params"] = {
                "BaseHight1":model["BaseHight1"],
                "BaseHight2":model["BaseHight2"],
                "lLenth_inside":model["lLenth_inside"],
                "maxheight":model["maxheight"]
            }

        # ====================四点参数====================
        elif model_type == 4:
            models[index]["model_params"] = {
                "BaseHight1":model["BaseHight1"],
                "BaseHight2":model["BaseHight2"],
                "lLenth_inside":model["lLenth_inside"],
                "wLenth_inside":model["wLenth_inside"],
                "maxheight":model["maxheight"],
                "moveWhat":model["moveWhat"]
            }

        # ====================多点参数====================
        elif model_type == 8:
            models[index]["model_params"] = {
                "Baseheight1":model["Baseheight1"],
                "Baseheight2":model["Baseheight2"],
                "maxheight":model["maxheight"],
                "betainit":model["betainit"],
                "point_init_pos":copy.deepcopy(model["point_init_pos"])
            }

        else:
            raise ValueError(f"未知模型类型：{model_type}")

    return action_id,model_count,models
##########################模型有效虚轴判断函数#########################
def get_active_axes(model):
    model_type = model["model_type"]

    if model_type == 1:
        return [0]                  # 单点 H

    elif model_type == 2:
        return [0,1]                # 两点 H、P

    elif model_type == 4:
        moveWhat = model["model_params"]["moveWhat"]

        if moveWhat == 1:
            return [0,1]            # 四点 H、P
        elif moveWhat == 2:
            return [0,2]            # 四点 H、Y
        else:
            return [0]              # 只有高度

    elif model_type == 8:
        return [0,1,2]              # 多点 H、P、Y

    else:
        raise ValueError(f"未知模型类型：{model_type}")


##########################模型最大实轴速度计算函数#########################
def calc_model_max_velocity(model):
    model_type = model["model_type"]

    current = model["current_HPY"]
    target = model["target_HPY"]

    velocity = model["velocity_work"]
    acceleration = model["acceleration_work"]
    deceleration = model["deceleration_work"]

    params = model["model_params"]

    if model_type == 1:
        return dandian_velocity_model(
            current[0],target[0],
            velocity[0],acceleration[0],deceleration[0]
        )

    elif model_type == 2:
        return liangdian_velocity_model(
            current[0],target[0],
            current[1],target[1],
            velocity[0],acceleration[0],deceleration[0],
            velocity[1],acceleration[1],deceleration[1],
            params["BaseHight1"],
            params["BaseHight2"],
            params["lLenth_inside"],
            params["maxheight"]
        )

    elif model_type == 4:
        return sidian_velocity_model(
            current[0],target[0],
            current[1],target[1],
            current[2],target[2],
            velocity[0],acceleration[0],deceleration[0],
            velocity[1],acceleration[1],deceleration[1],
            velocity[2],acceleration[2],deceleration[2],
            params["BaseHight1"],
            params["BaseHight2"],
            params["lLenth_inside"],
            params["wLenth_inside"],
            params["maxheight"],
            params["moveWhat"]
        )

    elif model_type == 8:
        return duodian_velocity_model(
            current[0],target[0],
            current[1],target[1],
            current[2],target[2],
            velocity[0],acceleration[0],deceleration[0],
            velocity[1],acceleration[1],deceleration[1],
            velocity[2],acceleration[2],deceleration[2],
            params["point_init_pos"],
            params["Baseheight1"],
            params["Baseheight2"],
            params["maxheight"],
            params["betainit"]
        )


##########################整体调速主流程#########################
def main_speed_control(models):

    # ====================第一遍：模型内部同步 + 实轴限速====================
    for index in models:
        model = models[index]

        current = model["current_HPY"]
        target = model["target_HPY"]

        velocity = model["velocity_work"]
        acceleration = model["acceleration_work"]
        deceleration = model["deceleration_work"]

        active_axes = get_active_axes(model)

        # ----------计算每个虚轴原始运动时间----------
        axis_time = [0.0,0.0,0.0]

        for axis in active_axes:
            axis_time[axis] = calc_motion_time(
                current[axis],
                target[axis],
                velocity[axis],
                acceleration[axis],
                deceleration[axis]
            )

        model["axis_time"] = axis_time

        # ----------模型内部取最长时间----------
        model_time = max(axis_time)
        model["model_time"] = model_time

        # ----------较快虚轴拉长到model_time，实现内部同步----------
        if model_time > 0:
            for axis in active_axes:

                if axis_time[axis] > 0 and axis_time[axis] < model_time:

                    velocity[axis],acceleration[axis],deceleration[axis] = scale_motion_parameter(
                        velocity[axis],
                        acceleration[axis],
                        deceleration[axis],
                        axis_time[axis],
                        model_time
                    )

        # ----------计算同步后的最大实轴速度----------
        max_velocity = calc_model_max_velocity(model)
        model["max_velocity"] = max_velocity

        max_motor_velocity = model["max_motor_velocity"]

        if max_motor_velocity <= 0:
            raise ValueError(f"模型{index}最大允许实轴速度必须大于0")

        # ----------判断实轴是否超速----------
        if max_velocity > max_motor_velocity and model_time > 0:

            # 整个模型需要放慢的比例
            k = max_velocity/max_motor_velocity*1.01

            safe_time = model_time*k

            # H/P/Y中所有真正运动的虚轴统一放慢
            for axis in active_axes:

                if axis_time[axis] > 0:

                    velocity[axis],acceleration[axis],deceleration[axis] = scale_motion_parameter(
                        velocity[axis],
                        acceleration[axis],
                        deceleration[axis],
                        model_time,
                        safe_time
                    )

            model["safe_time"] = safe_time

        else:
            model["safe_time"] = model_time


    # ====================找到所有模型的最大安全时间====================
    if len(models) == 0:
        return models,0.0

    Tglobal = max(model["safe_time"] for model in models.values())


    # ====================第二遍：所有模型全局同步====================
    for index in models:
        model = models[index]

        safe_time = model["safe_time"]
        active_axes = get_active_axes(model)

        velocity = model["velocity_work"]
        acceleration = model["acceleration_work"]
        deceleration = model["deceleration_work"]

        # 当前模型比全局时间短，则整个模型再次统一放慢
        if safe_time > 0 and safe_time < Tglobal:

            for axis in active_axes:

                if model["axis_time"][axis] > 0:

                    velocity[axis],acceleration[axis],deceleration[axis] = scale_motion_parameter(
                        velocity[axis],
                        acceleration[axis],
                        deceleration[axis],
                        safe_time,
                        Tglobal
                    )

        # 保存最终输出参数
        model["velocity_final"] = velocity.copy()
        model["acceleration_final"] = acceleration.copy()
        model["deceleration_final"] = deceleration.copy()
        model["final_time"] = Tglobal

    return models,Tglobal
##########################最终参数自动校验函数#########################
def validate_final_velocity(models):
    for index in models:
        model = models[index]

        # 临时使用最终V/A/D重新计算最大实轴速度
        check_model = model.copy()
        check_model["velocity_work"] = model["velocity_final"].copy()
        check_model["acceleration_work"] = model["acceleration_final"].copy()
        check_model["deceleration_work"] = model["deceleration_final"].copy()

        final_max_velocity = calc_model_max_velocity(check_model)

        model["final_max_velocity"] = final_max_velocity

        if final_max_velocity <= model["max_motor_velocity"]+1e-6:
            model["velocity_check"] = True
        else:
            model["velocity_check"] = False
            raise ValueError(
                f"模型{index}最终速度校验失败："
                f"最大实轴速度={final_max_velocity}, "
                f"允许速度={model['max_motor_velocity']}"
            )

    return True
##########################最终结果整理函数#########################
def build_output_data(action_id,model_count,models,Tglobal):
    output_data = {
        "action_id":action_id,
        "model_count":model_count,
        "total_time":Tglobal,
        "models":[]
    }

    for index in models:
        model = models[index]

        output_data["models"].append({
            "index":index,
            "model_type":model["model_type"],
            "time":Tglobal,

            "H":{
                "velocity":model["velocity_final"][0],
                "acceleration":model["acceleration_final"][0],
                "deceleration":model["deceleration_final"][0]
            },

            "P":{
                "velocity":model["velocity_final"][1],
                "acceleration":model["acceleration_final"][1],
                "deceleration":model["deceleration_final"][1]
            },

            "Y":{
                "velocity":model["velocity_final"][2],
                "acceleration":model["acceleration_final"][2],
                "deceleration":model["deceleration_final"][2]
            },

            "final_max_velocity":model["final_max_velocity"],
            "max_motor_velocity":model["max_motor_velocity"],
            "velocity_check":model["velocity_check"]
        })
    return output_data

########################################算法步骤##########################################
"""
##########################整体调速流程##########################

每个虚轴计算原始运动时间
        ↓
模型内部取最长时间
        ↓
较快虚轴降低V/A/D
实现模型内部同步到达
        ↓
计算同步后的最大实轴速度
        ↓
是否超过实轴最大速度
   ↓否             ↓是
参数不变       整个模型统一降低V/A/D
   ↓             ↓
得到每个模型安全时间
        ↓
所有模型取最大安全时间
        ↓
其余模型统一降低V/A/D
        ↓
所有模型、所有虚轴同步到达

############################################################
""" 

##########################主程序#########################
action_id,model_count,models = parse_YXZ_call()

# 1. 调速计算
models,Tglobal = main_speed_control(models)

# 2. 最终速度重新校验
validate_final_velocity(models)

# 3. 整理最终结果
output_data = build_output_data(
    action_id,
    model_count,
    models,
    Tglobal
)

# 4. 输出最终结果
print(json.dumps(output_data,indent=4,ensure_ascii=False))