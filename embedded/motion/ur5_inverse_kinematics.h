#ifndef UR5_INVERSE_KINEMATICS_H
#define UR5_INVERSE_KINEMATICS_H

#include <Eigen/Dense>
#include <vector>

namespace motion
{
  class UR5InverseKinematics
  {
  public:
    UR5InverseKinematics();
    /**
     * @brief UR5 解析逆运动学（Modified‑DH模型）
     * @param T_target 目标法兰link_6的4×4齐次变换矩阵
     * @return 可行关节角解集合，每个VectorXd为6维[q1,q2,q3,q4,q5,q6]，单位rad；无解返回空
     */
    std::vector<Eigen::VectorXd> compute_ik(const Eigen::Matrix4d &T_target);

  private:
    Eigen::MatrixXd mdh_params_;
  };
}

#endif