#######################运动过程中调速或者反向重规划######################## 
import math
import copy
import json
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
##########################在线动作JSON解析函数#########################
def load_online_action(file_name):
    with open(file_name,"r",encoding="utf-8") as f:
        data = json.load(f)

    base_action = data["base_action"]
    online_action = data["online_action"]
    command = data["command"]

    return base_action,online_action,command
##########################单段最大实轴速度计算函数#########################
def calc_segment_max_velocity(model,segment):
    model_type = model["model_type"]

    start = segment["start_HPY"]
    target = segment["target_HPY"]

    velocity = segment["velocity"]
    acceleration = segment["acceleration"]
    deceleration = segment["deceleration"]

    if model_type == 1:
        max_velocity = dandian_velocity_model(
            start[0],target[0],
            velocity[0],acceleration[0],deceleration[0]
        )

    elif model_type == 2:
        max_velocity = liangdian_velocity_model(
            start[0],target[0],
            start[1],target[1],
            velocity[0],acceleration[0],deceleration[0],
            velocity[1],acceleration[1],deceleration[1],
            model["BaseHight1"],
            model["BaseHight2"],
            model["lLenth_inside"],
            model["maxheight"]
        )

    elif model_type == 4:
        max_velocity = sidian_velocity_model(
            start[0],target[0],
            start[1],target[1],
            start[2],target[2],
            velocity[0],acceleration[0],deceleration[0],
            velocity[1],acceleration[1],deceleration[1],
            velocity[2],acceleration[2],deceleration[2],
            model["BaseHight1"],
            model["BaseHight2"],
            model["lLenth_inside"],
            model["wLenth_inside"],
            model["maxheight"],
            segment["moveWhat"]
        )

    elif model_type == 8:
        max_velocity = duodian_velocity_model(
            start[0],target[0],
            start[1],target[1],
            start[2],target[2],
            velocity[0],acceleration[0],deceleration[0],
            velocity[1],acceleration[1],deceleration[1],
            velocity[2],acceleration[2],deceleration[2],
            model["point_init_pos"],
            model["Baseheight1"],
            model["Baseheight2"],
            model["maxheight"],
            model["betainit"]
        )

    else:
        raise ValueError(f"未知模型类型：{model_type}")

    return max_velocity
##########################Base动作最大调速倍率计算函数#########################
def calc_base_speed_range(base_action,safety_factor=1.0):
    action_max_factor = float("inf")
    limit_model_index = -1
    limit_segment_id = -1
    model_results = []

    for model in base_action["models"]:
        model_index = model["index"]
        model_max_factor = float("inf")
        model_limit_segment = -1
        segment_results = []

        for segment in model["segments"]:
            segment_id = segment["segment_id"]

            max_velocity = calc_segment_max_velocity(model,segment)

            if max_velocity > 0:
                max_factor = model["max_motor_velocity"]/(max_velocity*safety_factor)
            else:
                max_factor = float("inf")

            segment_results.append({
                "segment_id":segment_id,
                "max_velocity":max_velocity,
                "max_factor":max_factor
            })

            if max_factor < model_max_factor:
                model_max_factor = max_factor
                model_limit_segment = segment_id

            if max_factor < action_max_factor:
                action_max_factor = max_factor
                limit_model_index = model_index
                limit_segment_id = segment_id

        model_results.append({
            "index":model_index,
            "max_factor":model_max_factor,
            "limit_segment_id":model_limit_segment,
            "segments":segment_results
        })

    if action_max_factor == float("inf"):
        action_max_factor = 1.0

    return {
        "action_max_factor":action_max_factor,
        "action_max_percent":action_max_factor*100.0,
        "limit_model_index":limit_model_index,
        "limit_segment_id":limit_segment_id,
        "models":model_results
    }
######################################主函数计算逻辑#######################################
"""
##########################在线调速与反向重规划流程##########################

读取Base动作和当前Online动作
        ↓
遍历每个模型、每个Segment
        ↓
根据Base数据计算当前动作允许调速范围
        ↓
限制用户请求倍率到安全范围
        ↓
获取每个模型当前Segment
当前时间/位置/速度/方向
        ↓
是否反向
   ↓否                     ↓是
按当前方向调速         先按减速度降到0
   ↓                     ↓
   ↓               计算停止时间和停止位置
   ↓                     ↓
   ↓                 切换运动方向
   └──────────┬──────────┘
              ↓
重新规划当前Segment剩余运动
        ↓
判断能否达到新的目标速度
   ↓能                     ↓不能
梯形曲线                三角形/特殊曲线
   └──────────┬──────────┘
              ↓
计算当前Segment新的V/A/D和时间
        ↓
按照Base倍率修改后续各Segment的V/A/D
        ↓
如果循环则继续计算完整一轮
        ↓
重新计算所有Segment的start_frame/end_frame
        ↓
重新计算整条Online动作最大实轴速度
        ↓
是否超过实轴最大速度
   ↓否                     ↓是
保留当前结果          降低调速倍率重新计算
   └──────────┬──────────┘
              ↓
输出新的Online动作
        ↓
下一次调速/反向继续以
Base + 最新Online作为输入

############################################################
"""

base_action,online_action,command = load_online_action("YXZ2_call.json")

speed_range = calc_base_speed_range(base_action)

print("整个动作最大倍率：",speed_range["action_max_factor"])
print("整个动作最大百分比：",speed_range["action_max_percent"],"%")
print("限制模型：",speed_range["limit_model_index"])
print("限制Segment：",speed_range["limit_segment_id"])
for model_result in speed_range["models"]:
    print("----------------------------------------")
    print("模型：",model_result["index"])
    print("模型最大倍率：",model_result["max_factor"])
    print("限制Segment：",model_result["limit_segment_id"])

    for segment_result in model_result["segments"]:
        print(
            "Segment：",segment_result["segment_id"],
            "最大实轴速度：",segment_result["max_velocity"],
            "最大倍率：",segment_result["max_factor"]
        )