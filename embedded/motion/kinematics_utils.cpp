#define _USE_MATH_DEFINES
#include "kinematics_utils.h"
#include <cmath>
namespace motion
{
  double KinematicsUtils::wrap_angle(double ang)
  {
    // 将角度归一到 [-M_PI , M_PI]
    ang = fmod(ang, 2.0 * M_PI);
    if (ang > M_PI)
      ang -= 2.0 * M_PI;
    if (ang < -M_PI)
      ang += 2.0 * M_PI;
    return ang;
  }

  Eigen::Vector3d KinematicsUtils::get_position(const Eigen::Matrix4d &transform_matrix)
  {
    // 从4×4齐次矩阵提取X Y Z位置
    Eigen::Vector3d xyz;
    xyz(0) = transform_matrix(0, 3);
    xyz(1) = transform_matrix(1, 3);
    xyz(2) = transform_matrix(2, 3);
    return xyz;
  }
}