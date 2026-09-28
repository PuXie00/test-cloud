#######################就近接入与Base动作调速范围########################
import math
import copy
import json
import re
from pathlib import Path

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
###############################################################################
# 二、保留的历史速度工具：下面四个速度函数不被当前两个业务入口调用。
# 保留原实现，供旧代码独立调用；阅读当前主流程时可以跳过本组，不必把它们当成新算法。
###############################################################################
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


###############################################################################
# 三、就近计算函数与公共辅助函数：主逻辑用if trajectory_run选择对应分支。
# 强制分支负责搜索曲线时间；非强制分支负责选共同关键帧，再调用Move同步及限速计算。
###############################################################################
##########################最近位置算法公共参数#########################
# 租赁2.0的曲线时间单位：1个PLC时间单位=0.1秒=100ms。
CURVE_TICK_FRAME = 100.0
# 三个虚拟轴的固定顺序，索引0/1/2分别对应H/P/Y。
AXIS_NAMES = ("H", "P", "Y")


##########################JSON输出格式#########################
# 保留对象层级缩进，只把坐标、候选帧等简单数组压缩为单行。
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


##########################内部计算：强制轨迹就近位置#########################
# 强制轨迹由PLC时间主轴运行：输入当前位置和曲线数据，在统一时间轴上寻找可直接接入的位置。
# 返回值raw_result中包含PosSet、_T、曲线速度以及各模型的详细计算数据。
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
    active_axes_by_model可传{模型号: ["H", "P", "Y"]}，不传时按model_type推导。
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
##########################非强制轨迹候选帧和位置计算#########################
# 第一步只生成按运行方向排列的共同候选帧及各模型位置，不在这里计算V/A/D或判断电机超速。
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


##########################兼容当前非强制完整计算#########################
# 暂时保留原函数名：第一步生成候选，第二步逐个调用同步Move和实际电机速度检查。
# 后续重写第二步主调用时，可直接复用calculate_non_forced_candidate_positions的结果。
def calculate_non_forced_nearest_position(inputs):
    candidate_result = calculate_non_forced_candidate_positions(inputs)
    rejected = []
    candidates = candidate_result["Candidates"]
    # 旧完整入口暂时保持“停止帧之后再接入”的历史行为；新主流程直接使用第一步结果。
    if (
        candidate_result["StartMode"] == "nearest"
        and candidate_result["stopped_time_ms"] is not None
        and len(candidates) > 1
        and abs(
            candidates[0]["TargetFrame_ms"]-candidate_result["stopped_time_ms"]
        ) <= 1.0e-9
    ):
        candidates = candidates[1:]
    for candidate_position in candidates:
        candidate = {
            "stopped_time_ms": candidate_result["stopped_time_ms"],
            "SearchOriginFrame_ms": candidate_result["SearchOriginFrame_ms"],
            "TargetFrame_ms": candidate_position["TargetFrame_ms"],
            "StartMode": candidate_result["StartMode"],
            "PosSet": candidate_position["PosSet"],
        }
        try:
            result = calculate_non_forced_motion(candidate, inputs)
        except (ValueError, ArithmeticError) as exc:
            rejected.append({
                "TargetFrame_ms": candidate_position["TargetFrame_ms"],
                "reason": str(exc),
            })
            continue
        if rejected:
            result["SkippedFrames"] = rejected
        return result
    reasons = "; ".join(f"{item['TargetFrame_ms']}ms: {item['reason']}" for item in rejected)
    raise ValueError(f"当前方向没有可行的共同接入帧（未自动回退或越界）：{reasons}")
##########################公共辅助：读取并检查JSON参数#########################
# 从JSON读取当前位置、曲线、运行方式以及默认/最大运动参数，并完成格式检查。
def load_nearest_position_inputs(file_name="YXZ.JSON"):
    """严格从JSON读取CalStartTime全部输入；缺字段时直接报错。"""
    with open(file_name, "r", encoding="utf-8") as file:
        data = json.load(file)

    current_items = data.get("current_model_positions")
    config = data.get("cal_start_time_config")
    command = data.get("command")
    if not isinstance(current_items, list) or not current_items:
        raise ValueError("JSON缺少current_model_positions或内容为空")
    if not isinstance(config, dict):
        raise ValueError("JSON缺少cal_start_time_config")
    if not isinstance(command, dict):
        raise ValueError("JSON缺少command")

    required_command = (
        "action_name", "reverse", "loop_once",
        "use_specified_time", "specified_time_ms", "trajectory_run",
    )
    missing_command = [name for name in required_command if name not in command]
    if missing_command:
        raise ValueError(f"command缺少字段：{missing_command}")
    action_name = command["action_name"]
    if action_name not in ("base_action", "online_action"):
        raise ValueError("command.action_name只能是base_action或online_action")
    if type(command["reverse"]) is not bool:
        raise ValueError("command.reverse必须是bool")
    if type(command["loop_once"]) is not bool:
        raise ValueError("command.loop_once必须是bool")
    if type(command["use_specified_time"]) is not bool:
        raise ValueError("command.use_specified_time必须是bool")
    if type(command["trajectory_run"]) is not bool:
        raise ValueError("command.trajectory_run必须是bool")
    nearest_start = command.get("nearest_start", True)
    if type(nearest_start) is not bool:
        raise ValueError("command.nearest_start必须是bool")
    specified_time_ms = command["specified_time_ms"]
    if isinstance(specified_time_ms, bool) or not isinstance(specified_time_ms, int) or specified_time_ms < 0:
        raise ValueError("command.specified_time_ms必须是非负整数毫秒")
    # 不传或传null表示由当前位置搜索起始帧；0是有效停止帧，不能当成未传。
    stopped_time_ms = command.get("stopped_time_ms")
    if stopped_time_ms is not None and (
        isinstance(stopped_time_ms, bool)
        or not isinstance(stopped_time_ms, int)
        or stopped_time_ms < 0
    ):
        raise ValueError("command.stopped_time_ms必须是非负整数毫秒或null")

    if config.get("time_unit") != "ms":
        raise ValueError("cal_start_time_config.time_unit必须是ms")
    for field_name in ("coarse_step_ms", "fine_step_ms", "models"):
        if field_name not in config:
            raise ValueError(f"cal_start_time_config缺少{field_name}")
    coarse_step = float(config["coarse_step_ms"])
    fine_step = float(config["fine_step_ms"])
    if coarse_step != 100.0 or fine_step != 10.0:
        raise ValueError("要与PLC等价，coarse_step_ms必须为100且fine_step_ms必须为10")

    config_models = config["models"]
    if not isinstance(config_models, list) or not config_models:
        raise ValueError("cal_start_time_config.models不能为空")
    default_velocities = {}
    default_accelerations = {}
    default_decelerations = {}
    max_velocities = {}
    max_accelerations = {}
    max_decelerations = {}
    active_axes_by_model = {}
    valid_axes = {"H", "P", "Y"}
    for item in config_models:
        required_fields = (
            "model_id", "active_axes",
            "default_velocity_HPY", "default_acceleration_HPY", "default_deceleration_HPY",
            "max_velocity_HPY", "max_acceleration_HPY", "max_deceleration_HPY",
        )
        missing = [name for name in required_fields if name not in item]
        if missing:
            raise ValueError(f"cal_start_time_config模型配置缺少字段：{missing}")
        model_id = int(item["model_id"])
        if model_id in default_velocities:
            raise ValueError(f"cal_start_time_config中的模型{model_id}重复")
        active_axes = item["active_axes"]
        if not isinstance(active_axes, list) or not active_axes:
            raise ValueError(f"模型{model_id}的active_axes不能为空")
        active_axes = [str(axis).upper() for axis in active_axes]
        if len(set(active_axes)) != len(active_axes) or any(axis not in valid_axes for axis in active_axes):
            raise ValueError(f"模型{model_id}的active_axes只能包含不重复的H/P/Y")
        active_axes_by_model[model_id] = active_axes
        for field_name, destination in (
            ("default_velocity_HPY", default_velocities),
            ("default_acceleration_HPY", default_accelerations),
            ("default_deceleration_HPY", default_decelerations),
            ("max_velocity_HPY", max_velocities),
            ("max_acceleration_HPY", max_accelerations),
            ("max_deceleration_HPY", max_decelerations),
        ):
            values = item[field_name]
            if not isinstance(values, list) or len(values) != 3:
                raise ValueError(f"模型{model_id}的{field_name}必须有H/P/Y三项")
            values = [float(value) for value in values]
            if not all(math.isfinite(value) and value >= 0.0 for value in values):
                raise ValueError(f"模型{model_id}的{field_name}必须是有限非负数")
            destination[model_id] = values

    curve_action = data.get(action_name)
    if not isinstance(curve_action, dict):
        raise ValueError(f"JSON缺少{action_name}")

    current_positions = {}
    for item in current_items:
        model_id = int(item["model_id"])
        values = item.get("current_HPY")
        if model_id in current_positions:
            raise ValueError(f"当前位置中的模型{model_id}重复")
        if not isinstance(values, list) or len(values) != 3:
            raise ValueError(f"模型{model_id}的current_HPY必须有H/P/Y三项")
        values = [float(value) for value in values]
        if not all(math.isfinite(value) for value in values):
            raise ValueError(f"模型{model_id}的current_HPY存在无效数值")
        current_positions[model_id] = values

    curve_models = curve_action.get("models")
    if not isinstance(curve_models, list) or not curve_models:
        raise ValueError(f"{action_name}.models不能为空")
    if int(curve_action.get("model_count", len(curve_models))) != len(curve_models):
        raise ValueError(f"{action_name}.model_count与models数量不一致")
    seen = set()
    for model in curve_models:
        model_id = int(model["index"])
        if model_id in seen:
            raise ValueError(f"{action_name}中的模型{model_id}重复")
        seen.add(model_id)
        if model_id not in current_positions or model_id not in default_velocities:
            raise ValueError(f"模型{model_id}缺少当前位置或运动参数")
    return {
        "current_positions": current_positions,
        "default_velocities": default_velocities,
        "default_accelerations": default_accelerations,
        "default_decelerations": default_decelerations,
        "max_velocities": max_velocities,
        "max_accelerations": max_accelerations,
        "max_decelerations": max_decelerations,
        "trajectory_run": command["trajectory_run"],
        "nearest_start": nearest_start,
        "active_axes_by_model": active_axes_by_model,
        "curve_action": curve_action,
        "direction": -1 if command["reverse"] else 1,
        "loop_once": command["loop_once"],
        "use_specified_time": command["use_specified_time"],
        "specified_time_ms": specified_time_ms,
        "stopped_time_ms": stopped_time_ms,
        "coarse_step": coarse_step,
        "fine_step": fine_step,
    }
