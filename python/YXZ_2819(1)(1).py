# -*- coding: utf-8 -*-
import contextlib
import io
import os
import math
import copy
import socket
import json
import traceback
from scipy.optimize import dual_annealing, least_squares
from pyswarm import pso
import numpy as np
import time
################################################################################################ 单点摆正反解函数
def dandian_inverse_model(height, motor_H, limit_min, limit_max):
    motor_H_avg = sum(motor_H) / len(motor_H)
    if motor_H_avg >= limit_max:
        motor_H_avg = limit_max
    elif motor_H_avg <= limit_min:
        motor_H_avg = limit_min
    return motor_H_avg

################################################################################################ 两点摆正反解函数
#两点摆正解函数
#Apoint_guess, Bpoint_guess = liangdian_forward_model(HPY[1],HPY[0],origin_distance1,origin_distance2, params[0][0],limitData[0][0])
def liangdian_forward_model(arg_x, height, BaseHight1,BaseHight2, lLenth_inside,maxheight):
    # 计算过程
    ##xOffset = (arg_x / 90.0)* (lLenth_inside / 2.0)
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
        # 点 A、B 到起点的距离（减去 BaseHight）
        Apoint =BaseHight2+maxheight- math.sqrt((xA - x0) ** 2 + (yA - y0) ** 2) 
        Bpoint =BaseHight2+maxheight- math.sqrt((xB - x1) ** 2 + (yB - y1) ** 2) 
        return Apoint,Bpoint
#两点摆反解函数
#liangdian_reverse_model(motor_H[0], motor_H[1], origin_distance1,origin_distance2, params[0][0],limitData[0][0],3)
def liangdian_reverse_model(Apoint_meas, Bpoint_meas, BaseHight1,BaseHight2, lLenth_inside,maxheight,max_recursions):
    target_distances = np.array([Apoint_meas, Bpoint_meas])
    def error_sum(params):
        arg_x, height = params
        try:
            Apoint, Bpoint = liangdian_forward_model(arg_x, height, BaseHight1,BaseHight2, lLenth_inside,maxheight)
            actual_distance = np.array([Apoint, Bpoint])
        except Exception as e:
            return 1e9  # 出现错误时返回大误差，避免影响全局搜索
        return np.sum((actual_distance - target_distances) ** 2)

    def distance_differences(params):
        arg_x, height = params
        A_calc, B_calc = liangdian_forward_model(arg_x, height, BaseHight1,BaseHight2, lLenth_inside,maxheight)
        return np.array([A_calc, B_calc]) - target_distances
#########
    bounds = [(-90,90), (min(target_distances)-1, max(target_distances)+1)]
    def print_current_solution(params, f, context):
        arg_x, height = params
    # 使用全局优化算法（模拟退火）进行全局搜索，找到较优的初始解
    result_anneal = dual_annealing(
        error_sum,
        bounds,
        maxiter=50,
        callback=print_current_solution
    )
    initial_guess = result_anneal.x
    # 使用最小二乘法进行局部优化，提高解的精度
    result = least_squares(
        distance_differences,
        x0=initial_guess,
        bounds=([-90, min(target_distances)-1 if min(target_distances)>=0 else -1], [90, max(target_distances)+1]),
        max_nfev=50,  # 限制最多50次函数调用
    )
    final_error = error_sum(result.x)
    tolerance=1e-6
    if final_error < tolerance:
        return result.x.tolist()  # 返回解
    elif max_recursions > 0:
        return liangdian_reverse_model(Apoint_meas, Bpoint_meas, BaseHight1,BaseHight2, lLenth_inside,maxheight,max_recursions=max_recursions-1,)
    else:
        return result.x.tolist()
#四点摆正解
#sidian_forward_model(HPY[1], HPY[2], HPY[0], origin_distance1,origin_distance1, params[0][0], params[0][1],limitData[0][0], moveWhat1)
def sidian_forward_model(arg_x_deg, arg_y_deg, height, BaseHight1,BaseHight2, lLenth_inside, wLenth_inside,maxheight, moveWhat):
    if BaseHight1!=0 and BaseHight2==0:
        if moveWhat == 1:
            xOffset = ((arg_x_deg / 90.0) ** 3) * (lLenth_inside / 2.0)
            arg_x_rad = math.radians(arg_x_deg)

            x0 = -(lLenth_inside / 2.0)
            x1 = (lLenth_inside / 2.0)
            xA = -math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
            xB = math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset

            yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0) + BaseHight1
            yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0) + BaseHight1

            Apoint = math.sqrt((xA - x0) ** 2 + (yA ) ** 2)-BaseHight1
            Bpoint = math.sqrt((xB - x1) ** 2 + (yB ) ** 2)-BaseHight1 
            Cpoint=Bpoint
            Dpoint=Apoint
            return [Apoint, Bpoint, Cpoint, Dpoint]
        elif moveWhat == 2:
            yOffset = ((arg_y_deg / 90.0) ** 3) * (wLenth_inside / 2.0)
            arg_y_rad = math.radians(arg_y_deg)

            x0 = -(wLenth_inside / 2.0)
            x1 = (wLenth_inside / 2.0)
            xA = -math.cos(arg_y_rad) * (wLenth_inside / 2.0) - yOffset
            xB = math.cos(arg_y_rad) * ( wLenth_inside/ 2.0) - yOffset

            yA = height - math.sin(arg_y_rad) * ( wLenth_inside/ 2.0) + BaseHight1
            yB = height + math.sin(arg_y_rad) * ( wLenth_inside/ 2.0) + BaseHight1
            Apoint = math.sqrt((xB - x1) ** 2 + yB ** 2)-BaseHight1
            Cpoint = math.sqrt((xA - x0) ** 2 + yA ** 2)-BaseHight1 
            Bpoint = Apoint
            Dpoint = Cpoint
            return [Apoint, Bpoint, Cpoint, Dpoint]
        else:
            return [height] * 4
    elif BaseHight1==0 and BaseHight2!=0:
        if moveWhat == 1:
            arg_x_deg=-1*arg_x_deg
            xOffset = ((arg_x_deg / 90.0) ** 3) * (lLenth_inside / 2.0)
            arg_x_rad = math.radians(arg_x_deg)

            x0 = -(lLenth_inside / 2.0)
            y0 = BaseHight2+maxheight
            x1 = (lLenth_inside / 2.0)
            y1 = BaseHight2+maxheight

            xA = -math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset
            xB = math.cos(arg_x_rad) * (lLenth_inside / 2.0) - xOffset

            yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0) 
            yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0) 

            Apoint =BaseHight2+maxheight- math.sqrt((xA - x0) ** 2 + (yA -y0) ** 2)
            Bpoint =BaseHight2+maxheight- math.sqrt((xB - x1) ** 2 + (yB -y1) ** 2) 
            Cpoint=Bpoint
            Dpoint=Apoint
            return [Apoint, Bpoint, Cpoint, Dpoint]
        elif moveWhat == 2:
            arg_y_deg=-1*arg_y_deg
            yOffset = ((arg_y_deg / 90.0) ** 3) * (wLenth_inside / 2.0)
            arg_y_rad = math.radians(arg_y_deg)

            x0 = -(wLenth_inside / 2.0)
            y0 = BaseHight2+maxheight
            x1 = (wLenth_inside / 2.0)
            y1 = BaseHight2+maxheight

            xA = -math.cos(arg_y_rad) * (wLenth_inside / 2.0) - yOffset
            xB = math.cos(arg_y_rad) * ( wLenth_inside/ 2.0) - yOffset

            yA = height - math.sin(arg_y_rad) * ( wLenth_inside/ 2.0) 
            yB = height + math.sin(arg_y_rad) * ( wLenth_inside/ 2.0) 
            Apoint = BaseHight2+maxheight- math.sqrt((xB - x1) ** 2 + (yB -y1) ** 2) 
            Cpoint = BaseHight2+maxheight- math.sqrt((xA - x0) ** 2 + (yA -y0) ** 2)
            Bpoint = Apoint
            Dpoint = Cpoint
            return [Apoint, Bpoint, Cpoint, Dpoint]
        else:
            return [height] * 4
