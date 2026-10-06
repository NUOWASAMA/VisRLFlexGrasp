// 文件功能：肩部圆交点、ZXZ 腕部分解、平面二连杆解析逆解；推导见 custom_ur5_ik.md
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

#include "motion/kinematics_utils.h"
#include "motion/ur5_forward_kinematics.h"
#include "motion/ur5_inverse_kinematics.h"

namespace motion
{
namespace
{
constexpr double ALGEBRA_TOLERANCE = 1e-10;
constexpr double POSITION_TOLERANCE = 1e-7;
constexpr double ROTATION_TOLERANCE = 1e-7;
constexpr double DUPLICATE_TOLERANCE = 1e-6;

double clamp_unit(double value)
{
    return std::clamp(value, -1.0, 1.0);
}

bool lift_to_limits(Eigen::VectorXd& angles, const Eigen::VectorXd& reference, const RobotModel& model)
{
    for (int idx = 0; idx < JOINT_COUNT; ++idx)
    {
        const double angle = KinematicsUtils::wrap_angle(angles(idx));
        const double first = std::ceil((model.joint_min(idx) - angle - ALGEBRA_TOLERANCE) / TWO_PI);
        const double last = std::floor((model.joint_max(idx) - angle + ALGEBRA_TOLERANCE) / TWO_PI);
        if (first > last)
        {
            return false;
        }
        const double turns = std::clamp(std::round((reference(idx) - angle) / TWO_PI), first, last);
        angles(idx) = angle + turns * TWO_PI;
        if (angles(idx) < model.joint_min(idx) - ALGEBRA_TOLERANCE
            || angles(idx) > model.joint_max(idx) + ALGEBRA_TOLERANCE)
        {
            return false;
        }
    }
    return true;
}

void append_verified(Eigen::VectorXd angles, const Eigen::Matrix4d& target,
    const Eigen::VectorXd& reference, const RobotModel& model, std::vector<Eigen::VectorXd>& solutions)
{
    if (!angles.allFinite() || !lift_to_limits(angles, reference, model))
    {
        return;
    }
    const Eigen::Matrix4d check = UR5ForwardKinematics(model).compute_fk(angles);
    if ((check.block<3, 1>(0, 3) - target.block<3, 1>(0, 3)).norm() > POSITION_TOLERANCE
        || (check.block<3, 3>(0, 0) - target.block<3, 3>(0, 0)).norm() > ROTATION_TOLERANCE)
    {
        return;
    }
    for (const auto& existing : solutions)
    {
        double distance = 0.0;
        for (int idx = 0; idx < JOINT_COUNT; ++idx)
        {
            distance = std::max(distance, std::abs(KinematicsUtils::wrap_angle(angles(idx) - existing(idx))));
        }
        if (distance < DUPLICATE_TOLERANCE)
        {
            return;
        }
    }
    solutions.push_back(angles);
}

std::vector<double> singular_sums(const Eigen::Vector3d& local_target, double wrist,
    double preferred, const RobotModel& model)
{
    const auto& origins = model.joint_origins;
    const Eigen::Vector3d wrist_vector = origins[4].block<3, 1>(0, 3)
        + rotate_y(PI/2).block<3, 3>(0, 0) * rotate_z(wrist).block<3, 3>(0, 0)
            * origins[5].block<3, 1>(0, 3);
    const double radius = local_target.head<2>().norm();
    const double offset = wrist_vector.head<2>().norm();
    const double upper_arm = origins[2].block<2, 1>(0, 3).norm();
    const double forearm = origins[3].block<2, 1>(0, 3).norm();
    std::vector<double> sums = {preferred};
    if (radius * offset <= ALGEBRA_TOLERANCE)
    {
        sums.push_back(0.0);
        return sums;
    }
    // 腕部奇异时 s 为自由变量；以二连杆可达环带解析求可行弧段。
    const double common = radius*radius + offset*offset;
    const double lower = (common - std::pow(upper_arm + forearm, 2)) / (2.0 * radius * offset);
    const double upper = (common - std::pow(upper_arm - forearm, 2)) / (2.0 * radius * offset);
    if (lower > 1.0 + ALGEBRA_TOLERANCE || upper < -1.0 - ALGEBRA_TOLERANCE)
    {
        return {};
    }
    const double start = std::acos(clamp_unit(upper));
    const double end = std::acos(clamp_unit(lower));
    const double phase = std::atan2(local_target(1), local_target(0))
        - std::atan2(wrist_vector(1), wrist_vector(0));
    for (const double sign : {-1.0, 1.0})
    {
        sums.push_back(phase + sign*start);
        sums.push_back(phase + sign*end);
        sums.push_back(phase + sign*(start + end)/2.0);
    }
    return sums;
}

void solve_elbow(double shoulder, double sum, double wrist, double last,
    const Eigen::Vector3d& local_target, const Eigen::Matrix4d& target,
    const Eigen::VectorXd& reference, const RobotModel& model, std::vector<Eigen::VectorXd>& solutions)
{
    const auto& origins = model.joint_origins;
    const Eigen::Vector3d remaining = local_target
        - rotate_z(sum).block<3, 3>(0, 0) * origins[4].block<3, 1>(0, 3)
        - (rotate_z(sum) * rotate_y(PI/2) * rotate_z(wrist)).block<3, 3>(0, 0)
            * origins[5].block<3, 1>(0, 3);
    if (std::abs(remaining(2) - origins[2](2, 3) - origins[3](2, 3)) > POSITION_TOLERANCE)
    {
        return;
    }
    const double first_length = origins[2].block<2, 1>(0, 3).norm();
    const double second_length = origins[3].block<2, 1>(0, 3).norm();
    const double first_phase = std::atan2(origins[2](1, 3), origins[2](0, 3));
    const double second_phase = std::atan2(origins[3](1, 3), origins[3](0, 3));
    const double cosine = (remaining.head<2>().squaredNorm() - first_length*first_length
        - second_length*second_length) / (2.0 * first_length * second_length);
    if (std::abs(cosine) > 1.0 + ALGEBRA_TOLERANCE)
    {
        return;
    }
    for (const double sign : {-1.0, 1.0})
    {
        const double elbow = sign * std::acos(clamp_unit(cosine));
        const double arm = std::atan2(remaining(1), remaining(0))
            - std::atan2(second_length*std::sin(elbow), first_length + second_length*std::cos(elbow));
        Eigen::VectorXd angles(JOINT_COUNT);
        angles(0) = shoulder;
        angles(1) = arm - first_phase;
        angles(2) = elbow - second_phase + first_phase;
        angles(3) = sum - angles(1) - angles(2);
        angles(4) = wrist;
        angles(5) = last;
        append_verified(angles, target, reference, model, solutions);
    }
}
}

UR5InverseKinematics::UR5InverseKinematics(const RobotModel& model) : m_model(model)
{
}

std::vector<Eigen::VectorXd> UR5InverseKinematics::compute_ik(
    const Eigen::Matrix4d& target, const Eigen::VectorXd& reference) const
{
    if (!is_rigid_pose(target) || reference.size() != JOINT_COUNT || !reference.allFinite())
    {
        throw std::invalid_argument("IK 需要合法的刚体目标和六个有限参考角");
    }
    const auto& origins = m_model.joint_origins;
    const Eigen::Matrix4d joint_target = target * m_model.joint6_from_flange.inverse();
    const Eigen::Vector3d position = joint_target.block<3, 1>(0, 3) - origins[0].block<3, 1>(0, 3);
    const Eigen::Vector3d corrected = position + origins[5](0, 3) * joint_target.block<3, 1>(0, 2);
    const double shoulder_offset = origins[1](0, 3) - origins[2](2, 3)
        - origins[3](2, 3) - origins[4](2, 3);
    const double radius = corrected.head<2>().norm();
    std::vector<Eigen::VectorXd> solutions;
    if (radius < std::abs(shoulder_offset) - ALGEBRA_TOLERANCE || radius < ALGEBRA_TOLERANCE)
    {
        return solutions;
    }
    const double shoulder_delta = std::acos(clamp_unit(shoulder_offset / radius));
    const double shoulder_phase = std::atan2(corrected(1), corrected(0));
    for (const double shoulder_sign : {-1.0, 1.0})
    {
        const double shoulder = shoulder_phase + shoulder_sign*shoulder_delta;
        const Eigen::Matrix3d local_rotation = (rotate_y(PI/2) * rotate_z(-shoulder)).block<3, 3>(0, 0);
        const Eigen::Matrix3d orientation = local_rotation * joint_target.block<3, 3>(0, 0);
        const Eigen::Vector3d local_target = rotate_y(PI/2).block<3, 3>(0, 0)
            * (rotate_z(-shoulder).block<3, 3>(0, 0) * position - origins[1].block<3, 1>(0, 3));
        const double sine = std::hypot(orientation(0, 2), orientation(1, 2));
        const double wrist_angle = std::atan2(sine, orientation(2, 2));
        if (sine <= ALGEBRA_TOLERANCE)
        {
            const double phase = std::atan2(orientation(1, 0), orientation(0, 0));
            const double preferred = reference(1) + reference(2) + reference(3);
            for (const double sum : singular_sums(local_target, wrist_angle, preferred, m_model))
            {
                const double last = orientation(2, 2) > 0.0 ? phase - sum : sum - phase;
                solve_elbow(shoulder, sum, wrist_angle, last, local_target, target, reference, m_model, solutions);
            }
            continue;
        }
        for (const double wrist_sign : {-1.0, 1.0})
        {
            const double wrist = wrist_sign*wrist_angle;
            const double sum = std::atan2(wrist_sign*orientation(0, 2), -wrist_sign*orientation(1, 2));
            const double last = std::atan2(wrist_sign*orientation(2, 0), wrist_sign*orientation(2, 1));
            solve_elbow(shoulder, sum, wrist, last, local_target, target, reference, m_model, solutions);
        }
    }
    return solutions;
}

Eigen::VectorXd UR5InverseKinematics::select_nearest_solution(
    const std::vector<Eigen::VectorXd>& solutions, const Eigen::VectorXd& reference)
{
    if (solutions.empty() || reference.size() != JOINT_COUNT || !reference.allFinite())
    {
        throw std::invalid_argument("选解需要非空候选集和六个有限参考角");
    }
    const Eigen::VectorXd* selected = nullptr;
    double best = std::numeric_limits<double>::infinity();
    for (const auto& angles : solutions)
    {
        if (angles.size() != JOINT_COUNT || !angles.allFinite())
        {
            throw std::invalid_argument("候选解必须为六个有限关节角");
        }
        const double distance = (angles - reference).squaredNorm();
        if (distance < best)
        {
            selected = &angles;
            best = distance;
        }
    }
    return *selected;
}
}