##########################公共辅助：单轴最短运动时间#########################
# 根据位移和速度/加速度/减速度上限，计算三角形或梯形曲线的峰值速度与总时间。
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


##########################强制轨迹时间主轴调速时间计算#########################
# PLC内部通过时间主轴执行调速和换向；上位机只预览调速后的剩余时间和完整一轮时间。
def calculate_forced_speed_adjustment_time(inputs, current_frame_ms, requested_factor, state=None):
    """返回强制轨迹按新倍率运行时的剩余时间和完整动作时间。

    requested_factor使用倍数表示：1.0为100%，1.2为120%。方向直接使用
    command.reverse解析后的inputs["direction"]。不输出虚轴V/A/D，也不检查超速。

    state可提供PLC实际时间主轴状态：current_master_velocity_ms_per_s为带符号速度，
    master_acceleration_ms_per_s2、master_deceleration_ms_per_s2为本次PLC实际采用的
    加减速度（getAdjSpeedAcc的结果；PLC内部100ms单位需乘100后传入）。
    循环换向还需要reversal_allowed，或dir_switching和plc_loop_count；暂停时需
    current_direction。pending_reversal=True表示还在等待PLC允许换向。
    缺少必要状态时保留匀速估算，但明确返回EstimateOnly和MissingStateFields。
    完整状态按主轴分段匀加/减速预测，不含通信/扫描延迟或位置跟随误差。
    循环输入允许累计主轴帧；不同模型周期不一致时分别报告，不捏造共同循环时间。
    """
    if not inputs["trajectory_run"]:
        raise ValueError("强制轨迹时间计算只用于trajectory_run=true")

    requested_factor = float(requested_factor)
    current_frame_ms = float(current_frame_ms)
    if not math.isfinite(requested_factor) or requested_factor <= 0.0:
        raise ValueError("强制轨迹调速倍率必须是大于0的有限数值")
    if not math.isfinite(current_frame_ms):
        raise ValueError("强制轨迹当前时间帧必须是有限数值")

    models = inputs["curve_action"].get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("强制轨迹动作没有models")
    ranges = {}
    for model in models:
        segments = model.get("segments")
        if not segments:
            raise ValueError("强制轨迹模型没有segments")
        first = float(segments[0]["start_frame"])
        last = float(segments[-1]["end_frame"])
        if not math.isfinite(first) or not math.isfinite(last) or last <= first:
            raise ValueError("强制轨迹模型时间范围无效")
        model_id = int(model["index"])
        if model_id in ranges:
            raise ValueError("强制轨迹模型编号重复")
        ranges[model_id] = (first, last)
    global_start = min(first for first, _ in ranges.values())
    global_end = max(last for _, last in ranges.values())
    if global_end <= global_start:
        raise ValueError("强制轨迹时间主轴范围无效")
    loop_once = inputs["loop_once"]
    if type(loop_once) is not bool:
        raise ValueError("loop_once必须是bool")
    # XML的getPosAllLoop只按Timeline首末节点循环，没有逐模型loop或循环子区间参数。
    # JSON中出现不一致的循环配置时明确报告不支持，不把该配置误算成PLC已执行。
    unsupported_loop_metadata = {}
    if not loop_once:
        for model in models:
            model_id = int(model["index"])
            first, last = ranges[model_id]
            conflicts = []
            if model.get("loop") is not None:
                if type(model["loop"]) is not bool:
                    raise ValueError("model.loop必须是bool")
                if not model["loop"]:
                    conflicts.append("当前PLC以统一loopCount循环，未提供单模型关闭循环的配置")
            for name, expected in (("loop_start_frame", first), ("loop_end_frame", last)):
                if model.get(name) is None:
                    continue
                value = float(model[name])
                if not math.isfinite(value):
                    raise ValueError(f"{name}必须是有限数值")
                if abs(value-expected) > 1.0e-9:
                    conflicts.append(f"{name}={value}与PLC Timeline边界{expected}不一致")
            if conflicts:
                unsupported_loop_metadata[model_id] = conflicts
    if loop_once and (current_frame_ms < global_start-1.0e-9 or current_frame_ms > global_end+1.0e-9):
        raise ValueError(
            f"强制轨迹当前时间帧必须位于{global_start}到{global_end}毫秒之间"
        )
    if loop_once:
        current_frame_ms = min(global_end, max(global_start, current_frame_ms))

    direction = inputs["direction"]
    if direction not in (-1, 1):
        raise ValueError("direction只能是1或-1")
    if state is None:
        state = {}
    if not isinstance(state, dict):
        raise ValueError("强制轨迹state必须是字典")

    # 到位后主轴Move的终点是远端MaxTime；动作边界处不额外人为添加减速到零。
    # 求主轴首次沿目标方向到达指定距离的时间，保留调速前的实际速度。
    def master_travel_time(distance, initial_speed, target_speed, acceleration, deceleration):
        if distance <= 1.0e-9:
            return 0.0
        elapsed = 0.0
        covered = 0.0
        velocity = initial_speed
        phases = []
        if velocity < 0.0:
            phases.append((-velocity/deceleration, deceleration))
            phases.append((target_speed/acceleration, acceleration))
        elif velocity > target_speed:
            phases.append(((velocity-target_speed)/deceleration, -deceleration))
        else:
            phases.append(((target_speed-velocity)/acceleration, acceleration))
        for duration, signed_acc in phases:
            end_velocity = velocity+signed_acc*duration
            phase_distance = (velocity+end_velocity)*duration/2.0
            # 反向制动阶段位移为负，只在后续正向阶段求目标交点。
            if velocity >= 0.0 and covered+phase_distance >= distance:
                remaining = distance-covered
                root = math.sqrt(max(0.0, velocity*velocity+2.0*signed_acc*remaining))
                return elapsed+2.0*remaining/(velocity+root)
            covered += phase_distance
            elapsed += duration
            velocity = max(0.0, end_velocity)
        return elapsed+(distance-covered)/target_speed

    required_state = (
        "current_master_velocity_ms_per_s",
        "master_acceleration_ms_per_s2",
        "master_deceleration_ms_per_s2",
    )
    missing = [name for name in required_state if state.get(name) is None]
    actual = {}
    for name in required_state:
        if state.get(name) is None:
            continue
        value = float(state[name])
        if not math.isfinite(value) or (name != required_state[0] and value <= 0.0):
            raise ValueError(f"{name}必须是有限数值，主轴加减速度必须大于0")
        actual[name] = value
    reasons = []
    if unsupported_loop_metadata:
        reasons.append("JSON循环设置与当前PLC工程不兼容；ModelTimes仅为PLC整段Timeline循环估算")
    for name in ("pending_reversal", "reversal_allowed", "dir_switching"):
        if state.get(name) is not None and type(state[name]) is not bool:
            raise ValueError(f"{name}必须是bool")
    if state.get("current_direction") is not None and state["current_direction"] not in (-1, 1):
        raise ValueError("current_direction只能是1或-1")
    if state.get("plc_loop_count") is not None and (
        type(state["plc_loop_count"]) is not int or state["plc_loop_count"] < -1 or state["plc_loop_count"] == 0
    ):
        raise ValueError("plc_loop_count必须是PLC有效正整数循环次数或-1（本轮后停止）")

    velocity = actual.get(required_state[0])
    if not loop_once and velocity is not None:
        current_direction = (1 if velocity > 0.0 else -1) if velocity != 0.0 else state.get("current_direction")
        if current_direction is None:
            missing.append("current_direction")
        elif current_direction != direction:
            allowed = state.get("reversal_allowed")
            if allowed is None and state.get("dir_switching") is not None and state.get("plc_loop_count") is not None:
                allowed = state["dir_switching"] or state["plc_loop_count"] == 1
            if allowed is None:
                missing.append("reversal_allowed")
            elif not allowed:
                reasons.append("PLC尚未允许循环换向，释放时刻未知")
    if state.get("pending_reversal", False):
        reasons.append("PLC换向请求尚在等待，释放时刻未知")
    if missing:
        reasons.append("缺少实际主轴状态，仅按请求倍率估算匀速时间")
    estimate_only = bool(missing or reasons)
    speed = 1000.0*requested_factor
    if not math.isfinite(speed):
        raise ValueError("强制轨迹倍率换算后的主轴速度超出数值范围")

    # 每条Timeline有独立周期。累计帧正向取下一个右端点、反向取下一个左端点。
    # 刚好处于循环边界时报告下一完整周期，不把下一轮剩余时间误报为0。
    model_times = {}
    for model_id, (first, last) in ranges.items():
        period = last-first
        if loop_once:
            boundary = last if direction > 0 else first
            distance = max(0.0, direction*(boundary-current_frame_ms))
            phase = min(last, max(first, current_frame_ms))
        elif direction > 0:
            boundary = last if current_frame_ms < first else first+(math.floor((current_frame_ms-first)/period)+1)*period
            distance = boundary-current_frame_ms
            phase = first if current_frame_ms < first else first+(current_frame_ms-first) % period
        else:
            boundary = first if current_frame_ms > last else first+(math.ceil((current_frame_ms-first)/period)-1)*period
            distance = current_frame_ms-boundary
            phase = last if current_frame_ms > last else first+(current_frame_ms-first) % period
            if phase == first:
                phase = last
        steady_time = distance/speed
        predicted = steady_time if estimate_only else master_travel_time(
            distance, direction*velocity, speed,
            actual[required_state[1]], actual[required_state[2]],
        )
        next_cycle_time = None
        if not loop_once:
            # 调速斜坡可能跨过一个周期；下一轮耗时不能总是直接取period/新速度。
            next_cycle_time = period/speed if estimate_only else master_travel_time(
                distance+period, direction*velocity, speed,
                actual[required_state[1]], actual[required_state[2]],
            )-predicted
        model_times[model_id] = {
            "CycleFrame_ms": phase,
            "CycleBoundaryFrame_ms": boundary,
            "RemainingTime_s": predicted,
            "SteadySpeedRemainingTime_s": steady_time,
            "CompleteCycleTime_s": period/speed,
            "CompleteCycleTimeBasis": "steady_speed",
            "NextLoopTime_s": next_cycle_time,
        }

    common_cycle = len(set(ranges.values())) == 1
    remaining_time_s = max(value["RemainingTime_s"] for value in model_times.values())
    complete_action_time_s = (global_end-global_start)/speed
    if not loop_once and not common_cycle:
        reasons.append("各模型周期或起点不同，没有唯一的共同循环边界；请使用ModelTimes")
        remaining_time_s = None
        complete_action_time_s = None
    if unsupported_loop_metadata:
        remaining_time_s = None
        complete_action_time_s = None
    return {
        "Direction": direction,
        "Reverse": direction < 0,
        "CurrentFrame_ms": current_frame_ms,
        "RemainingTime_s": remaining_time_s,
        "CompleteActionTime_s": complete_action_time_s,
        "NextLoopTime_s": next(iter(model_times.values()))["NextLoopTime_s"] if not loop_once and common_cycle and not unsupported_loop_metadata else None,
        "EstimateOnly": estimate_only,
        "TimeBasis": "steady_speed_estimate" if estimate_only else "plc_master_acceleration_prediction",
        "CompleteActionTimeBasis": "steady_speed_full_span" if loop_once or common_cycle else "no_common_cycle",
        "RemainingTimeScope": "current_action" if loop_once else "next_cycle_boundary",
        "MissingStateFields": missing,
        "TimeNotes": reasons,
        "HasCommonCycle": common_cycle,
        "LoopMetadataCompatible": not unsupported_loop_metadata,
        "UnsupportedLoopMetadata": unsupported_loop_metadata,
        "PLCLoopBasis": "timeline_first_last_with_shared_loop_count",
        "ModelTimes": model_times,
    }