#四点摆反解函数
#(motor_H[0], motor_H[1], motor_H[2], motor_H[3], origin_distance1,origin_distance2, params[0][0], params[0][1],limitData[0][0],50)
def sidian_reverse_model(Apoint, Bpoint,Cpoint,Dpoint, BaseHight1,BaseHight2, lLenth_inside,wLenth_inside,maxheight,max_recursions):
    if abs(Bpoint - Cpoint)<=100 and abs(Apoint-Dpoint)<=100:
        moveWhat=1
        target_distances = np.array([Apoint, Bpoint,Cpoint,Dpoint])
        def error_sum(params):
            arg_x, height = params
            try:
                Apoint1, Bpoint1,Cpoint1,Dpoint1 = sidian_forward_model(arg_x, arg_x, height, BaseHight1,BaseHight2, lLenth_inside, wLenth_inside,maxheight, moveWhat)
                actual_distance = np.array([Apoint1, Bpoint1,Cpoint1,Dpoint1])
            except Exception as e:
                return 1e9  # 出现错误时返回大误差，避免影响全局搜索
            return np.sum((actual_distance - target_distances) ** 2)

        def distance_differences(params):
            arg_x, height = params
            A_calc, B_calc , C_calc , D_calc = sidian_forward_model(arg_x, arg_x, height, BaseHight1,BaseHight2, lLenth_inside, wLenth_inside,maxheight, moveWhat)
            return np.array([A_calc, B_calc, C_calc , D_calc]) - target_distances

        bounds = [(-90, 90), (0, max(Apoint,Bpoint,Cpoint,Dpoint))]

        def print_current_solution(params, f, context):
            arg_x, height = params
        # 使用全局优化算法（模拟退火）进行全局搜索，找到较优的初始解
        result_anneal = dual_annealing(
            error_sum,
            bounds,
            maxiter=50,
            callback=print_current_solution
        )
        initial_guess = result_anneal.x

        # 使用最小二乘法进行局部优化，提高解的精度
        result = least_squares(
            distance_differences,
            x0=initial_guess,
            bounds=([-90, 0], [90, max(Apoint,Bpoint,Cpoint,Dpoint)]),
            max_nfev=50  # 限制最多50次函数调用
        )
        arg_y=0
        final_error = error_sum(result.x)
        tolerance=1e-6
        result = result.x.tolist()
        result1 = sidian_forward_model(result[0], arg_y, result[1], BaseHight1,BaseHight2, lLenth_inside, wLenth_inside,maxheight, moveWhat)
        if final_error < tolerance and abs(result1[0]-Apoint)<=1 and abs(result1[1]-Bpoint)<=1 and abs(result1[2]-Cpoint)<=1 and abs(result1[3]-Dpoint)<=1:
            return result[0],arg_y,result[1],moveWhat  # 返回解
        elif max_recursions > 0:
            return sidian_reverse_model(Apoint, Bpoint,Cpoint,Dpoint, BaseHight1,BaseHight2, lLenth_inside,wLenth_inside,maxheight,max_recursions=max_recursions-1)
        else:
            return result[0],arg_y,result[1],moveWhat 
    if abs(Apoint - Bpoint)<=100 and abs(Cpoint-Dpoint)<=100:
        moveWhat=2
        target_distances = np.array([Apoint, Bpoint,Cpoint,Dpoint])

        def error_sum(params):
            arg_y, height = params
            try:
                Apoint1, Bpoint1,Cpoint1,Dpoint1 = sidian_forward_model(arg_y, arg_y, height, BaseHight1,BaseHight2, lLenth_inside, wLenth_inside,maxheight, moveWhat)
                actual_distance = np.array([Apoint1, Bpoint1,Cpoint1,Dpoint1])
            except Exception as e:
                return 1e9  # 出现错误时返回大误差，避免影响全局搜索
            return np.sum((actual_distance - target_distances) ** 2)

        def distance_differences(params):
            arg_y, height = params
            A_calc, B_calc , C_calc , D_calc = sidian_forward_model(arg_y, arg_y, height, BaseHight1,BaseHight2, lLenth_inside, wLenth_inside, maxheight,moveWhat)
            return np.array([A_calc, B_calc, C_calc , D_calc]) - target_distances

        bounds = [(-90, 90), (0, max(Apoint,Bpoint,Cpoint,Dpoint))]

        def print_current_solution(params, f, context):
            arg_x, height = params
            
        # 使用全局优化算法（模拟退火）进行全局搜索，找到较优的初始解
        result_anneal = dual_annealing(
            error_sum,
            bounds,
            maxiter=50,
            callback=print_current_solution
        )
        initial_guess = result_anneal.x

        # 使用最小二乘法进行局部优化，提高解的精度
        result = least_squares(
            distance_differences,
            x0=initial_guess,
            bounds=([-90, 0], [90, max(Apoint,Bpoint,Cpoint,Dpoint)]),
            max_nfev=50  # 限制最多50次函数调用
        )

        final_error = error_sum(result.x)
        arg_x=0
        tolerance=1e-6
        result = result.x.tolist()
        result1 = sidian_forward_model(arg_x, result[0], result[1], BaseHight1,BaseHight2, lLenth_inside, wLenth_inside,maxheight, moveWhat)
        if final_error < tolerance and abs(result1[0]-Apoint)<=1 and abs(result1[1]-Bpoint)<=1 and abs(result1[2]-Cpoint)<=1 and abs(result1[3]-Dpoint)<=1:
            return arg_x,result[0],result[1],moveWhat  # 返回解
        elif max_recursions > 0:
            return sidian_reverse_model(Apoint, Bpoint,Cpoint,Dpoint, BaseHight1,BaseHight2, lLenth_inside,wLenth_inside,maxheight,max_recursions=max_recursions-1)
        else:
            return arg_x,result[0],result[1],moveWhat 
    else:    
        moveWhat=0
        return (Apoint+Bpoint+Cpoint+Dpoint)/4,0,0,moveWhat
