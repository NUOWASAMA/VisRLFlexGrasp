// 文件功能：加载分级 JSON 配置，检查规划参数并拒绝未实现的执行模式
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <jsoncons/json.hpp>
#include "comm/motion_config.h"
#include "motion/robot_model.h"
namespace vis_rl_grasp::comm
{
namespace
{
jsoncons::json read_file(const std::filesystem::path& path)
{
    std::ifstream stream(path);
    if (!stream)
    {
        throw std::runtime_error("无法读取配置：" + path.string());
    }
    jsoncons::json value;
    stream >> value;
    if (!value.is_object())
    {
        throw std::invalid_argument("配置必须为 JSON 对象");
    }
    return value;
}
void merge(jsoncons::json& base, const jsoncons::json& overlay)
{
    for (const auto& member : overlay.object_range())
    {
        const std::string key(member.key());
        if (base.contains(key) && base.at(key).is_object() && member.value().is_object())
        {
            merge(base[key], member.value());
        }
        else
        {
            base[key] = member.value();
        }
    }
}
Eigen::VectorXd vector6(const jsoncons::json& value)
{
    if (!value.is_array() || value.size() != motion::JOINT_COUNT)
    {
        throw std::invalid_argument("配置关节数组必须为六维");
    }
    Eigen::VectorXd result(motion::JOINT_COUNT);
    for (int idx = 0; idx < motion::JOINT_COUNT; ++idx)
    {
        if (!value[idx].is_number())
        {
            throw std::invalid_argument("关节配置必须为数值");
        }
        result(idx) = value[idx].as<double>();
    }
    if (!result.allFinite())
    {
        throw std::invalid_argument("关节配置必须有限");
    }
    return result;
}
double positive(const jsoncons::json& value)
{
    if (!value.is_number())
    {
        throw std::invalid_argument("规划限制必须为数值");
    }
    const double number = value.as<double>();
    if (!std::isfinite(number) || number <= 0.0)
    {
        throw std::invalid_argument("规划限制必须为正有限数");
    }
    return number;
}
}
MotionConfig MotionConfig::load(const std::string& path)
{
    const std::filesystem::path source(path);
    auto root = read_file(source);
    if (source.filename() == "base.json")
    {
        const char* setting = std::getenv("VISRL_ENV");
        const std::string environment = setting == nullptr ? "dev" : setting;
        if (environment != "dev" && environment != "sim" && environment != "real")
        {
            throw std::invalid_argument("VISRL_ENV 必须为 dev/sim/real");
        }
        merge(root, read_file(source.parent_path() / (environment + ".json")));
    }
    if (!root.at("enable_hardware").is_bool() || root.at("enable_hardware").as<bool>()
        || root.at("execution_mode").as<std::string>() != "plan_only")
    {
        throw std::invalid_argument("当前仅支持 plan_only，实体/仿真执行驱动尚未接入");
    }
    MotionConfig config;
    config.server_host = root.at("server").at("host").as<std::string>();
    const auto& port = root.at("server").at("port");
    if (!(port.is_int64() || port.is_uint64()) || port.as<int64_t>() < 1 || port.as<int64_t>() > 65535)
    {
        throw std::invalid_argument("端口必须为 1 到 65535 的整数");
    }
    config.server_port = port.as<int>();
    config.model_path = (source.parent_path() / root.at("model_file").as<std::string>()).string();
    config.initial_joints = vector6(root.at("initial_joint_angles"));
    const auto& trajectory = root.at("trajectory");
    config.max_velocity = vector6(trajectory.at("max_velocity"));
    config.max_acceleration = vector6(trajectory.at("max_acceleration"));
    config.minimum_duration = positive(trajectory.at("minimum_duration_sec"));
    config.maximum_force = positive(root.at("max_force_limit"));
    const auto& samples = trajectory.at("sample_count");
    if (!(samples.is_int64() || samples.is_uint64()) || samples.as<int64_t>() < 2
        || samples.as<int64_t>() > 4096 || config.server_host.empty()
        || (config.max_velocity.array() <= 0.0).any() || (config.max_acceleration.array() <= 0.0).any())
    {
        throw std::invalid_argument("采样数需在 2 到 4096 之间，速度及加速度必须为正");
    }
    config.sample_count = samples.as<int>();
    return config;
}
}