##########################内部计算：非强制Move同步及电机限速#########################
# 先按最大V/A/D计算并同步，再按整段实际电机速度的保守上界统一降速；不改接入位置。
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


##########################Move辅助：带实际初速度的一维运动规划#########################
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


##########################非强制轨迹在线调速与帧重排#########################
# 当前Segment以PLC实际位置和非零实际速度重新求解；后续完整Segment始终基于Base倍率缩放。
def calculate_non_forced_online_speed_adjustment(file_name="YXZ.JSON"):
    """基于真实Move重规划，返回公共发送时间表；不把不可能的运动伪装成成功。

    约定：末速为0、无jerk的梯形Move、不混合跨段。运行中实际初速度不乘倍率。
    当前移动轴求固定耗时解，后续零速段按k/k²同步；静止轴保持位置。
    Applied仅表示规划接受本次调速，不代表PLC已经执行；False时Models为空。
    上位机不能下发失败方案，也不能据此取消PLC保护。
    时间是该执行约定下的预测，不包含通讯、扫描及机械跟随误差。
    """
    with open(file_name, "r", encoding="utf-8") as file:
        data = json.load(file)
    command = data.get("command")
    online = data.get("non_forced_speed_adjustment")
    if not isinstance(command, dict) or not isinstance(online, dict):
        raise ValueError("JSON缺少command或non_forced_speed_adjustment")
    if command.get("trajectory_run") is not False:
        raise ValueError("非强制在线调速只用于trajectory_run=false")
    action = data.get(command.get("action_name", "base_action"))
    if not isinstance(action, dict) or not action.get("models"):
        raise ValueError("非强制在线调速缺少有效动作")
    current_factor = float(online.get("current_factor", 0.0))
    requested_factor = float(online.get("requested_factor", 0.0))
    click_base_frame = float(online.get("click_base_frame_ms", math.nan))
    click_online_frame = float(online.get("click_online_frame_ms", math.nan))
    elapsed_time = float(online.get("current_cycle_elapsed_s", click_online_frame/1000.0))
    frame_quantum = float(online.get("frame_rounding_ms", 1.0))
    direction = -1 if command.get("reverse") else 1
    if online.get("direction") is not None and online["direction"] != direction:
        raise ValueError("non_forced_speed_adjustment.direction与command.reverse不一致")
    loop_enabled = online.get("loop_enabled", not bool(command.get("loop_once", True)))
    if (not all(math.isfinite(x) for x in (
            current_factor, requested_factor, click_base_frame,
            click_online_frame, elapsed_time, frame_quantum))
            or min(current_factor, requested_factor, frame_quantum) <= 0
            or min(click_base_frame, click_online_frame, elapsed_time) < 0
            or type(loop_enabled) is not bool):
        raise ValueError("在线倍率、帧、已运行时间或循环标志无效")

    def hpy(values, name):
        """解析有限的三轴数据；不容许缺轴或NaN进入运动计算。"""
        if not isinstance(values, (list, tuple)) or len(values) != 3:
            raise ValueError(f"{name}必须包含H/P/Y三项")
        result = [float(x) for x in values]
        if not all(math.isfinite(x) for x in result):
            raise ValueError(f"{name}必须全部有限")
        return result

    models = {int(m["index"]): m for m in action["models"]}
    configs = data.get("cal_start_time_config", {}).get("models", [])
    states = online.get("model_states", [])
    limits = {int(m["model_id"]): m for m in configs}
    feedback = {int(m["model_id"]): m for m in states}
    if (len(models) != len(action["models"]) or len(feedback) != len(states)
            or len(limits) != len(configs) or set(feedback) != set(models)
            or not set(models).issubset(limits)):
        raise ValueError("模型、反馈和运动上限必须一一对应且ID不能重复")
    axes_by_model = {}
    for model_id, model in models.items():
        axes = [AXIS_NAMES.index(str(name).upper()) for name in limits[model_id]["active_axes"]]
        if len(set(axes)) != len(axes):
            raise ValueError(f"模型{model_id}活动轴重复")
        axes_by_model[model_id] = axes
        segments = model.get("segments", [])
        if not segments or len({s["segment_id"] for s in segments}) != len(segments):
            raise ValueError(f"模型{model_id}段为空或编号重复")
        previous = None
        for segment in segments:
            start, end = float(segment["start_frame"]), float(segment["end_frame"])
            begin = hpy(segment["start_HPY"], "段起点")
            finish = hpy(segment["target_HPY"], "段终点")
            if not math.isfinite(start) or not math.isfinite(end) or end <= start:
                raise ValueError(f"模型{model_id}段时间无效")
            if previous is not None:
                if start < float(previous["end_frame"]):
                    raise ValueError(f"模型{model_id}曲线段重叠或未排序")
                if any(abs(x-y) > 1.0e-5 for x, y in zip(begin, previous["target_HPY"])):
                    raise ValueError(f"模型{model_id}段间位置不连续，不能省略过渡Move")
            if any(abs(begin[i]-finish[i]) > 1.0e-5 for i in range(3) if i not in axes):
                raise ValueError(f"模型{model_id}非活动轴有位移")
            previous = segment
        for field in ("velocity", "acceleration", "deceleration"):
            if any(x < 0 for x in hpy(model[field], field)):
                raise ValueError(f"模型{model_id}Base参数不能为负")
        for field in ("max_velocity_HPY", "max_acceleration_HPY", "max_deceleration_HPY"):
            values = hpy(limits[model_id][field], field)
            if any(values[i] <= 0 for i in axes):
                raise ValueError(f"模型{model_id}活动轴上限必须大于0")
        feedback[model_id] = dict(feedback[model_id])
        feedback[model_id]["current_position_HPY"] = hpy(
            feedback[model_id].get("current_position_HPY"), "当前位置")
        feedback[model_id]["current_velocity_HPY"] = hpy(
            feedback[model_id].get("current_velocity_HPY"), "当前速度")

    global_start = min(float(m["segments"][0]["start_frame"]) for m in models.values())
    global_end = max(float(m["segments"][-1]["end_frame"]) for m in models.values())
    if not global_start <= click_base_frame <= global_end:
        raise ValueError("click_base_frame_ms必须是本轮Base时间；累计时间放在click_online_frame_ms")
    base_result = {
        "Direction": direction, "Reverse": direction < 0,
        "CurrentFactor": current_factor, "RequestedFactor": requested_factor,
        "ClickBaseFrame_ms": click_base_frame, "ClickOnlineFrame_ms": click_online_frame,
        "TimeBasis": "zero_jerk_zero_terminal_velocity_move",
    }

    def not_applied(reason):
        """失败不输出可执行参数，也不把未知剩余时间写成0。"""
        return dict(base_result, Applied=False, Status="not_applied", Reason=str(reason),
                    AppliedFactor=None, CurrentCycleRemaining_s=None,
                    CurrentCycleTotal_s=None, NextLoopTime_s=None, Models={})

    def make_specs(full_cycle=False):
        """保留原段边界关系；当前段用真实反馈，空档必须处于静止保持状态。"""
        origin = (global_start if direction > 0 else global_end) if full_cycle else click_base_frame
        specs = []
        active_ids = {}
        for model_id, model in models.items():
            ordered = model["segments"] if direction > 0 else list(reversed(model["segments"]))
            active = None
            if not full_cycle:
                active = next((s for s in ordered if (
                    float(s["start_frame"]) <= origin < float(s["end_frame"])
                    if direction > 0 else
                    float(s["start_frame"]) < origin <= float(s["end_frame"])
                )), None)
                report = feedback[model_id].get("current_segment_id")
                if report is not None and (active is None or int(report) != int(active["segment_id"])):
                    raise ValueError(f"模型{model_id}反馈段与点击Base帧不一致")
                velocity = feedback[model_id]["current_velocity_HPY"]
                position = feedback[model_id]["current_position_HPY"]
                if any(abs(velocity[i]) > float(limits[model_id]["max_velocity_HPY"][i])+1.0e-8
                       for i in axes_by_model[model_id]):
                    raise ValueError(f"模型{model_id}实际初速度已经超过虚轴上限")
                if any(abs(velocity[i]) > 1.0e-9 for i in range(3)
                       if i not in axes_by_model[model_id]):
                    raise ValueError(f"模型{model_id}非活动轴仍在运动")
                if active is None:
                    # 时间空档不能凭空把非零反馈速度当作静止。
                    if any(abs(x) > 1.0e-9 for x in velocity):
                        raise ValueError(f"模型{model_id}当前处于时间空档但实际速度非零")
                    held = list(model["segments"][0]["start_HPY"])
                    for segment in model["segments"]:
                        if float(segment["end_frame"]) <= origin:
                            held = list(segment["target_HPY"])
                    if any(abs(x-y) > 1.0e-5 for x, y in zip(position, held)):
                        raise ValueError(f"模型{model_id}空档反馈位置不在保持点，需先执行接入算法")
            active_ids[model_id] = None if active is None else int(active["segment_id"])
            for segment in ordered:
                segment_start = float(segment["start_frame"] if direction > 0 else segment["end_frame"])
                segment_end = float(segment["end_frame"] if direction > 0 else segment["start_frame"])
                current = not full_cycle and segment is active
                if not full_cycle and not current and (segment_start-origin)*direction < 0:
                    continue
                start = (feedback[model_id]["current_position_HPY"] if current else
                         hpy(segment["start_HPY"] if direction > 0 else segment["target_HPY"], "段起点"))
                target = hpy(segment["target_HPY"] if direction > 0 else segment["start_HPY"], "段终点")
                initial = feedback[model_id]["current_velocity_HPY"] if current else [0.0]*3
                if any(abs(start[i]-target[i]) > 1.0e-5 for i in range(3)
                       if i not in axes_by_model[model_id]):
                    raise ValueError(f"模型{model_id}非活动轴无法到达当前目标")
                specs.append({
                    "model_id": model_id, "segment_id": int(segment["segment_id"]),
                    "base_start": origin if current else segment_start, "base_end": segment_end,
                    "start": list(start), "target": target, "initial": list(initial),
                    "current": current,
                })
        return origin, specs, active_ids

    def plan_spec(spec, factor, duration=None):
        """同一Move求解器同时负责V/A/D、真实时间和整段姿态包围盒。"""
        model_id = spec["model_id"]
        model, limit = models[model_id], limits[model_id]
        profiles = []
        for axis in range(3):
            if axis not in axes_by_model[model_id]:
                profile = _plan_move_axis(spec["start"][axis], spec["start"][axis], 0, 0, 0, 0)
            else:
                profile = _plan_move_axis(
                    spec["start"][axis], spec["target"][axis], spec["initial"][axis],
                    float(model["velocity"][axis])*factor,
                    float(model["acceleration"][axis])*factor**2,
                    float(model["deceleration"][axis])*factor**2,
                    maximum_deceleration=float(limit["max_deceleration_HPY"][axis]),
                    duration=duration,
                )
            profiles.append(profile)
            # 保存动作时可能某轴完全静止，但本次反馈偏离需要回位；仍必须检查该轴上限。
            if axis in axes_by_model[model_id]:
                for value, field in (
                    (profile["peak_velocity"], "max_velocity_HPY"),
                    (profile["acceleration"], "max_acceleration_HPY"),
                    (profile["deceleration"], "max_deceleration_HPY"),
                ):
                    if value > float(limit[field][axis])*(1.0+1.0e-9):
                        raise ValueError(f"模型{model_id}的{AXIS_NAMES[axis]}轴Move超过{field}")
        bound = _move_motor_speed_bound(
            model, [p["position_min"] for p in profiles],
            [p["position_max"] for p in profiles], [p["peak_velocity"] for p in profiles])
        return profiles, bound

    def ceil_frame(value):
        """新事件只向未来取整，不能缩短Move所需时间。"""
        return math.ceil(value/frame_quantum)*frame_quantum

    def build_schedule(origin, specs, factor, online_origin):
        """公共事件约束：F(end)>=F(start)+Move时间，保留空档及事件次序。

        所有模型使用同一个Base帧到Online帧映射，不能各自平移后破坏公共帧关系。
        同一事件的所有移动轴最后求固定耗时解；无解则整次调速不应用。
        """
        terminal = global_end if direction > 0 else global_start
        events = sorted({origin, terminal, *(s["base_start"] for s in specs),
                         *(s["base_end"] for s in specs)}, reverse=direction < 0)
        plans = {}
        incoming = {event: [] for event in events}
        for index, spec in enumerate(specs):
            profiles, bound = plan_spec(spec, factor)
            plans[index] = profiles
            incoming[spec["base_end"]].append((index, max(p["duration"] for p in profiles)))
        frames = {origin: online_origin}
        for before, event in zip(events, events[1:]):
            # 原动作的空档也参与时间伸缩，不能在重排时丢掉。
            required = frames[before]+abs(event-before)/factor
            for index, duration in incoming[event]:
                required = max(required, frames[specs[index]["base_start"]]+duration*1000.0)
            frames[event] = ceil_frame(required)
        output = {model_id: [] for model_id in models}
        checks = {model_id: {"limit": float(m["max_motor_velocity"]), "upper_bound": 0.0}
                  for model_id, m in models.items()}
        for index, spec in enumerate(specs):
            start_frame, end_frame = frames[spec["base_start"]], frames[spec["base_end"]]
            duration = (end_frame-start_frame)/1000.0
            profiles, bound = plan_spec(spec, factor, duration)
            model_id = spec["model_id"]
            if bound > checks[model_id]["limit"]*(1.0+1.0e-9):
                raise ValueError(f"模型{model_id}固定耗时Move无法通过电机速度上界校验")
            checks[model_id]["upper_bound"] = max(checks[model_id]["upper_bound"], bound)
            # 通常为一条Move；背离目标的轴必须先制动，再发送反向Move。
            axis_commands = [p.get("commands", []) for p in profiles]
            item = {
                "segment_id": spec["segment_id"],
                "source": "replanned_current_segment" if spec["current"] else "scaled_base_segment",
                "start_frame": start_frame, "end_frame": end_frame,
                "start_HPY": spec["start"], "target_HPY": spec["target"],
                "velocity_HPY": [p["velocity"] for p in profiles],
                "acceleration_HPY": [p["acceleration"] for p in profiles],
                "deceleration_HPY": [p["deceleration"] for p in profiles],
                "initial_velocity_HPY": spec["initial"],
                "axis_modes": [p["mode"] for p in profiles],
                "axis_arrival_time_s": [p["duration"] for p in profiles],
                "motion_time_s": max(p["duration"] for p in profiles),
                "MotorSpeedUpperBound": bound,
            }
            if any(len(commands) > 1 for commands in axis_commands):
                item["ExecutionMode"] = "brake_then_move_axis_commands"
                item["axis_commands"] = axis_commands
            else:
                item["ExecutionMode"] = "move"
            output[model_id].append(item)
        return frames, output, checks

    # 第一阶段：统一缩放基准参数；不独立截断V/A/D破坏k/k²关系。
    try:
        max_scale = calculate_base_action_speed_ratio(file_name)
        applied_factor = min(requested_factor, max_scale)
        origin, specs, active_ids = make_specs()
        # Base静止轴在当前过渡中也可能要移动，不能漏掉这类反馈偏差的限额。
        for spec in specs:
            model_id = spec["model_id"]
            model, limit = models[model_id], limits[model_id]
            for axis in axes_by_model[model_id]:
                if (abs(spec["target"][axis]-spec["start"][axis]) <= 1.0e-12
                        and abs(spec["initial"][axis]) <= 1.0e-12):
                    continue
                for base_field, limit_field, power in (
                    ("velocity", "max_velocity_HPY", 1.0),
                    ("acceleration", "max_acceleration_HPY", 0.5),
                    ("deceleration", "max_deceleration_HPY", 0.5),
                ):
                    nominal = float(model[base_field][axis])
                    if nominal <= 0.0:
                        raise ValueError(f"模型{model_id}当前需要移动的轴缺少正的Base V/A/D")
                    applied_factor = min(applied_factor, (float(limit[limit_field][axis])/nominal)**power)
        # 当前实际初速度不能缩放，故每次降速都重新规划并重新检查整个姿态范围。
        for attempt in range(32):
            ratio = 1.0
            for spec in specs:
                _, bound = plan_spec(spec, applied_factor)
                motor_limit = float(models[spec["model_id"]]["max_motor_velocity"])
                if bound > motor_limit:
                    ratio = min(ratio, motor_limit/(bound*(1.0+1.0e-9)))
            if ratio >= 1.0-1.0e-10:
                break
            applied_factor *= min(0.98, ratio)
            if applied_factor < 1.0e-8:
                raise ValueError("保留实际初速度后无法认证电机速度安全")
        else:
            raise ValueError("当前实际初速度/姿态下，无法找到通过电机上界校验的调速方案")
        frames, output, checks = build_schedule(origin, specs, applied_factor, click_online_frame)
    except (ValueError, ArithmeticError) as exc:
        return not_applied(exc)

    # 第二阶段：完整下一轮也实际规划，不能直接用原总时长除倍率。
    next_time, next_frames, next_models, loop_reason = None, [], {}, None
    if loop_enabled:
        try:
            for model_id, model in models.items():
                if any(abs(float(a)-float(b)) > 1.0e-5 for a, b in zip(
                        model["segments"][0]["start_HPY"], model["segments"][-1]["target_HPY"])):
                    raise ValueError(f"模型{model_id}首尾位置不同，未授权自动增加循环回程")
            loop_origin, loop_specs, _ = make_specs(full_cycle=True)
            loop_frames, next_models, _ = build_schedule(loop_origin, loop_specs, applied_factor, 0.0)
            next_time = max(loop_frames.values())/1000.0
            next_frames = [{"base_frame_ms": b, "online_frame_ms": t} for b, t in loop_frames.items()]
        except (ValueError, ArithmeticError) as exc:
            loop_reason = str(exc)
    for model_id in models:
        output[model_id] = {
            "current_segment_id": active_ids[model_id],
            "current_position_HPY": feedback[model_id]["current_position_HPY"],
            "current_velocity_HPY": feedback[model_id]["current_velocity_HPY"],
            "segments": output[model_id],
        }
    remaining = (max(frames.values())-click_online_frame)/1000.0
    ideal = abs((global_end if direction > 0 else global_start)-origin)/applied_factor
    result = dict(
        base_result, Applied=True, Status="planned", AppliedFactor=applied_factor,
        MaxScale=max_scale, CurrentTransitionScale=applied_factor/min(requested_factor, max_scale),
        FrameMap=[{"base_frame_ms": b, "online_frame_ms": t} for b, t in frames.items()],
        TransitionDelay_ms=max(0.0, remaining*1000.0-ideal),
        CurrentCycleRemaining_s=remaining, CurrentCycleTotal_s=elapsed_time+remaining,
        NextLoopTime_s=next_time, NextLoopExecutable=bool(loop_enabled and loop_reason is None),
        MotorSpeedCheck=checks, Models=output,
    )
    if loop_enabled:
        result["NextLoopFrameMap"] = next_frames
        result["NextLoopModels"] = next_models
        if loop_reason:
            result["NextLoopReason"] = loop_reason
    return result


