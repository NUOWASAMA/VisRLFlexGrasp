// 文件功能：刚体位姿插值及关节五次轨迹接口
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#pragma once
#include <vector>
#include <Eigen/Dense>
namespace motion
{
class TrajectoryPlanner
{
public:
    // XYZ 直线插值、姿态 SLERP；非法位姿或采样数抛出异常。
    std::vector<Eigen::Matrix4d> cartesian_line(const Eigen::Matrix4d& start_pose,
        const Eigen::Matrix4d& end_pose, int step_num);
    // 连续关节五次插值，端点速度与加速度为零；输入必须为六维有限数。
    std::vector<Eigen::VectorXd> joint_poly_traj(const Eigen::VectorXd& q_start,
        const Eigen::VectorXd& q_end, int step_num);
    // 依据六轴速度、加速度上限计算满足五次轨迹峰值限制的时长。
    static double calculate_duration(const Eigen::VectorXd& start, const Eigen::VectorXd& end,
        const Eigen::VectorXd& velocity, const Eigen::VectorXd& acceleration, double minimum);
};
}
