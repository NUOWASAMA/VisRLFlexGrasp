// 文件功能：原始场景独立位姿、解析 IK、限位、奇异位形及轨迹边界验证
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <cmath>
#include <fstream>
#include <iostream>
#include <limits>
#include <random>
#include <stdexcept>

#include <jsoncons/json.hpp>

#include "motion/ur5_forward_kinematics.h"
#include "motion/ur5_inverse_kinematics.h"
#include "motion/trajectory_planner.h"

namespace
{
void require(bool condition, const std::string& message)
{
    if (!condition)
    {
        throw std::runtime_error(message);
    }
}
template<class Callable>
void require_invalid(Callable action)
{
    bool rejected = false;
    try
    {
        action();
    }
    catch (const std::invalid_argument&)
    {
        rejected = true;
    }
    require(rejected, "非法输入未被拒绝");
}
void verify_solutions(const motion::RobotModel& model, const Eigen::Matrix4d& target,
    const Eigen::VectorXd& reference, const std::string& label)
{
    const motion::UR5ForwardKinematics fk(model);
    const motion::UR5InverseKinematics ik(model);
    const auto solutions = ik.compute_ik(target, reference);
    require(!solutions.empty(), "可达目标没有逆解：" + label);
    for (const auto& angles : solutions)
    {
        require(angles.allFinite(), "逆解包含非有限数");
        require((angles.array() >= model.joint_min.array() - 1e-9).all()
            && (angles.array() <= model.joint_max.array() + 1e-9).all(), "逆解超过关节限位");
        const auto actual = fk.compute_fk(angles);
        require((actual - target).norm() < 2e-7, "逆解回代误差过大：" + label);
    }
    const auto selected = ik.select_nearest_solution(solutions, reference);
    for (const auto& angles : solutions)
    {
        require((selected - reference).squaredNorm() <= (angles - reference).squaredNorm() + 1e-10,
            "选解不是最小位移");
    }
}
void check_scene(const motion::RobotModel& model, const std::string& path)
{
    std::ifstream stream(path);
    jsoncons::json fixture;
    stream >> fixture;
    require(fixture.at("scene_sha256").as<std::string>() == model.scene_sha256, "场景基准版本不匹配");
    motion::UR5ForwardKinematics fk(model);
    int count = 0;
    for (const auto& item : fixture.at("cases").array_range())
    {
        Eigen::VectorXd angles(motion::JOINT_COUNT);
        Eigen::Matrix4d target;
        for (int idx = 0; idx < motion::JOINT_COUNT; ++idx)
        {
            angles(idx) = item.at("joint_angles")[idx].as<double>();
        }
        for (int row = 0; row < 4; ++row)
        {
            for (int col = 0; col < 4; ++col)
            {
                target(row, col) = item.at("base_from_flange")[row][col].as<double>();
            }
        }
        require((fk.compute_fk(angles) - target).norm() < 1e-10, "FK 不符合原始场景层级");
        verify_solutions(model, target, angles, "scene " + std::to_string(count));
        verify_solutions(model, target, Eigen::VectorXd::Zero(6), "zero reference " + std::to_string(count));
        ++count;
    }
    std::cout << "scene fixtures: " << count << " passed\n";
}
void check_random(const motion::RobotModel& model)
{
    std::mt19937 generator(20261006);
    std::uniform_real_distribution<double> distribution(-motion::TWO_PI, motion::TWO_PI);
    motion::UR5ForwardKinematics fk(model);
    for (int sample = 0; sample < 2000; ++sample)
    {
        Eigen::VectorXd angles(6), reference(6);
        for (int idx = 0; idx < 6; ++idx)
        {
            angles(idx) = distribution(generator);
            reference(idx) = distribution(generator);
        }
        if (sample % 10 == 0)
        {
            angles(4) = sample % 20 == 0 ? 0.0 : motion::PI;
        }
        verify_solutions(model, fk.compute_fk(angles), reference, "random " + std::to_string(sample));
    }
    std::cout << "random + singular: 2000 passed\n";
}
void check_boundaries(const motion::RobotModel& model)
{
    motion::UR5ForwardKinematics fk(model);
    motion::UR5InverseKinematics ik(model);
    Eigen::Matrix4d far = Eigen::Matrix4d::Identity();
    far(0, 3) = 100.0;
    require(ik.compute_ik(far).empty(), "不可达目标错误地返回解");
    Eigen::Matrix4d invalid = far;
    invalid(3, 3) = 0.0;
    require_invalid([&] { ik.compute_ik(invalid); });
    invalid = far;
    invalid(0, 0) = 2.0;
    require_invalid([&] { ik.compute_ik(invalid); });
    invalid = far;
    invalid(0, 3) = std::numeric_limits<double>::quiet_NaN();
    require_invalid([&] { ik.compute_ik(invalid); });
    require_invalid([&] { fk.compute_fk(Eigen::VectorXd::Zero(5)); });
    require_invalid([&] { ik.select_nearest_solution({}, Eigen::VectorXd::Zero(6)); });
    auto limited = model;
    limited.joint_min(0) = -0.001;
    limited.joint_max(0) = 0.001;
    Eigen::VectorXd angles(6);
    angles << 0.9, -0.4, 0.7, 0.2, -0.5, 0.6;
    require(motion::UR5InverseKinematics(limited).compute_ik(fk.compute_fk(angles)).empty(),
        "关节限位过滤未生效");
    Eigen::VectorXd base = Eigen::VectorXd::Zero(6), shifted = base;
    shifted(0) = 0.2;
    shifted(1) = -0.2;
    require((fk.compute_fk(base) - fk.compute_fk(shifted)).norm() > 0.01, "前两关节仍然退化");
}
void check_trajectory()
{
    motion::TrajectoryPlanner planner;
    Eigen::VectorXd first = Eigen::VectorXd::Constant(6, 3.0);
    Eigen::VectorXd last = Eigen::VectorXd::Constant(6, 3.4);
    const auto samples = planner.joint_poly_traj(first, last, 101);
    require((samples.front() - first).norm() < 1e-12 && (samples.back() - last).norm() < 1e-12,
        "关节轨迹端点不正确");
    for (size_t idx = 1; idx < samples.size(); ++idx)
    {
        require((samples[idx] - samples[idx - 1]).norm() < 0.03, "跨 pi 轨迹跳变");
    }
    require_invalid([&] { planner.joint_poly_traj(first, last, 1); });
    require_invalid([&] { planner.joint_poly_traj(first, Eigen::VectorXd::Zero(5), 10); });
    Eigen::Matrix4d start = Eigen::Matrix4d::Identity(), end = motion::rotate_z(motion::PI/2);
    end(0, 3) = 1.0;
    const auto poses = planner.cartesian_line(start, end, 11);
    require((poses.front() - start).norm() < 1e-12 && (poses.back() - end).norm() < 1e-12,
        "笛卡尔轨迹端点不正确");
    const double duration = planner.calculate_duration(first, last, Eigen::VectorXd::Ones(6),
        Eigen::VectorXd::Ones(6), 0.1);
    require(duration >= std::sqrt(10.0/std::sqrt(3.0)*0.4) - 1e-12, "时长未满足加速度约束");
}
}
int main(int argc, char** argv)
{
    try
    {
        require(argc == 3, "需要模型与场景基准路径");
        const auto model = motion::RobotModel::load(argv[1]);
        check_scene(model, argv[2]);
        check_random(model);
        check_boundaries(model);
        check_trajectory();
        std::cout << "motion math: all passed\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