##########################兼容旧调用：非强制轨迹JSON入口#########################
# 只为已使用此名称的外部代码和测试保留，仍返回完整结果，仍拒绝trajectory_run=true。
# 当前主逻辑已读取inputs，直接调用calculate_non_forced_nearest_position；无需再读一次JSON。
def run_non_forced_motion_from_json(file_name="YXZ.JSON"):
    """读取JSON并依次完成非强制轨迹的就近位置和Move运动参数计算。"""
    inputs = load_nearest_position_inputs(file_name)
    if inputs["trajectory_run"]:
        raise ValueError("当前JSON为trajectory_run=true，不能调用非强制轨迹算法")
    return calculate_non_forced_nearest_position(inputs)
###############################################################################
# 四、曲线与电机换算辅助函数：系数求值也供非强制选点复用，其余供Base调速范围计算使用。
###############################################################################
##########################公共辅助：曲线位置与速度求值#########################
# 计算base_action一条五次曲线在指定毫秒时刻的H/P/Y位置和每秒速度。
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
def _calculate_base_action_motor_positions(model, segment, hpy_position):
    model_type = int(model["model_type"])
    height, arg_x, arg_y = (float(value) for value in hpy_position)

    if model_type == 1:
        return dandian_forward_model(height, int(model["motor_num"]))
    if model_type == 2:
        return liangdian_forward_model(
            height, arg_x,
            float(model["BaseHight1"]), float(model["BaseHight2"]),
            float(model["lLenth_inside"]), float(model["maxheight"]),
        )
    if model_type == 4:
        # 四点模型的一条曲线段只能选择P轴、Y轴或纯H轴运动。
        p_moving = any(abs(float(segment[name][1])) > 1.0e-12 for name in ("b", "c", "d", "e", "f"))
        y_moving = any(abs(float(segment[name][2])) > 1.0e-12 for name in ("b", "c", "d", "e", "f"))
        if p_moving and y_moving:
            raise ValueError(f"四点模型{model['index']}同一曲线段不能同时改变P轴和Y轴")
        move_what = 1 if p_moving else 2 if y_moving else 0
        return sidian_forward_model(
            height, arg_x, arg_y,
            float(model["BaseHight1"]), float(model["BaseHight2"]),
            float(model["lLenth_inside"]), float(model["wLenth_inside"]),
            float(model["maxheight"]), move_what,
        )
    if model_type == 8:
        return duodian_forward_model(
            height, arg_x, arg_y,
            model["point_init_pos"],
            float(model["Baseheight1"]), float(model["Baseheight2"]),
            float(model["maxheight"]), float(model["betainit"]),
        )
    raise ValueError(f"模型{model['index']}存在不支持的model_type：{model_type}")
