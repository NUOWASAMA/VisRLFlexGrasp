// 文件功能：校验场景 MDH 与原始关节链，提供公共刚体变换
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <cmath>
#include <fstream>
#include <stdexcept>
#include <jsoncons/json.hpp>
#include "motion/robot_model.h"

namespace motion
{
namespace
{
constexpr double MODEL_TOLERANCE = 1e-9;
Eigen::Matrix4d read_pose(const jsoncons::json& value)
{
    if (!value.is_array() || value.size() != 4)
    {
        throw std::invalid_argument("模型位姿必须为 4x4 矩阵");
    }
    Eigen::Matrix4d result;
    for (int row = 0; row < 4; ++row)
    {
        if (!value[row].is_array() || value[row].size() != 4)
        {
            throw std::invalid_argument("模型位姿必须为 4x4 矩阵");
        }
        for (int col = 0; col < 4; ++col)
        {
            if (!value[row][col].is_number())
            {
                throw std::invalid_argument("模型位姿必须包含数值");
            }
            result(row, col) = value[row][col].as<double>();
        }
    }
    if (!is_rigid_pose(result))
    {
        throw std::invalid_argument("模型包含非法刚体变换");
    }
    return result;
}
Eigen::VectorXd read_limits(const jsoncons::json& value)
{
    if (!value.is_array() || value.size() != JOINT_COUNT)
    {
        throw std::invalid_argument("关节限位必须包含六个数值");
    }
    Eigen::VectorXd result(JOINT_COUNT);
    for (int idx = 0; idx < JOINT_COUNT; ++idx)
    {
        if (!value[idx].is_number())
        {
            throw std::invalid_argument("关节限位必须为数值");
        }
        result(idx) = value[idx].as<double>();
    }
    if (!result.allFinite())
    {
        throw std::invalid_argument("关节限位必须有限");
    }
    return result;
}
void validate_geometry(const RobotModel& model)
{
    const std::array<double, JOINT_COUNT> twists = {0.0, -PI/2, 0.0, 0.0, PI/2, -PI/2};
    for (int idx = 0; idx < JOINT_COUNT; ++idx)
    {
        if ((model.joint_origins[idx].block<3, 3>(0, 0) - rotate_y(twists[idx]).block<3, 3>(0, 0)).norm()
            > MODEL_TOLERANCE)
        {
            throw std::invalid_argument("解析逆解要求关节轴为 Z/-X/-X/-X/Z/-X");
        }
    }
    if (std::abs(model.joint_origins[5](1, 3)) > MODEL_TOLERANCE
        || model.joint_origins[2].block<2, 1>(0, 3).norm() < MODEL_TOLERANCE
        || model.joint_origins[3].block<2, 1>(0, 3).norm() < MODEL_TOLERANCE)
    {
        throw std::invalid_argument("不支持该腕部偏移或零长度连杆");
    }
    for (int sample = 0; sample < 3; ++sample)
    {
        Eigen::Matrix4d scene = Eigen::Matrix4d::Identity();
        Eigen::Matrix4d calibrated = model.base_from_mdh;
        for (int idx = 0; idx < JOINT_COUNT; ++idx)
        {
            const double angle = sample * (idx + 1) * 0.13;
            scene = (scene * model.joint_origins[idx] * rotate_z(angle)).eval();
            calibrated = (calibrated * mdh_transform(model.mdh(idx, 0), model.mdh(idx, 1),
                model.mdh(idx, 2), angle + model.mdh(idx, 3))).eval();
        }
        if ((scene - calibrated).norm() > MODEL_TOLERANCE)
        {
            throw std::invalid_argument("MDH 与原始场景关节链不一致，请重新导出模型");
        }
    }
}
}
RobotModel RobotModel::load(const std::string& path)
{
    std::ifstream input(path);
    if (!input)
    {
        throw std::runtime_error("无法读取模型文件：" + path);
    }
    jsoncons::json root;
    input >> root;
    if (root.at("schema_version").as<int>() != 1)
    {
        throw std::invalid_argument("不支持的模型版本");
    }
    RobotModel model;
    model.world_from_base = read_pose(root.at("world_from_base"));
    model.base_from_mdh = read_pose(root.at("base_from_mdh"));
    model.joint6_from_flange = read_pose(root.at("joint6_from_flange"));
    model.flange_from_tcp = read_pose(root.at("flange_from_tcp"));
    model.joint_min = read_limits(root.at("joint_min"));
    model.joint_max = read_limits(root.at("joint_max"));
    model.scene_sha256 = root.at("provenance").at("sha256").as<std::string>();
    if ((model.joint_max.array() <= model.joint_min.array()).any())
    {
        throw std::invalid_argument("关节上限必须大于下限");
    }
    const auto& rows = root.at("mdh");
    const auto& origins = root.at("joint_origins");
    if (!rows.is_array() || rows.size() != JOINT_COUNT || !origins.is_array() || origins.size() != JOINT_COUNT)
    {
        throw std::invalid_argument("MDH 和原始关节链必须为六轴");
    }
    for (int idx = 0; idx < JOINT_COUNT; ++idx)
    {
        if (!rows[idx].is_array() || rows[idx].size() != 4)
        {
            throw std::invalid_argument("MDH 每行需要 a、alpha、d、offset");
        }
        for (int col = 0; col < 4; ++col)
        {
            if (!rows[idx][col].is_number())
            {
                throw std::invalid_argument("MDH 参数必须为数值");
            }
            model.mdh(idx, col) = rows[idx][col].as<double>();
        }
        model.joint_origins[idx] = read_pose(origins[idx]);
    }
    if (!model.mdh.allFinite())
    {
        throw std::invalid_argument("MDH 参数必须有限");
    }
    validate_geometry(model);
    return model;
}
Eigen::Matrix4d mdh_transform(double length, double twist, double distance, double angle)
{
    const double ca = std::cos(twist), sa = std::sin(twist);
    const double ct = std::cos(angle), st = std::sin(angle);
    Eigen::Matrix4d result;
    result << ct, -st, 0.0, length,
              ca*st, ca*ct, -sa, -distance*sa,
              sa*st, sa*ct, ca, distance*ca,
              0.0, 0.0, 0.0, 1.0;
    return result;
}
Eigen::Matrix4d rotate_z(double angle)
{
    Eigen::Matrix4d result = Eigen::Matrix4d::Identity();
    result.block<3, 3>(0, 0) = Eigen::AngleAxisd(angle, Eigen::Vector3d::UnitZ()).toRotationMatrix();
    return result;
}
Eigen::Matrix4d rotate_y(double angle)
{
    Eigen::Matrix4d result = Eigen::Matrix4d::Identity();
    result.block<3, 3>(0, 0) = Eigen::AngleAxisd(angle, Eigen::Vector3d::UnitY()).toRotationMatrix();
    return result;
}
bool is_rigid_pose(const Eigen::Matrix4d& pose)
{
    constexpr double POSE_TOLERANCE = 1e-7;
    const Eigen::Matrix3d rotation = pose.block<3, 3>(0, 0);
    return pose.allFinite()
        && (pose.row(3) - Eigen::RowVector4d(0.0, 0.0, 0.0, 1.0)).norm() < POSE_TOLERANCE
        && (rotation.transpose()*rotation - Eigen::Matrix3d::Identity()).norm() < POSE_TOLERANCE
        && std::abs(rotation.determinant() - 1.0) < POSE_TOLERANCE;
}
}
