#define _USE_MATH_DEFINES
#include "ur5_inverse_kinematics.h"
#include <cmath>

namespace motion
{
  UR5InverseKinematics::UR5InverseKinematics()
  {
    mdh_params_.resize(6, 4);
    mdh_params_ << 0.0000, 0.0000, 0.0232, 0,
        0.0000, -M_PI / 2, 0.0000, 0,
        0.4251, 0.0000, 0.0000, 0,
        0.3922, 0.0000, 0.0000, 0,
        0.0000, M_PI / 2, 0.0000, 0,
        0.0000, -M_PI / 2, 0.0492, 0;
  }

  std::vector<Eigen::VectorXd> UR5InverseKinematics::compute_ik(const Eigen::Matrix4d &T_target)
  {
    std::vector<Eigen::VectorXd> solutions;

    // 待填充：UR5 MDH解析逆解数学逻辑

    return solutions;
  }

}