##########################调速辅助：曲线瞬时电机速度#########################
# 使用正解函数的方向导数，把H/P/Y每秒速度转换成各实际电机的每秒速度。
def _calculate_base_action_motor_velocity(model, segment, hpy_position, hpy_velocity):
    if max(abs(float(value)) for value in hpy_velocity) <= 1.0e-12:
        return 0.0

    derivative_step_s = 1.0e-5
    position_before = [
        float(position)-float(velocity)*derivative_step_s
        for position, velocity in zip(hpy_position, hpy_velocity)
    ]
    position_after = [
        float(position)+float(velocity)*derivative_step_s
        for position, velocity in zip(hpy_position, hpy_velocity)
    ]
    motor_before = _calculate_base_action_motor_positions(model, segment, position_before)
    motor_after = _calculate_base_action_motor_positions(model, segment, position_after)
    if len(motor_before) != len(motor_after):
        raise ValueError(f"模型{model['index']}正解返回的电机数量不一致")
    return max(
        abs(float(after)-float(before))/(2.0*derivative_step_s)
        for before, after in zip(motor_before, motor_after)
    )

###############################################################################
# 五、独立的Base调速范围计算：与就近接入计算分开，不修改任何运动结果。
###############################################################################
##########################Move辅助：整个运动包围盒的电机速度上界#########################
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


