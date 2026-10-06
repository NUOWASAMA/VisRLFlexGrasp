// 文件功能：刚体位姿插值与连续关节五次轨迹，校验采样数、维度和有限数
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include "motion/robot_model.h"
#include "motion/trajectory_planner.h"
namespace motion
{
namespace
{
constexpr int MAX_TRAJECTORY_SAMPLES = 100000;
void validate_samples(int count)
{
    if (count < 2 || count > MAX_TRAJECTORY_SAMPLES)
    {
        throw std::invalid_argument("轨迹采样数必须在 2 到 100000 之间");
    }
}
void validate_joints(const Eigen::VectorXd& angles)
{
    if (angles.size() != JOINT_COUNT || !angles.allFinite())
    {
        throw std::invalid_argument("轨迹需要六个有限关节角");
    }
}
}
std::vector<Eigen::Matrix4d> TrajectoryPlanner::cartesian_line(
    const Eigen::Matrix4d& start_pose, const Eigen::Matrix4d& end_pose, int step_num)
{
    validate_samples(step_num);
    if (!is_rigid_pose(start_pose) || !is_rigid_pose(end_pose))
    {
        throw std::invalid_argument("笛卡尔轨迹端点必须是合法刚体位姿");
    }
    const Eigen::Quaterniond first(start_pose.block<3, 3>(0, 0));
    const Eigen::Quaterniond last(end_pose.block<3, 3>(0, 0));
    std::vector<Eigen::Matrix4d> result;
    result.reserve(step_num);
    for (int idx = 0; idx < step_num; ++idx)
    {
        const double ratio = static_cast<double>(idx)/(step_num - 1);
        Eigen::Matrix4d pose = Eigen::Matrix4d::Identity();
        pose.block<3, 1>(0, 3) = (1.0 - ratio)*start_pose.block<3, 1>(0, 3)
            + ratio*end_pose.block<3, 1>(0, 3);
        pose.block<3, 3>(0, 0) = first.slerp(ratio, last).normalized().toRotationMatrix();
        result.push_back(pose);
    }
    return result;
}
std::vector<Eigen::VectorXd> TrajectoryPlanner::joint_poly_traj(
    const Eigen::VectorXd& q_start, const Eigen::VectorXd& q_end, int step_num)
{
    validate_samples(step_num);
    validate_joints(q_start);
    validate_joints(q_end);
    std::vector<Eigen::VectorXd> result;
    result.reserve(step_num);
    for (int idx = 0; idx < step_num; ++idx)
    {
        const double ratio = static_cast<double>(idx)/(step_num - 1);
        const double smooth = ratio*ratio*ratio*(10.0 + ratio*(-15.0 + 6.0*ratio));
        // 端点已由限位内选解确定；采样点不逐点归一，避免跨 +/-pi 时发生跳变。
        result.push_back(q_start + smooth*(q_end - q_start));
    }
    return result;
}
double TrajectoryPlanner::calculate_duration(const Eigen::VectorXd& start, const Eigen::VectorXd& end,
    const Eigen::VectorXd& velocity, const Eigen::VectorXd& acceleration, double minimum)
{
    validate_joints(start);
    validate_joints(end);
    validate_joints(velocity);
    validate_joints(acceleration);
    if ((velocity.array() <= 0.0).any() || (acceleration.array() <= 0.0).any()
        || !std::isfinite(minimum) || minimum <= 0.0)
    {
        throw std::invalid_argument("速度、加速度和最短时长必须为正有限数");
    }
    // 五次 s(t) 的最大一阶导数 15/8，最大二阶导数 10/sqrt(3)。
    constexpr double MAX_FIRST_DERIVATIVE = 1.875;
    const double max_second_derivative = 10.0/std::sqrt(3.0);
    const Eigen::VectorXd travel = (end - start).cwiseAbs();
    double duration = minimum;
    for (int idx = 0; idx < JOINT_COUNT; ++idx)
    {
        duration = std::max(duration, MAX_FIRST_DERIVATIVE*travel(idx)/velocity(idx));
        duration = std::max(duration, std::sqrt(max_second_derivative*travel(idx)/acceleration(idx)));
    }
    return duration;
}
}