# 多点摆正解
def duodian_forward_solution(height, roll, pitch, point_init_pos,Baseheight1,Baseheight2,maxheight,betainit):
    if Baseheight1 !=0 and Baseheight2==0:
        roll=roll+betainit
        roll=-roll
        pitch=-pitch
        def degrees_to_radians(degrees):
            return degrees * math.pi / 180
        def apply_quaternion_rotation(x, y, z, quaternion):
            # Apply quaternion rotation to a point (x, y, z)
            w, qx, qy, qz = quaternion
            # Calculate the rotated coordinates
            x_rot = (1 - 2 * qy**2 - 2 * qz**2) * x + (2 * qx * qy - 2 * w * qz) * y + (2 * qx * qz + 2 * w * qy) * z
            y_rot = (2 * qx * qy + 2 * w * qz) * x + (1 - 2 * qx**2 - 2 * qz**2) * y + (2 * qy * qz - 2 * w * qx) * z
            z_rot = (2 * qx * qz - 2 * w * qy) * x + (2 * qy * qz + 2 * w * qx) * y + (1 - 2 * qx**2 - 2 * qy**2) * z

            return {'x': x_rot, 'y': y_rot, 'z': z_rot}
        def ni_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, math.sin(angle_rad / 2)]
        def shun_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, -math.sin(angle_rad / 2)]

        def shun_quat_rotate_x(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), math.sin(angle_rad / 2), 0, 0]

        def find_distance_fixed(points, beta):
            beta = -beta*math.pi/180.0 + math.pi / 2
            ray_dir = {'x': -math.cos(beta), 'y': -math.sin(beta)}
            min_distance = float('inf')
            n = len(points)
            for i in range(n):
                x1, y1, _ = points[i]
                x2, y2, _ = points[(i + 1) % n]
                ab = {'x': x2 - x1, 'y': y2 - y1}
                oa = {'x': -x1, 'y': -y1}
                denominator = ray_dir['x'] * ab['y'] - ray_dir['y'] * ab['x']
                if denominator == 0:
                    continue
                t = (oa['x'] * ab['y'] - oa['y'] * ab['x']) / denominator
                u = (ray_dir['x'] * oa['y'] - ray_dir['y'] * oa['x']) / denominator
                if t < 0 or u < 0 or u > 1:
                    continue
                intersection = {'x': ray_dir['x'] * t, 'y': ray_dir['y'] * t}
                distance = math.sqrt(intersection['x']**2 + intersection['y']**2)
                min_distance = min(min_distance, distance)
            return None if min_distance == float('inf') else min_distance

        def calc_pos_fixed(h, r, p, init_p,Baseheight1):
            pos = copy.deepcopy(init_p)
            beta = r
            angle = p
            n_q_z = ni_quat_rotate_z(beta)
            s_q_z = shun_quat_rotate_z(beta)
            s_q_x = shun_quat_rotate_x(angle)
            np = []
            for i in range(len(init_p)):
                pos[i][2] = 0
                a = apply_quaternion_rotation(pos[i][0], pos[i][1], pos[i][2], n_q_z)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_x)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_z)
                np.append([a['x'], a['y'], a['z']])
            
            offset = find_distance_fixed(init_p, beta)
            if offset != 0:
                pow_val = 1.73 + 0.52 * ((h+Baseheight1) / offset)
                if pow_val > 100:
                    pow_val = 100
                a = offset / math.pow(1.5707963,pow_val)
                offset_t = a * math.pow(abs(angle*math.pi/180.0),pow_val)
                if offset_t > offset:
                    offset_t = offset
                offset = offset_t * (-1 if angle < 0 else 1)
            for i in range(len(init_p)):
                np[i][0] += math.sin(degrees_to_radians(beta)) * offset
                np[i][1] += math.cos(degrees_to_radians(beta)) * offset
                np[i][2] += init_p[i][2]-h-Baseheight1
            return np
        pos1 = calc_pos_fixed(height, roll, pitch, point_init_pos,Baseheight1)
        pos = calc_pos_fixed(height, roll, pitch, point_init_pos,Baseheight1)
        len_list = []
        for i in range(len(point_init_pos)):
            distance = math.sqrt(
                (pos[i][0] - point_init_pos[i][0])**2 +
                (pos[i][1] - point_init_pos[i][1])**2 +
                (pos[i][2] - point_init_pos[i][2])**2
            )-Baseheight1
            len_list.append(round(distance, 2))
        return len_list,pos1
    elif Baseheight1==0 and Baseheight2!=0:
        roll=roll+betainit
        roll=-roll
        pitch=-pitch
        def degrees_to_radians(degrees):
            return degrees * math.pi / 180
        def apply_quaternion_rotation(x, y, z, quaternion):
            # Apply quaternion rotation to a point (x, y, z)
            w, qx, qy, qz = quaternion
            # Calculate the rotated coordinates
            x_rot = (1 - 2 * qy**2 - 2 * qz**2) * x + (2 * qx * qy - 2 * w * qz) * y + (2 * qx * qz + 2 * w * qy) * z
            y_rot = (2 * qx * qy + 2 * w * qz) * x + (1 - 2 * qx**2 - 2 * qz**2) * y + (2 * qy * qz - 2 * w * qx) * z
            z_rot = (2 * qx * qz - 2 * w * qy) * x + (2 * qy * qz + 2 * w * qx) * y + (1 - 2 * qx**2 - 2 * qy**2) * z

            return {'x': x_rot, 'y': y_rot, 'z': z_rot}
        def ni_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, math.sin(angle_rad / 2)]
        def shun_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, -math.sin(angle_rad / 2)]

        def shun_quat_rotate_x(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), math.sin(angle_rad / 2), 0, 0]

        def find_distance_fixed(points, beta):
            beta = -beta*math.pi/180.0 + math.pi / 2
            ray_dir = {'x': -math.cos(beta), 'y': -math.sin(beta)}
            min_distance = float('inf')
            n = len(points)
            for i in range(n):
                x1, y1, _ = points[i]
                x2, y2, _ = points[(i + 1) % n]
                ab = {'x': x2 - x1, 'y': y2 - y1}
                oa = {'x': -x1, 'y': -y1}
                denominator = ray_dir['x'] * ab['y'] - ray_dir['y'] * ab['x']
                if denominator == 0:
                    continue
                t = (oa['x'] * ab['y'] - oa['y'] * ab['x']) / denominator
                u = (ray_dir['x'] * oa['y'] - ray_dir['y'] * oa['x']) / denominator
                if t < 0 or u < 0 or u > 1:
                    continue
                intersection = {'x': ray_dir['x'] * t, 'y': ray_dir['y'] * t}
                distance = math.sqrt(intersection['x']**2 + intersection['y']**2)
                min_distance = min(min_distance, distance)
            return None if min_distance == float('inf') else min_distance

        def calc_pos_fixed(h, r, p, init_p,Baseheight2):
            pos = copy.deepcopy(init_p)
            beta = r
            angle = p
            n_q_z = ni_quat_rotate_z(beta)
            s_q_z = shun_quat_rotate_z(beta)
            s_q_x = shun_quat_rotate_x(angle)
            np = []
            for i in range(len(init_p)):
                pos[i][2] = 0
                a = apply_quaternion_rotation(pos[i][0], pos[i][1], pos[i][2], n_q_z)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_x)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_z)
                np.append([a['x'], a['y'], a['z']])
            
            offset = find_distance_fixed(init_p, beta)
            if offset != 0:
                pow_val = 1.73 + 0.52 * ((Baseheight2+maxheight-h) / offset)
                if pow_val > 100:
                    pow_val = 100
                a = offset / math.pow(1.5707963,pow_val)
                offset_t = a * math.pow(abs(angle*math.pi/180.0),pow_val)
                if offset_t > offset:
                    offset_t = offset
                offset = offset_t * (-1 if angle < 0 else 1)
            for i in range(len(init_p)):
                np[i][0] += math.sin(degrees_to_radians(beta)) * offset
                np[i][1] += math.cos(degrees_to_radians(beta)) * offset
                np[i][2] += init_p[i][2]+h-Baseheight2-maxheight
            return np
        pos1 = calc_pos_fixed(height, roll, pitch, point_init_pos,Baseheight2)
        pos = calc_pos_fixed(height, roll, pitch, point_init_pos,Baseheight2)
        len_list = []
        for i in range(len(point_init_pos)):
            distance =Baseheight2+maxheight- math.sqrt(
                (pos[i][0] - point_init_pos[i][0])**2 +
                (pos[i][1] - point_init_pos[i][1])**2 +
                (pos[i][2] - point_init_pos[i][2])**2
            )
            len_list.append(round(distance, 2))
        return len_list,pos1

# 反解
#results = duodian_inverse_model(limitData,hull_params, motor_H_inx, origin_distance1,origin_distance2,limitData[0][0], 3)
def duodian_inverse_model(limitData,points, target_distances, Baseheight1,Baseheight2,maxheight, max_recursive_calls,betainit):
    EPS = 1e-6
    def error_sum(params):
        height, pitch, roll = params
        try:
            actual_distance,POS1 = duodian_forward_solution(height, roll, pitch, points, Baseheight1,Baseheight2,maxheight,betainit)
        except Exception as e:
            return 1e9
        return np.sum((np.array(actual_distance) - np.array(target_distances)) ** 2)

    lb = [
        min(target_distances)-1 if min(target_distances)>0 else -1,limitData[1][0],limitData[2][0]]

    ub = [max(target_distances) + 1+EPS,limitData[1][1]+EPS,limitData[2][1]+EPS]
    
    f = io.StringIO()
    with contextlib.redirect_stdout(f):
            ret = pso(error_sum, lb, ub, swarmsize=50, maxiter=50, minstep=1e-6)
    best_params = ret.x
    best_error = ret.fun


    actual_distance,POS1 = duodian_forward_solution(best_params[0], best_params[2], best_params[1], points, Baseheight1,Baseheight2,maxheight,betainit)
    POS1 = np.array(POS1)
    if best_error <= 0.1  and np.all(POS1[:, 2] < 0):
        return best_params.tolist()
    else:
        if max_recursive_calls <= 0:
            return best_params.tolist()
        return duodian_inverse_model(limitData,points, target_distances, Baseheight1,Baseheight2,maxheight, max_recursive_calls - 1,betainit)

    
##两点摆超坐标计算
def liangdian_forward_model_coordinate(arg_x, height,lLenth_inside):
    arg_x_rad = arg_x / 180.0 * math.pi  # 转为弧度制
    yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0) 
    yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0) 
    return yA,yB

##四点摆超坐标计算
def sidian_forward_model_coordinate(arg_x_deg, arg_y_deg, height, lLenth_inside, wLenth_inside, moveWhat):
    if moveWhat == 1:
        arg_x_rad = math.radians(arg_x_deg)
        yA = height - math.sin(arg_x_rad) * (lLenth_inside / 2.0) 
        yB = height + math.sin(arg_x_rad) * (lLenth_inside / 2.0) 
        return [yA,yB]

    elif moveWhat == 2:
        arg_y_rad = math.radians(arg_y_deg)
        yA = height - math.sin(arg_y_rad) * (wLenth_inside / 2.0) 
        yB = height + math.sin(arg_y_rad) * (wLenth_inside / 2.0) 
        return [yA,yB]
    else:
        return [0,0]   

