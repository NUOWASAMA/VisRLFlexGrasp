#ifndef KINEMATICS_UTILS_H
#define KINEMATICS_UTILS_H

#include <Eigen/Dense>

namespace motion
{
  class KinematicsUtils
  {
  public:
    // 角度归一化到 [-π, π]    // 辅助函数：角度归一到 [-pi, pi]
    static double wrap_angle(double ang);

  public:
    // UR5正运动学工具类
    static Eigen::Vector3d get_position(const Eigen::Matrix4d &transform_matrix);
  };
}

#endif