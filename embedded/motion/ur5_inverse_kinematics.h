// 文件功能：定制场景等价 MDH 链的解析逆运动学与限位内选解
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#pragma once
#include <vector>
#include "motion/robot_model.h"
namespace motion
{
class UR5InverseKinematics
{
public:
    explicit UR5InverseKinematics(const RobotModel& model);
    // 目标为基座到 UR5_link7 法兰；不可达返回空，非法位姿/参考角抛出异常。
    // 普通位形枚举肩/腕/肘分支；奇异位形返回参考角附近的可行连续族代表。
    std::vector<Eigen::VectorXd> compute_ik(const Eigen::Matrix4d& target,
        const Eigen::VectorXd& reference = Eigen::VectorXd::Zero(JOINT_COUNT)) const;
    // 从提升到关节限位内的候选解中选位移最小者；非法或空集合抛出异常。
    static Eigen::VectorXd select_nearest_solution(const std::vector<Eigen::VectorXd>& solutions,
        const Eigen::VectorXd& reference);
private:
    RobotModel m_model;
};
}
