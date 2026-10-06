// 文件功能：定制 UR5 统一模型，包含 Craig MDH、原始关节变换、工具和限位
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#pragma once
#include <array>
#include <string>
#include <Eigen/Dense>

namespace motion
{
constexpr int JOINT_COUNT = 6;
constexpr double PI = 3.14159265358979323846;
constexpr double TWO_PI = 2.0 * PI;
struct RobotModel
{
    Eigen::Matrix4d world_from_base;
    Eigen::Matrix4d base_from_mdh;
    Eigen::Matrix<double, JOINT_COUNT, 4> mdh;
    std::array<Eigen::Matrix4d, JOINT_COUNT> joint_origins;
    Eigen::Matrix4d joint6_from_flange;
    Eigen::Matrix4d flange_from_tcp;
    Eigen::VectorXd joint_min;
    Eigen::VectorXd joint_max;
    std::string scene_sha256;
    // 加载 JSON；非法变换、限位或不兼容的轴线结构抛出异常。
    static RobotModel load(const std::string& path);
};
// Craig MDH：Rx(alpha) Tx(a) Rz(q + offset) Tz(d)。
Eigen::Matrix4d mdh_transform(double length, double twist, double distance, double angle);
// 生成绕局部 Z/Y 轴的齐次旋转矩阵。
Eigen::Matrix4d rotate_z(double angle);
Eigen::Matrix4d rotate_y(double angle);
// 检查有限数、齐次末行与 SO(3) 条件。
bool is_rigid_pose(const Eigen::Matrix4d& pose);
}