##########################非强制Base动作调速范围计算函数#########################
def calculate_base_action_speed_ratio(file_name="YXZ.JSON", sample_step_ms=1.0):
    """按真正发送的零速起止Move参数求统一安全倍率，V乘k、A/D乘k²。

    使用每段实际可达到的梯形/三角形峰速和整段几何导数界，同时限制虚轴
    V/A/D与电机速度。返回保守安全倍率，不宣称是理论最大的可用倍率。
    sample_step_ms仅为旧调用保留；本算法不再通过采样证明安全。
    """
    with open(file_name, "r", encoding="utf-8") as file:
        data = json.load(file)
    if not math.isfinite(float(sample_step_ms)) or float(sample_step_ms) <= 0.0:
        raise ValueError("sample_step_ms必须大于0")
    action_name = data.get("command", {}).get("action_name", "base_action")
    models = data.get(action_name, {}).get("models")
    configurations = data.get("cal_start_time_config", {}).get("models")
    if not isinstance(models, list) or not models or not isinstance(configurations, list):
        raise ValueError("调速范围需要base_action.models和cal_start_time_config.models")
    limits = {int(item["model_id"]): item for item in configurations}
    if len(limits) != len(configurations):
        raise ValueError("调速范围的model_id不能重复")

    def read_vector(values, name):
        if not isinstance(values, (list, tuple)) or len(values) != 3:
            raise ValueError(f"{name}必须有H/P/Y三项")
        result = [float(value) for value in values]
        if not all(math.isfinite(value) for value in result):
            raise ValueError(f"{name}必须为有限数值")
        return result

    ratios = []
    for model in models:
        model_id = int(model["index"])
        if model_id not in limits:
            raise ValueError(f"模型{model_id}缺少虚轴运动限额")
        limit = limits[model_id]
        axes = {AXIS_NAMES.index(str(name).upper()) for name in limit["active_axes"]}
        velocity = read_vector(model["velocity"], "Base速度")
        acceleration = read_vector(model["acceleration"], "Base加速度")
        deceleration = read_vector(model["deceleration"], "Base减速度")
        max_velocity = read_vector(limit["max_velocity_HPY"], "最大速度")
        max_acceleration = read_vector(limit["max_acceleration_HPY"], "最大加速度")
        max_deceleration = read_vector(limit["max_deceleration_HPY"], "最大减速度")
        if any(value < 0.0 for vector in (
            velocity, acceleration, deceleration, max_velocity, max_acceleration, max_deceleration,
        ) for value in vector):
            raise ValueError(f"模型{model_id}的V/A/D及其上限不能为负")
        motor_limit = float(model["max_motor_velocity"])
        if not math.isfinite(motor_limit) or motor_limit <= 0.0:
            raise ValueError(f"模型{model_id}的max_motor_velocity必须大于0")
        segments = model.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError(f"模型{model_id}没有运动段")
        previous_target = None
        previous_end = None
        for segment in segments:
            start_frame, end_frame = float(segment["start_frame"]), float(segment["end_frame"])
            if not math.isfinite(start_frame) or not math.isfinite(end_frame) or end_frame <= start_frame:
                raise ValueError(f"模型{model_id}存在无效运动段时间范围")
            if previous_end is not None and start_frame < previous_end:
                raise ValueError(f"模型{model_id}的运动段必须按时间顺序排列且不能重叠")
            start = read_vector(segment["start_HPY"], "段起点")
            target = read_vector(segment["target_HPY"], "段终点")
            if previous_target is not None and any(abs(start[i]-previous_target[i]) > 1.0e-6 for i in range(3)):
                raise ValueError(f"模型{model_id}相邻运动段的起终位置不连续")
            previous_target, previous_end = target, end_frame
            peaks = [0.0, 0.0, 0.0]
            for axis in range(3):
                distance = abs(target[axis]-start[axis])
                if distance <= 1.0e-12:
                    continue
                if axis not in axes:
                    raise ValueError(f"模型{model_id}未启用的{AXIS_NAMES[axis]}轴存在位移")
                if min(velocity[axis], acceleration[axis], deceleration[axis],
                       max_velocity[axis], max_acceleration[axis], max_deceleration[axis]) <= 0.0:
                    raise ValueError(f"模型{model_id}有位移轴的V/A/D及上限必须大于0")
                peaks[axis], _ = _minimum_motion_profile(
                    distance, velocity[axis], acceleration[axis], deceleration[axis],
                )
                ratios.extend((
                    max_velocity[axis]/velocity[axis],
                    math.sqrt(max_acceleration[axis]/acceleration[axis]),
                    math.sqrt(max_deceleration[axis]/deceleration[axis]),
                ))
            bound = _move_motor_speed_bound(
                model, [min(p, q) for p, q in zip(start, target)],
                [max(p, q) for p, q in zip(start, target)], peaks,
            )
            if bound > 0.0:
                ratios.append(motor_limit/(bound*(1.0+1.0e-9)))
    # 全静止动作不存在运动速度约束，返回有限的名义倍率，便于JSON直接输出。
    return min(ratios) if ratios else 1.0


