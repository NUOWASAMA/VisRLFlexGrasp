// 文件功能：校验抓取指令并输出 plan_only 轨迹；不虚报放置成功
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <chrono>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include "comm/motion_processor.h"
#include "motion/ur5_inverse_kinematics.h"
#include "motion/trajectory_planner.h"
namespace vis_rl_grasp::comm
{
namespace
{
class PlanningError : public std::runtime_error
{
public:
    using std::runtime_error::runtime_error;
};
Eigen::VectorXd read_vector(const Json& value, int dimension)
{
    if (!value.is_array() || value.size() != static_cast<size_t>(dimension))
    {
        throw std::invalid_argument("向量维度不正确");
    }
    Eigen::VectorXd result(dimension);
    for (int idx = 0; idx < dimension; ++idx)
    {
        if (!value[idx].is_number())
        {
            throw std::invalid_argument("向量必须包含数值");
        }
        result(idx) = value[idx].as<double>();
    }
    if (!result.allFinite())
    {
        throw std::invalid_argument("向量必须包含有限数值");
    }
    return result;
}
Json vector_json(const Eigen::VectorXd& value)
{
    Json result = Json::array();
    for (Eigen::Index idx = 0; idx < value.size(); ++idx)
    {
        result.push_back(value(idx));
    }
    return result;
}
bool valid_envelope(const Json& value)
{
    if (!value.is_object())
    {
        return false;
    }
    for (const auto* field : {"msg_type", "source", "target", "code", "msg", "data", "timestamp"})
    {
        if (!value.contains(field))
        {
            return false;
        }
    }
    for (const auto* field : {"msg_type", "source", "target", "msg"})
    {
        if (!value.at(field).is_string())
        {
            return false;
        }
    }
    const auto& code = value.at("code");
    const auto& time = value.at("timestamp");
    return (code.is_int64() || code.is_uint64()) && (time.is_int64() || time.is_uint64())
        && code.as<int64_t>() >= 0 && code.as<int64_t>() <= 4999
        && value.at("data").is_object() && value.at("source").as<std::string>() == "backend"
        && value.at("target").as<std::string>() == "motion" && time.as<int64_t>() >= 0;
}
Json failure(const std::string& task_id, EErrorCode code, const std::string& reason)
{
    Json data = Json::object();
    data["task_id"] = task_id;
    data["phase"] = "failed";
    data["is_success"] = false;
    data["executed"] = false;
    data["error_code"] = static_cast<int>(code);
    data["detail"] = reason;
    return build_message("error_report", data, code, reason);
}
}
Json build_message(const std::string& type, const Json& data, EErrorCode code, const std::string& description)
{
    Json result = Json::object();
    result["msg_type"] = type;
    result["source"] = "motion";
    result["target"] = "backend";
    result["code"] = static_cast<int>(code);
    result["msg"] = description;
    result["data"] = data;
    result["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    return result;
}
MotionProcessor::MotionProcessor(const MotionConfig& config, const motion::RobotModel& model)
    : m_config(config), m_model(model)
{
    if ((config.initial_joints.array() < model.joint_min.array()).any()
        || (config.initial_joints.array() > model.joint_max.array()).any())
    {
        throw std::invalid_argument("初始关节角超过模型限位");
    }
}
bool MotionProcessor::is_registered() const
{
    return m_registered.load();
}
std::optional<Json> MotionProcessor::handle_line(const std::string& line)
{
    Json message;
    try
    {
        message = Json::parse(line);
        if (!valid_envelope(message))
        {
            return failure("", EErrorCode::INVALID_MESSAGE, "报文字段、方向或类型非法");
        }
    }
    catch (const std::exception&)
    {
        return failure("", EErrorCode::INVALID_MESSAGE, "JSON 解析或报文字段校验失败");
    }
    const auto type = message.at("msg_type").as<std::string>();
    if (type == "register_ack")
    {
        m_registered.store(message.at("code").as<int>() == 0);
        return std::nullopt;
    }
    if (type == "heartbeat_ack" || type == "error_report")
    {
        if (type == "error_report")
        {
            std::cerr << "[WARN] backend: " << message.at("msg").as<std::string>() << '\n';
        }
        return std::nullopt;
    }
    const auto& data = message.at("data");
    const std::string task_id = data.contains("task_id") && data.at("task_id").is_string()
        ? data.at("task_id").as<std::string>() : "";
    if (!m_registered.load())
    {
        return failure(task_id, EErrorCode::NOT_REGISTERED, "等待注册确认");
    }
    if (type != "grasp_command" || message.at("code").as<int>() != 0)
    {
        return failure(task_id, EErrorCode::INVALID_PARAM, "不支持的业务指令或非成功请求");
    }
    try
    {
        return plan_grasp(data);
    }
    catch (const PlanningError& error)
    {
        return failure(task_id, EErrorCode::MOTION_EXEC_FAILED, error.what());
    }
    catch (const std::exception& error)
    {
        return failure(task_id, EErrorCode::INVALID_PARAM, error.what());
    }
}
Json MotionProcessor::plan_grasp(const Json& data) const
{
    if (!data.contains("task_id") || !data.at("task_id").is_string()
        || data.at("task_id").as<std::string>().empty() || data.at("task_id").as<std::string>().size() > 256)
    {
        throw std::invalid_argument("task_id 必须为长度 1 到 256 的字符串");
    }
    const auto& pose = data.at("grasp_pose");
    const auto position = read_vector(pose.at("position"), 3);
    const auto orientation = read_vector(pose.at("orientation"), 4);
    Eigen::Quaterniond quaternion(orientation(3), orientation(0), orientation(1), orientation(2));
    if (!std::isfinite(quaternion.norm()) || quaternion.norm() < 1e-12)
    {
        throw std::invalid_argument("四元数范数必须为正有限数");
    }
    quaternion.normalize();
    if (!data.at("force_limit").is_number())
    {
        throw std::invalid_argument("force_limit 必须为数值");
    }
    const double force = data.at("force_limit").as<double>();
    if (!std::isfinite(force) || force <= 0.0 || force > m_config.maximum_force)
    {
        throw std::invalid_argument("夹持力必须为正且不超过配置上限");
    }
    Eigen::VectorXd reference = data.contains("current_joint_angles")
        ? read_vector(data.at("current_joint_angles"), motion::JOINT_COUNT) : m_config.initial_joints;
    if ((reference.array() < m_model.joint_min.array()).any()
        || (reference.array() > m_model.joint_max.array()).any())
    {
        throw std::invalid_argument("参考关节角超过模型限位");
    }
    Eigen::Matrix4d world_tcp = Eigen::Matrix4d::Identity();
    world_tcp.block<3, 3>(0, 0) = quaternion.toRotationMatrix();
    world_tcp.block<3, 1>(0, 3) = position;
    const Eigen::Matrix4d target = m_model.world_from_base.inverse() * world_tcp * m_model.flange_from_tcp.inverse();
    motion::UR5InverseKinematics solver(m_model);
    const auto solutions = solver.compute_ik(target, reference);
    if (solutions.empty())
    {
        throw PlanningError("目标不可达或所有解析解超过关节限位");
    }
    const auto selected = solver.select_nearest_solution(solutions, reference);
    const double duration = motion::TrajectoryPlanner::calculate_duration(reference, selected,
        m_config.max_velocity, m_config.max_acceleration, m_config.minimum_duration);
    const auto samples = motion::TrajectoryPlanner().joint_poly_traj(reference, selected, m_config.sample_count);
    Json result = Json::object();
    result["task_id"] = data.at("task_id");
    result["phase"] = "planned";
    result["is_success"] = true;
    result["executed"] = false;
    result["execution_mode"] = "plan_only";
    result["reference_source"] = data.contains("current_joint_angles") ? "request" : "config";
    result["joint_target"] = vector_json(selected);
    result["force_limit"] = force;
    result["solution_count"] = solutions.size();
    result["duration_sec"] = duration;
    result["sample_period_sec"] = duration/(m_config.sample_count - 1);
    result["joint_trajectory"] = Json::array();
    for (const auto& angles : samples)
    {
        result["joint_trajectory"].push_back(vector_json(angles));
    }
    return build_message("motion_status", result);
}
}
