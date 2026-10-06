// 文件功能：基于校准模型的 Craig MDH 正运动学
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#pragma once
#include "motion/robot_model.h"
namespace motion
{
class UR5ForwardKinematics
{
public:
    explicit UR5ForwardKinematics(const RobotModel& model);
    // 输入六个有限关节角，输出基座到 UR5_link7 法兰变换；非法输入抛出异常。
    Eigen::Matrix4d compute_fk(const Eigen::VectorXd& joint_angles) const;
private:
    RobotModel m_model;
};
}
