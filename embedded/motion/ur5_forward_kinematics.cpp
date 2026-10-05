#define _USE_MATH_DEFINES
#include "ur5_forward_kinematics.h"
#include <cmath>

namespace motion
{
  UR5ForwardKinematics::UR5ForwardKinematics()
  {
    // 初始化UR5的MDH参数矩阵
    mdh_params_.resize(6, 4);
    mdh_params_ << 0.0000, 0.0000, 0.0232, 0,
        0.0000, -M_PI / 2, 0.0000, 0,
        0.4251, 0.0000, 0.0000, 0,
        0.3922, 0.0000, 0.0000, 0,
        0.0000, M_PI / 2, 0.0000, 0,
        0.0000, -M_PI / 2, 0.0492, 0;
  }

  Eigen::Matrix4d UR5ForwardKinematics::get_link_transform(double a, double alpha, double d, double theta)
  {
    // 计算单根连杆的MDH齐次变换矩阵
    Eigen::Matrix4d T;
    T << cos(theta), -sin(theta) * cos(alpha), sin(theta) * sin(alpha), a * cos(theta),
        sin(theta), cos(theta) * cos(alpha), -cos(theta) * sin(alpha), a * sin(theta),
        0, sin(alpha), cos(alpha), d,
        0, 0, 0, 1;
    return T;
  }

  Eigen::Matrix4d UR5ForwardKinematics::compute_fk(const Eigen::VectorXd &joint_angle)
  {
    // 总变换矩阵，初始为单位矩阵
    Eigen::Matrix4d T_total = Eigen::Matrix4d::Identity();

    // 循环遍历6个连杆，依次相乘得到基座到末端总位姿
    for (int i = 0; i < 6; i++)
    {
      double a = mdh_params_(i, 0);
      double alpha = mdh_params_(i, 1);
      double d = mdh_params_(i, 2);
      // 当前连杆的theta = DH参数里的偏移 + 输入的关节角度
      double theta = mdh_params_(i, 3) + joint_angle(i);

      Eigen::Matrix4d T_link = get_link_transform(a, alpha, d, theta);
      T_total = T_total * T_link;
    }
    return T_total;
  }

}