##多点摆超坐标计算
def duodian_forward_solution1(height, roll, pitch, point_init_pos,Baseheight1,Baseheight2,maxheight):
    if Baseheight1 !=0 and Baseheight2==0:
        def degrees_to_radians(degrees):
            return degrees * math.pi / 180
        def apply_quaternion_rotation(x, y, z, quaternion):
            w, qx, qy, qz = quaternion
            # Calculate the rotated coordinates
            x_rot = (1 - 2 * qy**2 - 2 * qz**2) * x + (2 * qx * qy - 2 * w * qz) * y + (2 * qx * qz + 2 * w * qy) * z
            y_rot = (2 * qx * qy + 2 * w * qz) * x + (1 - 2 * qx**2 - 2 * qz**2) * y + (2 * qy * qz - 2 * w * qx) * z
            z_rot = (2 * qx * qz - 2 * w * qy) * x + (2 * qy * qz + 2 * w * qx) * y + (1 - 2 * qx**2 - 2 * qy**2) * z
            return {'x': x_rot, 'y': y_rot, 'z': z_rot}
        def ni_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, math.sin(angle_rad / 2)]
        def shun_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, -math.sin(angle_rad / 2)]
        def shun_quat_rotate_x(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), math.sin(angle_rad / 2), 0, 0]
        def find_distance_fixed(points, beta):
            beta = -beta + math.pi / 2
            ray_dir = {'x': -math.cos(beta), 'y': -math.sin(beta)}
            min_distance = float('inf')
            n = len(points)
            for i in range(n):
                x1, y1, _ = points[i]
                x2, y2, _ = points[(i + 1) % n]
                ab = {'x': x2 - x1, 'y': y2 - y1}
                oa = {'x': -x1, 'y': -y1}
                denominator = ray_dir['x'] * ab['y'] - ray_dir['y'] * ab['x']
                if denominator == 0:
                    continue
                t = (oa['x'] * ab['y'] - oa['y'] * ab['x']) / denominator
                u = (ray_dir['x'] * oa['y'] - ray_dir['y'] * oa['x']) / denominator
                if t < 0 or u < 0 or u > 1:
                    continue
                intersection = {'x': ray_dir['x'] * t, 'y': ray_dir['y'] * t}
                distance = math.sqrt(intersection['x']**2 + intersection['y']**2)
                min_distance = min(min_distance, distance)
            return None if min_distance == float('inf') else min_distance

        def calc_pos_fixed(h, r, p, init_p,Baseheight1):
            pos = copy.deepcopy(init_p)
            beta = r
            angle = p
            n_q_z = ni_quat_rotate_z(beta)
            s_q_z = shun_quat_rotate_z(beta)
            s_q_x = shun_quat_rotate_x(angle)
            np = []
            for i in range(len(init_p)):
                pos[i][2] = 0
                a = apply_quaternion_rotation(pos[i][0], pos[i][1], pos[i][2], n_q_z)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_x)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_z)
                np.append([a['x'], a['y'], a['z']])
            offset = find_distance_fixed(init_p, degrees_to_radians(beta + (180 if angle < 0 else 0)))
            if offset != 0:
                pow_val = 1.73 + 0.52 * ((h+Baseheight1) / offset)
                if pow_val > 100:
                    pow_val = 100
                a = offset / (90**pow_val)
                offset_t = a * (abs(angle)**pow_val)
                if offset_t > offset:
                    offset_t = offset
                offset = offset_t * (-1 if angle < 0 else 1)
            for i in range(len(init_p)):
                np[i][0] += math.sin(degrees_to_radians(beta)) * offset
                np[i][1] += math.cos(degrees_to_radians(beta)) * offset
                np[i][2] += init_p[i][2]+h
            return np
        pos1 = calc_pos_fixed(height, roll, pitch, point_init_pos,Baseheight1)
        return pos1
    elif Baseheight1==0 and Baseheight2!=0:
        def degrees_to_radians(degrees):
            return degrees * math.pi / 180
        def apply_quaternion_rotation(x, y, z, quaternion):
            w, qx, qy, qz = quaternion
            # Calculate the rotated coordinates
            x_rot = (1 - 2 * qy**2 - 2 * qz**2) * x + (2 * qx * qy - 2 * w * qz) * y + (2 * qx * qz + 2 * w * qy) * z
            y_rot = (2 * qx * qy + 2 * w * qz) * x + (1 - 2 * qx**2 - 2 * qz**2) * y + (2 * qy * qz - 2 * w * qx) * z
            z_rot = (2 * qx * qz - 2 * w * qy) * x + (2 * qy * qz + 2 * w * qx) * y + (1 - 2 * qx**2 - 2 * qy**2) * z
            return {'x': x_rot, 'y': y_rot, 'z': z_rot}
        def ni_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, math.sin(angle_rad / 2)]
        def shun_quat_rotate_z(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), 0, 0, -math.sin(angle_rad / 2)]
        def shun_quat_rotate_x(angle_deg):
            angle_rad = degrees_to_radians(angle_deg)
            return [math.cos(angle_rad / 2), math.sin(angle_rad / 2), 0, 0]
        def find_distance_fixed(points, beta):
            beta = -beta + math.pi / 2
            ray_dir = {'x': -math.cos(beta), 'y': -math.sin(beta)}
            min_distance = float('inf')
            n = len(points)
            for i in range(n):
                x1, y1, _ = points[i]
                x2, y2, _ = points[(i + 1) % n]
                ab = {'x': x2 - x1, 'y': y2 - y1}
                oa = {'x': -x1, 'y': -y1}
                denominator = ray_dir['x'] * ab['y'] - ray_dir['y'] * ab['x']
                if denominator == 0:
                    continue
                t = (oa['x'] * ab['y'] - oa['y'] * ab['x']) / denominator
                u = (ray_dir['x'] * oa['y'] - ray_dir['y'] * oa['x']) / denominator
                if t < 0 or u < 0 or u > 1:
                    continue
                intersection = {'x': ray_dir['x'] * t, 'y': ray_dir['y'] * t}
                distance = math.sqrt(intersection['x']**2 + intersection['y']**2)
                min_distance = min(min_distance, distance)
            return None if min_distance == float('inf') else min_distance

        def calc_pos_fixed(h, r, p, init_p,Baseheight2,maxheight):
            pos = copy.deepcopy(init_p)
            beta = r
            angle = p
            n_q_z = ni_quat_rotate_z(beta)
            s_q_z = shun_quat_rotate_z(beta)
            s_q_x = shun_quat_rotate_x(angle)
            np = []
            for i in range(len(init_p)):
                pos[i][2] = 0
                a = apply_quaternion_rotation(pos[i][0], pos[i][1], pos[i][2], n_q_z)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_x)
                a = apply_quaternion_rotation(a['x'], a['y'], a['z'], s_q_z)
                np.append([a['x'], a['y'], a['z']])
            offset = find_distance_fixed(init_p, degrees_to_radians(beta + (180 if angle < 0 else 0)))
            if offset != 0:
                pow_val = 1.73 + 0.52 * ((maxheight+Baseheight2-h) / offset)
                if pow_val > 100:
                    pow_val = 100
                a = offset / (90**pow_val)
                offset_t = a * (abs(angle)**pow_val)
                if offset_t > offset:
                    offset_t = offset
                offset = offset_t * (-1 if angle < 0 else 1)
            for i in range(len(init_p)):
                np[i][0] += math.sin(degrees_to_radians(beta)) * offset
                np[i][1] += math.cos(degrees_to_radians(beta)) * offset
                np[i][2] += init_p[i][2]+h
            return np
        pos1 = calc_pos_fixed(height, roll, pitch, point_init_pos,Baseheight2,maxheight)
        return pos1


def ConvexHull(params,hull_X,hull_Y,pointNum):
    # ---------- 辅助函数 ----------
    def Orientation(x1, y1, x2, y2, x3, y3):
        val = (y2 - y1) * (x3 - x2) - (x2 - x1) * (y3 - y2)
        if abs(val) < 1e-9:
            return 0
        return 1 if val > 0 else 2

    def DistanceSq(x1, y1, x2, y2):
        return (x1 - x2) ** 2 + (y1 - y2) ** 2
    
    # ---------- 0. 点数检查 ----------
    if pointNum < 3:
        return 0
    # ================== 1. 找 pivot ==================
    pivotIndex = 0
    for i in range(1, pointNum):
        if (params[i][1] < params[pivotIndex][1]) or \
           (params[i][1] == params[pivotIndex][1] and params[i][0] < params[pivotIndex][0]):
            pivotIndex = i        
    # ================== 2. 拷贝并把 pivot 放第一个 ==================
    sortedX = [0.0] * pointNum
    sortedY = [0.0] * pointNum

    sortedX[0] = params[pivotIndex][0]
    sortedY[0] = params[pivotIndex][1]

    j = 1
    for i in range(pointNum):
        if i != pivotIndex:
            sortedX[j] = params[i][0]
            sortedY[j] = params[i][1]
            j += 1
    # ================== 3. 冒泡排序（极角） ==================
    for i in range(1, pointNum - 1):
        for j in range(i + 1, pointNum):
            o = Orientation(
                sortedX[0], sortedY[0],
                sortedX[i], sortedY[i],
                sortedX[j], sortedY[j]
            )

            if o == 1:  # 顺时针，交换
                sortedX[i], sortedX[j] = sortedX[j], sortedX[i]
                sortedY[i], sortedY[j] = sortedY[j], sortedY[i]

            elif o == 0:  # 共线，距离远的放前
                if DistanceSq(sortedX[0], sortedY[0], sortedX[j], sortedY[j]) > \
                   DistanceSq(sortedX[0], sortedY[0], sortedX[i], sortedY[i]):
                    sortedX[i], sortedX[j] = sortedX[j], sortedX[i]
                    sortedY[i], sortedY[j] = sortedY[j], sortedY[i]

    # ---------- 检查所有点是否共线 ----------
    allColinear = True
    for i in range(2, pointNum):
        if Orientation(sortedX[0], sortedY[0], sortedX[1], sortedY[1], sortedX[i], sortedY[i]) != 0:
            allColinear = False
            break

    if allColinear:
        # 找最小和最大点（按 x，然后按 y）
        minIndex = 0
        maxIndex = 0
        for i in range(1, pointNum):
            if (params[i][0] < params[minIndex][0]) or \
               (params[i][0] == params[minIndex][0] and params[i][1] < params[minIndex][1]):
                minIndex = i
            if (params[i][0] > params[maxIndex][0]) or \
               (params[i][0] == params[maxIndex][0] and params[i][1] > params[maxIndex][1]):
                maxIndex = i
        hull_X.clear()
        hull_Y.clear()
        hull_X.append(params[minIndex][0])
        hull_Y.append(params[minIndex][1])
        hull_X.append(params[maxIndex][0])
        hull_Y.append(params[maxIndex][1])
        return 2  # hullSize = 2