##########################历史曲线调速估算：保留旧多项式工具，业务入口不调用#########################
# 原多项式求导及差分峰值算法只描述系数曲线，不能证明非强制Move的电机速度安全。
def _calculate_polynomial_speed_ratio_legacy(file_name="YXZ.JSON", sample_step_ms=1.0):
    with open(file_name, "r", encoding="utf-8") as file:
        data = json.load(file)

    base_action = data.get("base_action")
    if not isinstance(base_action, dict):
        raise ValueError("JSON缺少base_action")
    models = base_action.get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("base_action.models不能为空")
    sample_step_ms = float(sample_step_ms)
    if not math.isfinite(sample_step_ms) or sample_step_ms <= 0.0:
        raise ValueError("调速范围算法的采样步长必须大于0毫秒")

    # 这些小工具只属于调速范围计算，放在函数内，避免把文件拆成大量零散函数。
    def polynomial_value(coefficients, value):
        result = 0.0
        for coefficient in reversed(coefficients):
            result = result*value+coefficient
        return result

    def polynomial_roots_in_range(coefficients, lower, upper):
        """递归利用导数的单调区间，找出低阶多项式在指定区间的全部实根。"""
        coefficients = [float(value) for value in coefficients]
        scale = max(1.0, *(abs(value) for value in coefficients))
        while len(coefficients) > 1 and abs(coefficients[-1]) <= 1.0e-14*scale:
            coefficients.pop()
        degree = len(coefficients)-1
        if degree <= 0:
            return []
        if degree == 1:
            root = -coefficients[0]/coefficients[1]
            return [root] if lower-1.0e-10 <= root <= upper+1.0e-10 else []

        derivative = [index*coefficients[index] for index in range(1, len(coefficients))]
        turning_points = polynomial_roots_in_range(derivative, lower, upper)
        boundaries = [lower]+[root for root in turning_points if lower < root < upper]+[upper]
        roots = []
        value_tolerance = 1.0e-10*scale

        # 偶重根不会变号，必须单独检查导数的根。
        for point in boundaries:
            if abs(polynomial_value(coefficients, point)) <= value_tolerance:
                roots.append(point)
        for left, right in zip(boundaries, boundaries[1:]):
            left_value = polynomial_value(coefficients, left)
            right_value = polynomial_value(coefficients, right)
            if left_value*right_value >= 0.0:
                continue
            # 每个单调区间最多一个根，二分即可稳定求出。
            for _ in range(64):
                middle = (left+right)/2.0
                middle_value = polynomial_value(coefficients, middle)
                if left_value*middle_value <= 0.0:
                    right = middle
                    right_value = middle_value
                else:
                    left = middle
                    left_value = middle_value
            roots.append((left+right)/2.0)

        unique_roots = []
        for root in sorted(roots):
            root = min(upper, max(lower, root))
            if not unique_roots or abs(root-unique_roots[-1]) > 1.0e-7:
                unique_roots.append(root)
        return unique_roots

    model_speed_ratios = []
    for model in models:
        model_id = int(model["index"])
        max_motor_velocity = float(model["max_motor_velocity"])
        if not math.isfinite(max_motor_velocity) or max_motor_velocity <= 0.0:
            raise ValueError(f"模型{model_id}的max_motor_velocity必须大于0")
        segments = model.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError(f"模型{model_id}没有曲线段")

        curve_max_motor_velocity = 0.0
        for segment in segments:
            start_frame = float(segment["start_frame"])
            end_frame = float(segment["end_frame"])
            if end_frame <= start_frame:
                raise ValueError(f"模型{model_id}存在无效曲线时间范围")

            curve_duration = (end_frame-start_frame)/CURVE_TICK_FRAME
            candidate_frames = {start_frame, end_frame}

            # 直接对HPY速度求导：加速度为0的时刻是虚轴速度极值候选点。
            for axis in range(3):
                a, b, c, d, e, f = (
                    float(segment[name][axis]) for name in ("a", "b", "c", "d", "e", "f")
                )
                acceleration_coefficients = [2.0*c, 6.0*d, 12.0*e, 20.0*f]
                for curve_time in polynomial_roots_in_range(
                    acceleration_coefficients, 0.0, curve_duration,
                ):
                    candidate_frames.add(start_frame+curve_time*CURVE_TICK_FRAME)

                # 角度过0可能引起机构方向或几何分支切换，与PLC的特殊检查点保持一致。
                if axis in (1, 2):
                    for curve_time in polynomial_roots_in_range(
                        [a, b, c, d, e, f], 0.0, curve_duration,
                    ):
                        candidate_frames.add(start_frame+curve_time*CURVE_TICK_FRAME)

            # 加入与模型角度保护相关的高度几何边界。
            model_type = int(model["model_type"])
            height_boundaries = []
            if model_type == 2:
                radius = abs(float(model["lLenth_inside"]))/2.0
                height_boundaries = [radius, float(model["maxheight"])-radius]
            elif model_type == 4:
                radius_x = abs(float(model["lLenth_inside"]))/2.0
                radius_y = abs(float(model["wLenth_inside"]))/2.0
                max_height = float(model["maxheight"])
                height_boundaries = [
                    radius_x, max_height-radius_x,
                    radius_y, max_height-radius_y,
                ]
            if height_boundaries:
                height_coefficients = [float(segment[name][0]) for name in ("a", "b", "c", "d", "e", "f")]
                for boundary in height_boundaries:
                    equation = list(height_coefficients)
                    equation[0] -= boundary
                    for curve_time in polynomial_roots_in_range(equation, 0.0, curve_duration):
                        candidate_frames.add(start_frame+curve_time*CURVE_TICK_FRAME)

            # 100ms粗网格用来捕获非线性模型在理论候选点之间产生的峰值。
            coarse_step_ms = 100.0
            frame = start_frame+coarse_step_ms
            while frame < end_frame:
                candidate_frames.add(frame)
                frame += coarse_step_ms

            velocity_cache = {}

            def motor_velocity_at(frame_ms):
                frame_ms = min(end_frame, max(start_frame, float(frame_ms)))
                cache_key = round(frame_ms, 9)
                if cache_key not in velocity_cache:
                    hpy_position, hpy_velocity = _evaluate_base_action_segment(segment, frame_ms)
                    velocity_cache[cache_key] = _calculate_base_action_motor_velocity(
                        model, segment, hpy_position, hpy_velocity,
                    )
                return velocity_cache[cache_key]

            ordered_frames = sorted(candidate_frames)
            ordered_velocities = [motor_velocity_at(frame) for frame in ordered_frames]
            curve_max_motor_velocity = max(curve_max_motor_velocity, *ordered_velocities)

            # 只对粗搜得到的局部峰值附近继续四分细化，直到达到sample_step_ms精度。
            peak_indexes = {
                index for index in range(1, len(ordered_frames)-1)
                if ordered_velocities[index] >= ordered_velocities[index-1]
                and ordered_velocities[index] >= ordered_velocities[index+1]
                and (
                    ordered_velocities[index] > ordered_velocities[index-1]
                    or ordered_velocities[index] > ordered_velocities[index+1]
                )
            }
            peak_indexes.update((0, len(ordered_frames)-1))
            for index in peak_indexes:
                left_index = max(0, index-1)
                right_index = min(len(ordered_frames)-1, index+1)
                left = ordered_frames[left_index]
                right = ordered_frames[right_index]
                while right-left > sample_step_ms:
                    width = right-left
                    trial_frames = [
                        left,
                        left+width*0.25,
                        left+width*0.5,
                        left+width*0.75,
                        right,
                    ]
                    trial_velocities = [motor_velocity_at(frame) for frame in trial_frames]
                    best_index = max(range(5), key=lambda item: trial_velocities[item])
                    curve_max_motor_velocity = max(
                        curve_max_motor_velocity, trial_velocities[best_index],
                    )
                    if best_index == 0:
                        left, right = trial_frames[0], trial_frames[1]
                    elif best_index == 4:
                        left, right = trial_frames[3], trial_frames[4]
                    else:
                        left, right = trial_frames[best_index-1], trial_frames[best_index+1]

        # 静止模型不会限制整个动作的调速范围。
        if curve_max_motor_velocity > 1.0e-12:
            model_speed_ratios.append(max_motor_velocity/curve_max_motor_velocity)

    if not model_speed_ratios:
        raise ValueError("base_action中没有可用于计算调速范围的运动曲线")
    return min(model_speed_ratios)


