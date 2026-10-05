#ifndef TRAJECTORY_PLANNER_H
#define TRAJECTORY_PLANNER_H

#include <Eigen/Dense>
#include <vector>

namespace motion
{
  class TrajectoryPlanner
  {
  public:
    /**
     * @brief 笛卡尔空间直线轨迹插补（基础版：XYZ线性插值，姿态保持起点姿态不变）
     * @param start_pose 起始4×4齐次变换矩阵
     * @param end_pose   目标4×4齐次变换矩阵
     * @param step_num   插补总步数
     * @return 每一步对应的4×4位姿序列
     */
    std::vector<Eigen::Matrix4d> cartesian_line(const Eigen::Matrix4d &start_pose, const Eigen::Matrix4d &end_pose, int step_num);

    /**
     * @brief 关节空间5次多项式轨迹插补，启停位置、速度、加速度均为0
     * @param q_start 起始关节角向量(6维)
     * @param q_end   目标关节角向量(6维)
     * @param step_num 插补总步数
     * @return 插补后的关节角序列
     */
    std::vector<Eigen::VectorXd> joint_poly_traj(const Eigen::VectorXd &q_start,
                                                 const Eigen::VectorXd &q_end,
                                                 int step_num);
  };
}

#endif