# ---------- 4. 初始化栈 ----------
    hull_X.clear()
    hull_Y.clear()
    hull_X.append(sortedX[0])
    hull_Y.append(sortedY[0])
    hull_X.append(sortedX[1])
    hull_Y.append(sortedY[1])
    hull_X.append(sortedX[2])
    hull_Y.append(sortedY[2])
    top = 3

    # ---------- 5. Graham Scan ----------
    for i in range(3, pointNum):
        while top >= 2 and Orientation(hull_X[top - 2], hull_Y[top - 2],
                                       hull_X[top - 1], hull_Y[top - 1],
                                       sortedX[i], sortedY[i]) != 2:
            hull_X.pop()
            hull_Y.pop()
            top -= 1
        hull_X.append(sortedX[i])
        hull_Y.append(sortedY[i])
        top += 1

    # ---------- 6. 返回凸包点数 ----------
    return top
def safe_asin(x):
    return math.asin(max(-1, min(1, x)))*180.0/math.pi

def test_case(args):
    index = args['index']
    type = args['type']
    origin_distance1 = args['origin_distance1']   #baseheight1
    origin_distance2 = args['origin_distance2']   #baseheight2
    params = args['params']                     #llenth_inside  内部坐标
    motor_H = args['motor_H']                   #链条长度
    limitData=args['limit_data']
    radius=args['limit_rim']     #外部长度
    betainit=args['betainit']
    HPY=args['HPY']
    if type == 31:  # 单点摆
        P = 0
        Y = 0
        H = dandian_inverse_model(HPY[0],motor_H,limitData[0][0],limitData[0][1])
        motorH = motor_H
        # 如果 H 是列表（数组），直接复制
        if isinstance(H, (list, tuple)):
            motorH = H.copy()
        else:
            # 如果 H 是单个值，生成和 motor_H 等长的列表
            motorH = [H] * len(motor_H)
    elif type == 32:  # 两点摆
        #判断给的反解对不对,对的话直接输出  不对的进行反解
        Apoint_guess, Bpoint_guess = liangdian_forward_model(HPY[1],HPY[0],origin_distance1,origin_distance2, params[0][0],limitData[0][1])
        if abs(round(Apoint_guess) - round(motor_H[0])) <= 150 and abs(round(Bpoint_guess) - round(motor_H[1])) <= 150:
            H=HPY[0]
            P=HPY[1]
            Y=0
            Apoint_outside_coordinate,Bpoint_outside_coordinate=liangdian_forward_model_coordinate(P, H,radius[0])
            if Apoint_outside_coordinate<=0 or Apoint_outside_coordinate>=limitData[0][1] or  Bpoint_outside_coordinate<=0 or Bpoint_outside_coordinate>=limitData[0][1]:
                if Apoint_outside_coordinate <= 0  :
                    height_guess_A = H
                    height_guess_B = 0
                    arg_x_guess_B = 0
                    arg_x_guess_A = (safe_asin(H / (radius[0]/2)))
                elif Apoint_outside_coordinate >= limitData[0][1] :
                    height_guess_A = H
                    arg_x_guess_B = 0
                    height_guess_B = 0
                    arg_x_guess_A =safe_asin(limitData[0][1]-H)
                if Bpoint_outside_coordinate <= 0 :
                    arg_x_guess_A = 0
                    height_guess_A = 0
                    height_guess_B = H
                    arg_x_guess_B =(safe_asin(H / (radius[0]/2)))
                elif Bpoint_outside_coordinate >= limitData[0][1] :
                    arg_x_guess_A = 0
                    height_guess_A = 0
                    height_guess_B = H
                    arg_x_guess_B =(safe_asin((limitData[0][1]-H)/(radius[0]/2)))
                if arg_x_guess_A>arg_x_guess_B and P!=0:
                    arg_x_guess=np.sign(P) *arg_x_guess_A
                    height_guess=height_guess_A
                elif arg_x_guess_A<arg_x_guess_B and P!=0:
                    arg_x_guess=np.sign(P) *arg_x_guess_B
                    height_guess=height_guess_B
                else:
                    arg_x_guess=arg_x_guess_A
                    height_guess=H
                H=height_guess
                P=arg_x_guess
            else:
                height_guess=H
                arg_x_guess=P   
            Apoint, Bpoint = liangdian_forward_model(arg_x_guess,height_guess, origin_distance1,origin_distance2, params[0][0],limitData[0][1])
            motorH = [Apoint, Bpoint]
        else:
            P, H = liangdian_reverse_model(motor_H[0], motor_H[1], origin_distance1,origin_distance2, params[0][0],limitData[0][1],3)
            Y=0
            Apoint_outside_coordinate,Bpoint_outside_coordinate=liangdian_forward_model_coordinate(P, H,radius[0])

            ##坐标超零点或者超最大点处理逻辑
            if Apoint_outside_coordinate<=0 or Apoint_outside_coordinate>=limitData[0][1] or  Bpoint_outside_coordinate<=0 or Bpoint_outside_coordinate>=limitData[0][1]:
                if Apoint_outside_coordinate <= 0 :
                    height_guess_A = H
                    height_guess_B = 0
                    arg_x_guess_B = 0
                    arg_x_guess_A = (safe_asin(H / (radius[0]/2)))
                elif Apoint_outside_coordinate >= limitData[0][1] :
                    height_guess_A = H
                    arg_x_guess_B = 0
                    height_guess_B = 0
                    arg_x_guess_A =(safe_asin((limitData[0][1]-H)/(radius[0]/2)))
                if Bpoint_outside_coordinate <= 0 :
                    arg_x_guess_A = 0
                    height_guess_A = 0
                    height_guess_B = H
                    arg_x_guess_B =(safe_asin(H / (radius[0]/2)))
                elif Bpoint_outside_coordinate >= limitData[0][1] :
                    arg_x_guess_A = 0
                    height_guess_A = 0
                    height_guess_B = H
                    arg_x_guess_B =(safe_asin((limitData[0][1]-H)/(radius[0]/2)))
                if arg_x_guess_A>arg_x_guess_B:
                    arg_x_guess=np.sign(P) *arg_x_guess_A
                    height_guess=height_guess_A
                elif arg_x_guess_A<arg_x_guess_B:
                    arg_x_guess=np.sign(P) *arg_x_guess_B
                    height_guess=height_guess_B
                else:
                    arg_x_guess=arg_x_guess_A
                    height_guess=H
                H=height_guess
                P=arg_x_guess
            else:
                height_guess=H
                arg_x_guess=P 
            Apoint, Bpoint = liangdian_forward_model(arg_x_guess,height_guess, origin_distance1,origin_distance2, params[0][0],limitData[0][1])
            motorH = [Apoint, Bpoint]
        ##两点摆对虚轴做限制
        H = max(min(H, limitData[0][1]), limitData[0][0])
        P = max(min(P, limitData[1][1]), limitData[1][0])
        Y = max(min(Y, limitData[2][1]), limitData[2][0])
        ##根据当前高度计算角度保护的值
        h_top= H-limitData[0][0]
        h_bottom=limitData[0][1]-H
        hMin= min(h_bottom, h_top)
        lCycle= radius[0]/2
        Xtransition= 88
        if hMin<lCycle:
            Xtransition= math.asin(hMin/lCycle)*180.0/math.pi
        Xlimit_min= max(-Xtransition, limitData[1][0])
        Xlimit_max= min(Xtransition, limitData[1][1])
        P=max(min(P, Xlimit_max), Xlimit_min)
        Apoint, Bpoint = liangdian_forward_model(P,H, origin_distance1,origin_distance2, params[0][0],limitData[0][1])
        motorH = [Apoint, Bpoint]
    elif type == 64:  # 四点摆
        #判断给的反解对不对,对的话直接输出  不对的进行反解 
        if abs(round(motor_H[1]) - round(motor_H[2])) <= 150 and abs(round(motor_H[0]) - round(motor_H[3])) <= 150:
            moveWhat1=1
        elif abs(round(motor_H[0]) - round(motor_H[1])) <= 150 and abs(round(motor_H[2]) - round(motor_H[3])) <= 150:
            moveWhat1=2
        else:
            moveWhat1=0
        Apoint_guess, Bpoint_guess, Cpoint_guess, Dpoint_guess = sidian_forward_model(HPY[1], HPY[2], HPY[0], origin_distance1,origin_distance2, params[0][0], params[0][1],limitData[0][1], moveWhat1)
        if all(abs(round(a) - round(m)) <= 150 for a, m in zip([Apoint_guess, Bpoint_guess, Cpoint_guess, Dpoint_guess], motor_H)):
            H=HPY[0]
            P=HPY[1]
            Y=HPY[2]
            Apoint_outside_coordinate,Bpoint_outside_coordinate=sidian_forward_model_coordinate(P, Y, H,radius[0], radius[1], moveWhat1)
            ##特殊情况处理函数
            if moveWhat1==1: # 12一样 0 3一样  说明x有值
                if Apoint_outside_coordinate<=0 or Apoint_outside_coordinate>=limitData[0][1] or  Bpoint_outside_coordinate<=0 or Bpoint_outside_coordinate>=limitData[0][1] :
                    if Apoint_outside_coordinate <= 0 :
                        height_guess_A = H
                        height_guess_B = 0
                        arg_x_guess_B = 0
                        arg_x_guess_A =(safe_asin(H / (radius[0]/2)))
                    elif Apoint_outside_coordinate >= limitData[0][1]:
                        height_guess_A = H
                        arg_x_guess_B = 0
                        height_guess_B = 0
                        arg_x_guess_A =(safe_asin((limitData[0][1]-H)/(radius[0]/2)))
                    if Bpoint_outside_coordinate <= 0:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B =(safe_asin(H / (radius[0]/2)))
                    elif Bpoint_outside_coordinate >= limitData[0][1]:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B =(safe_asin((limitData[0][1]-H)/(radius[0]/2)))
                    if arg_x_guess_A>arg_x_guess_B and P!=0:
                        arg_x_guess=np.sign(P) *arg_x_guess_A
                        arg_y_guess=0
                        height_guess=height_guess_A
                    elif arg_x_guess_A<arg_x_guess_B and P!=0:
                        arg_x_guess=np.sign(P) *arg_x_guess_B
                        arg_y_guess=0
                        height_guess=height_guess_B
                    else:
                        arg_x_guess=arg_x_guess_A
                        arg_y_guess=0
                        height_guess=H
                    P=arg_x_guess
                    Y=arg_y_guess
                    H=height_guess
                else:
                    arg_x_guess=P
                    arg_y_guess=Y
                    height_guess=H
            elif moveWhat1==2: # 01一样 23一样  说明y有值
                if Apoint_outside_coordinate<=0 or Apoint_outside_coordinate>=limitData[0][1] or  Bpoint_outside_coordinate<=0 or Bpoint_outside_coordinate>=limitData[0][1]:
                    if Apoint_outside_coordinate <= 0:
                        height_guess_A = H
                        height_guess_B = 0
                        arg_x_guess_B = 0
                        arg_x_guess_A = (safe_asin(H / (radius[1]/2)))
                    elif Apoint_outside_coordinate >= limitData[0][1]:
                        height_guess_A = H
                        arg_x_guess_B = 0
                        height_guess_B = 0
                        arg_x_guess_A = (safe_asin((limitData[0][1]-H)/(radius[1]/2)))
                    if Bpoint_outside_coordinate <= 0:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B = (safe_asin(H / (radius[1]/2)))
                    elif Bpoint_outside_coordinate >= limitData[0][1]:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B = (safe_asin((limitData[0][1]-H)/(radius[1]/2)))
                    if arg_x_guess_A>arg_x_guess_B and Y!=0:
                        arg_x_guess=0
                        arg_y_guess=np.sign(Y) *arg_x_guess_A
                        height_guess=height_guess_A
                    elif arg_x_guess_A<arg_x_guess_B and Y!=0:
                        arg_x_guess=0
                        arg_y_guess=np.sign(Y) *arg_x_guess_B
                        height_guess=height_guess_B
                    else:
                        arg_x_guess=0
                        arg_y_guess=arg_x_guess_A
                        height_guess=H
                    P=arg_x_guess
                    Y=arg_y_guess
                    H=height_guess
                else:
                    arg_x_guess=P
                    arg_y_guess=Y
                    height_guess=H
            Apoint, Bpoint, Cpoint, Dpoint = sidian_forward_model(arg_x_guess, arg_y_guess, height_guess, origin_distance1,origin_distance2,params[0][0], params[0][1],limitData[0][1], moveWhat1)
            motorH = [Apoint, Bpoint, Cpoint, Dpoint]
        else:
            P,Y, H, moveWhat1 = sidian_reverse_model(motor_H[0], motor_H[1], motor_H[2], motor_H[3], origin_distance1,origin_distance2, params[0][0], params[0][1],limitData[0][1],50)
            Apoint_outside_coordinate,Bpoint_outside_coordinate=sidian_forward_model_coordinate(P, Y, H, radius[0], radius[1], moveWhat1)
            ##特殊情况处理函数
            if moveWhat1==1: # 12一样 0 3一样  说明x有值
                _lOffset=0
                h_top= H-_lOffset
                h_bottom= limitData[0][1]-H
                hMin= min(h_bottom, h_top)
                limit_angle=safe_asin(hMin/(radius[0]/2))+0.2
                if Apoint_outside_coordinate<=0 or Apoint_outside_coordinate>=limitData[0][1] or  Bpoint_outside_coordinate<=0 or Bpoint_outside_coordinate>=limitData[0][1] :
                    if Apoint_outside_coordinate <= 0 :
                        height_guess_A = H
                        height_guess_B = 0
                        arg_x_guess_B = 0
                        arg_x_guess_A =(safe_asin(H / (radius[0]/2)))
                    elif Apoint_outside_coordinate >= limitData[0][1]:
                        height_guess_A = H
                        arg_x_guess_B = 0
                        height_guess_B = 0
                        arg_x_guess_A =(safe_asin((limitData[0][1]-H)/(radius[0]/2)))
                    if Bpoint_outside_coordinate <= 0:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B =(safe_asin(H / (radius[0]/2)))
                    elif Bpoint_outside_coordinate >= limitData[0][1]:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B =(safe_asin((limitData[0][1]-H)/(radius[0]/2)))
                    if arg_x_guess_A>arg_x_guess_B and P!=0:
                        arg_x_guess=np.sign(P) *arg_x_guess_A
                        arg_y_guess=0
                        height_guess=height_guess_A
                    elif arg_x_guess_A<arg_x_guess_B and P!=0:
                        arg_x_guess=np.sign(P) *arg_x_guess_B
                        arg_y_guess=0
                        height_guess=height_guess_B
                    else:
                        arg_x_guess=arg_x_guess_A
                        arg_y_guess=0
                        height_guess=H
                    P=arg_x_guess
                    Y=arg_y_guess
                    H=height_guess
                else:
                    arg_x_guess=P
                    arg_y_guess=Y
                    height_guess=H
            elif moveWhat1==2: # 01一样 23一样  说明x有值
                _lOffset=0
                h_top= H-_lOffset
                h_bottom= limitData[0][1]-H
                hMin= min(h_bottom, h_top)
                limit_angle=safe_asin(hMin/(radius[1]/2))+0.2
                if Apoint_outside_coordinate<=0 or Apoint_outside_coordinate>=limitData[0][1] or  Bpoint_outside_coordinate<=0 or Bpoint_outside_coordinate>=limitData[0][1]:
                    if Apoint_outside_coordinate <= 0:
                        height_guess_A = H
                        height_guess_B = 0
                        arg_x_guess_B = 0
                        arg_x_guess_A = (safe_asin(H / (radius[1]/2)))
                    elif Apoint_outside_coordinate >= limitData[0][1]:
                        height_guess_A = H
                        arg_x_guess_B = 0
                        height_guess_B = 0
                        arg_x_guess_A = (safe_asin((limitData[0][1]-H)/(radius[1]/2)))
                    if Bpoint_outside_coordinate <= 0:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B = (safe_asin(H / (radius[1]/2)))
                    elif Bpoint_outside_coordinate >= limitData[0][1]:
                        arg_x_guess_A = 0
                        height_guess_A = 0
                        height_guess_B = H
                        arg_x_guess_B = (safe_asin((limitData[0][1]-H)/(radius[1]/2)))
                    if arg_x_guess_A>arg_x_guess_B and Y!=0:
                        arg_x_guess=0
                        arg_y_guess=np.sign(Y) *arg_x_guess_A
                        height_guess=height_guess_A
                    elif arg_x_guess_A<arg_x_guess_B and Y!=0:
                        arg_x_guess=0
                        arg_y_guess=np.sign(Y)*arg_x_guess_B
                        height_guess=height_guess_B
                    else:
                        arg_x_guess=0
                        arg_y_guess=arg_x_guess_A
                        height_guess=H
                    P=arg_x_guess
                    Y=arg_y_guess
                    H=height_guess
                else:
                    arg_x_guess=P
                    arg_y_guess=Y
                    height_guess=H
            Apoint, Bpoint, Cpoint, Dpoint = sidian_forward_model(arg_x_guess, arg_y_guess, height_guess, origin_distance1,origin_distance2, params[0][0], params[0][1], limitData[0][1],moveWhat1)
            motorH = [Apoint, Bpoint, Cpoint, Dpoint]
        ##四点摆对虚轴做限制
        H = max(min(H, limitData[0][1]), limitData[0][0])
        P = max(min(P, limitData[1][1]), limitData[1][0])
        Y = max(min(Y, limitData[2][1]), limitData[2][0])
        ##根据当前高度计算角度保护的值
        h_top= H-limitData[0][0]
        h_bottom=limitData[0][1]-H
        hMin= min(h_bottom, h_top)
        lCycle= radius[0]/2
        wCycle= radius[1]/2
        Xtransition= 88
        Ytransition= 88
        if hMin<lCycle:
            Xtransition= math.asin(hMin/lCycle)*180.0/math.pi
        if hMin<wCycle:
            Ytransition= math.asin(hMin/wCycle)*180.0/math.pi
        Xlimit_min= max(-Xtransition, limitData[1][0])
        Xlimit_max= min(Xtransition, limitData[1][1])
        Ylimit_min= max(-Ytransition, limitData[2][0])
        Ylimit_max= min(Ytransition, limitData[2][1])
        P=max(min(P, Xlimit_max), Xlimit_min)
        Y=max(min(Y, Ylimit_max), Ylimit_min)
        Apoint, Bpoint, Cpoint, Dpoint = sidian_forward_model(P, Y, H, origin_distance1,origin_distance2, params[0][0], params[0][1],limitData[0][1], moveWhat1)
        motorH = [Apoint, Bpoint, Cpoint, Dpoint]
    elif type == 63:  # 多点摆
        #12.16修改  增加凸包算法与PLC一致
        hull_X = []
        hull_Y = []
        hullSize = ConvexHull(params, hull_X, hull_Y, len(params))
        def build_hull_params(params, hull_X, hull_Y, hullSize, eps=1e-6):
            hull_params = []
            hull_indices = []
            for i in range(hullSize):
                hx = hull_X[i]
                hy = hull_Y[i]

                for idx, (x, y, z) in enumerate(params):
                    if abs(x - hx) <= eps and abs(y - hy) <= eps:
                        hull_params.append([x, y, z])
                        hull_indices.append(idx)
                        break

            return hull_params, hull_indices
        #利用新的hullx和hully构建新的params坐标，hull_indices记录索引 逆时针顺序
        hull_params,hull_indices  = build_hull_params(params, hull_X, hull_Y, hullSize)
        #把所有的params坐标的y改为负数
        #params=[[x,-y,z]for x,y,z in args['params']]
        #判断给的反解对不对,对的话直接输出  不对的进行反解 
        result,pos1 = duodian_forward_solution(HPY[0], HPY[2], HPY[1], hull_params,origin_distance1,origin_distance2,limitData[0][1],betainit)
        motor_H_inx = []

        for i, r in enumerate(result):
            motor_H_inx.append(motor_H[hull_indices[i]])
        if all(abs(round(result[i]) - round(motor_H_inx[i])) <= 150 for i in range(len(result))):    
    # 满足条件的逻辑
            H=HPY[0]
            P=HPY[1]
            Y=HPY[2]
            results = [H,P,Y]
            ##判断特殊情况
                #首先计算最小的半径
            r_min = min((x**2 + y**2)**0.5 for (x, y, z) in hull_params)
            if radius[0]>=r_min:
                #根据最小半径将坐标扩大
                point_init_pos_max = [(x * (radius[0] / r_min), y * (radius[0] / r_min), 0) for (x, y, z) in hull_params]
                point_init_pos_max = [list(p) for p in point_init_pos_max]
                #带入正解找到最大的那个值，利用它求解最小值
                result_guess,zuobiao_guess0=duodian_forward_solution(results[0], results[2], results[1], point_init_pos_max,origin_distance1,origin_distance2,limitData[0][1],betainit)
                #求解初始的那个坐标
                zuobiao_guess1=duodian_forward_solution1(results[0], results[2], results[1], point_init_pos_max,origin_distance1,origin_distance2,limitData[0][1])
                max_z = max(p[2] for p in zuobiao_guess0)##这是所有坐标中最大的那个值  令其为0 角度还是原来的角度求解height
                max_index = [p[2] for p in zuobiao_guess0].index(max_z)  #这是所有坐标中最大的那个值的索引
                #找出对应索引的第三个初始坐标
                z_value = zuobiao_guess1[max_index][2]
                ##根据最小的坐标计算最小角度  其中min_z其实等于minz+h+Baseheight=0
                if z_value<=0 or z_value>=limitData[0][1] :
                    if origin_distance1!=0 and origin_distance2==0:
                        height_guess=results[0] 
                        pitch_guess=np.sign(P)*(safe_asin(height_guess/radius[0]))
                        roll_guess=results[2]
                    elif origin_distance1==0 and origin_distance2!=0:
                        height_guess=results[0]
                        pitch_guess=np.sign(P)*(safe_asin((limitData[0][1]-height_guess)/radius[0]))
                        roll_guess=results[2]
                else:
                    height_guess=results[0]
                    pitch_guess=results[1]  
                    roll_guess=results[2]
            else:
                height_guess=results[0]
                pitch_guess=results[1]  
                roll_guess=results[2]
            if abs(pitch_guess)<0.5:
                roll_guess=0 
            result,pos1 = duodian_forward_solution(height_guess, roll_guess, pitch_guess, hull_params,origin_distance1,origin_distance2,limitData[0][1],betainit)
            # 1. 先构造一个“全量 result”，长度和原始 motor_H 一致
            full_result = motor_H.copy()   # 或者 [0]*len(motor_H)
            # 2. 用 hull_indices 把凸包计算结果回填
            for i, r in enumerate(result):
                orig_idx = hull_indices[i]
                full_result[orig_idx] = r
            # 3. 如果你希望“最终结果仍然叫 result”
            result = full_result
            motorH = result
            H =H
            P =P
            Y =Y
        else:
            #12.27新增 当高度相差较小的时候需要直接输出值
            max_val = max(motor_H)
            min_val = min(motor_H)
            if abs(max_val)-abs(min_val)<50:
                HPY[0]=min_val
                HPY[1]=0
                HPY[2]=0
                H=HPY[0]
                P=HPY[1]
                Y=HPY[2]
                result,pos1 = duodian_forward_solution(HPY[0], HPY[2], HPY[1], hull_params,origin_distance1,origin_distance2,limitData[0][1],betainit)
                motor_H_inx = []
                for i, r in enumerate(result):
                    motor_H_inx.append(motor_H[hull_indices[i]])
            else:
                results = duodian_inverse_model(limitData,hull_params, motor_H_inx, origin_distance1,origin_distance2,limitData[0][1], 3,betainit)
                ##判断特殊情况
                    #首先计算最小的半径
                r_min = min((x**2 + y**2)**0.5 for (x, y, z) in hull_params)
                if radius[0]>=r_min:
                     #根据最小半径将坐标扩大
                    point_init_pos_max = [(x * (radius[0] / r_min), y * (radius[0] / r_min), 0) for (x, y, z) in hull_params]
                    point_init_pos_max = [list(p) for p in point_init_pos_max]
                    #带入正解找到最大的那个值，利用它求解最小值
                    result_guess,zuobiao_guess0=duodian_forward_solution(results[0], results[2], results[1], point_init_pos_max,origin_distance1,origin_distance2,limitData[0][1],betainit)
                    #求解初始的那个坐标
                    zuobiao_guess1=duodian_forward_solution1(results[0], results[2], results[1], point_init_pos_max,origin_distance1,origin_distance2,limitData[0][1])
                    max_z = max(p[2] for p in zuobiao_guess0)##这是所有坐标中最大的那个值  令其为0 角度还是原来的角度求解height
                    max_index = [p[2] for p in zuobiao_guess0].index(max_z)  #这是所有坐标中最大的那个值的索引
                    #找出对应索引的第三个初始坐标
                    z_value = zuobiao_guess1[max_index][2]
                    ##根据最小的坐标计算最小角度  其中min_z其实等于minz+h+Baseheight=0
                    if z_value<=0 or z_value>=limitData[0][1] :
                        if origin_distance1!=0 and origin_distance2==0:
                            height_guess=results[0] 
                            pitch_guess=np.sign(P)*(safe_asin(height_guess/radius[0]))
                            roll_guess=results[2]
                        elif origin_distance1==0 and origin_distance2!=0:
                            height_guess=results[0]
                            pitch_guess=np.sign(P)*(safe_asin((limitData[0][1]-height_guess)/radius[0]))
                            roll_guess=results[2]
                    else:
                        height_guess=results[0]
                        pitch_guess=results[1]  
                        roll_guess=results[2]
                else:
                    height_guess=results[0]
                    roll_guess=results[2]
                    pitch_guess=results[1]  
                if abs(pitch_guess)<0.5:
                    roll_guess=0 
                result,pos1 = duodian_forward_solution(height_guess, roll_guess, pitch_guess, hull_params,origin_distance1,origin_distance2,limitData[0][1],betainit)
                motorH = result
                H =results[0]
                P =results[1]
                Y =results[2]
        ##多点摆对虚轴做限制
        H = max(min(H, limitData[0][1]), limitData[0][0])
        P = max(min(P, limitData[1][1]), limitData[1][0])
        Y = max(min(Y, limitData[2][1]), limitData[2][0])
        ##根据当前高度计算角度保护的值
        h_top= H-limitData[0][0]
        h_bottom=limitData[0][1]-H
        hMin= min(h_bottom, h_top)
        Xtransition= 88
        if hMin<radius[0]:
            Xtransition= math.asin(hMin/radius[0])*180.0/math.pi
        Xlimit_min= max(-Xtransition, limitData[1][0])
        Xlimit_max= min(Xtransition, limitData[1][1])
        P=max(min(P, Xlimit_max), Xlimit_min)
        result,pos1 = duodian_forward_solution(H, Y, P, hull_params,origin_distance1,origin_distance2,limitData[0][1],betainit)
        # 1. 先构造一个“全量 result”，长度和原始 motor_H 一致
        full_result = motor_H.copy()   # 或者 [0]*len(motor_H)
        # 2. 用 hull_indices 把凸包计算结果回填
        for i, r in enumerate(result):
            orig_idx = hull_indices[i]
            full_result[orig_idx] = r
        # 3. 如果你希望“最终结果仍然叫 result”
        result = full_result
        motorH = result
    P=P
    Y=Y
    result_H = motorH
        # 对 H 保留两位小数四舍五入
    def truncate_abs_small(x, decimals=2):
        factor = 10 ** decimals
        if x >= 0:
            return math.floor(x * factor) / factor
        else:
            return math.ceil(x * factor) / factor
    # 示例
    H_rounded = round(H, 2)  # H仍用四舍五入
    P_floor = truncate_abs_small(P, 2)
    Y_floor = truncate_abs_small(Y, 2)
    result = [H_rounded, P_floor, Y_floor]
    result_H = [round(value, 0) for value in result_H]
    return {
        'index':index,
        'HPY': result,
        'Motor_H': result_H,
    }


