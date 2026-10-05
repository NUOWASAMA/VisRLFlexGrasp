#define _USE_MATH_DEFINES
#include "trajectory_planner.h"
#include "kinematics_utils.h"
#include <cmath>

namespace motion
{
  std::vector<Eigen::Matrix4d> TrajectoryPlanner::cartesian_line(const Eigen::Matrix4d &start_pose, const Eigen::Matrix4d &end_pose, int step_num)
  {
    std::vector<Eigen::Matrix4d> pose_seq;
    pose_seq.reserve(step_num);

    // 提取起点、终点三维坐标，复用工具类
    Eigen::Vector3d p_start = KinematicsUtils::get_position(start_pose);
    Eigen::Vector3d p_end = KinematicsUtils::get_position(end_pose);

    for (int i = 0; i < step_num; i++)
    {
      // 归一化插值系数 t ∈ [0, 1]
      double t = static_cast<double>(i) / (step_num - 1);
      Eigen::Vector3d p_interp = (1.0 - t) * p_start + t * p_end;

      // 姿态保持起点不变，仅更新平移XYZ
      Eigen::Matrix4d T_interp = start_pose;
      T_interp(0, 3) = p_interp(0);
      T_interp(1, 3) = p_interp(1);
      T_interp(2, 3) = p_interp(2);

      pose_seq.push_back(T_interp);
    }
    return pose_seq;
  }

  std::vector<Eigen::VectorXd> TrajectoryPlanner::joint_poly_traj(
      const Eigen::VectorXd &q_start,
      const Eigen::VectorXd &q_end,
      int step_num)
  {
    std::vector<Eigen::VectorXd> q_seq;
    q_seq.reserve(step_num);
    const int joint_count = q_start.size();

    for (int i = 0; i < step_num; i++)
    {
      double t = static_cast<double>(i) / (step_num - 1);
      // 5次多项式 s(t) = 6t^5 -15t^4 +10t^3
      double s = 6.0 * pow(t, 5) - 15.0 * pow(t, 4) + 10.0 * pow(t, 3);

      Eigen::VectorXd q_interp(joint_count);
      for (int j = 0; j < joint_count; j++)
      {
        q_interp(j) = q_start(j) + s * (q_end(j) - q_start(j));
        // 角度归一，复用工具类
        q_interp(j) = KinematicsUtils::wrap_angle(q_interp(j));
      }
      q_seq.push_back(q_interp);
    }
    return q_seq;
  }
}