###############################################################################
# 主流程：强制轨迹和非强制轨迹分别进入自己的独立分支
###############################################################################
if __name__ == "__main__":
    json_file = Path(__file__).resolve().with_name("YXZ.JSON")
    motion_inputs = load_nearest_position_inputs(json_file)

    if motion_inputs["trajectory_run"]:
        # 第一个算法：强制轨迹按公共时间主轴选择接入帧和各模型目标位置。
        forced_position_result = calculate_forced_nearest_position(
            current_positions=motion_inputs["current_positions"],
            default_velocities=motion_inputs["default_velocities"],
            curve_action=motion_inputs["curve_action"],
            max_accelerations=motion_inputs["max_accelerations"],
            direction=motion_inputs["direction"],
            loop_once=motion_inputs["loop_once"],
            nearest_start=motion_inputs["nearest_start"],
            use_specified_time=motion_inputs["use_specified_time"],
            specified_time_ms=motion_inputs["specified_time_ms"],
            active_axes_by_model=motion_inputs["active_axes_by_model"],
            coarse_step=motion_inputs["coarse_step"],
            fine_step=motion_inputs["fine_step"],
        )
        print("一、强制轨迹接入位置：")
        print(json_dumps_with_inline_lists({
            "TargetFrame_ms": forced_position_result["TargetFrame_ms"],
            "PosSet": forced_position_result["PosSet"],
            "StartMode": forced_position_result["StartMode"],
            "xSafe": forced_position_result["xSafe"],
        }))

        # 第二个算法：各轴按默认V/A/D独立到位；先到的等待最慢模型，不做k/k²同步或超速检查。
        forced_motion_result = calculate_forced_motion(forced_position_result, motion_inputs)
        print("二、强制轨迹默认到位参数：")
        print(json_dumps_with_inline_lists(forced_motion_result))

        # 第三个算法：PLC内部调时间主轴，上位机只计算新倍率下的剩余时间和完整动作时间。
        with open(json_file, "r", encoding="utf-8") as file:
            forced_document = json.load(file)
        forced_speed_command = forced_document.get("forced_speed_adjustment", {})
        current_frame_ms = forced_speed_command.get(
            "current_frame_ms",
            forced_position_result["TargetFrame_ms"],
        )
        requested_factor = forced_document["command"].get("request_factor", 1.0)
        forced_time_result = calculate_forced_speed_adjustment_time(
            motion_inputs,
            current_frame_ms=current_frame_ms,
            requested_factor=requested_factor,
            state=forced_speed_command.get("state"),
        )
        print("三、强制轨迹调速时间：")
        print(json_dumps_with_inline_lists(forced_time_result))
    else:
        # 第一个算法：计算就近/非就近启动的候选帧和各模型目标位置。
        candidate_position_result = calculate_non_forced_candidate_positions(motion_inputs)
        print("一、非强制轨迹候选帧和位置：")
        print(json_dumps_with_inline_lists(candidate_position_result))

        # 第二个算法：逐个校验候选帧，输出最终目标以及同步V/A/D和运行时间。
        non_forced_result = calculate_non_forced_motion_parameters(
            candidate_position_result,
            motion_inputs,
        )
        print("二、非强制轨迹运行参数：")
        print(json_dumps_with_inline_lists(non_forced_result))

        with open(json_file, "r", encoding="utf-8") as file:
            non_forced_command = json.load(file).get("non_forced_speed_adjustment", {})
        if non_forced_command.get("enabled", False):
            # 第三个算法：从当前实际位置和非零实际速度重规划当前段，并重排后续帧。
            online_result = calculate_non_forced_online_speed_adjustment(json_file)
            print("三、非强制轨迹在线调速结果：")
            print(json_dumps_with_inline_lists(online_result))


######################################主函数计算逻辑#######################################
"""
##########################第一步：选择接入位置##########################

读取YXZ.JSON，判断trajectory_run
        ↓
false：非强制轨迹                  true：强制轨迹
        ↓                                 ↓
nearest_start=false？              nearest_start=false？
 正向取第一关键帧                   正向取第一帧
 反向取最后关键帧                   反向取最后帧
        ↓                                 ↓
nearest_start=true：               nearest_start=true：
 提供stopped_time_ms：               指定时间则直接取该时间
   正好在关键帧：使用该帧            未指定则共同粗搜100ms、细搜10ms
   不在关键帧：正向取后帧            按最长估计到位时间最小选共同时间
               反向取前帧                    ↓
 未提供：先共同粗搜100ms、          输出各模型目标位置、目标时间、xSafe
 细搜10ms，再按方向取下一关键帧     xSafe不阻止计算，由上位机决定是否运行
        ↓
所有模型使用同一候选时间，空档及结束后保持相应端点
第一步只输出候选位置，不声称已通过第二步的运动验证

##########################第二步：计算接入参数##########################

非强制：停稳后从当前位置出发，按最大V/A/D求各轴最短Move
        ↓
取最长耗时T；各移动轴k=T_i/T，V乘k，A/D乘k²
        ↓
用整个姿态范围的几何导数上界检查实际电机速度
超限则所有模型统一降速，V乘k、A/D乘k²、T除以k
        ↓
候选失败尝试下一候选；成功输出目标帧、位置、V/A/D、MaxRunTime_s
没有可执行候选则报错；不以越过目标再返回来满足可达性

强制：各轴按默认V/A独立到位，D按当前PLC接线取A
        ↓
不做上位机超速判断、不做k/k²同步
        ↓
先到的等待，最晚到位时间为准备耗时；全部到位后启动时间主轴

##########################第三步：运行中调速##########################

非强制：读取当前实际位置、实际速度、Base帧和当前Online帧
        ↓
使用实际Move基准计算保守安全倍率，不再用多项式峰速代替Move峰速
        ↓
统一限制请求倍率：V乘倍率、A/D乘倍率²，不分别截断三个参数
        ↓
当前段固定实际初速度重新规划，后续段按零速起止Move规划
反向且仍向旧方向运动：明确输出先制动、再反向Move的两条轴指令
        ↓
检查整段电机速度上界（包含反向制动位置及实际初速度）
需要降速时重新求解，不能直接缩放实际初速度
        ↓
建立所有模型共同关键帧时间表
每段结束帧 >= 开始帧 + 真实Move耗时；保留事件顺序和空档
新帧向未来取整，不能因取整缩短运动所需时间
        ↓
各段移动轴求指定耗时解
 零初速：严格k/k²同步
 非零初速：固定反馈速度求解，不把等待伪装成同步到达
 静止轴：保持位置
        ↓
再次核对虚轴上限和电机上界，输出新指令、FrameMap及本轮剩余时间
下一整轮另行规划，得到NextLoopTime_s及对应指令，不直接用旧总时间/倍率
首尾不闭合：不擅自增加循环回程，NextLoopExecutable=false并说明原因

不能停车、不能同步或几何不支持：Applied=false、Models为空、时间为null
上位机不能下发这个失败方案；是否继续旧指令须另行确认旧方案仍可执行

强制：仅预览时间，调速执行仍在PLC内
        ↓
forced_speed_adjustment.state是否提供真实主轴速度、有效加減速度？
 缺少/null：EstimateOnly=true，输出带标记的匀速估计
 齐全：按实际主轴加減速及反向制动过程计算边界到达时间
        ↓
循环换向需PLC许可状态；尚未允许则不能声称实际剩余时间已确定
累计主轴帧按各Timeline周期计算；周期不同分别输出ModelTimes
CompleteActionTime_s是目标匀速倍率的完整跨度时间，其依据单独标明

执行约定：非强制预测按无jerk、末速0、不混合跨段的梯形Move。
FrameMap是公共发送时间表，正反向的Online时间都向前增加。
axis_commands出现时必须执行其中的制动/Move顺序，不能只取顶层V/A/D。
forced_speed_adjustment.state的主轴位置单位为ms、速度为ms/s、加減速度为ms/s²。
时间不包含通讯、PLC扫描及机械跟随误差；PLC保护与到位反馈仍必须保留。
####################################################################
"""