import threading,psutil,time,shutil,sys

HOST="127.0.0.1"
PORT=5000
CHUNK_SIZE=4096
OUTPUT_VERSION="1.0"
OUTPUT_FILE_NAME="YXZ.json"
if getattr(sys,"frozen",False): BASE_DIR=os.path.dirname(os.path.abspath(sys.executable))
else: BASE_DIR=os.path.dirname(os.path.abspath(__file__))
WATCH_FILE=os.path.join(BASE_DIR,"YXZ_call.json")
REQUIRED_FIELDS=['index','type','origin_distance1','origin_distance2','params','motor_H','limit_data','limit_rim','betainit','HPY']

def check_data_available(args):
    if not isinstance(args,dict): return False,REQUIRED_FIELDS.copy()
    missing=[f for f in REQUIRED_FIELDS if f not in args]
    return len(missing)==0,missing

def process_data(data):
    return [test_case(x) for x in data] if isinstance(data,list) else test_case(data)

def build_output(version,err="",data=None):
    return {"version":str(version),"errPrintStr":err,"data":[] if data is None else data}

def write_output(output_dir,data):
    path=os.path.join(output_dir,OUTPUT_FILE_NAME)
    with open(path,"w",encoding="utf-8") as f: json.dump(data,f,ensure_ascii=False,indent=4)
    return path

