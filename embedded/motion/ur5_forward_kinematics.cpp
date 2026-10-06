// 文件功能：按 Craig MDH 次序计算法兰位姿，保留基座与末端固定偏移
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <stdexcept>
#include "motion/ur5_forward_kinematics.h"
namespace motion
{
UR5ForwardKinematics::UR5ForwardKinematics(const RobotModel& model) : m_model(model)
{
}
Eigen::Matrix4d UR5ForwardKinematics::compute_fk(const Eigen::VectorXd& joint_angles) const
{
    if (joint_angles.size() != JOINT_COUNT || !joint_angles.allFinite())
    {
        throw std::invalid_argument("FK 输入必须为六个有限关节角");
    }
    Eigen::Matrix4d result = m_model.base_from_mdh;
    for (int idx = 0; idx < JOINT_COUNT; ++idx)
    {
        result = (result * mdh_transform(m_model.mdh(idx, 0), m_model.mdh(idx, 1),
            m_model.mdh(idx, 2), joint_angles(idx) + m_model.mdh(idx, 3))).eval();
    }
    return result * m_model.joint6_from_flange;
}
}