def append_error(errors,error_type,msg):
    errors.append(f"{error_type}: {msg}")

def copy_call_file(output_dir):
    dst=os.path.join(output_dir,"YXZ_call.json")
    if os.path.normcase(os.path.abspath(WATCH_FILE))!=os.path.normcase(os.path.abspath(dst)): shutil.copy2(WATCH_FILE,dst)
    return dst

def free_port(port):
    for c in psutil.net_connections(kind='tcp'):
        if c.laddr and c.laddr.port==port and c.status=='LISTEN':
            try:
                p=psutil.Process(c.pid)
                print(f"杀掉占用端口 {port} 的进程 PID={c.pid}")
                p.kill()
            except Exception as e: print(f"释放端口失败: {e}")

free_port(PORT)

def send_json_in_chunks(conn,data,chunk_size=CHUNK_SIZE):
    try:
        b=json.dumps(data,ensure_ascii=False).encode("utf-8")
        for i in range(0,len(b),chunk_size): conn.sendall(b[i:i+chunk_size])
    except (ConnectionResetError,ConnectionAbortedError,BrokenPipeError):
        print("客户端已断开连接")
    except Exception as e: print("发送数据异常:",e)

def handle_client(conn,addr):
    print(f"客户端已连接: {addr}")
    try:
        while True:
            try:
                recv_data=conn.recv(CHUNK_SIZE)
            except (ConnectionResetError,ConnectionAbortedError):
                print(f"客户端 {addr} 已断开连接")
                break
            print("rec:",recv_data)
            if not recv_data:
                print(f"客户端 {addr} 已关闭连接")
                break

            if not os.path.exists(WATCH_FILE):
                out=build_output(OUTPUT_VERSION,"SOURCE_PARSE_ERROR: YXZ_call.json文件不存在")
                try: write_output(BASE_DIR,out)
                except Exception as e: print(f"生成错误结果文件失败: {e}")
                try: conn.sendall(b'{"error":"file not found"}')
                except (ConnectionResetError,ConnectionAbortedError,BrokenPipeError):
                    print(f"客户端 {addr} 已断开连接")
                    break
                print(BASE_DIR)
                continue

            try:
                with open(WATCH_FILE,"r",encoding="utf-8") as f: config=json.load(f)
            except Exception as e:
                out=build_output(OUTPUT_VERSION,f"SOURCE_PARSE_ERROR: YXZ_call.json解析失败: {e}")
                try: write_output(BASE_DIR,out)
                except Exception as e2: print(f"生成错误结果文件失败: {e2}")
                try: conn.sendall(b'{"error":"json parse failed"}')
                except (ConnectionResetError,ConnectionAbortedError,BrokenPipeError):
                    print(f"客户端 {addr} 已断开连接")
                    break
                continue

            errors=[]
            all_results=[]
            output_dir=BASE_DIR
            items=[]
            path_valid=False

            if not isinstance(config,dict):
                append_error(errors,"SOURCE_PARSE_ERROR","YXZ_call.json顶层必须是对象")
            else:
                p=config.get("path")
                d=config.get("data")

                if not isinstance(p,str) or not p.strip():
                    append_error(errors,"SOURCE_PARSE_ERROR","path缺失或为空")
                else:
                    output_dir=p.strip()
                    if not os.path.isabs(output_dir): output_dir=os.path.abspath(os.path.join(BASE_DIR,output_dir))
                    if not os.path.isdir(output_dir):
                        append_error(errors,"SOURCE_PARSE_ERROR",f"path不存在: {output_dir}")
                        output_dir=BASE_DIR
                    else:
                        path_valid=True

                if not isinstance(d,list):
                    append_error(errors,"SOURCE_PARSE_ERROR","data缺失或不是数组")
                else:
                    items=d

            if path_valid:
                try:
                    dst=copy_call_file(output_dir)
                    print(f"YXZ_call.json已保存到: {dst}")
                except Exception as e:
                    append_error(errors,"SOURCE_PARSE_ERROR",f"YXZ_call.json复制失败: {e}")

            for pos,item in enumerate(items):
                if not isinstance(item,dict):
                    append_error(errors,"SOURCE_PARSE_ERROR",f"data[{pos}]不是对象")
                    continue

                index=item.get("index",pos+1)
                valid,missing=check_data_available(item)

                if not valid:
                    append_error(errors,"SOURCE_PARSE_ERROR",f"index={index} 缺少字段: {','.join(missing)}")
                    continue

                try:
                    all_results.append(process_data(item))
                except Exception as e:
                    append_error(errors,"COUPLING_MODULE_ERROR",f"index={index} {e}")

            out=build_output(OUTPUT_VERSION,"\n".join(errors),all_results)

            try:
                output_file=write_output(output_dir,out)
                local_output_file=write_output(BASE_DIR,out)
                print(f"目标结果已生成: {output_file}")
                print(f"本地结果已生成: {local_output_file}")
            except Exception as e:
                append_error(errors,"SOURCE_PARSE_ERROR",f"YXZ.json写入失败: {e}")
                out=build_output(OUTPUT_VERSION,"\n".join(errors),all_results)
                try:
                    fallback=write_output(BASE_DIR,out)
                    print(f"目标路径写入失败，错误结果已生成到: {fallback}")
                except Exception as e2:
                    print(f"生成YXZ.json失败: {e2}")

            print("send:",recv_data)
            try:
                conn.sendall(recv_data)
            except (ConnectionResetError,ConnectionAbortedError,BrokenPipeError):
                print(f"客户端 {addr} 已断开连接")
                break

    except Exception:
        print("客户端处理异常:\n",traceback.format_exc())
    finally:
        conn.close()

def start_server():
    with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        s.bind((HOST,PORT))
        s.listen(5)
        print(f"服务器已启动，监听 {HOST}:{PORT}")
        print(f"程序目录: {BASE_DIR}")
        print(f"读取文件: {WATCH_FILE}")
        while True:
            conn,addr=s.accept()
            threading.Thread(target=handle_client,args=(conn,addr),daemon=True).start()

if __name__=="__main__":
    threading.Thread(target=start_server,daemon=True).start()
    print("服务器已启动，按 Ctrl+C 停止")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        print("服务器已停止")